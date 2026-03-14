# Claude Code Runner — Documentation

## Overview

Claude Code Runner is a proof-of-concept web application that provides a browser-based terminal interface for running [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) tasks remotely. Users submit prompts through a web UI, and the server spawns a real pseudo-terminal (PTY) that launches Claude Code in interactive mode — streaming the full terminal output back to the browser in real-time via WebSocket.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (Frontend)                                          │
│  ┌──────────┐  ┌──────────────────┐  ┌────────────────────┐ │
│  │ Sidebar   │  │ xterm.js Terminal │  │ Task Modal (Form)  │ │
│  │ Task List │  │ (live PTY output) │  │ prompt + workDir   │ │
│  └─────┬────┘  └────────┬─────────┘  └──────────┬─────────┘ │
│        │                │ WebSocket               │ REST API  │
└────────┼────────────────┼─────────────────────────┼──────────┘
         │                │                         │
─────────┼────────────────┼─────────────────────────┼──────────
         │                │                         │
┌────────┼────────────────┼─────────────────────────┼──────────┐
│  Server (Backend)       │                         │          │
│  ┌─────┴────────────────┴─────────────────────────┴───────┐  │
│  │ Express.js + WebSocket Server (ws)                     │  │
│  │ ┌────────────────────────────────────────────────────┐ │  │
│  │ │ Task Manager (in-memory Map)                       │ │  │
│  │ │  - Create / List / Get / Stop / Delete tasks       │ │  │
│  │ └───────────────────────┬────────────────────────────┘ │  │
│  │                         │                              │  │
│  │ ┌───────────────────────▼────────────────────────────┐ │  │
│  │ │ node-pty (Pseudo-Terminal)                         │ │  │
│  │ │  1. Spawns shell (powershell / bash)               │ │  │
│  │ │  2. Types: claude --dangerously-skip-permissions   │ │  │
│  │ │  3. Types the user's prompt                        │ │  │
│  │ │  4. Streams all output back via WebSocket          │ │  │
│  │ └───────────────────────────────────────────────────-┘ │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Backend

| Technology | Version | Purpose |
|---|---|---|
| **Node.js** | — | Runtime environment |
| **Express.js** | ^4.21.0 | HTTP server, REST API, static file serving |
| **ws** | ^8.18.0 | WebSocket server for real-time bidirectional communication |
| **node-pty** | ^1.0.0 | Spawns real pseudo-terminals (PTY) to run interactive CLI programs |
| **uuid** | ^10.0.0 | Generates unique task IDs |
| **cors** | ^2.8.5 | Cross-Origin Resource Sharing middleware |

### Frontend

| Technology | Version | Purpose |
|---|---|---|
| **xterm.js** | 5.5.0 | Full terminal emulator in the browser (renders ANSI escape codes, colors, cursor) |
| **xterm-addon-fit** | 0.10.0 | Auto-fits the terminal to its container size |
| **xterm-addon-web-links** | 0.11.0 | Makes URLs in the terminal clickable |
| **Vanilla JavaScript** | ES6+ | Frontend logic — no framework (single `app.js` file) |
| **CSS3** | — | Custom dark theme with CSS variables, glassmorphism, animations |
| **Google Fonts** | — | Inter (UI text) + JetBrains Mono (terminal / code) |

---

## Project Structure

```
poc-backend-run-claude-code/
├── server.js              # Backend — Express + WebSocket + PTY spawning
├── package.json           # Dependencies and scripts
├── public/                # Static frontend (served by Express)
│   ├── index.html         # Main HTML — sidebar, terminal, modal
│   ├── style.css          # Dark theme styles (CSS variables)
│   └── app.js             # Frontend logic — xterm.js, WebSocket, REST calls
└── node_modules/          # Installed dependencies
```

---

## How It Works

### 1. User submits a task
The browser sends a `POST /api/tasks` request with a `prompt` and optional `workingDir`.

### 2. Server spawns a PTY
The server creates an in-memory `Task` object and spawns a real pseudo-terminal using `node-pty`:
- On Windows: `powershell.exe`
- On Linux/macOS: `bash`

### 3. Server types commands into the PTY
After a 1-second delay (for the shell to initialize), the server writes:
```
claude --dangerously-skip-permissions
```
Then after another 3-second delay (for Claude Code to start), it writes the user's prompt followed by Enter — simulating a human typing.

### 4. Output streams to the browser
All PTY output (including ANSI colors, cursor movement, and Claude Code's interactive UI) is captured and broadcast to subscribed WebSocket clients. The browser's xterm.js terminal renders this output exactly as it would appear in a native terminal.

### 5. Bidirectional input
The browser terminal also forwards keyboard input back to the server PTY via WebSocket (`type: 'input'`), allowing real interactive control of the Claude Code session.

---

## REST API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/tasks` | Create and start a new task. Body: `{ prompt, workingDir? }` |
| `GET` | `/api/tasks` | List all tasks (summary, sorted by newest first) |
| `GET` | `/api/tasks/:id` | Get full task details including output |
| `POST` | `/api/tasks/:id/stop` | Stop a running task (kills the PTY process) |
| `DELETE` | `/api/tasks/:id` | Delete a task (kills PTY if running, removes from memory) |

---

## WebSocket Protocol

The client connects to `ws://<host>:<port>` and exchanges JSON messages:

### Client → Server

| Type | Payload | Description |
|---|---|---|
| `subscribe` | `{ type: "subscribe", taskId: "..." }` | Subscribe to a task's output stream |
| `unsubscribe` | `{ type: "unsubscribe" }` | Unsubscribe from current task |
| `input` | `{ type: "input", data: "..." }` | Send keyboard input to the PTY |

### Server → Client

| Type | Payload | Description |
|---|---|---|
| `status` | `{ type: "status", status: "running" }` | Task status change (queued/running/completed/failed/stopped) |
| `output` | `{ type: "output", data: "..." }` | Raw terminal output (ANSI escape codes included) |

---

## Running

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The server starts on `http://localhost:3456` by default. Set the `PORT` environment variable to change it.

---

## Key Design Decisions

- **node-pty over child_process**: A real PTY is required because Claude Code uses an interactive TUI with colors, cursor positioning, and keyboard input. A simple `child_process.spawn` would not preserve the interactive experience.
- **No frontend framework**: The UI is intentionally built with vanilla JS to keep the POC lightweight with zero build steps.
- **In-memory task store**: Tasks are stored in a `Map` — restarting the server clears all history. This is acceptable for a POC.
- **`--dangerously-skip-permissions`**: The flag is used so Claude Code runs without interactive permission prompts, enabling fully automated execution.
