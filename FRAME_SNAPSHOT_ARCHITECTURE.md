# Frame Snapshot Architecture - Correct Approach

## Core Insight

Don't extract frames from context - **capture snapshots at render time**.

## The Problem with Extraction

```typescript
// WRONG: Render everything, then extract
const fullContext = hud.render(allFrames);
const extracted = extractFrameRange(fullContext, 100, 150);
```

This is backwards. We're rendering all frames, building messages, then trying to reverse-engineer which frames contributed what.

## The Right Architecture

```typescript
// RIGHT: Capture as you render
for (const frame of frames) {
  const snapshot = renderFrame(frame, currentState);
  frame.renderedSnapshot = snapshot; // Store it!
}

// Later: direct access
const framesToCompress = frames.filter(f => f.sequence >= 100 && f.sequence <= 150);
const content = framesToCompress.map(f => f.renderedSnapshot.content).join('\n\n');
```

## Implementation Options

### Option 1: Capture at Frame Finalization (In Space)

**Where:** `Space.processFrame()` before calling `veilState.finalizeFrame()`

**Pros:**
- Canonical snapshot at creation time
- Guaranteed to capture original subjective experience
- Single source of truth

**Cons:**
- Space needs a renderer (or injectable render function)
- Every frame gets rendered (even if never compressed)
- Performance overhead

```typescript
// In Space.processFrame()
// After all phases complete
const snapshot = this.captureFrameSnapshot(frame);
frame.renderedSnapshot = snapshot;

// Then finalize
this.veilState.finalizeFrame(frame);
```

### Option 2: Lazy Capture (On First Render)

**Where:** First time any component renders frame history

**Pros:**
- No overhead for frames that are never rendered
- Can use any HUD implementation
- Flexible

**Cons:**
- Snapshots captured at different times (not creation time)
- Multiple renders might create multiple snapshots (need deduplication)
- Later transforms might have modified history

```typescript
// In FrameTrackingHUD.renderWithFrameTracking()
for (const frame of frames) {
  if (!frame.renderedSnapshot) {
    frame.renderedSnapshot = {
      content: renderThisFrame(frame),
      tokens: estimateTokens(content),
      // ...
    };
  }
  // Use the snapshot
}
```

### Option 3: Explicit Capture Transform (Phase 2)

**Where:** A dedicated `FrameSnapshotTransform` in Phase 2

**Pros:**
- Clean separation of concerns
- Runs after other transforms stabilize state
- Part of normal frame processing
- Can be configured (capture every N frames, etc.)

**Cons:**
- Snapshot happens after Phase 2, not at "creation"
- Still within same frame, so reasonably close to creation time

```typescript
export class FrameSnapshotTransform extends BaseTransform {
  priority = 200; // Run late, after state stabilizes
  
  constructor(private hud: FrameTrackingHUD) {
    super();
  }
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    const currentFrame = state.frameHistory[state.frameHistory.length - 1];
    
    if (!currentFrame.renderedSnapshot) {
      // Render just this frame
      const snapshot = this.hud.renderSingleFrame(
        currentFrame,
        new Map(state.facets)
      );
      
      currentFrame.renderedSnapshot = snapshot;
    }
    
    return []; // No deltas, just side effect on frame
  }
}
```

## Recommendation: Option 3 (Transform-Based)

**Why:**
- Fits naturally into MARTEM architecture
- Runs after Phase 2 stabilizes (late priority)
- Optional/configurable (can be disabled)
- No special Space logic needed
- Can be extended (e.g., only snapshot every N frames)

**Implementation:**

```typescript
// Frame type (already exists conceptually)
interface Frame {
  sequence: number;
  deltas: VEILDelta[];
  events: SpaceEvent[];
  renderedSnapshot?: {
    content: string;
    tokens: number;
    role: 'user' | 'assistant' | 'system';
    facetIds: string[];
  };
}

// New transform
class FrameSnapshotTransform extends BaseTransform {
  priority = 200; // Late execution
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    const latestFrame = state.frameHistory[state.frameHistory.length - 1];
    
    // Only capture if not already captured
    if (latestFrame && !latestFrame.renderedSnapshot) {
      this.captureSnapshot(latestFrame, state);
    }
    
    return [];
  }
  
  private captureSnapshot(frame: Frame, state: ReadonlyVEILState): void {
    // Render this specific frame
    const content = this.renderFrame(frame, state.facets);
    const tokens = estimateTokens(content);
    const role = this.determineRole(frame);
    
    frame.renderedSnapshot = {
      content,
      tokens,
      role,
      facetIds: this.getRenderedFacetIds(frame)
    };
  }
}

// Compression becomes trivial
class CompressionTransform extends BaseTransform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const ranges = this.engine.identifyRanges(...);
    
    for (const range of ranges) {
      // Direct access, no extraction needed!
      const framesToCompress = state.frameHistory.filter(f =>
        f.sequence >= range.from && f.sequence <= range.to
      );
      
      const content = framesToCompress
        .map(f => f.renderedSnapshot?.content || '')
        .join('\n\n');
      
      this.startCompression(range, content);
    }
    
    return [];
  }
}
```

## Benefits

1. **No Extraction Logic**: Direct frame access
2. **Captured Once**: Snapshot happens once per frame
3. **Timing Control**: Priority 200 means after state stabilizes
4. **Architectural Fit**: Just another transform
5. **Optional**: Can be disabled if not needed
6. **Memory Efficient**: Only stores delta content per frame

## Next Steps

1. Add `renderedSnapshot` to Frame type
2. Implement `FrameSnapshotTransform`
3. Add helper method `renderSingleFrame()` to HUD
4. Update CompressionTransform to use snapshots
5. Remove extraction utilities (no longer needed)
