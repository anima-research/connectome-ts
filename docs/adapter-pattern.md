# Adapter Pattern for Connectome

## Overview

Adapters bridge external systems (Discord, Console, Twitter, etc.) with the Connectome's internal event system. They follow a consistent pattern:

1. **Mount**: Set up internal machinery (websockets, readline, etc.)
2. **External Events**: Convert external events to Space events
3. **Frame Participation**: Add VEIL operations during frame processing
4. **Response Routing**: Listen for agent responses and route back to external system

## Event Flow

```
External Event (e.g., console input)
    ↓
Adapter emits Space Event
    ↓
Space creates Frame (if needed)
    ↓
Space emits frame:start
    ↓
Adapter adds VEIL operations to frame
    ↓
Agent processes frame
    ↓
Agent emits response
    ↓
Adapter routes response to external system
```

## Key Principles

1. **Adapters don't create frames** - they emit events that trigger frame creation
2. **Adapters react to frame:start** - this is when they add their VEIL operations
3. **Async machinery runs independently** - external event loops enqueue into Space's event system
4. **Clean separation** - external I/O is isolated from VEIL/Space logic

## Example: Console Adapter

```typescript
class ConsoleAdapter extends Component {
  async onMount() {
    // 1. Set up async machinery
    this.rl = readline.createInterface(...);
    
    // 2. Subscribe to relevant events
    this.element.subscribe('frame:start');
    this.element.subscribe('agent:response');
    
    // 3. Start external event loop
    this.rl.on('line', (input) => {
      // Convert to Space event
      this.element.emit({
        topic: 'console:input',
        payload: { message: input }
      });
    });
  }
  
  handleEvent(event: SpaceEvent) {
    if (event.topic === 'frame:start') {
      // Add VEIL operations
      frame.operations.push(...);
    }
    
    if (event.topic === 'agent:response') {
      // Route back to console
      console.log(response);
    }
  }
}
```

This pattern ensures clean async handling and proper integration with the Space/Element event system.
