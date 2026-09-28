let meetings = [];
let currentMeeting = null;
let mediaRecorder = null;
let recordedAudioChunks = [];
let recordingTimerInterval = null;
let recordingSeconds = 0;

document.addEventListener('DOMContentLoaded', () => {
  loadCapabilities();
  loadMeetings();

  document.getElementById('btn-new-meeting').addEventListener('click', createNewMeetingPrompt);
  document.getElementById('search-input').addEventListener('input', (e) => loadMeetings(e.target.value));
  document.getElementById('btn-save-meeting').addEventListener('click', saveCurrentMeeting);
  document.getElementById('btn-delete-meeting').addEventListener('click', deleteCurrentMeeting);

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      const targetId = e.target.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');
    });
  });

  // Audio Recording
  document.getElementById('btn-start-record').addEventListener('click', startRecording);
  document.getElementById('btn-stop-record').addEventListener('click', stopRecording);
  document.getElementById('btn-upload-audio').addEventListener('click', uploadAudioFile);
  document.getElementById('btn-proceed-transcribe').addEventListener('click', startTranscription);
  document.getElementById('btn-submit-manual').addEventListener('click', submitManualTranscript);
  document.getElementById('btn-save-transcript').addEventListener('click', saveTranscriptSegments);
  document.getElementById('btn-run-analysis').addEventListener('click', runAiAnalysis);
});

async function loadCapabilities() {
  try {
    const res = await fetch('/api/provider/capabilities');
    const data = await res.json();
    const statusEl = document.getElementById('provider-status');
    if (data.configured || data.has_api_key) {
      statusEl.textContent = `AI Provider: ${data.provider} (Ready)`;
      statusEl.style.color = '#38a169';
    } else {
      statusEl.textContent = 'AI Provider: Manual Mode (No Key)';
      statusEl.style.color = '#d69e2e';
    }
  } catch (e) {
    console.error('Failed to load capabilities:', e);
  }
}

async function loadMeetings(search = '') {
  try {
    const res = await fetch(`/api/meetings?search=${encodeURIComponent(search)}`);
    meetings = await res.json();
    renderMeetingList();
  } catch (e) {
    console.error('Failed to load meetings:', e);
  }
}

function renderMeetingList() {
  const listContainer = document.getElementById('meeting-list');
  listContainer.innerHTML = '';

  if (meetings.length === 0) {
    listContainer.innerHTML = '<div style="padding: 15px; color: #718096; font-size: 0.85rem; text-align: center;">No meetings found</div>';
    return;
  }

  meetings.forEach(m => {
    const item = document.createElement('div');
    item.className = `meeting-item ${currentMeeting && currentMeeting.id === m.id ? 'active' : ''}`;
    item.innerHTML = `
      <div class="meeting-item-title">${escapeHtml(m.title)}</div>
      <div class="meeting-item-meta">
        <span>${m.language || 'english'}</span>
        <span class="badge">${m.status || 'Draft'}</span>
      </div>
    `;
    item.addEventListener('click', () => selectMeeting(m.id));
    listContainer.appendChild(item);
  });
}

async function createNewMeetingPrompt() {
  const title = prompt('Enter meeting title / Nhập tên cuộc họp:', 'Quarterly Sync ' + new Date().toLocaleDateString());
  if (!title) return;

  try {
    const res = await fetch('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, language: 'english', date: new Date().toISOString() })
    });
    const newMeeting = await res.json();
    await loadMeetings();
    selectMeeting(newMeeting.id);
  } catch (e) {
    alert('Failed to create meeting: ' + e.message);
  }
}

async function selectMeeting(id) {
  try {
    const res = await fetch(`/api/meetings/${id}`);
    currentMeeting = await res.json();

    document.getElementById('empty-view').classList.add('hidden');
    document.getElementById('meeting-view').classList.remove('hidden');

    document.getElementById('meeting-title-input').value = currentMeeting.title;
    document.getElementById('meeting-lang-select').value = currentMeeting.language || 'english';
    document.getElementById('meeting-status-badge').textContent = currentMeeting.status || 'Draft';
    document.getElementById('summary-textarea').value = currentMeeting.summary || '';

    renderTranscriptSegments();
    renderDecisions();
    renderTasks();
    renderMeetingList();
  } catch (e) {
    alert('Failed to load meeting details: ' + e.message);
  }
}

