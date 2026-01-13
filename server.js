import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { moderate, generateTopic } from './moderation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Add JSON parser for feedback endpoint
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

/**
 * GLOBAL TIME LOGIC (Clock-Aligned)
 */
const getNextBoundary = (minutes) => {
  const ms = minutes * 60 * 1000;
  return Math.ceil(Date.now() / ms) * ms;
};

// In-memory state
let users = new Map();
let communityMessages = []; 
let privateRooms = new Map(); 
let privateMessages = new Map(); // roomId -> Array<Message>
let feedbacks = []; // In-memory storage for anonymous feedback
let communityTimerEnd = getNextBoundary(30);
let siteTimerEnd = getNextBoundary(120);
let currentTopic = "What is a thought you've never shared out loud?";
let sessionStyle = 'DEEP'; 

// Quiet Moment state
let quietStart = 0;
let quietEnd = 0;

const calculateQuietMoment = (endTime) => {
  const windowStart = endTime - (10 * 60 * 1000);
  const randomOffset = Math.random() * (8 * 60 * 1000); 
  quietStart = windowStart + randomOffset;
  quietEnd = quietStart + (2 * 60 * 1000);
};

const resetCommunity = async () => {
  communityMessages = [];
  communityTimerEnd = getNextBoundary(30);
  sessionStyle = sessionStyle === 'DEEP' ? 'PLAYFUL' : 'DEEP';
  currentTopic = await generateTopic(sessionStyle);
  calculateQuietMoment(communityTimerEnd);

  io.emit('RESET_COMMUNITY', { 
    nextReset: communityTimerEnd,
    topic: currentTopic,
    quietMoment: { start: quietStart, end: quietEnd }
  });
};

const resetSite = () => {
  users.clear();
  communityMessages = [];
  privateRooms.clear();
  privateMessages.clear();
  feedbacks = [];
  communityTimerEnd = getNextBoundary(30);
  siteTimerEnd = getNextBoundary(120);
  calculateQuietMoment(communityTimerEnd);
  io.emit('RESET_SITE', { nextReset: siteTimerEnd });
};

calculateQuietMoment(communityTimerEnd);
generateTopic('DEEP').then(topic => { currentTopic = topic; });

setInterval(() => {
  const now = Date.now();
  if (now >= communityTimerEnd) resetCommunity();
  if (now >= siteTimerEnd) resetSite();

  communityMessages = communityMessages.filter(m => now - m.timestamp < 300000);
  
  for (let [id, room] of privateRooms.entries()) {
    // 1. Absolute Main Timer Priority
    if (now >= room.expiresAt) {
      privateRooms.delete(id);
      privateMessages.delete(id);
      io.emit('CHAT_CLOSED', { roomId: id, reason: 'expired' });
      continue;
    }

    const activeParticipantsCount = Array.from(users.values())
      .filter(u => room.participants.includes(u.id))
      .length;

    // 2. Rejoin Window Logic with Absolute Capping
    if (activeParticipantsCount < 2) {
      if (!room.rejoinStartedAt) {
        room.rejoinStartedAt = now;
      }
      
      const rejoinLimit = room.rejoinStartedAt + (15 * 60 * 1000);
      // Rejoin window cannot exceed the session expiry time
      const effectiveDeadline = Math.min(rejoinLimit, room.expiresAt);

      if (now >= effectiveDeadline) {
        privateRooms.delete(id);
        privateMessages.delete(id);
        io.emit('CHAT_CLOSED', { roomId: id, reason: 'rejoin_expired' });
      }
    } else {
      room.rejoinStartedAt = null;
    }
  }
}, 1000);

// ANONYMOUS FEEDBACK ENDPOINT
app.post('/api/feedback', (req, res) => {
  const { feedback } = req.body;
  if (!feedback) {
    return res.status(400).json({ error: 'No feedback provided' });
  }

  const wordCount = feedback.trim().split(/\s+/).filter(word => word.length > 0).length;
  if (wordCount < 15) {
    return res.status(400).json({ error: 'Feedback too short' });
  }

  // --- CONFIGURATION: IN-MEMORY FEEDBACK ---
  const feedbackEntry = { text: feedback };
  feedbacks.push(feedbackEntry);
  if (feedbacks.length > 50) feedbacks.shift(); // Keep only latest 50
  
  // Broadcast immediately to all connected clients
  io.emit('NEW_FEEDBACK', feedbackEntry);
  
  res.json({ success: true });
});

