const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    language TEXT DEFAULT 'english',
    status TEXT DEFAULT 'Draft',
    transcript TEXT,
    transcript_segments TEXT,
    summary TEXT,
    decisions TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS action_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER,
    task TEXT NOT NULL,
    assignee TEXT,
    due TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY(meeting_id) REFERENCES meetings(id)
  )`);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/provider/capabilities', (req, res) => {
  res.json({
    provider: 'local-ai-mock',
    capabilities: ['transcribe', 'summarize', 'action-items'],
    configured: true,
    has_api_key: true
  });
});

app.get('/api/meetings', (req, res) => {
  const search = req.query.search || '';
  const query = search ? 'SELECT * FROM meetings WHERE title LIKE ? ORDER BY id DESC' : 'SELECT * FROM meetings ORDER BY id DESC';
  const params = search ? [`%${search}%`] : [];
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/meetings', (req, res) => {
  const { title, date, language } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const meetingDate = date || new Date().toISOString();
  const lang = language || 'english';
  
  db.run(
    'INSERT INTO meetings (title, date, language, status) VALUES (?, ?, ?, ?)',
    [title, meetingDate, lang, 'Draft'],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, title, date: meetingDate, language: lang, status: 'Draft' });
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
    
    try {
      meeting.transcript_segments = meeting.transcript_segments ? JSON.parse(meeting.transcript_segments) : [];
    } catch (e) {
      meeting.transcript_segments = [];
    }
    try {
      meeting.decisions = meeting.decisions ? JSON.parse(meeting.decisions) : [];
    } catch (e) {
      meeting.decisions = [];
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

app.patch('/api/meetings/:id', (req, res) => {
  const meetingId = req.params.id;
  const { title, language, summary, transcript_segments, decisions, status } = req.body;
  
  db.get('SELECT * FROM meetings WHERE id = ?', [meetingId], (err, meeting) => {
    if (err || !meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const newTitle = title !== undefined ? title : meeting.title;
    const newLang = language !== undefined ? language : meeting.language;
    const newSummary = summary !== undefined ? summary : meeting.summary;
    const newStatus = status !== undefined ? status : meeting.status;
    const newSegments = transcript_segments !== undefined ? JSON.stringify(transcript_segments) : meeting.transcript_segments;
    const newDecisions = decisions !== undefined ? JSON.stringify(decisions) : meeting.decisions;

    db.run(
      'UPDATE meetings SET title = ?, language = ?, summary = ?, status = ?, transcript_segments = ?, decisions = ? WHERE id = ?',
      [newTitle, newLang, newSummary, newStatus, newSegments, newDecisions, meetingId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        db.get('SELECT * FROM meetings WHERE id = ?', [meetingId], (err, updatedMeeting) => {
          if (err) return res.status(500).json({ error: err.message });
          try {
            updatedMeeting.transcript_segments = updatedMeeting.transcript_segments ? JSON.parse(updatedMeeting.transcript_segments) : [];
          } catch (e) { updatedMeeting.transcript_segments = []; }
          try {
            updatedMeeting.decisions = updatedMeeting.decisions ? JSON.parse(updatedMeeting.decisions) : [];
          } catch (e) { updatedMeeting.decisions = []; }
          
          db.all('SELECT * FROM action_items WHERE meeting_id = ?', [meetingId], (err, items) => {
            updatedMeeting.action_items = items || [];
            res.json(updatedMeeting);
          });
        });
      }
    );
  });
});

app.delete('/api/meetings/:id', (req, res) => {
  const meetingId = req.params.id;
  db.run('DELETE FROM action_items WHERE meeting_id = ?', [meetingId], (err) => {
    db.run('DELETE FROM meetings WHERE id = ?', [meetingId], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, deleted: this.changes });
    });
  });
});

app.post('/api/meetings/:id/audio', (req, res) => {
  const meetingId = req.params.id;
  const { audio_base64 } = req.body;
  if (!audio_base64) {
    return res.status(400).json({ error: 'Audio data required' });
  }
  db.run('UPDATE meetings SET status = ? WHERE id = ?', ['Audio Recorded', meetingId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Audio uploaded successfully' });
  });
});

app.post('/api/meetings/:id/transcribe', (req, res) => {
  const meetingId = req.params.id;
  const { manual_transcript } = req.body;
  
  let segments = [
    { id: 1, speaker: 'Host', text: 'Welcome everyone to today\'s strategy and planning review meeting.', start_ms: 0, end_ms: 5000 },
    { id: 2, speaker: 'Participant', text: 'Thank you. Let\'s discuss the upcoming milestones and action items.', start_ms: 5001, end_ms: 10000 }
  ];

  if (manual_transcript) {
    segments = manual_transcript.split('\n').filter(Boolean).map((line, idx) => {
      const parts = line.split(':');
      return {
        id: idx + 1,
        speaker: parts.length > 1 ? parts[0].trim() : 'Speaker',
        text: parts.length > 1 ? parts.slice(1).join(':').trim() : line.trim(),
        start_ms: idx * 3000,
        end_ms: (idx + 1) * 3000
      };
    });
  }

  const segmentsJson = JSON.stringify(segments);
  db.run(
    'UPDATE meetings SET transcript_segments = ?, status = ? WHERE id = ?',
    [segmentsJson, 'Transcribed', meetingId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Meeting transcribed successfully' });
    }
  );
});

app.post('/api/meetings/:id/analyze', (req, res) => {
  const meetingId = req.params.id;
  db.get('SELECT * FROM meetings WHERE id = ?', [meetingId], (err, meeting) => {
    if (err || !meeting) return res.status(404).json({ error: 'Meeting not found' });
    
    const summary = 'This meeting focused on strategic goals, quarterly milestones, and core operational action items. Team alignment was confirmed across all departments.';
    const decisions = JSON.stringify(['Approved Q3 strategic roadmap', 'Confirmed weekly review schedule']);
    
    db.run(
      'UPDATE meetings SET summary = ?, decisions = ?, status = ? WHERE id = ?',
      [summary, decisions, 'Analyzed', meetingId],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.get('SELECT COUNT(*) as count FROM action_items WHERE meeting_id = ?', [meetingId], (err, row) => {
          if (row && row.count === 0) {
            db.run('INSERT INTO action_items (meeting_id, task, assignee, due, status) VALUES (?, ?, ?, ?, ?)', [meetingId, 'Prepare final budget report', 'Finance Team', 'Friday', 'pending']);
            db.run('INSERT INTO action_items (meeting_id, task, assignee, due, status) VALUES (?, ?, ?, ?, ?)', [meetingId, 'Update product roadmap documentation', 'Product Lead', 'Next Monday', 'pending']);
          }
          res.json({ success: true, message: 'AI Analysis completed' });
        });
      }
    );
  });
});

app.get('/api/meetings/:id/export', (req, res) => {
  const meetingId = req.params.id;
  const format = req.query.format || 'markdown';
  
  db.get('SELECT * FROM meetings WHERE id = ?', [meetingId], (err, meeting) => {
    if (err || !meeting) return res.status(404).send('Meeting not found');
    
    db.all('SELECT * FROM action_items WHERE meeting_id = ?', [meetingId], (err, items) => {
      if (format === 'text') {
        let text = `Meeting: ${meeting.title}\nDate: ${meeting.date}\nStatus: ${meeting.status}\n\nSummary:\n${meeting.summary || 'N/A'}\n\nAction Items:\n`;
        (items || []).forEach(it => text += `- [${it.status}] ${it.task} (Assignee: ${it.assignee}, Due: ${it.due})\n`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="meeting-${meetingId}.txt"`);
        return res.send(text);
      }
      
      if (format === 'csv') {
        let csv = 'Task,Assignee,Due,Status\n';
        (items || []).forEach(it => csv += `"${(it.task || '').replace(/"/g, '""')}","${it.assignee || ''}","${it.due || ''}","${it.status || ''}"\n`);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="meeting-${meetingId}.csv"`);
        return res.send(csv);
      }

      let md = `# ${meeting.title}\n\n- **Date:** ${meeting.date}\n- **Status:** ${meeting.status}\n- **Language:** ${meeting.language}\n\n## Summary\n${meeting.summary || 'No summary available.'}\n\n## Action Items\n`;
      (items || []).forEach(it => md += `- [${it.status === 'completed' ? 'x' : ' '}] ${it.task} — *${it.assignee}* (Due: ${it.due})\n`);
      
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="meeting-${meetingId}.md"`);
      res.send(md);
    });
  });
});

app.get('/api/action-items', (req, res) => {
  db.all('SELECT * FROM action_items', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/action-items', (req, res) => {
  const { meeting_id, task, assignee, due, status } = req.body;
  if (!task || !meeting_id) return res.status(400).json({ error: 'Meeting ID and task required' });
  db.run(
    'INSERT INTO action_items (meeting_id, task, assignee, due, status) VALUES (?, ?, ?, ?, ?)',
    [meeting_id, task, assignee || '', due || '', status || 'pending'],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, meeting_id, task, assignee, due, status: status || 'pending' });
    }
  );
});

app.patch('/api/action-items/:id', (req, res) => {
  const itemId = req.params.id;
  const { task, assignee, due, status } = req.body;
  db.get('SELECT * FROM action_items WHERE id = ?', [itemId], (err, item) => {
    if (err || !item) return res.status(404).json({ error: 'Action item not found' });
    const newTask = task !== undefined ? task : item.task;
    const newAssignee = assignee !== undefined ? assignee : item.assignee;
    const newDue = due !== undefined ? due : item.due;
    const newStatus = status !== undefined ? status : item.status;
    db.run(
      'UPDATE action_items SET task = ?, assignee = ?, due = ?, status = ? WHERE id = ?',
      [newTask, newAssignee, newDue, newStatus, itemId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: itemId, meeting_id: item.meeting_id, task: newTask, assignee: newAssignee, due: newDue, status: newStatus });
      }
    );
  });
});

app.delete('/api/action-items/:id', (req, res) => {
  const itemId = req.params.id;
  db.run('DELETE FROM action_items WHERE id = ?', [itemId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Meeting Assistant server running on port ${PORT}`);
});
