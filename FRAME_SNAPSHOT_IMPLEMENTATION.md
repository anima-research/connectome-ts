# Frame Snapshot Implementation - Complete

## What Was Implemented

A complete system for capturing rendered frame snapshots with chunked content and facet attribution.

## Files Changed/Created

### 1. **New Types** (`src/veil/rendered-snapshot-types.ts`)

```typescript
interface RenderedChunk {
  content: string;              // Required: rendered text
  tokens: number;               // Required: token count
  facetIds?: string[];          // Optional: source facets
  chunkType?: string;           // Optional: semantic type (open string)
  metadata?: Record<string, any>;  // Optional: HUD-specific data
}

interface FrameRenderedSnapshot {
  chunks: RenderedChunk[];      // Chunked content with attribution
  totalTokens: number;          // Pre-computed sum
  totalContent: string;         // Pre-computed concatenation
  capturedAt?: number;          // Timestamp
}
```

**Key decisions:**
- ✅ No `role` field (LLM-specific, determined at render time)
- ✅ `chunkType` is open string (like facet types, not enum)
- ✅ All attribution is optional

### 2. **Frame Type Updated** (`src/veil/types.ts`)

```typescript
interface Frame {
  // ... existing fields ...
  renderedSnapshot?: FrameRenderedSnapshot;  // Optional snapshot
}
```

### 3. **HUD Method** (`src/hud/frame-tracking-hud.ts`)

Added `captureFrameSnapshot()` method:

```typescript
captureFrameSnapshot(
  frame: Frame,
  currentFacets: Map<string, Facet>,
  replayedState?: Map<string, Facet>
): FrameRenderedSnapshot
```

**Features:**
- Tracks turn markers as separate chunks (chunkType: 'turn-marker')
- Attributes each facet rendering to source facets
- Handles agent frames (with turn markers) vs environment frames
- Two-pass rendering for state changes (like existing HUD logic)

### 4. **Transform** (`src/transforms/frame-snapshot-transform.ts`)

```typescript
class FrameSnapshotTransform extends BaseTransform {
  priority = 200;  // Run late, after state stabilizes
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    // Capture snapshot of latest frame
    // Store directly on frame object
    // Returns no deltas (side effect only)
  }
}
```

**Features:**
- Can be enabled/disabled
- Optional verbose logging
- Skips frames that already have snapshots
- Runs late (priority 200) so other transforms finish first

## Usage

### Basic Setup

```typescript
import { 
  Space, 
  VEILStateManager, 
  FrameSnapshotTransform 
} from 'connectome-ts';

const veilState = new VEILStateManager();
const space = new Space(veilState);

// Add snapshot transform
const snapshotTransform = new FrameSnapshotTransform({
  enabled: true,
  verbose: true
});
space.addTransform(snapshotTransform);

await space.mount();

// Process events normally - snapshots captured automatically
space.emit(someEvent);
await space.processEvents();

// Access snapshots
const frame = veilState.getState().frameHistory[0];
console.log(frame.renderedSnapshot?.chunks);
```

### Using Snapshots for Compression

```typescript
// CompressionTransform can now use snapshots directly
class CompressionTransform extends BaseTransform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const framesToCompress = state.frameHistory.filter(f =>
      f.sequence >= 100 && f.sequence <= 150
    );
    
    // Direct access to rendered content
    const content = framesToCompress
      .map(f => f.renderedSnapshot?.totalContent || '')
      .join('\n\n');
    
    const tokens = framesToCompress.reduce(
      (sum, f) => sum + (f.renderedSnapshot?.totalTokens || 0),
      0
    );
    
    this.compressAsync({ fromFrame: 100, toFrame: 150, content, tokens });
    return [];
  }
}
```

### Analyzing Facet Attribution

```typescript
// Find which facets contributed to rendered output
for (const frame of frames) {
  if (frame.renderedSnapshot) {
    for (const chunk of frame.renderedSnapshot.chunks) {
      if (chunk.facetIds) {
        console.log(`Chunk type ${chunk.chunkType}: facets ${chunk.facetIds.join(', ')}`);
      }
    }
  }
}
```

## Chunk Structure Examples

### Agent Frame (with turn markers)

```javascript
{
  chunks: [
    {
      content: '<my_turn>\n\n',
      tokens: 2,
      chunkType: 'turn-marker'
      // No facetIds - formatting only
    },
    {
      content: 'Hello! How can I help?',
      tokens: 12,
      facetIds: ['speech-123'],
      chunkType: 'speech'
    },
    {
      content: '\n\n</my_turn>',
      tokens: 2,
      chunkType: 'turn-marker'
    }
  ],
  totalTokens: 16,
  totalContent: '<my_turn>\n\nHello! ...\n\n</my_turn>'
}
```

### Environment Frame (events/states)

```javascript
{
  chunks: [
    {
      content: '<event>User said: Hello</event>',
      tokens: 8,
      facetIds: ['event-456'],
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
  totalContent: '<event>...</event><state>...</state>'
}
```

## Benefits

### 1. **Compression Can Use Snapshots**
- No need to re-render when compressing
- Captures original subjective experience
- Immune to later transforms modifying history

### 2. **Facet-Level Attribution**
- Trace rendered content back to source facets
- Analyze which facets contribute most to context
- Debug rendering issues

### 3. **Flexible Chunking**
- Turn markers as separate chunks
- Each facet as its own chunk
- Can aggregate or filter by chunk type

### 4. **Performance**
- Pre-computed totals (content, tokens)
- Captured once per frame
- No repeated rendering

### 5. **Optional**
- Can disable snapshot capture if not needed
- Backwards compatible (optional field)
- Gradual adoption

## Testing

Run the example:

```bash
cd connectome-ts
npx ts-node examples/test-frame-snapshots.ts
```

Expected output:
- Frame snapshots with chunk details
- Facet attribution analysis
- Demonstration of compression usage

## Next Steps

### Immediate
1. ✅ Types defined
2. ✅ HUD method implemented
3. ✅ Transform created
4. ✅ Exported from index
5. ✅ Example created

### Future Enhancements
1. **Snapshot Storage Optimization**
   - Delta-only storage (vs full cumulative)
   - Compression-aware strategies
   
2. **Advanced Attribution**
   - Multi-facet chunks (groups of related facets)
   - Hierarchical chunking (nested structures)
   
3. **Compression Integration**
   - Update CompressionTransform to prefer snapshots
   - Fallback to re-rendering if missing
   
4. **Analysis Tools**
   - Facet rendering frequency
   - Token usage by facet type
   - Snapshot quality metrics

## Architecture Notes

**Why priority 200?**
- Runs late in Phase 2
- Other transforms have stabilized state
- Captures "final" rendering before effectors run

**Why side effect on frame?**
- Snapshots are frame metadata, not VEIL deltas
- No need to propagate through system
- Direct mutation is pragmatic here

**Why optional everywhere?**
- HUD might not track facets for formatting chunks
- Allows gradual adoption
- Doesn't force immediate facet attribution

**Why no role field?**
- Role is LLM-specific (OpenAI/Anthropic convention)
- Frame source determined at render time by HUD
- Keeps VEIL independent from LLM APIs
