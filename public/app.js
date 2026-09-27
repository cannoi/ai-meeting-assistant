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
    if (data.has_api_key) {
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
        <span>${m.language}</span>
        <span class="badge">${m.status}</span>
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
      body: JSON.stringify({ title, language: 'english' })
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
    document.getElementById('meeting-lang-select').value = currentMeeting.language;
    document.getElementById('meeting-status-badge').textContent = currentMeeting.status;
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
    document.getElementById('meeting-status-badge').textContent = currentMeeting.status;
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

      // Stop tracks
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
      alert('Upload failed: ' + data.error);
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
      alert(data.message);
      selectMeeting(currentMeeting.id);
    } else {
      alert('Transcription failed: ' + data.error);
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
      alert(data.message);
      selectMeeting(currentMeeting.id);
    } else {
      alert('Manual transcript error: ' + data.error);
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
  currentMeeting.transcript_segments.forEach((seg, idx) => {
    const speakerInput = document.getElementById(`seg-speaker-${idx}`);
    const textInput = document.getElementById(`seg-text-${idx}`);
    if (speakerInput && textInput) {
      segments.push({
        id: seg.id,
        speaker: speakerInput.value,
        text: textInput.value,
        start_ms: seg.start_ms,
        end_ms: seg.end_ms
      });
    }
  });

  try {
    const res = await fetch(`/api/meetings/${currentMeeting.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript_segments: segments })
    });
    currentMeeting = await res.json();
    alert('Transcript edits saved!');
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
      alert('Analysis failed: ' + data.error);
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
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.gap = '10px';
    div.style.marginBottom = '8px';
    div.innerHTML = `
      <input type="text" class="transcript-text" value="${escapeHtml(dec.text)}" id="decision-input-${idx}">
      <button class="btn btn-danger-outline btn-sm" onclick="removeDecision(${idx})">X</button>
    `;
    container.appendChild(div);
  });
}

function addDecisionRow() {
  if (!currentMeeting.decisions) currentMeeting.decisions = [];
  currentMeeting.decisions.push({ text: 'New decision' });
  renderDecisions();
}

function removeDecision(idx) {
  currentMeeting.decisions.splice(idx, 1);
  renderDecisions();
}

function renderTasks() {
  const tbody = document.getElementById('tasks-tbody');
  tbody.innerHTML = '';

  if (!currentMeeting.action_items || currentMeeting.action_items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #718096;">No action items found.</td></tr>';
    return;
  }

  currentMeeting.action_items.forEach((task, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" ${task.completed ? 'checked' : ''} onchange="toggleTaskCompletion(${idx}, this.checked)"></td>
      <td><input type="text" class="table-input" value="${escapeHtml(task.title)}" id="task-title-${idx}" style="width: 100%; border: 1px solid #cbd5e0; padding: 4px; border-radius: 4px;"></td>
      <td><input type="text" class="table-input" value="${escapeHtml(task.owner || '')}" id="task-owner-${idx}" style="width: 100%; border: 1px solid #cbd5e0; padding: 4px; border-radius: 4px;"></td>
      <td><input type="text" class="table-input" value="${escapeHtml(task.due_date_text || '')}" id="task-due-${idx}" style="width: 100%; border: 1px solid #cbd5e0; padding: 4px; border-radius: 4px;"></td>
      <td><button class="btn btn-danger-outline btn-sm" onclick="removeTask(${idx})">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function addTaskRow() {
  if (!currentMeeting.action_items) currentMeeting.action_items = [];
  currentMeeting.action_items.push({ title: 'New action item', owner: 'Team', due_date_text: 'Soon', completed: false });
  renderTasks();
}

function removeTask(idx) {
  currentMeeting.action_items.splice(idx, 1);
  renderTasks();
}

function toggleTaskCompletion(idx, completed) {
  if (currentMeeting.action_items[idx]) {
    currentMeeting.action_items[idx].completed = completed;
  }
}

function exportMeeting(format) {
  if (!currentMeeting) return;
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
