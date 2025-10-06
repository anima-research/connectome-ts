# Single Rendering Path Refactor - Complete

## The Problem

Originally, frame rendering and snapshot capture had **two separate code paths**:

```typescript
// Path 1: Regular rendering
renderFrameContent() → renderAgentFrame() / renderEnvironmentFrame()

// Path 2: Snapshot capture  
captureFrameSnapshot() → duplicated rendering logic
```

**Issues:**
- ❌ Logic duplication (~200 lines of duplicated code)
- ❌ Divergence risk (could render frames differently)
- ❌ Maintenance burden (bug fixes needed twice)
- ❌ No guarantee of consistency

## The Solution

**Single rendering path with chunk-based architecture:**

```typescript
// Shared rendering path
renderFrameAsChunks() → renderAgentFrameAsChunks() / renderEnvironmentFrameAsChunks()
                    ↓
        ┌───────────┴──────────┐
        │                      │
    Regular rendering    Snapshot capture
    (concatenates)       (uses chunks directly)
```

## Implementation

### 1. New Core Methods

```typescript
// Single source of truth for rendering
private renderFrameAsChunks(
  frame: Frame,
  source: 'user' | 'agent' | 'system',
  replayedState: Map<string, Facet>,
  removals?: Map<string, 'hide' | 'delete'>
): RenderedChunk[]

// Agent frames: turn markers + content
private renderAgentFrameAsChunks(frame: Frame): RenderedChunk[]

// Environment frames: events + states
private renderEnvironmentFrameAsChunks(
  frame: Frame,
  replayedState: Map<string, Facet>,
  removals?: Map<string, 'hide' | 'delete'>
): RenderedChunk[]
```

### 2. Legacy Wrappers

```typescript
// Existing code still works via wrappers
private renderFrameContent(...): { content: string; facetIds: string[] } {
  const chunks = this.renderFrameAsChunks(...);
  return {
    content: chunks.map(c => c.content).join(''),
    facetIds: Array.from(new Set(chunks.flatMap(c => c.facetIds || [])))
  };
}

private renderAgentFrame(frame: Frame): string {
  const chunks = this.renderAgentFrameAsChunks(frame);
  return chunks.map(c => c.content).join('');
}

private renderEnvironmentFrame(...): string {
  const chunks = this.renderEnvironmentFrameAsChunks(...);
  return chunks.map(c => c.content).join('');
}
```

### 3. Simplified Snapshot Capture

```typescript
// Was ~200 lines, now ~15 lines
captureFrameSnapshot(
  frame: Frame,
  currentFacets: Map<string, Facet>,
  replayedState?: Map<string, Facet>
): FrameRenderedSnapshot {
  const source = this.getFrameSource(frame);
  const stateToUse = replayedState || new Map(currentFacets);
  
  // Use the shared rendering path - single source of truth!
  const chunks = this.renderFrameAsChunks(frame, source, stateToUse);
  
  // Build snapshot
  return {
    chunks,
    totalContent: chunks.map(c => c.content).join(''),
    totalTokens: chunks.reduce((sum, c) => sum + c.tokens, 0),
    capturedAt: Date.now()
  };
}
```

## Benefits

### 1. **Single Source of Truth**
- All rendering goes through `renderFrameAsChunks`
- Snapshots **guaranteed** to match actual rendering
- Bug fixes automatically apply to both paths

### 2. **Simplified Maintenance**
- ~200 lines of duplication eliminated
- One place to update rendering logic
- Easier to reason about

### 3. **Architectural Correctness**
- Snapshots use the same logic HUD uses
- No divergence possible
- Future rendering changes automatically propagate

### 4. **Backwards Compatible**
- Existing code works via legacy wrappers
- Can gradually migrate to chunk-based rendering
- No breaking changes

## Architecture Flow

```
┌─────────────────────────────────────┐
│     renderFrameAsChunks()           │  ← Single source of truth
│  (returns RenderedChunk[])          │
└───────────┬─────────────────────────┘
            │
            ├──→ Agent frames: renderAgentFrameAsChunks()
            │    • Turn marker chunks (formatting)
            │    • Speech/action/thought chunks (with facetIds)
            │
            └──→ Environment frames: renderEnvironmentFrameAsChunks()
                 • Two-pass rendering (states first)
                 • Event/state chunks (with facetIds)

┌────────────────────────────────────────────────────┐
│ Usage Paths                                        │
├────────────────────────────────────────────────────┤
│                                                    │
│ Path 1: Regular Rendering                         │
│ ──────────────────────                            │
│ renderWithFrameTracking()                          │
│   → renderFrameContent()                           │
│     → renderFrameAsChunks()                        │
│       → concatenate chunks → string                │
│                                                    │
│ Path 2: Snapshot Capture                          │
│ ────────────────────                              │
│ captureFrameSnapshot()                             │
│   → renderFrameAsChunks()                          │
│     → use chunks directly → FrameRenderedSnapshot  │
│                                                    │
└────────────────────────────────────────────────────┘
```

