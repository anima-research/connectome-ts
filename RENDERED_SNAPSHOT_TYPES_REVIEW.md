# Rendered Snapshot Types - Design Review

## Overview

Types for capturing frame rendering as chunked content with optional facet attribution. Preserves the original subjective experience for compression while remaining flexible.

## Key Design Decisions

### 1. Chunked Storage

**Why chunks?**
- Fine-grained tracking: Can attribute parts of rendered output to specific facets
- Flexibility: A chunk can map to one facet, many facets, or no facets
- Performance: Can reconstruct full content or work with pieces
- Analysis: Enables facet-level compression analysis

```typescript
interface RenderedChunk {
  content: string;
  tokens: number;
  facetIds?: string[];      // Optional facet attribution
  chunkType?: string;       // Optional semantic type
  metadata?: Record<string, any>;  // Optional HUD-specific data
}
```

### 2. No Type Restrictions

**Original mistake:**
```typescript
chunkType?: 'event' | 'state' | 'ambient' | 'system' | 'compressed' | 'formatting';
```

**Fixed:**
```typescript
chunkType?: string;  // Completely open, like facet types
```

**Rationale:**
- VEIL uses `FacetType = string` - any string is valid
- Chunk types should follow the same philosophy
- Different HUDs might use different categorizations
- Extension without modification

### 3. No Role Field on Snapshots

**Original mistake:**
```typescript
interface FrameRenderedSnapshot {
  role: 'user' | 'assistant' | 'system';  // ❌ LLM API convention
}
```

**Fixed:**
```typescript
interface FrameRenderedSnapshot {
  // No role field - determined by HUD at render time
}
```

**Rationale:**
- `role` is an LLM API convention (OpenAI/Anthropic), not a VEIL concept
- Frame source (user/agent/system) is determined by `getFrameSource(frame)`
- Snapshots capture **what was rendered**, not **how it's used in LLM messages**
- Keeps VEIL independent from LLM-specific concerns

### 4. Optional Everything

**All attribution is optional:**
```typescript
facetIds?: string[];       // May not have facets
chunkType?: string;        // May not have semantic type
metadata?: Record<string, any>;  // May not have metadata
```

**Rationale:**
- HUD might not track facets (e.g., for formatting chunks like turn markers)
- Some chunks are purely presentational
- Allows gradual adoption without forcing immediate facet tracking

## Type Hierarchy

```
Frame
  ├─ renderedSnapshot?: FrameRenderedSnapshot
      ├─ chunks: RenderedChunk[]
      │   ├─ content: string (required)
      │   ├─ tokens: number (required)
      │   ├─ facetIds?: string[] (optional)
      │   ├─ chunkType?: string (optional)
      │   └─ metadata?: Record<string, any> (optional)
      ├─ totalTokens: number (pre-computed sum)
      ├─ totalContent: string (pre-computed concatenation)
      └─ capturedAt?: number (timestamp)
```

## Usage Patterns

### 1. Full Facet Attribution

```typescript
const snapshot: FrameRenderedSnapshot = {
  chunks: [
    {
      content: '<event>User said: Hello</event>',
      tokens: 8,
      facetIds: ['event-123'],
      chunkType: 'event'
    },
    {
      content: '<state id="counter">Count: 5</state>',
      tokens: 9,
      facetIds: ['state-counter'],
      chunkType: 'state'
    }
  ],
  totalTokens: 17,
  totalContent: '<event>...</event><state>...</state>',
  capturedAt: Date.now()
};
```

### 2. Partial Attribution (Formatting Chunks)

```typescript
const snapshot: FrameRenderedSnapshot = {
  chunks: [
    {
      content: '<my_turn>\n\n',
      tokens: 2,
      // No facetIds - this is just formatting
      chunkType: 'turn-marker'
    },
    {
      content: 'I analyzed the data...',
      tokens: 12,
      facetIds: ['speech-456'],
      chunkType: 'speech'
    },
    {
      content: '\n\n</my_turn>',
      tokens: 2,
      // No facetIds
      chunkType: 'turn-marker'
    }
  ],
  totalTokens: 16,
  totalContent: '<my_turn>\n\nI analyzed...\n\n</my_turn>'
};
```

### 3. No Attribution (Simple Capture)

```typescript
const snapshot: FrameRenderedSnapshot = {
  chunks: [
    {
      content: 'Full frame rendered output',
      tokens: 25
      // No facetIds, chunkType, or metadata
    }
  ],
  totalTokens: 25,
  totalContent: 'Full frame rendered output'
};
```

## Helper Functions

```typescript
// Build chunks
createRenderedChunk(content, tokens, { facetIds, chunkType, metadata });

// Query chunks
getReferencedFacets(chunks);           // All facet IDs
filterChunksByType(chunks, 'event');   // Filter by type
getChunksForFacet(chunks, 'event-123'); // Chunks for specific facet

// Aggregate
concatenateChunks(chunks);             // Full content
sumChunkTokens(chunks);                // Total tokens
```

## Benefits

1. **Flexible Attribution**: Can track facets when useful, skip when not
2. **VEIL-Aligned**: No imposed enums, follows open string philosophy
3. **LLM-Independent**: Doesn't bake in LLM API conventions
4. **Performance**: Pre-computed totals avoid repeated iteration
5. **Compression-Friendly**: Direct access to historical renderings
6. **Analysis-Ready**: Can trace rendered content back to source facets

## What's NOT in the Types

**Deliberately excluded:**
- ❌ Role field (LLM-specific, determined at render time)
- ❌ Message structure (chunks are pre-message, HUD builds messages)
- ❌ Restricted enums (everything is open strings)
- ❌ Rendering logic (these are just data structures)

## Next Steps

1. Implement snapshot capture in HUD (`renderSingleFrame()`)
2. Create `FrameSnapshotTransform` to capture at frame finalization
3. Update `CompressionTransform` to use snapshots
4. Add tests for chunk helpers
5. Document HUD implementation patterns
