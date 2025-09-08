# Saliency Implementation Summary

## What We Built

We've extended VEIL to support intelligent context management through saliency hints and stream awareness.

### Core Additions

1. **Saliency Hints** on facets:
   - Temporal: `expires`, `transient`
   - Semantic: `streams`, `crossStream`
   - Importance: `pinned`, `reference`
   - Contextual: `responseToFacet`, `referencedByFacets`

2. **Stream Information**:
   - Simple stream concept (id + optional name)
   - Focus tracking in VEIL state
   - Stream-aware rendering

3. **SaliencyAwareHUD**:
   - Scores blocks based on context
   - Selects content within token limits
   - Respects focus and stream boundaries

## How It Works

### 1. Facets Provide Hints
```typescript
{
  id: "file-share",
  type: "event",
  content: "ProjectDocs.pdf shared",
  saliency: {
    streams: ["discord:general"],
    transient: true,
    expires: "2024-01-15T11:00:00Z"
  }
}
```

### 2. HUD Calculates Scores
The HUD considers:
- **Focus match**: Content in focused stream gets 2x boost
- **Cross-stream**: Maintains 0.8x base retention everywhere
- **Transient decay**: Rapid decay for temporary content
- **Pinned content**: Always included (score = 10.0)
- **References**: Boost for referenced content

### 3. Content Selection
- Blocks sorted by score
- Selected up to token limit
- Expired content automatically excluded

## Key Design Decisions

### No Explicit Scores
Facets don't have saliency numbers. They provide contextual hints that the HUD interprets based on current state.

### Stream-Centric
Focus is on streams (communication channels), not individual users or conversations. This matches how attention works in multi-channel environments.

### Flexible Defaults
Missing hints don't break rendering - sensible defaults based on facet type ensure graceful behavior.

## Example Behaviors

### Channel Switch
```
In discord:general → File shared (transient) → Conversation
Switch to discord:dev
Result: File ages out quickly, conversation preserved
```

### Important Content
```
Analysis created → User pins it
Switch channels → Analysis still visible (pinned)
Return later → Analysis still there
```

### System Alerts
```
Memory warning (crossStream + transient)
Visible in all channels briefly
Ages out after expiry time
```

## Benefits

1. **No Manual Scoring**: System infers importance from context
2. **Natural Behavior**: Content ages naturally based on relevance
3. **Multi-Channel Aware**: Different streams have different contexts
4. **Extensible**: Easy to add new hint types

## Future Enhancements

1. **Learning**: Track which content the agent references to adjust scores
2. **User Preferences**: Allow customization of decay rates
3. **Compression Integration**: Use saliency for summarization decisions
4. **Dynamic Expiry**: Adjust expiry based on activity patterns