async function saveCurrentMeeting() {
  if (!currentMeeting) return;

  const title = document.getElementById('meeting-title-input').value;
  const language = document.getElementById('meeting-lang-select').value;
  const summary = document.getElementById('summary-textarea').value;

  try {
    const res = await fetch(`/api/meetings/${currentMeeting.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, language, summary })
    });
    currentMeeting = await res.json();
    document.getElementById('meeting-status-badge').textContent = currentMeeting.status || 'Draft';
    loadMeetings();
    alert('Meeting saved successfully!');
  } catch (e) {
    alert('Failed to save meeting: ' + e.message);
  }
}

async function deleteCurrentMeeting() {
  if (!currentMeeting) return;
  if (!confirm('Are you sure you want to delete this meeting?')) return;

  try {
    await fetch(`/api/meetings/${currentMeeting.id}`, { method: 'DELETE' });
    currentMeeting = null;
    document.getElementById('meeting-view').classList.add('hidden');
    document.getElementById('empty-view').classList.remove('hidden');
    loadMeetings();
  } catch (e) {
    alert('Failed to delete meeting: ' + e.message);
  }
}

// Audio Recording
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    recordedAudioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedAudioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedAudioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64Audio = reader.result;
        await uploadAudioBase64(base64Audio, 'audio/webm');
      };
      stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start();
    document.getElementById('btn-start-record').disabled = true;
    document.getElementById('btn-stop-record').disabled = false;
    recordingSeconds = 0;
    recordingTimerInterval = setInterval(() => {
      recordingSeconds++;
      const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
      const secs = String(recordingSeconds % 60).padStart(2, '0');
      document.getElementById('recording-timer').textContent = `${mins}:${secs}`;
    }, 1000);
  } catch (e) {
    alert('Microphone permission denied or unavailable: ' + e.message);
  }
}

function stopRecording() {
  if (mediaRecorder) {
    mediaRecorder.stop();
    clearInterval(recordingTimerInterval);
    document.getElementById('btn-start-record').disabled = false;
    document.getElementById('btn-stop-record').disabled = true;
  }
}

async function uploadAudioFile() {
  const fileInput = document.getElementById('audio-file-input');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select an audio file first.');
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();
  document.getElementById('upload-status').textContent = 'Uploading audio...';

  reader.readAsDataURL(file);
  reader.onloadend = async () => {
    await uploadAudioBase64(reader.result, file.type);
  };
}

async function uploadAudioBase64(base64, mimeType) {
  if (!currentMeeting) return;

  try {
    const res = await fetch(`/api/meetings/${currentMeeting.id}/audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: base64, mime_type: mimeType })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('upload-status').textContent = 'Audio attached successfully!';
      document.getElementById('audio-preview-container').classList.remove('hidden');
      document.getElementById('recorded-audio-element').src = base64;
      selectMeeting(currentMeeting.id);
    } else {
      alert('Upload failed: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Upload error: ' + e.message);
  }
}

