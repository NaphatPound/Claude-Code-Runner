const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const { spawn } = require('child_process');

// node-pty for real PTY (interactive terminal)
let pty;
try {
  pty = require('node-pty');
  console.log('✅ node-pty loaded — interactive terminal mode enabled');
} catch (e) {
  console.error('❌ node-pty is REQUIRED for interactive mode. Install it:');
  console.error('   npm install node-pty');
  process.exit(1);
}

// ─── Config ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3456;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Task Store (in-memory) ────────────────────────────────────
const tasks = new Map();

class Task {
  constructor({ prompt, workingDir }) {
    this.id = uuidv4();
    this.prompt = prompt;
    this.workingDir = workingDir || process.cwd();
    this.status = 'queued';
    this.output = '';
    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.finishedAt = null;
    this.exitCode = null;
    this.ptyProcess = null;
    this.subscribers = new Set();
  }

  toJSON() {
    return {
      id: this.id,
      prompt: this.prompt,
      workingDir: this.workingDir,
      status: this.status,
      output: this.output,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      exitCode: this.exitCode,
    };
  }

  toSummary() {
    return {
      id: this.id,
      prompt: this.prompt.substring(0, 100) + (this.prompt.length > 100 ? '...' : ''),
      status: this.status,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }
}

// ─── Broadcast to task subscribers ─────────────────────────────
function broadcast(task, message) {
  const data = JSON.stringify(message);
  task.subscribers.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

// ─── Run Claude Code INTERACTIVELY via PTY ─────────────────────
// This spawns a real pseudo-terminal, starts claude in interactive mode,
// then types the prompt like a human would. The browser xterm.js shows
// the REAL Claude Code interactive UI.
function runTask(task) {
  task.status = 'running';
  task.startedAt = new Date().toISOString();
  broadcast(task, { type: 'status', status: task.status, startedAt: task.startedAt });

  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

  // Spawn a real PTY with a shell
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: task.workingDir,
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  task.ptyProcess = ptyProcess;

  // Stream ALL output to browser via WebSocket
  ptyProcess.onData((data) => {
    task.output += data;
    broadcast(task, { type: 'output', data });
  });

  ptyProcess.onExit(({ exitCode }) => {
    task.exitCode = exitCode;
    task.status = exitCode === 0 ? 'completed' : 'failed';
    task.finishedAt = new Date().toISOString();
    task.ptyProcess = null;
    broadcast(task, { type: 'status', status: task.status, exitCode, finishedAt: task.finishedAt });
  });

  // Step 1: Wait for shell to be ready, then type the claude command
  setTimeout(() => {
    // Type the claude command into the terminal — just like a human would
    const claudeCmd = 'claude --dangerously-skip-permissions\r';
    ptyProcess.write(claudeCmd);

    // Step 2: Wait for Claude Code to start up, then type the prompt
    setTimeout(() => {
      // Type the task prompt and press Enter
      ptyProcess.write(task.prompt);
      ptyProcess.write('\r');
    }, 3000); // Wait 3 seconds for Claude to start up

  }, 1000); // Wait 1 second for shell to be ready
}

// ─── REST API ──────────────────────────────────────────────────
app.post('/api/tasks', (req, res) => {
  const { prompt, workingDir } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const task = new Task({ prompt: prompt.trim(), workingDir });
  tasks.set(task.id, task);
  runTask(task);
  res.status(201).json(task.toJSON());
});

app.get('/api/tasks', (req, res) => {
  const list = Array.from(tasks.values())
    .map((t) => t.toSummary())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

app.get('/api/tasks/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task.toJSON());
});

app.post('/api/tasks/:id/stop', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'running') {
    return res.status(400).json({ error: 'Task is not running' });
  }

  if (task.ptyProcess) {
    task.ptyProcess.kill();
  }

  task.status = 'stopped';
  task.finishedAt = new Date().toISOString();
  task.ptyProcess = null;
  broadcast(task, { type: 'status', status: task.status, finishedAt: task.finishedAt });
  res.json(task.toJSON());
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (task.ptyProcess) {
    task.ptyProcess.kill();
  }

  tasks.delete(task.id);
  res.json({ success: true });
});

// ─── WebSocket ─────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let subscribedTask = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'subscribe' && msg.taskId) {
        if (subscribedTask) subscribedTask.subscribers.delete(ws);
        const task = tasks.get(msg.taskId);
        if (task) {
          subscribedTask = task;
          task.subscribers.add(ws);
          ws.send(JSON.stringify({ type: 'status', status: task.status }));
          if (task.output) {
            ws.send(JSON.stringify({ type: 'output', data: task.output }));
          }
        }
      }

      if (msg.type === 'unsubscribe') {
        if (subscribedTask) { subscribedTask.subscribers.delete(ws); subscribedTask = null; }
      }

      // Allow sending keyboard input to the terminal from the browser
      if (msg.type === 'input' && subscribedTask && subscribedTask.ptyProcess) {
        subscribedTask.ptyProcess.write(msg.data);
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (subscribedTask) subscribedTask.subscribers.delete(ws);
  });
});

// ─── Start Server ──────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   🚀 Claude Code Runner — Interactive Terminal Mode      ║');
  console.log(`║   📡 http://localhost:${PORT}                               ║`);
  console.log('║   🌐 Remote: http://<your-ip>:' + PORT + '                          ║');
  console.log('║                                                           ║');
  console.log('║   How it works:                                           ║');
  console.log('║   1. Submit a task from the browser                       ║');
  console.log('║   2. Server opens a PTY terminal                          ║');
  console.log('║   3. Types: claude --dangerously-skip-permissions         ║');
  console.log('║   4. Then types your task prompt (like a human!)          ║');
  console.log('║   5. Watch Claude Code run in real-time in the browser    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
});