io.on('connection', (socket) => {
  socket.hasSeenSoftFirst = false;
  socket.borderlineCount = 0;
  socket.isShadowLimited = false;

  socket.emit('INIT_STATE', {
    communityMessages,
    communityTimerEnd,
    siteTimerEnd,
    feedbacks,
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
          privateMessages.delete(roomId);
          io.emit('CHAT_CLOSED', { roomId, reason: 'moderation', systemMessage: 'This private chat has ended.' });
        }
      } else {
        socket.emit('MESSAGE', data); 
      }
      return;
    }

    if (status === 'BORDERLINE') {
      socket.borderlineCount++;
      if (socket.borderlineCount > 4) socket.isShadowLimited = true;
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
    } else {
      // Store Private History
      if (!privateMessages.has(data.message.roomId)) {
        privateMessages.set(data.message.roomId, []);
      }
      privateMessages.get(data.message.roomId).push(data.message);
    }
    io.emit('MESSAGE', data);
  });

  socket.on('CHAT_REQUEST', (data) => {
    socket.broadcast.emit('CHAT_REQUEST', data);
  });

  socket.on('CHAT_ACCEPT', (data) => {
    // Generate session tokens for secure rejoin
    const tokenA = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const tokenB = Math.random().toString(36).substring(2) + Date.now().toString(36);
    
    const participantTokens = {};
    participantTokens[data.room.participants[0]] = tokenA;
    participantTokens[data.room.participants[1]] = tokenB;

    const room = {
        ...data.room,
        participantTokens,
        stageDecisions: { '5min': {}, '2min': {} }
    };
    privateRooms.set(room.id, room);
    // Send history if rejoining or just created (usually empty on create)
    const history = privateMessages.get(room.id) || [];
    io.emit('CHAT_ACCEPT', { ...data, room, messages: history });
  });

  socket.on('CHAT_EXIT', (data) => {
    if (privateRooms.has(data.roomId)) {
      privateRooms.delete(data.roomId);
      privateMessages.delete(data.roomId);
      io.emit('CHAT_CLOSED', { roomId: data.roomId, reason: 'exit' });
    }
  });

  socket.on('CHAT_EXTENSION_DECISION', (data) => {
    const { roomId, stage, decision, userId } = data;
    const room = privateRooms.get(roomId);
    if (!room || room.extended) return;

    if (!room.stageDecisions) room.stageDecisions = { '5min': {}, '2min': {} };
    if (!room.stageDecisions[stage]) room.stageDecisions[stage] = {};
    
    room.stageDecisions[stage][userId] = decision;

    const decisionsEntries = Object.entries(room.stageDecisions[stage]);
    if (decisionsEntries.length >= 2) {
      const decisions = decisionsEntries.map(e => e[1]);
      if (decisions.every(d => d === 'EXTEND')) {
        room.extended = true;
        room.expiresAt = Date.now() + 30 * 60 * 1000;
        privateRooms.set(room.id, room);
        io.emit('CHAT_EXTENDED', { room });
        
        const sysMsg = {
          id: 'sys_ext_' + Math.random().toString(36).substring(7),
          senderId: 'system',
          senderName: 'SYSTEM',
          text: 'Both users agreed. Session extended by 30 minutes.',
          timestamp: Date.now(),
          roomId: room.id
        };
        io.emit('MESSAGE', { message: sysMsg });
      } else {
        // Mixed Decisions Feedback (Fix 4)
        for (const [uId, d] of decisionsEntries) {
          const targetSocket = Array.from(users.values()).find(u => u.id === uId)?.socketId;
          if (targetSocket) {
            let feedback = "";
            if (d === 'EXTEND') feedback = "The other person chose to decide later.";
            else feedback = "You chose to decide later.";
            
            io.to(targetSocket).emit('MESSAGE', {
              message: {
                id: 'sys_ext_fb_' + Date.now(),
                senderId: 'system',
                senderName: 'SYSTEM',
                text: feedback,
                timestamp: Date.now(),
                roomId: roomId
              }
            });
          }
        }
      }
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
      // Validate session token for same-device security
      const tokenValues = Object.values(foundRoom.participantTokens || {});
      const isValidToken = data.sessionToken && tokenValues.includes(data.sessionToken);

      if (isValidToken) {
        // Find original owner of this token and update their ID to current session ID
        let originalId = null;
        for (let [uid, token] of Object.entries(foundRoom.participantTokens)) {
            if (token === data.sessionToken) {
                originalId = uid;
                break;
            }
        }

        // Update participant list and token mapping
        if (originalId && originalId !== currentUser.id) {
            const index = foundRoom.participants.indexOf(originalId);
            if (index > -1) foundRoom.participants[index] = currentUser.id;
            
            delete foundRoom.participantTokens[originalId];
            foundRoom.participantTokens[currentUser.id] = data.sessionToken;
        }

        if (!foundRoom.participants.includes(currentUser.id)) foundRoom.participants.push(currentUser.id);
        
        if (foundRoom.rejoinStartedAt) {
          foundRoom.rejoinStartedAt = null;
          io.emit('MESSAGE', {
            message: {
              id: 'sys_rej_' + Date.now(),
              senderId: 'system',
              senderName: 'SYSTEM',
              text: "Your ghost rejoined the chat.",
              timestamp: Date.now(),
              roomId: foundRoom.id
            }
          });
        }

        const history = privateMessages.get(foundRoom.id) || [];
        io.emit('CHAT_ACCEPT', { room: foundRoom, messages: history });
      } else {
        socket.emit('ERROR', { message: 'Session not available.' });
      }
    } else {
      socket.emit('ERROR', { message: 'Session not available.' });
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      for (let [roomId, room] of privateRooms.entries()) {
        if (room.participants.includes(user.id)) {
          room.rejoinStartedAt = Date.now();
          io.emit('ROOM_UPDATE', { room });
          
          const otherId = room.participants.find(p => p !== user.id);
          const otherSocketId = Array.from(users.values()).find(u => u.id === otherId)?.socketId;
          if (otherSocketId) {
            io.to(otherSocketId).emit('MESSAGE', {
              message: {
                id: 'sys_disc_' + Date.now(),
                senderId: 'system',
                senderName: 'SYSTEM',
                text: "Your ghost disconnected. Waiting 15 minutes.",
                timestamp: Date.now(),
                roomId: roomId
              }
            });
          }
        }
      }
    }
    users.delete(socket.id);
  });
});

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
server.listen(process.env.PORT || 3000);