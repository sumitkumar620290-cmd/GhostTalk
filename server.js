
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { moderate, generateTopic } from './moderation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

/**
 * GLOBAL TIME LOGIC (Clock-Aligned)
 * Resets happen at :00 and :30 of every hour for community.
 * Resets happen every 2 hours on the hour for site.
 */
const getNextBoundary = (minutes) => {
  const ms = minutes * 60 * 1000;
  return Math.ceil(Date.now() / ms) * ms;
};

// In-memory state
let users = new Map();
let communityMessages = []; 
let privateRooms = new Map(); 
let communityTimerEnd = getNextBoundary(30);
let siteTimerEnd = getNextBoundary(120);
let currentTopic = "What is a thought you've never shared out loud?";
let sessionStyle = 'DEEP'; 

// Quiet Moment state
let quietStart = 0;
let quietEnd = 0;

const calculateQuietMoment = (endTime) => {
  // Random start time in the final 10 minutes (minutes 20 to 28 of the 30-min session)
  const windowStart = endTime - (10 * 60 * 1000);
  const randomOffset = Math.random() * (8 * 60 * 1000); 
  quietStart = windowStart + randomOffset;
  quietEnd = quietStart + (2 * 60 * 1000);
};

const resetCommunity = async () => {
  communityMessages = [];
  communityTimerEnd = getNextBoundary(30);
  
  // Topic Rotation Logic
  sessionStyle = sessionStyle === 'DEEP' ? 'PLAYFUL' : 'DEEP';
  currentTopic = await generateTopic(sessionStyle);

  calculateQuietMoment(communityTimerEnd);

  io.emit('RESET_COMMUNITY', { 
    nextReset: communityTimerEnd,
    topic: currentTopic,
    quietMoment: { start: quietStart, end: quietEnd }
  });
  console.log(`Clock-aligned reset. Next: ${new Date(communityTimerEnd).toLocaleTimeString()}. Topic: ${currentTopic}`);
};

const resetSite = () => {
  users.clear();
  communityMessages = [];
  privateRooms.clear();
  communityTimerEnd = getNextBoundary(30);
  siteTimerEnd = getNextBoundary(120);
  calculateQuietMoment(communityTimerEnd);
  io.emit('RESET_SITE', { nextReset: siteTimerEnd });
};

// Initial setup
calculateQuietMoment(communityTimerEnd);
generateTopic('DEEP').then(topic => { currentTopic = topic; });

// Main ticker for clock-aligned checks
setInterval(() => {
  const now = Date.now();
  
  // Check for Community Reset
  if (now >= communityTimerEnd) {
    resetCommunity();
  }

  // Check for Site Reset
  if (now >= siteTimerEnd) {
    resetSite();
  }

  // Cleanup loop
  communityMessages = communityMessages.filter(m => now - m.timestamp < 300000);
  
  for (let [id, room] of privateRooms.entries()) {
    if (now > room.expiresAt) {
      privateRooms.delete(id);
      io.emit('CHAT_CLOSED', { roomId: id, reason: 'expired' });
      continue;
    }

    const activeParticipantsCount = Array.from(users.values())
      .filter(u => room.participants.includes(u.id))
      .length;

    if (activeParticipantsCount < 2) {
      if (!room.rejoinStartedAt) {
        room.rejoinStartedAt = now;
      } else if (now - room.rejoinStartedAt > 15 * 60 * 1000) {
        privateRooms.delete(id);
        io.emit('CHAT_CLOSED', { roomId: id, reason: 'rejoin_expired' });
      }
    } else {
      room.rejoinStartedAt = null;
    }
  }
}, 1000);

