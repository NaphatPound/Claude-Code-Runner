// ─── Config ────────────────────────────────────────────────
const API_BASE = `${window.location.origin}/api`;
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

// ─── State ─────────────────────────────────────────────────
let selectedTaskId = null;
let ws = null;
let term = null;
let fitAddon = null;
let tasks = [];

// ─── Initialize xterm.js ───────────────────────────────────
function isMobile() {
  return window.innerWidth <= 768;
}

function initTerminal() {
  const mobile = isMobile();
  term = new Terminal({
    theme: {
      background: '#0d1117',
      foreground: '#e6edf3',
      cursor: '#638cff',
      cursorAccent: '#0d1117',
      selectionBackground: 'rgba(99, 140, 255, 0.3)',
      black: '#0d1117',
      red: '#f85149',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#76e3ea',
      white: '#e6edf3',
      brightBlack: '#484f58',
      brightRed: '#ff7b72',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#a5d6ff',
      brightWhite: '#f0f6fc',
    },
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
    fontSize: mobile ? 10 : 14,
    lineHeight: mobile ? 1.2 : 1.4,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    convertEol: true,
  });

  fitAddon = new FitAddon.FitAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  term.open(document.getElementById('terminal'));
  fitAddon.fit();

  // Welcome message
  if (mobile) {
    term.writeln('\x1b[38;2;99;140;255m⚡ Claude Code Runner\x1b[0m');
    term.writeln('\x1b[33mMode:\x1b[0m Interactive');
    term.writeln('Submit a task to get started!');
    term.writeln('');
  } else {
    term.writeln('\x1b[38;2;99;140;255m╔════════════════════════════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[38;2;99;140;255m║\x1b[0m  ⚡ \x1b[1mClaude Code Runner\x1b[0m — Interactive Terminal                 \x1b[38;2;99;140;255m║\x1b[0m');
    term.writeln('\x1b[38;2;99;140;255m║\x1b[0m                                                              \x1b[38;2;99;140;255m║\x1b[0m');
    term.writeln('\x1b[38;2;99;140;255m║\x1b[0m  \x1b[33mMode:\x1b[0m Interactive (real Claude Code UI)                     \x1b[38;2;99;140;255m║\x1b[0m');
    term.writeln('\x1b[38;2;99;140;255m║\x1b[0m  \x1b[33mCmd:\x1b[0m  claude --dangerously-skip-permissions                  \x1b[38;2;99;140;255m║\x1b[0m');
    term.writeln('\x1b[38;2;99;140;255m║\x1b[0m                                                              \x1b[38;2;99;140;255m║\x1b[0m');
    term.writeln('\x1b[38;2;99;140;255m║\x1b[0m  Submit a task → server types the command like a human        \x1b[38;2;99;140;255m║\x1b[0m');
    term.writeln('\x1b[38;2;99;140;255m║\x1b[0m  → watch Claude Code run in real-time right here!            \x1b[38;2;99;140;255m║\x1b[0m');
    term.writeln('\x1b[38;2;99;140;255m╚════════════════════════════════════════════════════════════════╝\x1b[0m');
    term.writeln('');
  }

  // Forward keyboard input from browser terminal to server PTY
  term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN && selectedTaskId) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  });
}

// Send terminal size to server so PTY can resize to match
function sendResize() {
  if (ws && ws.readyState === WebSocket.OPEN && term && selectedTaskId) {
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }
}

// ─── WebSocket ─────────────────────────────────────────────
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('🔌 WebSocket connected');
    // Re-subscribe if we had a selected task
    if (selectedTaskId) {
      ws.send(JSON.stringify({ type: 'subscribe', taskId: selectedTaskId }));
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'output' && term) {
      term.write(msg.data);
    }

    if (msg.type === 'status') {
      updateTaskStatus(selectedTaskId, msg.status);
      updateTerminalHeader(msg.status);
      // Refresh task list to update badges
      fetchTasks();
    }
  };

  ws.onclose = () => {
    console.log('🔌 WebSocket disconnected, reconnecting...');
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function subscribeToTask(taskId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    // Send current terminal size so PTY can match
    setTimeout(sendResize, 200);
  }
}

// ─── API Calls ─────────────────────────────────────────────
async function fetchTasks() {
  try {
    const res = await fetch(`${API_BASE}/tasks`);
    tasks = await res.json();
    renderTaskList();
  } catch (err) {
    console.error('Failed to fetch tasks:', err);
  }
}

