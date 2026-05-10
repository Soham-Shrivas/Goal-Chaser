const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const db = new Database('goalchaser.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    displayName TEXT,
    bio TEXT DEFAULT '',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    friendId INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id),
    FOREIGN KEY (friendId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER NOT NULL,
    receiverId INTEGER NOT NULL,
    message TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (senderId) REFERENCES users(id),
    FOREIGN KEY (receiverId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    createdBy INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (createdBy) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (groupId) REFERENCES groups(id),
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS study_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    groupId INTEGER,
    startTime DATETIME DEFAULT CURRENT_TIMESTAMP,
    endTime DATETIME,
    seconds INTEGER DEFAULT 0,
    FOREIGN KEY (userId) REFERENCES users(id),
    FOREIGN KEY (groupId) REFERENCES groups(id)
  );
`);

const users = new Map();
const userSockets = new Map();

function getUser(id) {
  const stmt = db.prepare('SELECT id, username, displayName, bio FROM users WHERE id = ?');
  return stmt.get(id);
}

function getUserByUsername(username) {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  return stmt.get(username);
}

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const existing = getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, password, displayName) VALUES (?, ?, ?)');
    const result = stmt.run(username, hashedPassword, displayName || username);

    res.json({ success: true, userId: result.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = getUserByUsername(username);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      success: true,
      user: { id: user.id, username: user.username, displayName: user.displayName, bio: user.bio }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user/:id', (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.put('/api/user/profile', (req, res) => {
  const { userId, displayName, bio } = req.body;
  const stmt = db.prepare('UPDATE users SET displayName = ?, bio = ? WHERE id = ?');
  stmt.run(displayName || '', bio || '', userId);
  res.json({ success: true });
});

app.get('/api/users/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const stmt = db.prepare('SELECT id, username, displayName FROM users WHERE username LIKE ? OR displayName LIKE ? LIMIT 20');
  const results = stmt.all(`%${q}%`, `%${q}%`);
  res.json(results);
});

app.get('/api/friends/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName, u.bio FROM users u
    JOIN friends f ON (f.friendId = u.id AND f.userId = ?) OR (f.userId = u.id AND f.friendId = ?)
    WHERE f.status = 'accepted'
  `);
  const friends = stmt.all(userId, userId);
  res.json(friends);
});

app.get('/api/friends/requests/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName FROM users u
    JOIN friends f ON f.userId = u.id AND f.friendId = ? AND f.status = 'pending'
  `);
  const requests = stmt.all(userId);
  res.json(requests);
});

app.post('/api/friends/add', (req, res) => {
  const { userId, friendId } = req.body;
  const existing = db.prepare('SELECT * FROM friends WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)')
    .get(userId, friendId, friendId, userId);
  if (existing) return res.status(400).json({ error: 'Already friends or request pending' });

  db.prepare('INSERT INTO friends (userId, friendId, status) VALUES (?, ?, ?)').run(userId, friendId, 'pending');

  const friendSocket = userSockets.get(friendId);
  if (friendSocket) {
    io.to(friendSocket).emit('friend_request', { from: userId });
  }
  res.json({ success: true });
});

app.post('/api/friends/accept', (req, res) => {
  const { userId, friendId } = req.body;
  db.prepare('UPDATE friends SET status = ? WHERE userId = ? AND friendId = ?').run('accepted', friendId, userId);
  db.prepare('INSERT INTO friends (userId, friendId, status) VALUES (?, ?, ?)').run(userId, friendId, 'accepted');
  res.json({ success: true });
});

app.post('/api/friends/remove', (req, res) => {
  const { userId, friendId } = req.body;
  db.prepare('DELETE FROM friends WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)').run(userId, friendId, friendId, userId);
  res.json({ success: true });
});

app.get('/api/messages/:userId/:friendId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const friendId = parseInt(req.params.friendId);
  const stmt = db.prepare(`
    SELECT * FROM messages
    WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?)
    ORDER BY createdAt ASC LIMIT 100
  `);
  const messages = stmt.all(userId, friendId, friendId, userId);
  res.json(messages);
});

app.post('/api/messages/send', (req, res) => {
  const { senderId, receiverId, message } = req.body;
  db.prepare('INSERT INTO messages (senderId, receiverId, message) VALUES (?, ?, ?)').run(senderId, receiverId, message);

  const receiverSocket = userSockets.get(receiverId);
  if (receiverSocket) {
    io.to(receiverSocket).emit('new_message', { senderId, message, createdAt: new Date().toISOString() });
  }
  res.json({ success: true });
});

app.get('/api/groups/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const stmt = db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members gm ON gm.groupId = g.id
    WHERE gm.userId = ?
  `);
  const groups = stmt.all(userId);
  res.json(groups);
});

