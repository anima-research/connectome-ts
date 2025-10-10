# Frame Snapshot Implementation - Complete

## Overview

Frames now capture **chunked rendered snapshots** at creation time, preserving the original subjective experience for compression and replay. Each chunk can optionally be attributed to VEIL facets.

## Architecture

### 1. Chunk Structure

```typescript
interface RenderedChunk {
  content: string;           // The actual rendered text
  tokens: number;            // Token count
  facetIds?: string[];       // Optional: which facets this represents
  type?: string;             // Optional: 'event', 'state', 'speech', 'action', etc.
  role?: 'user' | 'assistant' | 'system';  // For message grouping
}
```

**Key Design Decision:**
- **Optional facet attribution**: Not all rendered content maps to facets
- Examples:
  - `facetIds: ['event-123']` - Content from a specific event facet
  - `facetIds: []` or `undefined` - Formatting, system messages, turn markers
  
### 2. Frame Snapshot

```typescript
interface FrameRenderedSnapshot {
  chunks: RenderedChunk[];      // Ordered chunks
  totalContent: string;         // Concatenated (convenience)
  totalTokens: number;          // Sum of chunk tokens
  capturedAt: number;           // Timestamp
  hasContent: boolean;          // Whether frame produced visible content
}

// Added to Frame interface
interface Frame {
  // ... existing fields ...
  renderedSnapshot?: FrameRenderedSnapshot;
}
```

### 3. Capture During Rendering

The `FrameTrackingHUD` captures snapshots during `renderWithFrameTracking()`:

```typescript
// For each frame
const snapshotBuilder = new FrameSnapshotBuilder();

// Render and capture chunks
this.renderFrameContent(frame, source, state, removals, snapshotBuilder);

// Attach to frame
frame.renderedSnapshot = snapshotBuilder.build();
```

**Chunk Attribution Examples:**

```typescript
// Agent speech - attributed to facet
snapshotBuilder.addContent(facet.content, {
  facetIds: [facet.id],
  type: 'speech',
  role: 'assistant'
});

// Turn markers - unattributed formatting
snapshotBuilder.addContent('<my_turn>\n\n', {
  type: 'formatting',
  role: 'assistant'
  // No facetIds - this is just formatting
});

// Event - attributed to facet
snapshotBuilder.addContent(rendered, {
  facetIds: [facet.id],
  type: 'event',
  role: 'user'
});
```

## Usage

### Compression

```typescript
// CompressionTransform automatically uses snapshots
private getRenderedFrames(state: ReadonlyVEILState): RenderedFrame[] {
  const frameHistory = state.frameHistory;
  
  // Try snapshots first
  const hasSnapshots = frameHistory.every(f => f.renderedSnapshot);
  
  if (hasSnapshots) {
    // Use pre-captured snapshots - fast and preserves original
    return frameHistory.map(frame => ({
      frameSequence: frame.sequence,
      content: frame.renderedSnapshot!.totalContent,
      tokens: frame.renderedSnapshot!.totalTokens,
      facetIds: Array.from(new Set(
        frame.renderedSnapshot!.chunks.flatMap(c => c.facetIds || [])
      ))
    }));
  }
  
  // Fallback: re-render if snapshots missing
  return this.renderCurrent(frameHistory);
}
```

### Extract Specific Frame Range

```typescript
import { extractSnapshotRange } from 'connectome-ts';

// Get frames 100-150 with their original rendering
const { chunks, totalContent, totalTokens } = extractSnapshotRange(
  frameHistory.map(f => ({ 
    sequence: f.sequence, 
    snapshot: f.renderedSnapshot! 
  })),
  100,  // fromFrame
  150   // toFrame
);

// Compress that specific content
await compressRange(totalContent);
```

### Find Content by Facet

```typescript
import { findChunksByFacet, getSnapshotFacets } from 'connectome-ts';

// Find all chunks that reference a specific facet
const chunks = findChunksByFacet(frame.renderedSnapshot!, 'event-123');

// Get all facets referenced in a snapshot
const facetIds = getSnapshotFacets(frame.renderedSnapshot!);
```

### Group Chunks by Role

```typescript
import { groupChunksByRole } from 'connectome-ts';

// Group chunks for message construction
const roleGroups = groupChunksByRole(frame.renderedSnapshot!.chunks);

const userChunks = roleGroups.get('user');
const assistantChunks = roleGroups.get('assistant');
```

## Benefits

### 1. Preserves Original Subjective Experience

