# Stream Operations in VEIL

## Why Explicit Stream Operations?

Streams represent communication contexts that the agent can interact with. Making stream lifecycle explicit through VEIL operations provides several benefits:

## 1. Agent Awareness

Without explicit operations, the agent only knows about the currently focused stream. With operations, the agent maintains awareness of:
- All available communication channels
- The nature of each channel (from ID patterns and names)
- Where it can route messages

## 2. Intelligent Routing

When a user asks "run npm test", the agent can:
- See that `shell:term1` exists
- Route the command there even if currently focused on `discord:general`
- Provide feedback in the appropriate channel

## 3. Multi-Channel Coordination

The agent can:
- Monitor multiple streams simultaneously
- Cross-reference activity between streams
- Make decisions based on the full communication context

## Stream Operations

### AddStream
```typescript
{
  type: "addStream",
  stream: {
    id: "discord:general",
    name: "General Chat"
  }
}
```
Creates a new stream in the agent's awareness.

### UpdateStream
```typescript
{
  type: "updateStream",
  streamId: "discord:general",
  updates: {
    name: "General Chat (30 users online)"
  }
}
```
Updates stream properties (useful for dynamic information).

### DeleteStream
```typescript
{
  type: "deleteStream",
  streamId: "discord:dm:alice"
}
```
Removes a stream from the agent's awareness.

## Example Flow

1. **Discord channel opens** → `addStream` operation
2. **User focuses channel** → `focus` property on frame
3. **Terminal starts** → `addStream` for shell
4. **User asks to run command** → Agent knows shell exists
5. **Agent routes command** → Uses `speak` with explicit target
6. **Channel closes** → `deleteStream` operation

## Design Benefits

### Explicit vs Implicit
- **Implicit**: Streams appear/disappear magically
- **Explicit**: Clear lifecycle, agent can track and respond

### Separation of Concerns
- **Stream existence**: Managed by operations
- **Stream focus**: Managed by frame property
- **Stream relevance**: Managed by saliency hints

### Future Capabilities
With explicit stream awareness, we can add:
- Stream permissions (can agent write here?)
- Stream capabilities (does this support images?)
- Stream relationships (parent/child channels)

## Best Practices

1. **Always use operations** for stream lifecycle
2. **Include descriptive names** to help agent understand context
3. **Clean up streams** when they're no longer available
4. **Track available streams** in a cross-stream state facet

This gives the agent a complete picture of its communication environment, enabling more intelligent and context-aware behavior.
