const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/group/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/invite/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const DB_PATH = path.join(__dirname, 'goalchaser.db');
let db;

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      displayName TEXT,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      friendId INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      senderId INTEGER NOT NULL,
      receiverId INTEGER NOT NULL,
      message TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      createdBy INTEGER NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      groupId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS study_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      groupId INTEGER,
      startTime DATETIME DEFAULT CURRENT_TIMESTAMP,
      endTime DATETIME,
      seconds INTEGER DEFAULT 0
    )
  `);
  
  saveDB();
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

const users = new Map();
const userSockets = new Map();

function getUser(id) {
  const stmt = db.prepare('SELECT id, username, displayName, bio, avatar FROM users WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function getUserByUsername(username) {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  stmt.bind([username]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
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
    db.run('INSERT INTO users (username, password, displayName) VALUES (?, ?, ?)', [username, hashedPassword, displayName || username]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    const userId = result[0].values[0][0];
    
    saveDB();
    res.json({ success: true, userId, username, displayName: displayName || username });
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
      user: { id: user.id, username: user.username, displayName: user.displayName, bio: user.bio, avatar: user.avatar || '' }
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
  db.run('UPDATE users SET displayName = ?, bio = ? WHERE id = ?', [displayName || '', bio || '', userId]);
  saveDB();
  res.json({ success: true });
});

app.get('/api/users/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const stmt = db.prepare('SELECT id, username, displayName, avatar FROM users WHERE username LIKE ? OR displayName LIKE ? LIMIT 20');
  stmt.bind([`%${q}%`, `%${q}%`]);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(results);
});

app.get('/api/users/recommendations/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName, u.bio, u.avatar
    FROM users u
    WHERE u.id != ?
    AND u.id NOT IN (
      SELECT friendId FROM friends WHERE userId = ? AND status = 'accepted'
      UNION
      SELECT userId FROM friends WHERE friendId = ? AND status = 'accepted'
    )
    LIMIT 10
  `);
  stmt.bind([userId, userId, userId]);
  const recommendations = [];
  while (stmt.step()) {
    recommendations.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(recommendations);
});

app.get('/api/user/by-invite/:code', (req, res) => {
  const code = req.params.code;
  const parts = code.split('-');
  if (parts.length !== 2) return res.status(400).json({ error: 'Invalid invite code' });
  
  const userId = parseInt(parts[0]);
  const username = parts[1];
  
  const stmt = db.prepare('SELECT id, username, displayName FROM users WHERE id = ? AND username = ?');
  stmt.bind([userId, username]);
  
  if (stmt.step()) {
    const user = stmt.getAsObject();
    stmt.free();
    res.json({ success: true, user });
  } else {
    stmt.free();
    res.status(404).json({ error: 'User not found' });
  }
});

app.post('/api/invite/generate', (req, res) => {
  const { userId } = req.body;
  const stmt = db.prepare('SELECT id, username FROM users WHERE id = ?');
  stmt.bind([userId]);
  
  if (stmt.step()) {
    const user = stmt.getAsObject();
    stmt.free();
    const inviteCode = `${user.id}-${user.username}`;
    res.json({ success: true, inviteCode, username: user.username });
  } else {
    stmt.free();
    res.status(404).json({ error: 'User not found' });
  }
});

app.post('/api/user/avatar', (req, res) => {
  const { userId, avatar } = req.body;
  db.run('UPDATE users SET avatar = ? WHERE id = ?', [avatar, userId]);
  saveDB();
  res.json({ success: true });
});

app.get('/api/groups/invite/:code', (req, res) => {
  const code = req.params.code;
  const parts = code.split('-');
  if (parts.length < 2) return res.status(400).json({ error: 'Invalid group code' });
  
  const groupId = parseInt(parts[0]);
  const groupName = parts.slice(1).join('-');
  
  const stmt = db.prepare('SELECT id, name, createdBy FROM groups WHERE id = ? AND name = ?');
  stmt.bind([groupId, groupName]);
  
  if (stmt.step()) {
    const group = stmt.getAsObject();
    stmt.free();
    res.json({ success: true, group });
  } else {
    stmt.free();
    res.status(404).json({ error: 'Group not found' });
  }
});

