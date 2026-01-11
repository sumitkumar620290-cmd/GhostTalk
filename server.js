
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

  socket.emit('INIT_STATE', {
    communityMessages,
    communityTimerEnd,
    siteTimerEnd
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
    socket.broadcast.emit('CHAT_REQUEST', data);
  });

  socket.on('CHAT_ACCEPT', (data) => {
    privateRooms.set(data.room.id, data.room);
    io.emit('CHAT_ACCEPT', data);
  });

  socket.on('CHAT_EXIT', (data) => {
    // data: { roomId }
    if (privateRooms.has(data.roomId)) {
      privateRooms.delete(data.roomId);
      io.emit('CHAT_CLOSED', { roomId: data.roomId, reason: 'exit' });
      console.log(`Private room ${data.roomId} closed by user.`);
    }
  });

  socket.on('CHAT_EXTEND', (data) => {
    // data: { roomId }
    const room = privateRooms.get(data.roomId);
    if (room && !room.extended) {
      room.extended = true;
      room.expiresAt = Date.now() + 30 * 60 * 1000; // Reset to 30 more mins
      privateRooms.set(room.id, room);
      io.emit('CHAT_EXTENDED', { room });
      console.log(`Private room ${room.id} extended.`);
    }
  });

  socket.on('CHAT_REJOIN', (data) => {
    let found = false;
    for (let room of privateRooms.values()) {
      if (room.reconnectCode === data.reconnectCode) {
        socket.emit('CHAT_ACCEPT', { room });
        found = true;
        break;
      }
    }
    if (!found) {
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
  console.log(`AnonChat Server running on port ${PORT}`);
});