async function createTask(prompt, workingDir) {
  try {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, workingDir: workingDir || undefined }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Server error ${res.status}: ${text}`);
    }

    const task = await res.json();

    // Select the new task
    selectTask(task.id);
    fetchTasks();

    return task;
  } catch (err) {
    console.error('Failed to create task:', err);
    alert('Failed to create task: ' + err.message);
  }
}

async function stopTask(taskId) {
  try {
    await fetch(`${API_BASE}/tasks/${taskId}/stop`, { method: 'POST' });
    fetchTasks();
  } catch (err) {
    console.error('Failed to stop task:', err);
  }
}

async function deleteTask(taskId) {
  try {
    await fetch(`${API_BASE}/tasks/${taskId}`, { method: 'DELETE' });
    if (selectedTaskId === taskId) {
      selectedTaskId = null;
      term.clear();
      updateTerminalHeader(null);
    }
    fetchTasks();
  } catch (err) {
    console.error('Failed to delete task:', err);
  }
}

// ─── Select a task ─────────────────────────────────────────
function selectTask(taskId) {
  selectedTaskId = taskId;
  term.clear();
  term.reset();
  subscribeToTask(taskId);

  // Update active state in task list
  document.querySelectorAll('.task-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.taskId === taskId);
  });

  // Find task info
  const task = tasks.find((t) => t.id === taskId);
  if (task) {
    document.getElementById('terminalTitle').textContent = task.prompt.substring(0, 60) + (task.prompt.length > 60 ? '...' : '');
    updateTerminalHeader(task.status);
  }
}

// ─── Update UI ─────────────────────────────────────────────
function updateTerminalHeader(status) {
  const statusBadge = document.getElementById('terminalStatus');
  const stopBtn = document.getElementById('btnStopTask');

  if (!status) {
    statusBadge.style.display = 'none';
    stopBtn.style.display = 'none';
    document.getElementById('terminalTitle').textContent = 'Select a task to view output';
    return;
  }

  statusBadge.style.display = 'inline-flex';
  statusBadge.className = `task-status-badge status-badge status-${status}`;
  statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);

  stopBtn.style.display = status === 'running' ? 'inline-flex' : 'none';
}

function updateTaskStatus(taskId, status) {
  const taskItem = document.querySelector(`.task-item[data-task-id="${taskId}"]`);
  if (taskItem) {
    const badge = taskItem.querySelector('.status-badge');
    if (badge) {
      badge.className = `status-badge status-${status}`;
      badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }
  }
}

function renderTaskList() {
  const list = document.getElementById('taskList');

  if (tasks.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📋</span>
        <p>No tasks yet</p>
        <p class="sub">Click "New Task" to get started</p>
      </div>
    `;
    return;
  }

  list.innerHTML = tasks
    .map(
      (task) => `
    <div class="task-item ${task.id === selectedTaskId ? 'active' : ''}" data-task-id="${task.id}">
      <div class="task-item-header">
        <span class="task-item-prompt" title="${escapeHtml(task.prompt)}">${escapeHtml(task.prompt)}</span>
        <span class="status-badge status-${task.status}">${capitalize(task.status)}</span>
      </div>
      <div class="task-item-time">${formatTime(task.createdAt)}</div>
    </div>
  `
    )
    .join('');

  // Bind click events
  list.querySelectorAll('.task-item').forEach((el) => {
    el.addEventListener('click', () => selectTask(el.dataset.taskId));
  });
}

// ─── Modal ─────────────────────────────────────────────────
function openModal() {
  document.getElementById('modalOverlay').classList.add('active');
  document.getElementById('taskPrompt').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  document.getElementById('taskForm').reset();
}

// ─── Helpers ───────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Mobile Tab Switching ─────────────────────────────────
function switchMobileTab(tab) {
  const sidebar = document.getElementById('sidebar');
  const tabs = document.querySelectorAll('.mobile-tab');

  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));

  if (tab === 'tasks') {
    sidebar.classList.remove('mobile-hidden');
  } else {
    sidebar.classList.add('mobile-hidden');
    // Re-fit terminal when switching to terminal tab
    setTimeout(() => {
      if (fitAddon) { fitAddon.fit(); sendResize(); }
    }, 50);
  }
}

// ─── Event Listeners ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  try {
    initTerminal();
  } catch (err) {
    console.error('Failed to initialize terminal:', err);
  }
  connectWebSocket();
  fetchTasks();

  // Resize terminal on window resize
  window.addEventListener('resize', () => {
    if (fitAddon) {
      fitAddon.fit();
      sendResize();
    }
  });

  // New Task button (desktop sidebar + mobile FAB)
  document.getElementById('btnNewTask').addEventListener('click', openModal);
  document.getElementById('mobileFab').addEventListener('click', openModal);

  // Close modal
  document.getElementById('btnCloseModal').addEventListener('click', closeModal);
  document.getElementById('btnCancelModal').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Escape key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Submit task form
  document.getElementById('taskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = document.getElementById('taskPrompt').value.trim();
    const workingDir = document.getElementById('workingDir').value.trim();

    if (!prompt) return;

    closeModal();
    await createTask(prompt, workingDir);

    // On mobile, switch to terminal tab after creating a task
    if (window.innerWidth <= 768) {
      switchMobileTab('terminal');
    }
  });

  // Stop task
  document.getElementById('btnStopTask').addEventListener('click', () => {
    if (selectedTaskId) stopTask(selectedTaskId);
  });

  // Clear terminal
  document.getElementById('btnClearTerminal').addEventListener('click', () => {
    if (term) {
      term.clear();
    }
  });

  // Refresh task list
  document.getElementById('btnRefresh').addEventListener('click', fetchTasks);

  // Mobile tab bar
  document.querySelectorAll('.mobile-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchMobileTab(tab.dataset.tab));
  });

  // Mobile: switch to terminal when selecting a task
  const origSelectTask = selectTask;
  selectTask = function(taskId) {
    origSelectTask(taskId);
    if (window.innerWidth <= 768) {
      switchMobileTab('terminal');
    }
  };

  // Auto-refresh task list every 5 seconds
  setInterval(fetchTasks, 5000);
});