app.post('/api/groups/invite/generate', (req, res) => {
  const { groupId } = req.body;
  const stmt = db.prepare('SELECT id, name FROM groups WHERE id = ?');
  stmt.bind([groupId]);
  
  if (stmt.step()) {
    const group = stmt.getAsObject();
    stmt.free();
    const inviteCode = `${group.id}-${group.name}`;
    res.json({ success: true, inviteCode, groupName: group.name });
  } else {
    stmt.free();
    res.status(404).json({ error: 'Group not found' });
  }
});

app.get('/api/groups/:groupId/addable-members/:userId', (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const userId = parseInt(req.params.userId);
  
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName, u.avatar
    FROM users u
    WHERE u.id != ?
    AND u.id NOT IN (SELECT userId FROM group_members WHERE groupId = ?)
    AND (
      u.id IN (
        SELECT friendId FROM friends WHERE userId = ? AND status = 'accepted'
        UNION
        SELECT userId FROM friends WHERE friendId = ? AND status = 'accepted'
      )
    )
  `);
  stmt.bind([userId, groupId, userId, userId]);
  const users = [];
  while (stmt.step()) {
    users.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(users);
});

app.get('/api/all-users', (req, res) => {
  const { exclude } = req.query;
  let query = 'SELECT id, username, displayName, avatar FROM users';
  let params = [];
  
  if (exclude) {
    const excludeIds = exclude.split(',').map(Number);
    const placeholders = excludeIds.map(() => '?').join(',');
    query += ` WHERE id NOT IN (${placeholders})`;
    params = excludeIds;
  }
  
  const stmt = db.prepare(query);
  stmt.bind(params);
  const users = [];
  while (stmt.step()) {
    users.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(users);
});

app.get('/api/friends/available/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName, u.avatar
    FROM users u
    WHERE u.id != ?
    AND u.id NOT IN (
      SELECT friendId FROM friends WHERE userId = ? AND status = 'accepted'
      UNION
      SELECT userId FROM friends WHERE friendId = ? AND status = 'accepted'
    )
    AND u.id NOT IN (
      SELECT friendId FROM friends WHERE userId = ? AND status = 'pending'
      UNION
      SELECT userId FROM friends WHERE friendId = ? AND status = 'pending'
    )
  `);
  stmt.bind([userId, userId, userId, userId, userId]);
  const users = [];
  while (stmt.step()) {
    users.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(users);
});

app.get('/api/friends/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName, u.bio, u.avatar FROM users u
    JOIN friends f ON (f.friendId = u.id AND f.userId = ?) OR (f.userId = u.id AND f.friendId = ?)
    WHERE f.status = 'accepted'
  `);
  stmt.bind([userId, userId]);
  const friends = [];
  while (stmt.step()) {
    friends.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(friends);
});

app.get('/api/friends/requests/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName, u.avatar FROM users u
    JOIN friends f ON f.userId = u.id AND f.friendId = ? AND f.status = 'pending'
  `);
  stmt.bind([userId]);
  const requests = [];
  while (stmt.step()) {
    requests.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(requests);
});

app.post('/api/friends/add', (req, res) => {
  const { userId, friendId } = req.body;
  
  const checkStmt = db.prepare('SELECT * FROM friends WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)');
  checkStmt.bind([userId, friendId, friendId, userId]);
  const exists = checkStmt.step();
  checkStmt.free();
  if (exists) return res.status(400).json({ error: 'Already friends or request pending' });

  db.run('INSERT INTO friends (userId, friendId, status) VALUES (?, ?, ?)', [userId, friendId, 'pending']);
  
  saveDB();
  
  const friendSocket = userSockets.get(friendId);
  if (friendSocket) {
    io.to(friendSocket).emit('friend_request', { from: userId });
  }
  
  res.json({ success: true, message: 'Friend request sent!' });
});

