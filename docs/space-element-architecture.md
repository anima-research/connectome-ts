# Space/Element/AgentLoop Architecture

## Overview

This document outlines the Unity-inspired architecture for Connectome's Space/Element system and how it integrates with VEIL and the AgentLoop.

## Core Concepts

### 1. Event System

First-class events flow through the element tree:
- **frame:start/end** - Marks frame boundaries (possibly in phases: pre/post)
- **time:tick** - Regular time updates
- **element:mount/unmount** - Lifecycle events
- **scheduled events** - Custom scheduled callbacks
- **adapter events** - Discord messages, file changes, etc. (defined by elements)

```typescript
interface SpaceEvent {
  type: string;
  source?: Element;
  target?: Element;  // null = broadcast
  data: any;
  timestamp: number;
  propagation: 'bubble' | 'capture' | 'none';
  stopPropagation?: boolean;
}
```

### 2. Element System

Elements are the basic building blocks (like Unity GameObjects):
- Arranged in a tree hierarchy
- Can have multiple components
- Manage their own lifecycle
- Can produce VEIL operations

```typescript
abstract class Element {
  id: string;
  name: string;
  parent?: Element;
  children: Element[] = [];
  components: Component[] = [];
  active: boolean = true;
  
  // Called by Space during event processing
  handleEvent(event: SpaceEvent): void;
}
```

### 3. Component System

Components attach behavior to elements:
- Similar to Unity MonoBehaviours
- Subscribe to specific events
- Can modify element state
- Can produce VEIL operations

```typescript
abstract class Component {
  element: Element;
  enabled: boolean = true;
  
  // Lifecycle
  onMount(): void {}
  onUnmount(): void {}
  onEnable(): void {}
  onDisable(): void {}
  
  // Event handling
  handleEvent(event: SpaceEvent): void {}
}
```

### 4. Space (Root Container)

The Space is the root element that orchestrates everything:
- Manages the event queue
- Runs the frame loop
- Integrates with VEIL state
- Manages focus

```typescript
class Space extends Element {
  private eventQueue: SpaceEvent[] = [];
  private veilState: VEILStateManager;
  private currentFrame?: IncomingVEILFrame;
  private focus?: string;  // Current communication focus
  
  // Main frame processing
  processFrame(): void {
    // 1. Emit frame:start
    // 2. Process queued events
    // 3. Update VEIL state
    // 4. Check for agent activation
    // 5. Emit frame:end
    // 6. Finalize or discard frame
  }
}
```

## AgentLoop Integration

The AgentLoop is a special component that:
1. Monitors VEIL frames for activation requests
2. Manages the LLM interaction lifecycle
3. Parses responses into VEIL operations
4. Handles focus-based routing

```typescript
class AgentLoopComponent extends Component {
  private hud: FrameTrackingHUD;
  private llmProvider: LLMProvider;
  private compressionEngine?: CompressionEngine;
  
  async handleEvent(event: SpaceEvent): void {
    if (event.type === 'frame:end') {
      // Check if this frame needs LLM activation
      const activation = this.checkActivation(event.data.frame);
      if (activation) {
        await this.runAgentCycle(activation);
      }
    }
  }
  
  private checkActivation(frame: IncomingVEILFrame): AgentActivationOperation | null {
    // Look for explicit activation operations
    // Consider priority levels
    // Check agent state (sleeping, ignoring certain sources, etc.)
  }
}
```

## Focus Mechanism

Focus determines where agent responses are routed:

1. **Setting Focus**: Incoming events set focus via the VEIL frame
   ```typescript
   frame.focus = "discord:general";  // Set by Discord adapter
   ```

2. **Using Focus**: Agent speak operations use current focus by default
   ```typescript
   speak("Hello!"); // Goes to current focus
   speak("Hello!", { target: "minecraft:local" }); // Override focus
   ```

3. **Focus Persistence**: Focus remains until changed by another event

## Frame Lifecycle

```
1. Space.processFrame() starts
2. Emit frame:start event
3. Elements handle events, modify VEIL state
4. Check if frame has changes:
   - Has VEIL operations? → Keep frame
   - Has agent activation? → Keep frame  
   - Empty? → Discard frame
5. Emit frame:end event
6. AgentLoop checks for activation
7. If activated:
   - Build context via HUD
   - Call LLM
   - Parse response
   - Create outgoing frame
```

## Example Flow

```typescript
// 1. Discord message arrives
const discordElement = space.getElement('discord-adapter');
discordElement.emit({
  type: 'discord:message',
  data: { 
    channel: 'general',
    content: 'Hello agent!',
    author: 'user123'
  }
});

// 2. Discord adapter creates VEIL frame
veilState.recordIncomingFrame({
  focus: 'discord:general',
  operations: [
    { type: 'addFacet', facet: messageEvent },
    { type: 'agentActivation', priority: 'normal', source: 'discord' }
  ]
});

// 3. Frame processing detects activation
// 4. AgentLoop builds context and calls LLM
// 5. Response parsed into outgoing frame
veilState.recordOutgoingFrame({
  operations: [
    { type: 'speak', content: 'Hello!', target: frame.focus }
  ]
});

// 6. Discord adapter receives speak event and sends to channel
```

## Design Principles

1. **Loose Coupling**: Elements communicate via events, not direct references
2. **Emergent Behavior**: Minimal constraints to allow agent adaptation
3. **Pluggable Components**: Easy to add/remove functionality at runtime
4. **Focus-Based Routing**: Natural flow of conversation without hardcoding
5. **Frame Efficiency**: Empty frames are discarded to avoid clutter

## Implementation Order

1. Basic Element/Component/Event system
2. Space with frame processing
3. VEIL integration (frame building)
4. AgentLoop component
5. Simple test adapter (console-based)
6. Discord adapter
7. Additional elements (scratchpad, timers, etc.)