app.post('/api/groups', (req, res) => {
  const { name, userId } = req.body;
  const result = db.prepare('INSERT INTO groups (name, createdBy) VALUES (?, ?)').run(name, userId);
  const groupId = result.lastInsertRowid;
  db.prepare('INSERT INTO group_members (groupId, userId) VALUES (?, ?)').run(groupId, userId);
  res.json({ success: true, groupId });
});

app.get('/api/groups/:groupId/members', (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName FROM users u
    JOIN group_members gm ON gm.userId = u.id
    WHERE gm.groupId = ?
  `);
  const members = stmt.all(groupId);
  res.json(members);
});

app.post('/api/groups/:groupId/join', (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const { userId } = req.body;
  const existing = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
  if (existing) return res.status(400).json({ error: 'Already a member' });
  db.prepare('INSERT INTO group_members (groupId, userId) VALUES (?, ?)').run(groupId, userId);
  res.json({ success: true });
});

app.post('/api/groups/:groupId/leave', (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const { userId } = req.body;
  db.prepare('DELETE FROM group_members WHERE groupId = ? AND userId = ?').run(groupId, userId);
  res.json({ success: true });
});

app.get('/api/groups/:groupId/study-time', (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName, 
           COALESCE(SUM(ss.seconds), 0) as totalSeconds
    FROM users u
    LEFT JOIN study_sessions ss ON ss.userId = u.id AND ss.groupId = ?
    JOIN group_members gm ON gm.userId = u.id AND gm.groupId = ?
    GROUP BY u.id
  `);
  const studyTimes = stmt.all(groupId, groupId);
  res.json(studyTimes);
});

io.on('connection', (socket) => {
  socket.on('auth', (userId) => {
    users.set(socket.id, userId);
    userSockets.set(userId, socket.id);
    socket.emit('online', { userId });
  });

  socket.on('start_study', ({ userId, groupId }) => {
    const result = db.prepare('INSERT INTO study_sessions (userId, groupId) VALUES (?, ?)').run(userId, groupId || null);
    const sessionId = result.lastInsertRowid;
    socket.sessionId = sessionId;

    if (groupId) {
      const members = db.prepare('SELECT userId FROM group_members WHERE groupId = ?').all(groupId);
      members.forEach(m => {
        const sock = userSockets.get(m.userId);
        if (sock) io.to(sock).emit('study_started', { userId, groupId });
      });
    }
  });

  socket.on('stop_study', ({ userId, groupId }) => {
    if (socket.sessionId) {
      const elapsed = Math.floor((Date.now() - socket.studyStartTime) / 1000);
      db.prepare('UPDATE study_sessions SET endTime = CURRENT_TIMESTAMP, seconds = ? WHERE id = ?')
        .run(elapsed, socket.sessionId);
      socket.sessionId = null;

      if (groupId) {
        const stmt = db.prepare(`
          SELECT u.id, u.username, u.displayName, COALESCE(SUM(ss.seconds), 0) as totalSeconds
          FROM users u
          LEFT JOIN study_sessions ss ON ss.userId = u.id AND ss.groupId = ?
          JOIN group_members gm ON gm.userId = u.id AND gm.groupId = ?
          GROUP BY u.id
        `);
        const studyTimes = stmt.all(groupId, groupId);
        const members = db.prepare('SELECT userId FROM group_members WHERE groupId = ?').all(groupId);
        members.forEach(m => {
          const sock = userSockets.get(m.userId);
          if (sock) io.to(sock).emit('study_updated', { groupId, studyTimes });
        });
      }
    }
  });

  socket.on('typing', ({ receiverId }) => {
    const receiverSocket = userSockets.get(receiverId);
    if (receiverSocket) io.to(receiverSocket).emit('typing', { from: users.get(socket.id) });
  });

  socket.on('join_group_room', (groupId) => {
    socket.join(`group_${groupId}`);
  });

  socket.on('leave_group_room', (groupId) => {
    socket.leave(`group_${groupId}`);
  });

  socket.on('disconnect', () => {
    const userId = users.get(socket.id);
    if (userId) {
      userSockets.delete(userId);
      users.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Goal Chaser server running on http://localhost:${PORT}`);
});