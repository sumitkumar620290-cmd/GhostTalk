
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// In-memory state
let users = new Map();
let communityMessages = []; 
let privateRooms = new Map(); // Store active private sessions
let communityTimerEnd = Date.now() + 30 * 60 * 1000;
let siteTimerEnd = Date.now() + 120 * 60 * 1000;

const resetCommunity = () => {
  communityMessages = [];
  communityTimerEnd = Date.now() + 30 * 60 * 1000;
  io.emit('RESET_COMMUNITY', { nextReset: communityTimerEnd });
  console.log('Community reset triggered');
};

const resetSite = () => {
  users.clear();
  communityMessages = [];
  privateRooms.clear();
  communityTimerEnd = Date.now() + 30 * 60 * 1000;
  siteTimerEnd = Date.now() + 120 * 60 * 1000;
  io.emit('RESET_SITE', { nextReset: siteTimerEnd });
  console.log('Site reset triggered');
};

setInterval(resetCommunity, 30 * 60 * 1000);
setInterval(resetSite, 120 * 60 * 1000);

setInterval(() => {
  const now = Date.now();
  communityMessages = communityMessages.filter(m => now - m.timestamp < 300000);
  
  for (let [id, room] of privateRooms.entries()) {
    if (now > room.expiresAt) {
      privateRooms.delete(id);
      io.emit('CHAT_CLOSED', { roomId: id, reason: 'expired' });
      console.log(`Private room ${id} expired.`);
    }
  }
}, 5000);

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Send current state including the list of currently active users
  socket.emit('INIT_STATE', {
    communityMessages,
    communityTimerEnd,
    siteTimerEnd,
    onlineUsers: Array.from(users.values())
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

  socket.on('MESSAGE', (data) => {
    if (data.message.roomId === 'community') {
      communityMessages.push(data.message);
      if (communityMessages.length > 200) communityMessages.shift();
    }
    io.emit('MESSAGE', data);
  });

  socket.on('CHAT_REQUEST', (data) => {
    console.log(`Chat request from ${data.request.fromName} to ${data.request.toId}`);
    socket.broadcast.emit('CHAT_REQUEST', data);
  });

  socket.on('CHAT_ACCEPT', (data) => {
    console.log(`Chat accepted for room ${data.room.id}`);
    privateRooms.set(data.room.id, data.room);
    io.emit('CHAT_ACCEPT', data);
  });

  socket.on('CHAT_EXIT', (data) => {
    if (privateRooms.has(data.roomId)) {
      privateRooms.delete(data.roomId);
      io.emit('CHAT_CLOSED', { roomId: data.roomId, reason: 'exit' });
      console.log(`Private room ${data.roomId} closed by user.`);
    }
  });

  socket.on('CHAT_EXTEND', (data) => {
    const room = privateRooms.get(data.roomId);
    if (room && !room.extended) {
      room.extended = true;
      room.expiresAt = Date.now() + 30 * 60 * 1000;
      privateRooms.set(room.id, room);
      io.emit('CHAT_EXTENDED', { room });
      console.log(`Private room ${room.id} extended.`);
    }
  });

  socket.on('CHAT_REJOIN', (data) => {
    const currentUser = users.get(socket.id);
    if (!currentUser) {
      socket.emit('ERROR', { message: 'Connection issue. Please wait.' });
      return;
    }

    let foundRoom = null;
    for (let room of privateRooms.values()) {
      if (room.reconnectCode === data.reconnectCode) {
        foundRoom = room;
        break;
      }
    }

    if (foundRoom) {
      // Add the new user ID to participants list so client-side check passes
      if (!foundRoom.participants.includes(currentUser.id)) {
        foundRoom.participants.push(currentUser.id);
      }
      // Broadcast update to EVERYONE so the original partner also gets the new ID list
      io.emit('CHAT_ACCEPT', { room: foundRoom });
      console.log(`User ${currentUser.username} restored session via key: ${data.reconnectCode}`);
    } else {
      socket.emit('ERROR', { message: 'Invalid or Expired Secret Key' });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
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
