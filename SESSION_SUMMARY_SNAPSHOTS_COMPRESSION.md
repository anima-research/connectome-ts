# Session Summary: Frame Snapshots & Compression Architecture

## What We Accomplished

### 1. Resolved Git Merge Conflicts
- Merged compression refactoring branch with RETM auto-discovery
- Reconciled conflicts in `base-martem.ts` and `receptor-effector-types.ts`
- Combined priority system with RETM_TYPE symbols

### 2. Identified Priority System Issues
**Your insight:** "Priority is a really fragile mechanism for when you have an open ecosystem of components that don't have cross-awareness"

**Root cause:** CompressionTransform and ContextTransform were sharing mutable state (engine cache) instead of communicating through VEIL.

### 3. Diagnosed Poly-Temporality Problem
**The fundamental tension:**
- Frames exist in objective time (sequence numbers)
- Rendered context exists in subjective time (how frames look from a given vantage point)
- Compression needs to preserve "how frames rendered at creation time"
- But later transforms can modify earlier frames!

**Solution:** Frame snapshots captured at creation time.

### 4. Designed Constraint Solver Evolution Path
**Current:** Numeric priorities (pragmatic stopgap)
```typescript
priority = 10;  // Magic number, fragile
```

**Future:** Declarative constraints  
```typescript
provides = ['compressed-frames'];
requires = ['frame-snapshots'];
// Topological sort determines order automatically
```

Created comprehensive design doc: `CONSTRAINT_SOLVER_DESIGN.md`

### 5. Implemented Frame Snapshot Capture

**Key architectural decisions:**
- ✅ Chunked storage (fine-grained tracking)
- ✅ Optional facet attribution (not all chunks need facets)
- ✅ Open string types (no enums - `chunkType?: string`)
- ✅ No `role` field (LLM-specific, determined at render time)
- ✅ Single rendering path (no duplication)

**Types created:**
```typescript
interface RenderedChunk {
  content: string;
  tokens: number;
  facetIds?: string[];      // Optional facet attribution
  chunkType?: string;       // Optional semantic type (open)
  metadata?: Record<string, any>;  // Optional HUD data
}

interface FrameRenderedSnapshot {
  chunks: RenderedChunk[];
  totalContent: string;
  totalTokens: number;
  capturedAt?: number;
}

interface Frame {
  // ... existing fields ...
  renderedSnapshot?: FrameRenderedSnapshot;
}
```

### 6. Refactored HUD to Single Rendering Path

**Before:**
- Regular rendering: `renderFrameContent()` → string
- Snapshot capture: `captureFrameSnapshot()` → duplicated logic (~200 lines)
- ❌ Two separate code paths, no guarantee of consistency

**After:**
- Core: `renderFrameAsChunks()` → RenderedChunk[]
- Regular rendering: wraps chunks → string
- Snapshot capture: uses chunks directly
- ✅ Single source of truth, ~150 lines eliminated

**Files refactored:**
- `src/veil/rendered-snapshot-types.ts` - new types
- `src/veil/types.ts` - added `Frame.renderedSnapshot`
- `src/hud/frame-tracking-hud.ts` - single rendering path
- `src/transforms/frame-snapshot-transform.ts` - capture transform
- `src/index.ts` - exports

### 7. Integrated Compression with Snapshots

**Updated CompressionTransform:**
```typescript
priority = 250;  // After snapshots (200)

private getRenderedFrames(state: ReadonlyVEILState): RenderedFrame[] {
  // Try snapshots first
  if (frameHistory.every(f => f.renderedSnapshot)) {
    console.log('Using frame snapshots');
    return frameHistory.map(f => ({
      frameSequence: f.sequence,
      content: f.renderedSnapshot!.totalContent,
      tokens: f.renderedSnapshot!.totalTokens,
      facetIds: getReferencedFacets(f.renderedSnapshot!.chunks)
    }));
  }
  
  // Fallback: re-render
  console.log('Snapshots not available, re-rendering');
  return this.hud.renderWithFrameTracking(...);
}
```

**Test results:**
```
[FrameSnapshotTransform] Captured snapshot for frame 3: 4 chunks, 50 tokens
[CompressionTransform] Using frame snapshots (3 frames)
✅ Compression can use snapshots directly - no re-rendering needed!
```

