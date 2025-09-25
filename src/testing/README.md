# Connectome Session Server

A minimal session management server that provides persistent terminal sessions for AI testing.

## Quick Start

```bash
# Start the server
npm run session-server

# Or with custom port
SESSION_SERVER_PORT=3200 npm run session-server
```

## What It Solves

✅ **Persistent Sessions**: Commands like `cd` and `export` persist across AI responses  
✅ **Smart Service Starting**: Detects when services are ready or have errors  
✅ **Log Search**: Find patterns in output without grep gymnastics  
✅ **Multi-Service Management**: Track multiple services by name  
✅ **No Lost Context**: Sessions survive between AI tool calls  

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────┐
│ MCP Client  │◄──────────────────►│              │
└─────────────┘                    │   Session    │
                                   │   Server     │
┌─────────────┐                    │              │
│   VSCode    │◄──────────────────►│  - Terminal  │
└─────────────┘                    │    Sessions  │
                                   │  - Output    │
┌─────────────┐                    │    Buffers   │
│ Connectome  │◄──────────────────►│              │
└─────────────┘                    └──────────────┘
```

## Usage Examples

### From MCP (AI Assistant)

```typescript
// Start a service
await mcp.startService({
  name: 'discord-bot',
  command: 'npm run dev',
  cwd: '/Users/olena/connectome-local/discord-axon',
  readyPatterns: ['Discord bot ready']
});
// Returns immediately with status: 'ready' | 'error' | 'running'

// Run commands in persistent session
await mcp.runCommand({
  session: 'build-env',
  command: 'export NODE_ENV=production'
});

// Search logs
await mcp.searchLogs({
  session: 'discord-bot',
  pattern: 'error|warning',
  context: 5
});
```

### From TypeScript

```typescript
import { SessionClient } from './websocket-api';

const client = new SessionClient('ws://localhost:3100');

// Create a session
const { sessionId } = await client.createSession({
  id: 'test-session',
  cwd: '/path/to/project'
});

// Execute commands
const result = await client.exec(sessionId, 'npm test');
console.log(result.output);

// Get recent output
const logs = await client.getOutput(sessionId, 100);
```

### Direct WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3100');

ws.send(JSON.stringify({
  id: '123',
  method: 'session.create',
  params: { id: 'my-session' }
}));

ws.send(JSON.stringify({
  id: '124', 
  method: 'session.exec',
  params: { 
    sessionId: 'my-session',
    command: 'echo "Hello from persistent session"'
  }
}));
```

## API Reference

### Session Management

- `session.create` - Create a new terminal session
- `session.exec` - Execute a command in a session
- `session.output` - Get buffered output (last N lines)
- `session.search` - Search output with regex and context
- `session.list` - List all active sessions
- `session.kill` - Terminate a session

### Service Management

- `service.start` - Start a service with intelligent ready detection
  - Waits up to 2 seconds for ready/error patterns
  - Returns status and startup logs
  - Automatically creates a named session

## Next Steps

This is the MVP that solves immediate testing pain. Future enhancements:

- [ ] Session persistence across server restarts
- [ ] Advanced pattern matching with webhooks
- [ ] Session sharing between multiple agents  
- [ ] Integration with Connectome components
- [ ] VSCode extension for visual session management

## Development

```bash
# Run tests
npm test

# Start in dev mode
npm run session-server:dev
```