async function startTranscription() {
  if (!currentMeeting) return;
  const consent = document.getElementById('consent-checkbox').checked;
  if (!consent) {
    alert('Please confirm AI processing consent before transcribing.');
    return;
  }

  try {
    const res = await fetch(`/api/meetings/${currentMeeting.id}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message || 'Transcription completed successfully');
      selectMeeting(currentMeeting.id);
    } else {
      alert('Transcription failed: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Transcription error: ' + e.message);
  }
}

async function submitManualTranscript() {
  if (!currentMeeting) return;
  const manualText = document.getElementById('manual-transcript-input').value;
  if (!manualText.trim()) {
    alert('Please enter transcript text.');
    return;
  }

  try {
    const res = await fetch(`/api/meetings/${currentMeeting.id}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual_transcript: manualText })
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message || 'Manual transcript applied');
      selectMeeting(currentMeeting.id);
    } else {
      alert('Manual transcript error: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function renderTranscriptSegments() {
  const container = document.getElementById('transcript-segments-container');
  container.innerHTML = '';

  if (!currentMeeting.transcript_segments || currentMeeting.transcript_segments.length === 0) {
    container.innerHTML = '<div style="color: #718096; font-size: 0.9rem; text-align: center; padding: 15px;">No transcript segments yet. Record audio or enter manual transcript above.</div>';
    return;
  }

  currentMeeting.transcript_segments.forEach((seg, idx) => {
    const row = document.createElement('div');
    row.className = 'transcript-row';
    row.innerHTML = `
      <input type="text" class="transcript-speaker" value="${escapeHtml(seg.speaker || 'Speaker')}" data-index="${idx}" id="seg-speaker-${idx}">
      <input type="text" class="transcript-text" value="${escapeHtml(seg.text)}" data-index="${idx}" id="seg-text-${idx}">
    `;
    container.appendChild(row);
  });
}

async function saveTranscriptSegments() {
  if (!currentMeeting) return;

  const segments = [];
  if (currentMeeting.transcript_segments) {
    currentMeeting.transcript_segments.forEach((seg, idx) => {
      const speakerInput = document.getElementById(`seg-speaker-${idx}`);
      const textInput = document.getElementById(`seg-text-${idx}`);
      if (speakerInput && textInput) {
        segments.push({
          id: seg.id || (idx + 1),
          speaker: speakerInput.value,
          text: textInput.value,
          start_ms: seg.start_ms || 0,
          end_ms: seg.end_ms || 0
        });
      }
    });
  }

  try {
    const res = await fetch(`/api/meetings/${currentMeeting.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript_segments: segments })
    });
    currentMeeting = await res.json();
    alert('Transcript segments saved successfully!');
    renderTranscriptSegments();
  } catch (e) {
    alert('Failed to save transcript: ' + e.message);
  }
}

async function runAiAnalysis() {
  if (!currentMeeting) return;
  try {
    const res = await fetch(`/api/meetings/${currentMeeting.id}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      alert('AI Analysis completed successfully!');
      selectMeeting(currentMeeting.id);
    } else {
      alert('Analysis failed: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Analysis error: ' + e.message);
  }
}

function renderDecisions() {
  const container = document.getElementById('decisions-container');
  container.innerHTML = '';

  if (!currentMeeting.decisions || currentMeeting.decisions.length === 0) {
    container.innerHTML = '<div style="color: #718096; font-size: 0.85rem;">No decisions recorded yet.</div>';
    return;
  }

  currentMeeting.decisions.forEach((dec, idx) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '10px';
    row.style.marginBottom = '8px';
    row.innerHTML = `
      <input type="text" class="form-input" value="${escapeHtml(dec)}" id="decision-input-${idx}" style="flex: 1;">
      <button class="btn btn-danger-outline btn-sm" onclick="removeDecision(${idx})">X</button>
    `;
    container.appendChild(row);
  });
}

function addDecisionRow() {
  if (!currentMeeting) return;
  if (!currentMeeting.decisions) currentMeeting.decisions = [];
  currentMeeting.decisions.push('New Decision');
  renderDecisions();
}

function removeDecision(idx) {
  if (!currentMeeting || !currentMeeting.decisions) return;
  currentMeeting.decisions.splice(idx, 1);
  renderDecisions();
}

async function saveDecisions() {
  if (!currentMeeting) return;
  const decisions = [];
  currentMeeting.decisions.forEach((_, idx) => {
    const el = document.getElementById(`decision-input-${idx}`);
    if (el && el.value.trim()) {
      decisions.push(el.value.trim());
    }
  });

  try {
    await fetch(`/api/meetings/${currentMeeting.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions })
    });
    selectMeeting(currentMeeting.id);
  } catch (e) {
    console.error('Failed to save decisions:', e);
  }
}

function renderTasks() {
  const tbody = document.getElementById('tasks-tbody');
  tbody.innerHTML = '';

  if (!currentMeeting.action_items || currentMeeting.action_items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #718096; padding: 15px;">No action items found.</td></tr>';
    return;
  }

  currentMeeting.action_items.forEach((task) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align: center;">
        <input type="checkbox" ${task.status === 'completed' ? 'checked' : ''} onchange="toggleTaskStatus(${task.id}, this.checked)">
      </td>
      <td><input type="text" class="form-input-sm" value="${escapeHtml(task.task)}" id="task-text-${task.id}" onchange="updateTaskField(${task.id})"></td>
      <td><input type="text" class="form-input-sm" value="${escapeHtml(task.assignee || '')}" id="task-assignee-${task.id}" onchange="updateTaskField(${task.id})"></td>
      <td><input type="text" class="form-input-sm" value="${escapeHtml(task.due || '')}" id="task-due-${task.id}" onchange="updateTaskField(${task.id})"></td>
      <td><button class="btn btn-danger-outline btn-sm" onclick="deleteTask(${task.id})">Del</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function addTaskRow() {
  if (!currentMeeting) return;
  try {
    await fetch('/api/action-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_id: currentMeeting.id, task: 'New Action Item', assignee: 'Unassigned', due: 'TBD', status: 'pending' })
    });
    selectMeeting(currentMeeting.id);
  } catch (e) {
    alert('Failed to add task: ' + e.message);
  }
}

async function toggleTaskStatus(taskId, completed) {
  try {
    await fetch(`/api/action-items/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: completed ? 'completed' : 'pending' })
    });
  } catch (e) {
    console.error('Failed to update task status:', e);
  }
}

async function updateTaskField(taskId) {
  const taskInput = document.getElementById(`task-text-${taskId}`);
  const assigneeInput = document.getElementById(`task-assignee-${taskId}`);
  const dueInput = document.getElementById(`task-due-${taskId}`);
  if (!taskInput) return;

  try {
    await fetch(`/api/action-items/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: taskInput.value,
        assignee: assigneeInput ? assigneeInput.value : '',
        due: dueInput ? dueInput.value : ''
      })
    });
  } catch (e) {
    console.error('Failed to update task:', e);
  }
}

async function deleteTask(taskId) {
  try {
    await fetch(`/api/action-items/${taskId}`, { method: 'DELETE' });
    selectMeeting(currentMeeting.id);
  } catch (e) {
    alert('Failed to delete task: ' + e.message);
  }
}

function exportMeeting(format) {
  if (!currentMeeting) {
    alert('Please select a meeting to export.');
    return;
  }
  window.open(`/api/meetings/${currentMeeting.id}/export?format=${format}`, '_blank');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
