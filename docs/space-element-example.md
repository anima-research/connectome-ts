# Space/Element Architecture Example

This example shows how the Space/Element system would work in practice with a simple Discord integration.

## Element Tree Structure

```
Space (root)
├── AgentLoop (component: AgentLoopComponent)
├── Discord Adapter
│   ├── Channel Manager (component: ChannelComponent)
│   └── Message Handler (component: MessageComponent)
├── Scratchpad (component: ScratchpadComponent)
└── Timer System (component: TimerComponent)
```

## Example Implementation Sketch

```typescript
// 1. Discord Message Arrives
class DiscordMessageComponent extends Component {
  handleEvent(event: SpaceEvent): void {
    if (event.type === 'discord:message') {
      const { channel, content, author } = event.data;
      
      // Create VEIL frame with focus
      this.element.space.veilState.startFrame({
        focus: `discord:${channel}`,
        operations: [
          {
            type: 'addFacet',
            facet: {
              id: generateId(),
              type: 'event',
              displayName: 'message',
              content: content,
              attributes: { sender: author, source: channel }
            }
          },
          {
            type: 'agentActivation',
            priority: 'normal',
            source: 'discord',
            reason: 'New message from user'
          }
        ]
      });
    }
  }
}

// 2. Agent Loop Processes
class AgentLoopComponent extends Component {
  private currentFocus?: string;
  private agentState = {
    sleeping: false,
    ignoringSources: new Set<string>(),
    defaultPriority: 'normal' as const
  };
  
  handleEvent(event: SpaceEvent): void {
    if (event.type === 'frame:end') {
      const frame = event.data.frame as IncomingVEILFrame;
      
      // Update focus if provided
      if (frame.focus) {
        this.currentFocus = frame.focus;
      }
      
      // Check for activation
      const activation = this.shouldActivate(frame);
      if (activation) {
        this.scheduleAgentCycle(activation);
      }
    }
  }
  
  private shouldActivate(frame: IncomingVEILFrame): AgentActivationOperation | null {
    // Find activation operations
    const activations = frame.operations
      .filter(op => op.type === 'agentActivation') as AgentActivationOperation[];
    
    if (activations.length === 0) return null;
    
    // Check agent state
    if (this.agentState.sleeping) {
      // Only high priority can wake sleeping agent
      const highPriority = activations.find(a => a.priority === 'high');
      if (!highPriority) return null;
    }
    
    // Check ignored sources
    const validActivation = activations.find(a => 
      !a.source || !this.agentState.ignoringSources.has(a.source)
    );
    
    return validActivation || null;
  }
  
  private async runAgentCycle(activation: AgentActivationOperation): Promise<void> {
    // Build context
    const context = await this.hud.render(
      this.element.space.veilState.getFrames(),
      this.element.space.veilState.getActiveFacets(),
      this.compressionEngine
    );
    
    // Call LLM
    const response = await this.llmProvider.complete(context);
    
    // Parse response and create outgoing frame
    const operations = this.parseResponse(response.content);
    
    // Apply default focus to speak operations
    const focusedOps = operations.map(op => {
      if (op.type === 'speak' && !op.target && this.currentFocus) {
        return { ...op, target: this.currentFocus };
      }
      return op;
    });
    
    // Record outgoing frame
    this.element.space.veilState.recordOutgoingFrame({
      operations: focusedOps
    });
  }
}

// 3. Timer Component (shows internal event generation)
class TimerComponent extends Component {
  private timers = new Map<string, NodeJS.Timeout>();
  
  handleEvent(event: SpaceEvent): void {
    if (event.type === 'tool:setTimer') {
      const { id, delayMs, message } = event.data;
      
      const timeout = setTimeout(() => {
        // Generate internal event
        this.element.space.queueEvent({
          type: 'timer:expired',
          source: this.element,
          data: { id, message }
        });
        
        // Also create VEIL frame
        this.element.space.veilState.startFrame({
          operations: [
            {
              type: 'addFacet',
              facet: {
                id: generateId(),
                type: 'event',
                displayName: 'timer',
                content: `Timer expired: ${message}`,
                attributes: { timerId: id }
              }
            },
            {
              type: 'agentActivation',
              priority: 'low',
              source: 'timer',
              reason: 'Scheduled timer expired'
            }
          ]
        });
      }, delayMs);
      
      this.timers.set(id, timeout);
    }
  }
}
```

## Event Flow Diagram

```
External Event → Element → VEIL Frame → Frame Processing → Agent Activation?
                                ↓                                  ↓
                          Frame Storage                      Agent Cycle
                                                                  ↓
                                                            Parse Response
                                                                  ↓
                                                         Outgoing VEIL Frame
                                                                  ↓
                                                         Element Handlers
                                                                  ↓
                                                         External Actions
```

## Key Design Benefits

1. **Decoupled**: Discord adapter doesn't know about agent internals
2. **Flexible**: Agent can choose to ignore sources or sleep
3. **Emergent**: Agent could learn to set timers, manage focus, etc.
4. **Extensible**: New adapters just emit events and handle speak operations
5. **Testable**: Can inject events and verify VEIL frames

## Frame Efficiency Example

```typescript
// Empty frame that gets discarded
processFrame() {
  // No events processed
  // No VEIL operations added
  // No agent activation
  // → Frame is discarded, sequence number not incremented
}

// Minimal frame that gets kept
processFrame() {
  // Timer tick event processed
  // No VEIL operations added
  // But agent activation requested
  // → Frame is kept for activation tracking
}
```
