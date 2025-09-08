# Frame Sequence Tracking Analysis

## The Question
Do we need frame sequence tracking for memory formation?

## Current Architecture Problems

1. **Facets don't have frameSequence** - We'd need to add this property, creating coupling
2. **Complex tracking** - ContentBlocks need metadata, HUDs need to preserve it
3. **Lost on compression** - Frame sequences disappear when blocks are compressed
4. **Overengineering** - Adds complexity without clear benefit

## Key Insight

**The agent sees rendered text, not internal structures!**

When an agent wants to compress memory, they see:
```xml
<context>
<event>Event 1 occurred</event>
<event>Event 2 occurred</event>
<my_turn>
Agent response to events
</my_turn>
</context>
```

They DON'T see frame sequences, content blocks, or facet IDs.

## Simpler Approach

### 1. Segment Markers in Rendered Text
```xml
<context>
<!-- memory-segment-1 -->
<event>Event 1 occurred</event>
<event>Event 2 occurred</event>
<!-- /memory-segment-1 -->

<!-- memory-segment-2 -->
<my_turn>
Agent response
</my_turn>
<!-- /memory-segment-2 -->
</context>
```

### 2. Agent-Driven Compression
Agent sees markers and can request:
- "Compress segment-1 as: [Summary of events 1-2]"
- "Compress segment-2 as: [Agent's response summary]"

### 3. Memory System Tracks Replacements
```
segment-1 -> "[Summary of events 1-2]"
segment-2 -> "[Agent's response summary]"
```

### 4. HUD Applies Replacements on Next Render
When rendering blocks, check if they belong to a compressed segment and replace.

## Benefits

1. **No frame tracking needed** - Works with rendered text
2. **Agent-friendly** - Agent sees and references what's in the context
3. **Simple implementation** - Just string markers and replacements
4. **Preserves attention hooks** - Agent compresses in their own context

## Token-Based Alternative

Instead of frame tracking, use token counting:
1. Count tokens as blocks are added
2. When approaching limit, mark oldest blocks for compression
3. Agent compresses marked sections
4. Replace on next render

## Conclusion

Frame sequence tracking is unnecessary complexity. The agent works with rendered text, so our memory system should too. Simple segment markers or token-based compression achieve the same goal with less architectural overhead.