## Transform Priority Order (Final)

```
Phase 2 Execution Order:
  1. ContextTransform (100)        - Renders context for agents
  2. FrameSnapshotTransform (200)  - Captures frame snapshots
  3. CompressionTransform (250)    - Compresses using snapshots
  4. Other transforms (no priority) - Registration order
```

**Why this works:**
- ContextTransform doesn't need snapshots (uses current rendering)
- FrameSnapshotTransform captures before compression needs them
- CompressionTransform reads snapshots (no re-rendering)
- Async compression results appear in future frames

## Benefits Achieved

1. **Correct Architecture:** Snapshots capture original subjective experience
2. **Performance:** Compression doesn't re-render (uses cached snapshots)
3. **Single Path:** ~150 lines of duplication eliminated
4. **Guaranteed Correctness:** Snapshots match actual rendering (same code path)
5. **Facet Attribution:** Can trace rendered content back to source facets
6. **Open Ecosystem:** No imposed enums, extensible types
7. **Optional Everything:** Graceful degradation if snapshots unavailable

## Files Modified

### Core Implementation
- `src/veil/rendered-snapshot-types.ts` - NEW: Snapshot types
- `src/veil/types.ts` - Added `Frame.renderedSnapshot`
- `src/hud/frame-tracking-hud.ts` - Single rendering path refactor
- `src/transforms/frame-snapshot-transform.ts` - NEW: Snapshot capture
- `src/transforms/compression-transform.ts` - Use snapshots
- `src/index.ts` - Exports

### Documentation
- `CONSTRAINT_SOLVER_DESIGN.md` - Future evolution path
- `FRAME_SNAPSHOT_ARCHITECTURE.md` - Design options
- `RENDERED_SNAPSHOT_TYPES_REVIEW.md` - Type design review
- `SINGLE_RENDERING_PATH_REFACTOR.md` - Refactoring details
- `docs/transform-ordering.md` - Updated with constraint solver path

### Tests
- `examples/test-compression-with-snapshots.ts` - Compression integration test
- `examples/test-snapshots-direct.ts` - Direct snapshot test
- `examples/test-frame-snapshots.ts` - Type usage examples

## Commits

1. `2ab61a6` - Merge origin/refactor with RETM auto-discovery
2. `dd6b3f4` - Frame-attributed rendering (later superseded)
3. `cba7a38` - Document constraint solver evolution
4. `0a0d5d9` - Implement frame snapshot capture
5. `700311c` - Fix merge conflict
6. `d0eecc2` - Fix debug server static file handling
7. `ee5daeb` - Verify compression uses snapshots

## Key Insights

### Your Architectural Instincts Were Spot-On

1. **Priority is fragile** → Constraint solver is the right long-term solution
2. **Message-level attribution is wrong** → Frame-level is correct
3. **Extraction is backwards** → Capture at render time is correct
4. **Two rendering paths is broken** → Single path is the only way

### Poly-Temporality Is Real

The tension between objective frame time and subjective rendering time isn't just philosophy - it has real implementation implications. Snapshots solve this by capturing "how it looked at creation time."

### Open Ecosystem Design

Avoiding enums (`chunkType?: string`), making everything optional, and planning for constraint-based ordering shows you're thinking about this as infrastructure others will build on.

## What's Next

### Immediate
- ✅ Snapshots working
- ✅ Compression using snapshots
- ❌ Debug server API (separate issue to fix)

### Future
- Implement constraint solver (topological sort)
- Tentative freezing for compression invalidation
- Delta-only snapshot storage optimization
- Advanced chunk analysis tools

## Lines of Code Impact

- **Added:** ~600 lines (snapshot types + capture + tests)
- **Removed:** ~150 lines (duplicate rendering logic)
- **Net:** +450 lines for comprehensive snapshot system

## Testing Evidence

```bash
npx tsx examples/test-compression-with-snapshots.ts

# Output shows:
# ✅ Snapshots captured: 4 chunks per frame
# ✅ Compression using snapshots (no re-rendering!)
# ✅ Can extract frame ranges for compression
```

The implementation is solid. Compression now operates on captured snapshots, preserving the original subjective experience even if later transforms modify history.
