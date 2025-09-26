# Connectome Debug MCP Server Setup

The Connectome Debug MCP server provides deep introspection capabilities for debugging Connectome applications through Cursor's MCP interface.

## Features

- **Connection Management**: Connect to debug servers on different ports
- **State Inspection**: View VEIL state, elements, and facets
- **Frame History**: Browse execution history and time-travel debugging
- **Performance Metrics**: Monitor operation rates and memory usage
- **Interactive Debugging**: Inject events and modify element properties
- **Search Capabilities**: Search through execution frames

## Setup

### 1. Add to Cursor MCP Configuration

Add the following to your `~/.cursor/mcp.json` file:

```json
{
  "servers": {
    "connectome-inspector": {
      "command": "/Users/olena/.nvm/versions/node/v20.10.0/bin/npx",
      "args": ["ts-node", "/Users/olena/connectome-local/connectome-ts/src/testing/debug-mcp-stdio.ts"],
      "cwd": "/Users/olena/connectome-local/connectome-ts"
    }
  }
}
```

**Note**: 
- Replace `/Users/olena` with your actual home directory path
- The server name is `connectome-inspector` to avoid conflicts
- Ensure you're using the correct path to your Node.js installation

### 2. Restart Cursor

After adding the configuration, restart Cursor to load the new MCP server.

## Usage

### Connect to Debug Server

First, ensure your Connectome application is running with debug enabled:

```typescript
const host = new ConnectomeHost({
  debug: { enabled: true, port: 3015 }
});
```

Then connect the MCP server:

```
connect({ port: 3015 })
```

### Available Tools

1. **Connection Management**
   - `connect({ port, host? })` - Connect to debug server
   - `disconnect()` - Disconnect from server
   - `getConnectionStatus()` - Check connection status

2. **State Inspection**
   - `getState()` - Full state (space + VEIL + metrics)
   - `getVEILState()` - Just VEIL facets
   - `getElement({ elementId })` - Inspect specific element
   - `getElementTree({ elementId?, depth? })` - Element hierarchy
   - `getAgents()` - List registered agents

3. **Frame History**
   - `getFrames({ limit?, offset? })` - Browse execution history
   - `getFrame({ frameId })` - Detailed frame with facet tree
   - `searchFrames({ pattern, type?, limit? })` - Search frames
   - `deleteFrames({ count })` - Clean up old frames

4. **Debugging Actions**
   - `injectEvent({ topic, payload?, sourceId? })` - Inject events
   - `updateElementProps({ elementId, props })` - Modify elements
   - `getMetrics()` - Performance metrics

### Example Workflow

```typescript
// 1. Connect to debug server
connect({ port: 3015 })

// 2. Check current state
const state = await getState()

// 3. Search for errors
const errors = await searchFrames({ 
  pattern: "error",
  type: "error" 
})

// 4. Inspect error frame
const frame = await getFrame({ 
  frameId: errors[0].uuid 
})

// 5. Inject test event
await injectEvent({
  topic: "user.action",
  payload: { test: true }
})
```

## Debugging Tips

1. **Time-Travel Debugging**: Use frames to see exact state at any point
2. **Performance Analysis**: Monitor metrics to identify bottlenecks
3. **State Inspection**: Drill down into VEIL facets to understand data flow
4. **Interactive Testing**: Inject events to test edge cases

## Troubleshooting

- **Connection Failed**: Ensure debug server is running and port is correct
- **No Frames**: Check that your application has debug enabled
- **Large Memory Usage**: Use `deleteFrames` to clean up history



