# Testing Debug MCP Tools

If the debug MCP is loaded, you should be able to use these commands:

1. First, connect to the debug server:
```
connect({ port: 4000 })
```

2. Get current state:
```
getConnectionStatus()
```

3. View the application state:
```
getState()
```

4. List agents:
```
getAgents()
```

5. Get recent frames:
```
getFrames({ limit: 10 })
```

6. Search for patterns:
```
searchFrames({ pattern: "agent" })
```

7. Inject a test event:
```
injectEvent({ topic: "test.mcp", payload: { source: "cursor" } })
```

8. Disconnect when done:
```
disconnect()
```

If these commands aren't available, the MCP server may not be loaded properly in Cursor.









