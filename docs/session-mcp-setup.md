# Connectome Session MCP Server Setup

The Session MCP server provides terminal session management capabilities for AI assistants, allowing them to run commands, manage processes, and interact with running applications.

## Features

- **Multi-session Management**: Create and manage multiple terminal sessions simultaneously
- **Interactive I/O**: Send input to running processes and capture output
- **Signal Handling**: Send signals like SIGINT (Ctrl+C) to processes
- **Service Management**: Start long-running services with ready/error pattern detection
- **Log Search**: Search through session logs with regex patterns
- **Robust Connection**: Automatic reconnection with exponential backoff

## Installation

1. Ensure you have the Connectome TypeScript project set up
2. Install dependencies:
   ```bash
   cd /path/to/connectome-ts
   npm install
   ```

## Configuration

Add the following to your `~/.cursor/mcp.json` file:

```json
{
  "servers": {
    "connectome-session": {
      "command": "/Users/user/.nvm/versions/node/v20.10.0/bin/npx",
      "args": ["ts-node", "/Users/user/connectome-local/connectome-ts/src/testing/mcp-stdio-server.ts"],
      "cwd": "/Users/user/connectome-local/connectome-ts",
      "env": {
        "SESSION_SERVER_PORT": "3101"
      }
    }
  }
}
```

**Note**: Replace `/Users/user` with your actual home directory path.

## Starting the Session Server

Before using the MCP server in Cursor, start the WebSocket session server:

```bash
cd /path/to/connectome-ts
SESSION_SERVER_PORT=3101 npm run session-server
```

The session server must be running for the MCP server to work properly.

## Available Tools

### Session Management

**Note on Graceful Shutdown**: When terminating sessions, you can choose between:
- **Graceful shutdown** (default): Sends SIGINT to allow processes to clean up resources, save state, and exit cleanly. Waits up to 3 seconds before force killing.
- **Force kill** (`graceful: false`): Immediately terminates the process without cleanup. Use only when graceful shutdown fails or for unresponsive processes.

- **`startService`**: Start a long-running service with startup detection
  ```typescript
  startService({
    name: "my-app",
    command: "npm run dev",
    cwd: "/path/to/project",
    readyPatterns: ["Server ready on port"],
    errorPatterns: ["Error:", "Failed to"]
  })
  ```

- **`runCommand`**: Execute a command and wait for completion
  ```typescript
  runCommand({
    session: "test-session",
    command: "npm test"
  })
  ```

- **`listSessions`**: Get all active sessions
  ```typescript
  listSessions()
  ```

- **`killSession`**: Terminate a specific session
  ```typescript
  // Graceful shutdown (default - sends SIGINT, waits up to 3 seconds)
  killSession({ session: "session-id" })
  
  // Force kill (immediate termination - use only when necessary)
  killSession({ session: "session-id", graceful: false })
  ```

- **`killAll`**: Terminate all active sessions
  ```typescript
  // Gracefully shutdown all sessions (default)
  killAll()
  
  // Force kill all sessions (use only when necessary)
  killAll({ graceful: false })
  ```

### Interactive Operations

- **`sendInput`**: Send input to a running process
  ```typescript
  sendInput({
    session: "interactive-app",
    input: "yes"
  })
  ```

- **`sendSignal`**: Send a signal to a process (default: SIGINT)
  ```typescript
  sendSignal({
    session: "running-app",
    signal: "SIGINT"
  })
  ```

### Log Operations

- **`tailLogs`**: Get recent logs from a session
  ```typescript
  tailLogs({
    session: "my-app",
    lines: 50
  })
  ```

- **`searchLogs`**: Search logs with regex patterns
  ```typescript
  searchLogs({
    session: "my-app",
    pattern: "error|warning",
    context: 3
  })
  ```

## Troubleshooting

### MCP server not loading in Cursor
1. Ensure the session server is running on the configured port
2. Check that all paths in the configuration are absolute
3. Restart Cursor after configuration changes

### Commands freezing
- The session server implements timeouts (2 seconds by default)
- Long-running commands will return partial output and continue running
- Use `tailLogs` to get additional output

### Connection lost
- The MCP server will automatically reconnect with exponential backoff
- Maximum 5 reconnection attempts
- Check if the session server is still running

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Cursor    │────▶│  MCP Server  │────▶│ Session Server │
│ (AI Agent)  │◀────│  (stdio)     │◀────│  (WebSocket)   │
└─────────────┘     └──────────────┘     └────────────────┘
                                                  │
                                                  ▼
                                          ┌────────────────┐
                                          │   node-pty     │
                                          │  (terminals)   │
                                          └────────────────┘
```

## Development

To modify the session server:
1. Edit `/src/testing/session-server-v3.ts` for core functionality
2. Edit `/src/testing/mcp-server.ts` for MCP wrapper logic
3. Edit `/src/testing/mcp-stdio-server.ts` for tool definitions

Remember to restart both the session server and Cursor after making changes.
