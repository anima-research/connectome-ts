#!/usr/bin/env node

/**
 * Start the Session Server API
 */

import { SessionAPI } from './websocket-api';

const port = parseInt(process.env.SESSION_SERVER_PORT || '3100');

console.log(`
╔═══════════════════════════════════════╗
║     Connectome Session Server         ║
║                                       ║
║  Persistent terminal sessions for     ║
║  collaborative AI testing             ║
╚═══════════════════════════════════════╝

Starting server on port ${port}...
`);

const api = new SessionAPI(port);

console.log(`
✅ Server ready!

WebSocket URL: ws://localhost:${port}
Health Check: http://localhost:${port}/health

Available methods:
- session.create    Create a new terminal session
- session.exec      Execute a command
- session.output    Get session output
- session.search    Search logs with context
- session.list      List active sessions
- session.kill      Kill a session
- session.killAll   Kill all sessions
- session.input     Send input to interactive session
- session.signal    Send signal (SIGINT, etc)
- session.env       Get environment variables
- session.pwd       Get current directory
- service.start     Start a service with monitoring

Press Ctrl+C to stop
`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  api.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  api.stop();
  process.exit(0);
});

