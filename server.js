const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Initialize database tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    transcript TEXT,
    summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS action_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER,
    task TEXT NOT NULL,
    assignee TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY(meeting_id) REFERENCES meetings(id)
  )`);
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Provider capabilities endpoint
app.get('/api/provider/capabilities', (req, res) => {
  res.json({
    provider: 'local-ai-mock',
    capabilities: ['transcribe', 'summarize', 'action-items'],
    configured: true
  });
});

// API Endpoints for Meetings
app.get('/api/meetings', (req, res) => {
  db.all('SELECT * FROM meetings ORDER BY date DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/meetings', (req, res) => {
  const { title, date, transcript, summary } = req.body;
  if (!title || !date) {
    return res.status(400).json({ error: 'Title and date are required' });
  }
  db.run(
    'INSERT INTO meetings (title, date, transcript, summary) VALUES (?, ?, ?, ?)',
    [title, date, transcript || '', summary || ''],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, title, date, transcript, summary });
    }
  );
});

app.get('/api/meetings/:id', (req, res) => {
  const meetingId = req.params.id;
  db.get('SELECT * FROM meetings WHERE id = ?', [meetingId], (err, meeting) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    db.all('SELECT * FROM action_items WHERE meeting_id = ?', [meetingId], (err, items) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      meeting.action_items = items;
      res.json(meeting);
    });
  });
});

// API Endpoints for Action Items
app.get('/api/action-items', (req, res) => {
  db.all('SELECT * FROM action_items', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/action-items', (req, res) => {
  const { meeting_id, task, assignee, status } = req.body;
  if (!task) {
    return res.status(400).json({ error: 'Task description is required' });
  }
  db.run(
    'INSERT INTO action_items (meeting_id, task, assignee, status) VALUES (?, ?, ?, ?)',
    [meeting_id || null, task, assignee || 'Unassigned', status || 'pending'],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, meeting_id, task, assignee, status: status || 'pending' });
    }
  );
});

app.patch('/api/action-items/:id', (req, res) => {
  const { status } = req.body;
  const itemId = req.params.id;
  db.run(
    'UPDATE action_items SET status = ? WHERE id = ?',
    [status, itemId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ updated: this.changes });
    }
  );
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
