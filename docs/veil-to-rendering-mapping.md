# VEIL to Rendered Context Mapping

This document explains how VEIL frames and operations map to the final rendered context sent to the LLM.

## Core Principles

1. **VEIL is the internal representation** - it tracks all state changes, events, and operations
2. **Rendered context is the external representation** - it's what the LLM actually sees
3. **Not everything in VEIL gets rendered** - tool definitions, some metadata, etc.
4. **Rendering is stateful** - the current state of all facets determines what appears

## Facet Type Rendering Rules

### State Facets
- Rendered as XML elements with their current state
- Attributes become XML attributes
- Children are rendered nested inside
- When state changes, the new state is rendered (not the delta)
- Persist in context until removed or out of scope

Example:
```typescript
// VEIL
{
  id: "ship-status-001",
  type: "state",
  content: "USS Endeavor - In orbit",
  attributes: { alertLevel: "green" }
}

// Rendered
<ship_status alertLevel="green">
USS Endeavor - In orbit
</ship_status>
```

### Event Facets
- Rendered once at their temporal position
- Appear as single-use elements
- Source/sender attributes often become XML attributes

Example:
```typescript
// VEIL
{
  type: "event",
  content: "Anomaly detected",
  attributes: { source: "sensors", priority: "high" }
}

// Rendered
<event source="sensors" priority="high">
Anomaly detected
</event>
```

### Ambient Facets
- Float in the context without strict temporal ordering
- Remain visible while their scope is active
- Often used for persistent context like objectives

Example:
```typescript
// VEIL
{
  type: "ambient",
  content: "Primary Directive: Explore",
  scope: ["mission"]
}

// Rendered
<ambient scope="mission">
Primary Directive: Explore
</ambient>
```

### Tool Facets
- **Never rendered directly**
- Register handlers for tool calls
- Only visible through their invocation

## Operation Mapping

### Incoming Operations

| VEIL Operation | Rendering Effect |
|----------------|------------------|
| `addFacet` | Facet appears in context according to its type rules |
| `changeState` | Updated state replaces previous rendering |
| `addScope` | Facets with that scope become active |
| `deleteScope` | Facets with that scope stop rendering |
| `agentActivation` | Triggers `<my_turn>` block in output |

### Outgoing Operations (Agent Responses)

| VEIL Operation | Rendering |
|----------------|-----------|
| `speak` | Natural dialogue text (no special formatting) |
| `toolCall` | `<tool_call name="...">` with parameters |
| `innerThoughts` | `<inner_thoughts>` block |
| `cycleRequest` | Tool call to system cycle function |

The `speak` operation contains the agent's natural dialogue and is rendered as plain text within the `<my_turn>` block. When a `speak` operation includes an explicit `target`, it may be rendered with special formatting (e.g., `<log_entry channel="...">` for log streams).

## Temporal Ordering

1. Events appear in sequence order
2. State changes show the latest state
3. Within an agent turn (`<my_turn>`), operations appear in order:
   - Inner thoughts first
   - Natural language
   - Tool calls interspersed or at end

## Hierarchical Rendering

Parent-child relationships in VEIL translate to nested XML:

```typescript
// VEIL
{
  id: "crew-status",
  type: "state",
  content: "Bridge crew active",
  children: [
    { id: "helm", type: "state", content: "Stable" },
    { id: "sensors", type: "state", content: "Scanning" }
  ]
}

// Rendered
<crew_status>
Bridge crew active
<helm>Stable</helm>
<sensors>Scanning</sensors>
</crew_status>
```

## Compression Points

The Compression Engine can intervene at several points:

1. **Historical summarization** - Old events compressed to summaries
2. **Ambient context generation** - Creating mission summaries, character sheets
3. **State aggregation** - Multiple related states combined
4. **Narrative blocks** - Self-narrated summaries of complex sequences

## Special Rendering Cases

### Agent Activation
When `agentActivation` operation occurs:
1. Current context is finalized
2. `<my_turn>` tag is opened
3. Agent generates response
4. Response is parsed for tool calls and inner thoughts
5. Outgoing VEIL frame is created from parsed response

### Scope Changes
- Adding scope: Dormant facets with that scope become active
- Deleting scope: Active facets with that scope stop rendering
- Scopes cascade: Child facets inherit parent's scope implicitly

### Frame Boundaries
- Frame boundaries are logical, not rendered
- Multiple frames can contribute to a single rendered moment
- Frames mainly matter for:
  - Sequencing guarantees
  - Rollback points
  - Event causality tracking