io.on('connection', (socket) => {
  socket.hasSeenSoftFirst = false;
  socket.borderlineCount = 0;
  socket.isShadowLimited = false;

  socket.emit('INIT_STATE', {
    communityMessages,
    communityTimerEnd,
    siteTimerEnd,
    onlineUsers: Array.from(users.values()),
    currentTopic,
    quietMoment: { start: quietStart, end: quietEnd }
  });

  socket.on('HEARTBEAT', (data) => {
    if (!data.user) return;
    users.set(socket.id, { ...data.user, socketId: socket.id });
    socket.broadcast.emit('HEARTBEAT', { 
      user: data.user,
      communityTimerEnd,
      siteTimerEnd
    });
  });

  socket.on('MESSAGE', async (data) => {
    if (!data || !data.message || !data.message.text) return;

    const now = Date.now();

    // FEATURE 2: RANDOM QUIET MOMENT
    if (data.message.roomId === 'community' && now >= quietStart && now <= quietEnd) {
      const sysMsg = {
        id: 'sys_quiet_' + Math.random().toString(36).substring(7),
        senderId: 'system',
        senderName: 'SYSTEM',
        text: 'Quiet moment. Just read.',
        timestamp: now,
        roomId: 'community'
      };
      socket.emit('MESSAGE', { message: sysMsg });
      return;
    }

    const status = await moderate(data.message.text);

    if (status === 'BLOCKED') {
      if (data.message.roomId !== 'community') {
        const roomId = data.message.roomId;
        if (privateRooms.has(roomId)) {
          privateRooms.delete(roomId);
          io.emit('CHAT_CLOSED', { 
            roomId, 
            reason: 'moderation',
            systemMessage: 'This private chat has ended.' 
          });
        }
      } else {
        socket.emit('MESSAGE', data); 
      }
      return;
    }

    if (status === 'BORDERLINE') {
      socket.borderlineCount++;
      if (socket.borderlineCount > 4) {
        socket.isShadowLimited = true;
      }

      if (!socket.hasSeenSoftFirst) {
        const systemMsg = {
          id: 'sys_' + Math.random().toString(36).substring(7),
          senderId: 'system',
          senderName: 'SYSTEM',
          text: 'Let’s keep Ghost Talk safe for everyone.',
          timestamp: Date.now(),
          roomId: data.message.roomId
        };
        socket.emit('MESSAGE', { message: systemMsg });
        socket.hasSeenSoftFirst = true;
      }
    }

    if (socket.isShadowLimited) {
      socket.emit('MESSAGE', data);
      return;
    }

    if (data.message.roomId === 'community') {
      communityMessages.push(data.message);
      if (communityMessages.length > 200) communityMessages.shift();
    }
    io.emit('MESSAGE', data);
  });

  socket.on('CHAT_REQUEST', (data) => {
    socket.broadcast.emit('CHAT_REQUEST', data);
  });

  socket.on('CHAT_ACCEPT', (data) => {
    privateRooms.set(data.room.id, data.room);
    io.emit('CHAT_ACCEPT', data);
  });

  socket.on('CHAT_EXIT', (data) => {
    if (privateRooms.has(data.roomId)) {
      privateRooms.delete(data.roomId);
      io.emit('CHAT_CLOSED', { roomId: data.roomId, reason: 'exit' });
    }
  });

  socket.on('CHAT_EXTEND', (data) => {
    const room = privateRooms.get(data.roomId);
    if (room && !room.extended) {
      room.extended = true;
      room.expiresAt = Date.now() + 30 * 60 * 1000;
      privateRooms.set(room.id, room);
      io.emit('CHAT_EXTENDED', { room });
    }
  });

  socket.on('CHAT_REJOIN', (data) => {
    const currentUser = users.get(socket.id);
    if (!currentUser) return;

    let foundRoom = null;
    for (let room of privateRooms.values()) {
      if (room.reconnectCode === data.reconnectCode) {
        foundRoom = room;
        break;
      }
    }

    if (foundRoom) {
      if (!foundRoom.participants.includes(currentUser.id)) {
        foundRoom.participants.push(currentUser.id);
      }
      io.emit('CHAT_ACCEPT', { room: foundRoom });
    } else {
      socket.emit('ERROR', { message: 'Invalid or Expired Secret Key' });
    }
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
  });
});

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`GhostTalk Server running on port ${PORT}`);
});