```typescript
// Frame rendered at creation (frame N)
frame.renderedSnapshot = {
  chunks: [
    { content: "User asked: What's 2+2?", facetIds: ['event-1'], role: 'user' },
    { content: "The answer is 4", facetIds: ['event-2'], role: 'assistant' }
  ]
};

// Later (frame N+100), a transform modifies facet 'event-1'
// But compression still sees the ORIGINAL rendering!
await compressRange(frame.renderedSnapshot.totalContent);
```

### 2. Facet Attribution (When Available)

```typescript
// Find what agent said about a specific topic
const speechChunks = snapshot.chunks.filter(c => 
  c.type === 'speech' && 
  c.facetIds?.includes('discussion-topic-ai')
);

// Track which facets contributed to compressed content
const compressed = await compressFrames(100, 150);
compressed.sourceFacets = extractedChunks
  .flatMap(c => c.facetIds || []);
```

### 3. Optional Facet Attribution

**Attributed Content:**
- Events from external systems
- Agent speech, thoughts, actions
- State changes
- Ambient information

**Unattributed Content:**
- Turn markers (`<my_turn>`, `</my_turn>`)
- System messages
- Formatting separators
- Generated prompts

```typescript
// Mix of attributed and unattributed
chunks: [
  { content: '<my_turn>\n\n', type: 'formatting' },  // No facetIds
  { content: 'Hello!', facetIds: ['speech-1'], type: 'speech' },  // Attributed
  { content: '\n\n</my_turn>', type: 'formatting' }  // No facetIds
]
```

### 4. Performance

```typescript
// Without snapshots: O(n) rendering every time
const rendered = hud.render(allFrames);

// With snapshots: O(1) access to pre-rendered content
const content = frame.renderedSnapshot.totalContent;
```

## Memory Considerations

### Storage Size

```typescript
// Example frame snapshot
{
  chunks: [
    { content: "User: Hello", tokens: 3, facetIds: ['event-1'] },
    { content: "Agent: Hi!", tokens: 3, facetIds: ['speech-1'] }
  ],
  totalContent: "User: Hello\nAgent: Hi!",  // ~20 bytes
  totalTokens: 6
}

// Typical size: 100-500 bytes per frame
// 10,000 frames = ~1-5MB
```

**Acceptable for in-memory storage.**

### Optimization Strategies

1. **Lazy Capture** (current): Snapshots captured on first render
2. **Selective Capture**: Only snapshot frames older than N
3. **Garbage Collection**: Drop snapshots for compressed ranges
4. **Disk Persistence**: Archive old snapshots to disk

## Testing

```typescript
// Verify snapshot capture
const frame = createTestFrame();
const builder = new FrameSnapshotBuilder();

builder.addContent('User input', {
  facetIds: ['event-1'],
  type: 'event',
  role: 'user'
});

const snapshot = builder.build();

assert.equal(snapshot.chunks.length, 1);
assert.equal(snapshot.totalContent, 'User input');
assert.deepEqual(snapshot.chunks[0].facetIds, ['event-1']);
```

## Migration

**Backwards Compatible:**
- Old frames without `renderedSnapshot` still work
- Compression falls back to re-rendering
- Snapshots are added automatically on first render

**Gradual Adoption:**
```typescript
// Check if snapshot exists
if (frame.renderedSnapshot) {
  // Use fast snapshot path
  return frame.renderedSnapshot.totalContent;
} else {
  // Fall back to re-rendering
  return hud.renderFrame(frame);
}
```

## Future Enhancements

### 1. Incremental Snapshots

Instead of storing full content, store only deltas:

```typescript
interface FrameRenderedSnapshot {
  deltaChunks: RenderedChunk[];  // Only new content
  cumulativeTokens: number;       // Running total
  basedOn?: number;               // Previous frame sequence
}
```

### 2. Compression-Aware Snapshots

```typescript
interface FrameRenderedSnapshot {
  chunks: RenderedChunk[];
  compressionState?: {
    replacedBy?: string;  // Compression block ID
    originalTokens: number;
  };
}
```

### 3. Multi-Facet Chunks

Some chunks represent multiple related facets:

```typescript
{
  content: "State changed: count=3 → count=4",
  facetIds: ['state-counter', 'transition-increment'],  // Multiple facets!
  type: 'state-transition'
}
```

### 4. Structural Metadata

```typescript
interface RenderedChunk {
  // ... existing fields ...
  structure?: {
    level: number;      // Nesting level
    parent?: string;    // Parent chunk ID
    children?: string[];  // Child chunk IDs
  };
}
```

This enables hierarchical compression strategies.