app.post('/api/friends/accept', (req, res) => {
  const { userId, friendId } = req.body;
  db.run('UPDATE friends SET status = ? WHERE userId = ? AND friendId = ?', ['accepted', friendId, userId]);
  db.run('INSERT INTO friends (userId, friendId, status) VALUES (?, ?, ?)', [userId, friendId, 'accepted']);
  saveDB();
  res.json({ success: true });
});

app.post('/api/friends/remove', (req, res) => {
  const { userId, friendId } = req.body;
  db.run('DELETE FROM friends WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)', [userId, friendId, friendId, userId]);
  saveDB();
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
  stmt.bind([userId, friendId, friendId, userId]);
  const messages = [];
  while (stmt.step()) {
    messages.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(messages);
});

app.post('/api/messages/send', (req, res) => {
  const { senderId, receiverId, message } = req.body;
  db.run('INSERT INTO messages (senderId, receiverId, message) VALUES (?, ?, ?)', [senderId, receiverId, message]);

  const receiverSocket = userSockets.get(receiverId);
  if (receiverSocket) {
    io.to(receiverSocket).emit('new_message', { senderId, message, createdAt: new Date().toISOString() });
  }
  saveDB();
  res.json({ success: true });
});

app.get('/api/groups/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const stmt = db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members gm ON gm.groupId = g.id
    WHERE gm.userId = ?
  `);
  stmt.bind([userId]);
  const groups = [];
  while (stmt.step()) {
    groups.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(groups);
});

app.post('/api/groups', (req, res) => {
  const { name, userId } = req.body;
  db.run('INSERT INTO groups (name, createdBy) VALUES (?, ?)', [name, userId]);
  const result = db.exec('SELECT last_insert_rowid() as id');
  const groupId = result[0].values[0][0];
  db.run('INSERT INTO group_members (groupId, userId) VALUES (?, ?)', [groupId, userId]);
  saveDB();
  res.json({ success: true, groupId });
});

app.get('/api/groups/:groupId/members', (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName FROM users u
    JOIN group_members gm ON gm.userId = u.id
    WHERE gm.groupId = ?
  `);
  stmt.bind([groupId]);
  const members = [];
  while (stmt.step()) {
    members.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(members);
});

app.post('/api/groups/:groupId/join', (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const { userId } = req.body;
  const stmt = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?');
  stmt.bind([groupId, userId]);
  const exists = stmt.step();
  stmt.free();
  if (exists) return res.status(400).json({ error: 'Already a member' });
  db.run('INSERT INTO group_members (groupId, userId) VALUES (?, ?)', [groupId, userId]);
  saveDB();
  res.json({ success: true });
});

app.post('/api/groups/:groupId/leave', (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const { userId } = req.body;
  db.run('DELETE FROM group_members WHERE groupId = ? AND userId = ?', [groupId, userId]);
  saveDB();
  res.json({ success: true });
});

app.get('/api/groups/:groupId/study-time', (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName, u.avatar, 
           COALESCE(SUM(ss.seconds), 0) as totalSeconds
    FROM users u
    LEFT JOIN study_sessions ss ON ss.userId = u.id AND ss.groupId = ?
    JOIN group_members gm ON gm.userId = u.id AND gm.groupId = ?
    GROUP BY u.id
  `);
  stmt.bind([groupId, groupId]);
  const studyTimes = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const isStudying = studyingUsers.has(row.id) && studyingUsers.get(row.id) === groupId;
    row.isStudying = isStudying;
    studyTimes.push(row);
  }
  stmt.free();
  res.json(studyTimes);
});

app.get('/api/admin/users', (req, res) => {
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.displayName, u.bio, u.avatar, u.createdAt,
           COALESCE(SUM(ss.seconds), 0) as totalStudyTime,
           COUNT(DISTINCT ss.id) as sessionCount,
           (SELECT COUNT(*) FROM friends WHERE userId = u.id OR friendId = u.id) as friendCount
    FROM users u
    LEFT JOIN study_sessions ss ON ss.userId = u.id
    GROUP BY u.id
    ORDER BY u.id DESC
  `);
  const users = [];
  while (stmt.step()) {
    users.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(users);
});