## Code Comparison

### Before (Duplicated)

```typescript
// Regular rendering (~80 lines)
private renderAgentFrame(frame: Frame): string {
  const parts: string[] = [];
  for (const operation of frame.deltas) {
    if (operation.type === 'addFacet') {
      const facet = operation.facet;
      switch (facet.type) {
        case 'speech': /* ... */ break;
        case 'action': /* ... */ break;
        case 'thought': /* ... */ break;
      }
    }
  }
  if (parts.length > 0) {
    return `<my_turn>\n\n${parts.join('\n\n')}\n\n</my_turn>`;
  }
  return '';
}

// Snapshot capture (~80 lines - DUPLICATED LOGIC)
captureFrameSnapshot(...) {
  // Same logic as above, but building chunks instead of strings
  for (const operation of frame.deltas) {
    if (operation.type === 'addFacet') {
      const facet = operation.facet;
      switch (facet.type) {
        case 'speech': /* ... */ break;  // DUPLICATION!
        case 'action': /* ... */ break;  // DUPLICATION!
        case 'thought': /* ... */ break; // DUPLICATION!
      }
    }
  }
  // Build chunks...
}
```

### After (Shared)

```typescript
// Chunk-based rendering (~70 lines)
private renderAgentFrameAsChunks(frame: Frame): RenderedChunk[] {
  const chunks: RenderedChunk[] = [];
  const contentParts: Array<{ content: string; facetId: string; type: string }> = [];

  for (const operation of frame.deltas) {
    if (operation.type === 'addFacet') {
      const facet = operation.facet;
      let content = '';
      switch (facet.type) {
        case 'speech': /* ... */ break;
        case 'action': /* ... */ break;
        case 'thought': /* ... */ break;
      }
      if (content) {
        contentParts.push({ content, facetId: facet.id, type: facet.type });
      }
    }
  }
  
  // Build chunks with turn markers
  if (contentParts.length > 0) {
    chunks.push(createRenderedChunk('<my_turn>\n\n', ...));
    for (const part of contentParts) {
      chunks.push(createRenderedChunk(part.content, ..., { 
        facetIds: [part.facetId], 
        chunkType: part.type 
      }));
    }
    chunks.push(createRenderedChunk('\n\n</my_turn>', ...));
  }
  
  return chunks;
}

// Regular rendering (wrapper - ~3 lines)
private renderAgentFrame(frame: Frame): string {
  const chunks = this.renderAgentFrameAsChunks(frame);
  return chunks.map(c => c.content).join('');
}

// Snapshot capture (wrapper - ~15 lines)
captureFrameSnapshot(...): FrameRenderedSnapshot {
  const chunks = this.renderFrameAsChunks(frame, source, stateToUse);
  return {
    chunks,
    totalContent: chunks.map(c => c.content).join(''),
    totalTokens: chunks.reduce((sum, c) => sum + c.tokens, 0),
    capturedAt: Date.now()
  };
}
```

## Migration Path

### Phase 1: Chunk-Based Core (✅ Complete)
- Add `renderFrameAsChunks` methods
- Keep legacy wrappers for compatibility
- `captureFrameSnapshot` uses shared path

### Phase 2: Direct Chunk Usage (Future)
- Update `renderWithFrameTracking` to use chunks directly
- Remove legacy wrappers
- Full chunk-based architecture

### Phase 3: Advanced Features (Future)
- Chunk-level compression analysis
- Selective chunk rendering
- Chunk-based filtering/transformation

## Testing

Existing tests should pass without changes thanks to legacy wrappers:

```typescript
// This still works
const { content, facetIds } = hud.renderFrameContent(frame, source, state);

// This now uses the same rendering logic
const snapshot = hud.captureFrameSnapshot(frame, facets);
console.assert(snapshot.totalContent === content); // Guaranteed to match!
```

## Lines of Code Impact

- **Before:** ~400 lines (200 regular + 200 snapshot)
- **After:** ~250 lines (150 shared + 50 wrappers + 50 snapshot)
- **Reduction:** ~150 lines eliminated
- **Duplication:** 0 (was ~200 lines)

## Key Insight

The architectural fix wasn't just about deduplication - it was about **guaranteeing correctness**. With separate paths, there was no way to ensure snapshots matched actual rendering. Now it's impossible for them to diverge.
