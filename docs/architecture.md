# Lightweight Connectome Architecture

## Overview

The implementation is structured in layers, with clean interfaces between components:

```
┌─────────────────────────────────────────────┐
│              Agent Loop                      │
│  (Coordinates all components)                │
└─────────────┬───────────────────────────────┘
              │
    ┌─────────┴─────────┬──────────────────┐
    ▼                   ▼                  ▼
┌─────────┐      ┌──────────────┐   ┌───────────┐
│  VEIL   │      │ Compression  │   │    HUD    │
│ State   │─────▶│   Engine     │──▶│ Renderer  │
└─────────┘      └──────────────┘   └───────────┘
```

## Component Responsibilities

### 1. VEIL State Manager (`veil/veil-state.ts`)
- Maintains current state of all facets
- Applies incoming frame operations
- Tracks scopes and frame history
- Provides active facets filtered by scope
- Manages focus (communication channel)

### 2. Compression Engine (`compression/`)
- Interface: Takes facets, returns content blocks
- PassthroughEngine: Minimal implementation that converts facets to blocks
- Future: Can implement summarization, narrative generation, etc.

### 3. HUD (`hud/`)
- Interface: Takes blocks, returns rendered context for LLM
- XmlHUD: Renders facets as XML elements
- Parses completions to extract operations (speak, tool calls, inner thoughts)
- Future: JSON HUD, custom formats

### 4. Agent Loop (`agent-loop/`)
- Orchestrates the full cycle:
  1. Check for agent activation
  2. Get active facets from VEIL
  3. Compress facets to blocks
  4. Render blocks to LLM context
  5. Call LLM
  6. Parse response into operations
  7. Create outgoing VEIL frame
  8. Process tool calls
  9. Check for cycle requests

## Data Flow

### Incoming Events → VEIL
```typescript
frame: IncomingVEILFrame = {
  sequence: 1,
  focus: "discord:general",  // Sets communication context
  operations: [
    { type: "addFacet", facet: {...} },
    { type: "agentActivation" }
  ]
}
↓
VEILStateManager.applyIncomingFrame(frame)
↓
State updated, listeners notified
```

### VEIL → Compression → HUD → LLM
```typescript
facets = veilState.getActiveFacets()
↓
blocks = compressionEngine.compress(facets, request)
↓
context = hud.render(blocks, config, focus)
↓
completion = llmProvider.complete(context.system, context.messages)
```

### LLM Response → Operations → VEIL
```typescript
parsed = hud.parseCompletion(completion)
↓
outgoingFrame: OutgoingVEILFrame = {
  sequence: 1001,
  operations: [
    { type: "speak", content: "Hello!" },
    { type: "toolCall", toolName: "search", parameters: {...} }
  ]
}
↓
veilState.recordOutgoingFrame(outgoingFrame)
```

## Key Design Decisions

### 1. Compression Returns Blocks
Rather than having the compression engine directly render text, it returns structured blocks. This allows the HUD to make final formatting decisions based on its output format.

### 2. Focus-Based Routing
The `focus` property on incoming frames sets the active communication channel. Speak operations go to this channel by default, but can override with explicit targets.

### 3. Operations Not Facets
Outgoing frames contain operations (speak, toolCall) not facets. This distinguishes agent actions from state changes.

### 4. Stateless Components
Compression and HUD are stateless - they process inputs to outputs without maintaining internal state. Only VEILStateManager is stateful.

## Extension Points

### Adding New Facet Types
1. Update `FacetType` in `veil/types.ts`
2. Update rendering logic in HUD implementations
3. Update compression logic if special handling needed

### Adding New HUD Formats
1. Implement the `HUD` interface
2. Define rendering rules for your format
3. Implement completion parsing for your format

### Adding Compression Strategies
1. Implement the `CompressionEngine` interface
2. Add logic for summarization, filtering, etc.
3. Can maintain internal cache for optimization

### Tool Integration
Currently, tool calls are logged. To integrate:
1. Register tool handlers with facet IDs
2. Look up handler in `processToolCalls`
3. Execute and generate new VEIL frames from results
