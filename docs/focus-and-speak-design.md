# Focus and Speak Design

This document explains how agent communication works through the focus and speak mechanisms.

## Core Concepts

### Focus
- **Definition**: The active communication channel where agent responses are directed
- **Set by**: Incoming VEIL frames
- **Format**: `adapter:channel` (e.g., `discord:general`, `minecraft:local`, `twitter:compose`)
- **Persistence**: Focus remains active until changed by a new incoming frame

### Speak Operation
- **Purpose**: Captures the agent's natural dialogue
- **Routing**: By default, goes to the current focus
- **Override**: Can specify explicit target(s) to override focus

## How It Works

### 1. Context Sets Focus
When an event arrives from an external source:
```typescript
{
  sequence: 10,
  timestamp: "...",
  focus: "discord:general",  // This event came from Discord #general
  operations: [
    {
      type: "addFacet",
      facet: {
        type: "event",
        content: "Can you help with this?",
        attributes: { sender: "Alice", channel: "discord:general" }
      }
    }
  ]
}
```

### 2. Agent Speaks Naturally
The agent responds using speak operations that flow to the focused channel:
```typescript
{
  sequence: 11,
  operations: [
    {
      type: "speak",
      content: "Of course! Let me help you with that."
      // No target specified - goes to current focus (discord:general)
    }
  ]
}
```

### 3. Explicit Routing When Needed
The agent can override focus for specific messages:
```typescript
{
  type: "speak",
  content: "Attention all channels: System maintenance in 5 minutes",
  targets: ["discord:general", "discord:announcements", "minecraft:global"]
}
```

## Multi-Channel Scenarios

### Scenario 1: Natural Conversation Flow
- User messages from Discord → focus: `discord:general`
- Agent speaks → goes to Discord
- Minecraft event arrives → focus: `minecraft:local`
- Agent speaks → goes to Minecraft

### Scenario 2: Cross-Channel Communication
```typescript
// Currently focused on discord:general
{
  type: "speak",
  content: "Let me check what's happening in the game",
  target: "minecraft:local"  // Explicitly speak to Minecraft
}
```

### Scenario 3: Private Response
```typescript
// In a public channel but want to DM
{
  type: "speak",
  content: "I'll send you the details privately",
  target: "discord:dm:alice"
}
```

## Design Benefits

1. **Natural Flow**: Agents don't need to specify targets for every utterance
2. **Context Awareness**: Responses naturally go where they make sense
3. **Flexibility**: Can break out of context when needed
4. **Multi-Platform**: Works across different communication platforms
5. **Clear Tracking**: All dialogue is captured in VEIL as speak operations

## Rendering

Speak operations render as natural text without special formatting:
```xml
<my_turn>
<!-- Inner thoughts if any -->
<inner_thoughts>...</inner_thoughts>

<!-- Speak operations render as plain text -->
Hello! How can I help you today?

<!-- Tool calls render with structure -->
<tool_call name="search">...</tool_call>

Let me search for that information.
</my_turn>
```

## Implementation Notes

1. **Focus Inheritance**: Child elements could inherit parent focus (future enhancement)
2. **Focus Stack**: Could support focus history for "return to previous context"
3. **Multi-Focus**: Could support simultaneous focus on multiple channels
4. **Focus Metadata**: Could include additional context like language, formality level

## Comparison with Alternatives

### Alternative 1: Everything as Tool Calls
```typescript
// NOT our approach
{ type: "toolCall", name: "send_message", parameters: { 
  channel: "discord:general", 
  message: "Hello!" 
}}
```
- Pro: Explicit routing
- Con: Unnatural, verbose, loses conversational flow

### Alternative 2: No Structure
- Pro: Maximum flexibility
- Con: No tracking, no routing, no multi-channel support

Our focus/speak design balances structure with natural conversation flow.
