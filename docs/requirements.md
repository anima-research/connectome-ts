# Lightweight Connectome Requirements

## Overview
An experimental TypeScript implementation of Connectome without the Loom DAG, focusing on instant state management with VEIL (Virtual Environment Interface Language) for LLM context generation.

## Core Design Principles

### 1. No Historical State
- No Loom DAG - state is instant only
- No timeline branching or rollback
- Simplified state model focused on current reality

### 2. Event-Driven Architecture
- All changes propagate through unified event system
- Both adapter events and internal events use same system
- Frame start/end boundaries for atomic updates

### 3. Focus-Based Communication
- Incoming events set a "focus" - the active communication channel
- Agent responses naturally flow to the focused channel
- Explicit routing available when needed

## VEIL (Virtual Environment Interface Language)

### Facet Types
1. **Event** - Strict temporality, occur at one moment
2. **State** - Persist until changed/invalidated  
3. **Ambient** - Loose temporality, "floats" at preferred depth (3-5 messages) from current moment
4. **Tool** - Define available tools (never rendered)

### Frame Structure

#### Incoming Frames
- **focus**: Communication channel (e.g., `discord:general`)
- **operations**:
  - `addFacet` - Add new facets
  - `changeState` - Modify existing states
  - `addScope`/`deleteScope` - Manage scopes
  - `addStream`/`updateStream`/`deleteStream` - Manage communication contexts
  - `agentActivation` - Trigger LLM call

#### Outgoing Frames  
- **operations**:
  - `speak` - Natural dialogue (routed via focus)
  - `toolCall` - Invoke registered tools
  - `innerThoughts` - Agent's reasoning
  - `cycleRequest` - Request another LLM cycle

### Key VEIL Properties
- Frames are deltas, not full state
- Sequence numbers for ordering (not timestamps)
- Facets can contain other facets (hierarchy)
- Scopes control facet lifetime

### Saliency Hints
Facets can include saliency hints to guide context management:
- **Temporal**: `transient` (float 0.0-1.0+) - decay rate
- **Semantic**: `streams[]`, `crossStream` - relevance scope
- **Importance**: `pinned`, `reference` - retention priority
- **Graph links**: `linkedTo[]`, `linkedFrom[]` - facet relationships

### Stream Management
- Streams represent communication contexts (channels, terminals, logs)
- Explicit lifecycle through operations (add/update/delete)
- Agent maintains awareness of all available streams
- Focus determines default routing for speak operations

## Architecture Layers

### 1. Elements & Spaces
- Elements arranged in tree structure
- Root Space contains all elements
- Event propagation through subscription

### 2. VEIL Processing
- Elements produce VEIL frames during event handling
- Frame boundaries ensure atomic updates
- Order of element execution not guaranteed

### 3. Compression Engine
- Runs after frame end
- Async compression ahead of need
- First pass enqueues tasks
- Blocks only when needed data unavailable

### 4. HUD (Heads-Up Display)
- Assembles final LLM context
- Multiple implementations possible (XML, JSON)
- Begins after compression first pass
- Extracts tool calls from completions

## Communication Flow

### Focus Mechanism
```typescript
// Incoming event sets focus
{ focus: "discord:general", operations: [...] }

// Agent speaks to focused channel
{ type: "speak", content: "Hello!" }  // Goes to discord:general

// Override with explicit target
{ type: "speak", content: "Alert!", targets: ["discord:general", "minecraft:global"] }
```

### Multi-Channel Support
- Discord: `discord:channel`, `discord:dm:user`
- Minecraft: `minecraft:local`, `minecraft:global`  
- Twitter: `twitter:timeline`, `twitter:dm:user`
- Shell: `shell:terminal1`
- File: `file:editor1`

## Implementation Requirements

### TypeScript Benefits
- Type safety for VEIL operations
- Better async/await handling
- Modern tooling and IDE support

### Event System
- Subscribe/unsubscribe patterns
- Event bubbling through element tree
- Async event handlers with proper ordering

### Extensibility
- Pluggable HUD implementations
- Pluggable compression strategies
- Easy addition of new element types
- Adapter-agnostic core

## Initial Targets

### Phase 1: Core + Discord
- VEIL state management
- Basic XML HUD
- Discord adapter integration
- Simple compression (passthrough)

### Phase 2: Additional Elements
- Internal scratchpad
- Social graph tracking
- Shell terminal
- File terminal

### Phase 3: Advanced Features
- Compression strategies
- Multiple HUD types
- Cross-channel coordination
- Scheduled events/timers

## Non-Goals

- Historical state tracking
- Timeline manipulation  
- State rollback/replay
- Complex state merging
- Backward compatibility with Python Connectome

## Success Criteria

1. Clean separation of concerns
2. Predictable event flow
3. Natural agent communication
4. Easy to add new elements
5. Performance suitable for real-time chat
6. Clear, maintainable codebase
