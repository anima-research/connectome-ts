# Clean Agent Architecture

## Problem
Currently BasicAgent:
1. Gets sequence numbers from VEILStateManager (line 237)
2. Records its own frames (line 108)
3. Processes its own tool calls (line 111)

This creates conflicts with multiple agents and violates separation of concerns.

## Solution: Event-Driven Architecture

### Agent Responsibilities (Simplified)
```typescript
async runCycle(context, streamRef): Promise<OutgoingVEILFrame> {
  // 1. Call LLM
  const response = await this.llmProvider.generate(messages);
  
  // 2. Parse completion
  const parsed = this.parseCompletion(response.content);
  
  // 3. Create frame WITHOUT sequence
  return {
    sequence: undefined, // Space will assign this!
    timestamp: new Date().toISOString(),
    operations: parsed.operations
  };
}

async onFrameComplete(frame, state): Promise<void> {
  // Check activations and run cycle
  const response = await this.runCycle(context, streamRef);
  
  // Emit event instead of recording/processing
  this.element.emit({
    topic: 'agent:frame-ready',
    payload: { 
      frame: response,
      priority: 'immediate' 
    },
    source: this.element.getRef()
  });
}
```

### Space Responsibilities (Centralized)
```typescript
handleEvent(event: SpaceEvent) {
  if (event.topic === 'agent:frame-ready') {
    const { frame } = event.payload;
    
    // 1. Assign sequence
    frame.sequence = this.veilState.getNextSequence();
    
    // 2. Record frame
    this.veilState.recordOutgoingFrame(frame);
    
    // 3. Process tool calls
    await this.processToolCalls(frame.operations);
    
    // 4. Emit responses
    for (const op of frame.operations) {
      if (op.type === 'speak') {
        this.emit({ topic: 'agent:response', payload: op });
      }
    }
  }
}
```

## Benefits

1. **No Sequence Conflicts**: Space assigns all sequences
2. **Parallel Agents**: Multiple agents can emit frames simultaneously
3. **Clean Separation**: Agents generate, Space orchestrates
4. **Event-Driven**: Natural async flow
5. **Tool Coordination**: Space can coordinate tool calls between agents

## Multi-Agent Example

```typescript
// Opus thinks, Haiku executes
const opusFrame = {
  operations: [
    { type: 'speak', content: 'I need to search for X' },
    { type: 'requestTool', tool: 'search', params: {...} }
  ]
};

const haikuFrame = {
  operations: [
    { type: 'action', target: 'search', params: {...} }
  ]
};

// Space receives both, sequences them properly, coordinates execution
```