app.get('/api/admin/all-sessions', (req, res) => {
  const stmt = db.prepare(`
    SELECT ss.*, u.username, u.displayName, g.name as groupName
    FROM study_sessions ss
    JOIN users u ON u.id = ss.userId
    LEFT JOIN groups g ON g.id = ss.groupId
    ORDER BY ss.startTime DESC
    LIMIT 100
  `);
  const sessions = [];
  while (stmt.step()) {
    sessions.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(sessions);
});

app.post('/api/admin/update-user', (req, res) => {
  const { userId, displayName, bio, action } = req.body;
  
  if (action === 'delete') {
    db.run('DELETE FROM messages WHERE senderId = ? OR receiverId = ?', [userId, userId]);
    db.run('DELETE FROM friends WHERE userId = ? OR friendId = ?', [userId, userId]);
    db.run('DELETE FROM study_sessions WHERE userId = ?', [userId]);
    db.run('DELETE FROM group_members WHERE userId = ?', [userId]);
    db.run('DELETE FROM groups WHERE createdBy = ?', [userId]);
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    saveDB();
    res.json({ success: true, message: 'User deleted' });
  } else {
    db.run('UPDATE users SET displayName = ?, bio = ? WHERE id = ?', [displayName || '', bio || '', userId]);
    saveDB();
    res.json({ success: true, message: 'User updated' });
  }
});

const studyingUsers = new Map();

io.on('connection', (socket) => {
  socket.on('auth', (userId) => {
    users.set(socket.id, userId);
    userSockets.set(userId, socket.id);
    socket.emit('online', { userId });
  });

  socket.on('start_study', ({ userId, groupId }) => {
    db.run('INSERT INTO study_sessions (userId, groupId) VALUES (?, ?)', [userId, groupId || null]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    socket.sessionId = result[0].values[0][0];
    socket.studyStartTime = Date.now();
    socket.studyUserId = userId;
    socket.studyGroupId = groupId;
    
    if (groupId) {
      studyingUsers.set(userId, groupId);
      
      const stmt = db.prepare('SELECT userId FROM group_members WHERE groupId = ?');
      stmt.bind([groupId]);
      while (stmt.step()) {
        const m = stmt.getAsObject();
        const sock = userSockets.get(m.userId);
        if (sock) io.to(sock).emit('study_started', { userId, groupId });
      }
      stmt.free();
    }
    saveDB();
  });

  socket.on('stop_study', ({ userId, groupId }) => {
    if (socket.sessionId) {
      const elapsed = Math.floor((Date.now() - socket.studyStartTime) / 1000);
      db.run('UPDATE study_sessions SET endTime = CURRENT_TIMESTAMP, seconds = ? WHERE id = ?', [elapsed, socket.sessionId]);
      socket.sessionId = null;
      
      if (groupId) {
        studyingUsers.delete(userId);
        
        const stmt = db.prepare(`
          SELECT u.id, u.username, u.displayName, u.avatar, COALESCE(SUM(ss.seconds), 0) as totalSeconds
          FROM users u
          LEFT JOIN study_sessions ss ON ss.userId = u.id AND ss.groupId = ?
          JOIN group_members gm ON gm.userId = u.id AND gm.groupId = ?
          GROUP BY u.id
        `);
        stmt.bind([groupId, groupId]);
        const studyTimes = [];
        while (stmt.step()) {
          const row = stmt.getAsObject();
          row.isStudying = studyingUsers.has(row.id) && studyingUsers.get(row.id) === groupId;
          studyTimes.push(row);
        }
        stmt.free();

        const stmt2 = db.prepare('SELECT userId FROM group_members WHERE groupId = ?');
        stmt2.bind([groupId]);
        while (stmt2.step()) {
          const m = stmt2.getAsObject();
          const sock = userSockets.get(m.userId);
          if (sock) io.to(sock).emit('study_updated', { groupId, studyTimes });
        }
        stmt2.free();
      }
      saveDB();
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

initDB().then(() => {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Goal Chaser server running on http://localhost:${PORT}`);
  });
});