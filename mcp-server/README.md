# Claude Code Runner — MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes the Claude Code Runner backend as tools, allowing any MCP-compatible AI service (Claude Desktop, Cursor, Windsurf, etc.) to run Claude Code tasks programmatically.

## Tools

| Tool | Description |
|---|---|
| `run_claude_code` | Submit a prompt to Claude Code, optionally wait for completion, and return the output |
| `get_task_status` | Check the status and output of an existing task |
| `list_tasks` | List all tasks with status summaries |
| `stop_task` | Stop a running task |
| `send_input` | Send keyboard input to a running task's terminal |
| `delete_task` | Delete a task from memory |

## Setup

```bash
cd mcp-server
npm install
```

**Prerequisite:** The Claude Code Runner backend (`server.js` in the parent directory) must be running on `http://localhost:3456`.

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "claude-code-runner": {
      "command": "node",
      "args": ["G:/project/poc/poc-backend-run-claude-code/mcp-server/index.js"],
      "env": {
        "BACKEND_URL": "http://localhost:3456"
      }
    }
  }
}
```

### Claude Code CLI

Add to your `.claude/settings.json` or project `CLAUDE.md`:

```json
{
  "mcpServers": {
    "claude-code-runner": {
      "command": "node",
      "args": ["G:/project/poc/poc-backend-run-claude-code/mcp-server/index.js"],
      "env": {
        "BACKEND_URL": "http://localhost:3456"
      }
    }
  }
}
```

### Cursor / Windsurf / Other MCP Clients

Use the same `command` + `args` pattern as above — refer to your client's MCP configuration docs.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `http://localhost:3456` | URL of the Claude Code Runner backend |

## Example Usage (from an AI)

> "Run Claude Code to create a hello world Express server in /tmp/test-project"

The AI calls:
```json
{
  "tool": "run_claude_code",
  "arguments": {
    "prompt": "Create a hello world Express server with a /health endpoint",
    "working_dir": "/tmp/test-project",
    "wait": true,
    "timeout_seconds": 120
  }
}
```

The MCP server forwards this to the backend, waits for Claude Code to finish, and returns the cleaned terminal output.
