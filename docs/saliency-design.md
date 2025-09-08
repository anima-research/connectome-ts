# Saliency and Context Management Design

## Problem Statement

The HUD needs to make intelligent decisions about what to include in limited context:
- What stays in context as we move between streams?
- How quickly should different types of information age out?
- What's relevant to the current focus vs globally relevant?

## Design Approach: Contextual Hints, Not Scores

Instead of explicit saliency scores, we provide contextual hints that the HUD interprets.

## Key Concepts

### 1. Streams as First-Class Citizens

Streams represent communication contexts:
```typescript
{
  id: "discord:general",
  name: "General Chat"
}
```

The stream is simply an identifier with an optional human-readable name. The ID convention (e.g., "discord:general", "shell:term1") provides enough context without needing explicit types.

### 2. Saliency Hints on Facets

Facets can include hints about their relevance:
```typescript
{
  id: "file-shared-001",
  type: "event",
  content: "SharedFile.pdf uploaded",
  saliency: {
    streams: ["discord:general"],  // Only relevant to this stream
    transient: 0.7,  // Decay rate (0.0 = permanent, 1.0 = very transient)
    linkedTo: ["request-001"]  // Someone asked for this file
  }
}
```

### 3. Implicit Saliency Rules

The HUD applies rules based on context:

#### Speech is Always Preserved
```typescript
// Speak operations create facets with implicit high saliency
{
  type: "event",
  content: "Agent said: Hello everyone!",
  saliency: {
    streams: ["discord:general"],
    // No transient flag - speech is preserved
  }
}
```

#### Cross-Stream Information
```typescript
{
  type: "state",
  content: "System Status: Online",
  saliency: {
    crossStream: true  // Relevant everywhere
  }
}
```

#### Referenced Content Gains Importance
```typescript
{
  id: "analysis-001",
  content: "Analysis of the data...",
  saliency: {
    referencedByFacets: ["response-001", "response-002"]
    // HUD boosts saliency due to references
  }
}
```

## Saliency Calculation (HUD's Responsibility)

The HUD calculates effective saliency based on:

1. **Stream Focus Match**
   - In focused stream: High base saliency
   - In active but unfocused stream: Medium
   - In inactive stream: Low

2. **Temporal Factors**
   - Recent: Full saliency
   - Aging + transient: Rapid decay
   - Aging + persistent: Slow decay
   - Expired: Zero saliency

3. **Semantic Factors**
   - Referenced by other facets: Boost
   - Pinned: Maximum saliency
   - Cross-stream: Maintain base saliency regardless of focus

4. **Type-Based Defaults**
   - Speech events: High retention
   - File shares: Medium retention in-stream, low out-of-stream
   - System states: Cross-stream relevance
   - Transient events: Quick decay

## Example Scenarios

### Scenario 1: Channel Switch
- User in `discord:general`, shares file, has conversation
- Switches to `discord:dev`
- File share ages out quickly (transient + out of focus)
- Conversation preserved longer (speech has high retention)
- System states remain (cross-stream)

### Scenario 2: Return to Channel
- User returns to `discord:general` after time away
- Recent activity shown in full
- Older transient events dropped
- Important conversations preserved
- Pinned references always available

### Scenario 3: Multi-Stream Agent
- Agent monitoring Discord, Minecraft, and terminal
- Each stream's content weighted by focus
- Cross-stream states (like agent's working memory) persist
- Stream-specific events fade when unfocused

## Implementation Notes

1. **Facets don't calculate their own saliency** - they provide hints
2. **HUD interprets hints based on current context** - flexible rendering
3. **No magic numbers** - relative importance, not absolute scores
4. **Graceful degradation** - missing hints use sensible defaults

## Benefits

- No need for humans to set saliency scores
- Agent doesn't need to explicitly manage importance
- Context-aware without being prescriptive
- Natural behavior emerges from simple rules
