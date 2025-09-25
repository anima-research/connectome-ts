# MCP Setup for Connectome Session Server

## Quick Start

1. **Start the session server** (required for MCP):
   ```bash
   cd /Users/olena/connectome-local/connectome-ts
   npm run session-server
   ```
   Keep this running in a terminal (runs on port 3100).

2. **Restart Cursor** to load the new MCP configuration.

3. **Test the MCP tools** - I should now have access to these tools:
   - `startService` - Start services with smart detection
   - `runCommand` - Execute commands in sessions
   - `listSessions` - See all active sessions
   - `tailLogs` - Get recent session output

## How It Works

```
┌─────────────┐     stdio/jsonrpc     ┌──────────────┐      WebSocket
│   Cursor    │◄────────────────────►│  MCP Server  │◄───────────────►│ Session Server │
│  (You & Me) │                      │ (stdio-server)│                │   (port 3101)  │
└─────────────┘                      └──────────────┘                └────────────────┘
```

The MCP server translates between Cursor's MCP protocol and our WebSocket session API.

## Troubleshooting

If tools aren't showing up:
1. Make sure session server is running on port 3101
2. Check Cursor's MCP logs: View → Output → MCP
3. Try: `ps aux | grep session-server` to verify it's running

## Example Usage

Once set up, I can use commands like:
- Start a service: Use the `startService` tool
- Run commands: Use the `runCommand` tool
- Check logs: Use the `tailLogs` tool

No more terminal juggling! 🎉

