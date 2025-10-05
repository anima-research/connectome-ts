# Frame Snapshot Implementation - Complete

## What Was Implemented

Frame snapshots are now captured at frame creation time to preserve the original subjective experience for compression.

## Changes Made

### 1. Frame Type Updated (`src/veil/types.ts`)

```typescript
export interface Frame {
  sequence: number;
  timestamp: string;
  uuid?: string;
  activeStream?: StreamRef;
  events: SpaceEvent[];
  deltas: VEILDelta[];
  transition: FrameTransition;
  
  // NEW: Snapshot of rendered content
  renderedSnapshot?: {
    content: string;           // Rendered text for this frame
    tokens: number;            // Estimated token count
    role: 'user' | 'assistant' | 'system';
    facetIds: string[];        // Which facets were rendered
  };
}
```

### 2. FrameSnapshotTransform Created (`src/transforms/frame-snapshot-transform.ts`)

New transform that captures frame snapshots:

```typescript
export class FrameSnapshotTransform extends BaseTransform {
  priority = 200;  // Runs late in Phase 2, after state stabilizes
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    const latestFrame = state.frameHistory[state.frameHistory.length - 1];
    
    if (!latestFrame?.renderedSnapshot) {
      this.captureSnapshot(latestFrame, state.facets);
    }
    
    return [];
  }
}
```

**Features:**
- Captures how each frame renders at creation time
- Determines role (user/assistant/system) from frame events
- Renders content-bearing facets (speech, thought, action, event)
- Handles tool calls with special formatting
- Stores facet IDs for traceability

### 3. CompressionTransform Updated (`src/transforms/compression-transform.ts`)

Now uses snapshots instead of re-rendering:

```typescript
private getRenderedFrames(state: ReadonlyVEILState): RenderedFrame[] {
  const hasSnapshots = state.frameHistory.every(f => f.renderedSnapshot);
  
  if (hasSnapshots) {
    // Use pre-captured snapshots (preserves original experience)
    return state.frameHistory.map(frame => ({
      frameSequence: frame.sequence,
      content: frame.renderedSnapshot!.content,
      tokens: frame.renderedSnapshot!.tokens,
      facetIds: frame.renderedSnapshot!.facetIds
    }));
  }
  
  // Fallback: re-render for backwards compatibility
  return this.hud.renderWithFrameTracking(...);
}
```

### 4. Exports Updated (`src/index.ts`)

`FrameSnapshotTransform` is now exported and available for use.

## Usage

### Basic Setup

```typescript
import { 
  Space, 
  VEILStateManager,
  FrameSnapshotTransform,
  CompressionTransform 
} from 'connectome-ts';

const veilState = new VEILStateManager();
const space = new Space(veilState);

// Add snapshot transform (runs late to capture stable state)
space.addTransform(new FrameSnapshotTransform());

// Add compression transform (will use snapshots automatically)
const compressionTransform = new CompressionTransform({
  engine: compressionEngine
});
space.addTransform(compressionTransform);
```

### How It Works

1. **Frame Created**: Space processes events and creates a frame with deltas
2. **Phase 2 Runs**: Other transforms modify state
3. **Snapshot Captured**: FrameSnapshotTransform (priority 200) captures the frame's rendered content
4. **Frame Finalized**: Frame is pushed to history with snapshot attached
5. **Compression Uses Snapshots**: CompressionTransform reads pre-captured snapshots instead of re-rendering

### Example Flow

```typescript
// Frame N created
Frame {
  sequence: 42,
  deltas: [
    { type: 'addFacet', facet: { type: 'event', content: 'User says hello' } }
  ]
}

// After FrameSnapshotTransform processes it
Frame {
  sequence: 42,
  deltas: [...],
  renderedSnapshot: {
    content: 'User says hello',
    tokens: 4,
    role: 'user',
    facetIds: ['event-123']
  }
}

// Later, compression extracts frames 40-50
const framesToCompress = frames.filter(f => f.sequence >= 40 && f.sequence <= 50);
const content = framesToCompress
  .map(f => f.renderedSnapshot.content)
  .join('\n\n');
// No re-rendering needed!
```

## Benefits

### 1. Preserves Original Subjective Experience
Snapshots capture how frames rendered at creation time, not how they render now after later transforms modified state.

### 2. Performance
No need to re-render entire frame history every time compression runs.

### 3. Correct Compression Input
Compression operates on the actual text that was experienced, not a reconstructed version.

### 4. Poly-Temporality Solved
Each frame remembers its own rendering, independent of future modifications.

### 5. Backwards Compatible
Falls back to re-rendering if snapshots are missing (e.g., old frame history without snapshots).

## Configuration Options

### Capture Frequency

You can control how often snapshots are captured:

```typescript
class SelectiveSnapshotTransform extends BaseTransform {
  priority = 200;
  private captureInterval = 10;  // Only capture every 10th frame
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    const latestFrame = state.frameHistory[state.frameHistory.length - 1];
    
    // Only capture if sequence is multiple of interval
    if (latestFrame.sequence % this.captureInterval === 0) {
      this.captureSnapshot(latestFrame, state.facets);
    }
    
    return [];
  }
}
```

### Conditional Capture

Only capture frames that will be compressed:

```typescript
class ConditionalSnapshotTransform extends BaseTransform {
  priority = 200;
  private minAgeForCapture = 100;  // Only capture frames older than 100
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    const currentSequence = state.currentSequence;
    
    // Capture snapshots for frames that are aging out
    for (const frame of state.frameHistory) {
      if (!frame.renderedSnapshot && 
          currentSequence - frame.sequence > this.minAgeForCapture) {
        this.captureSnapshot(frame, state.facets);
      }
    }
    
    return [];
  }
}
```

## Memory Considerations

**Delta Content (Efficient):**
- Each frame stores ~1-2KB of snapshot content
- 10,000 frames ≈ 10-20MB
- Acceptable for in-memory operation

**Trade-offs:**
- Storage: Snapshots use memory
- Speed: No re-rendering needed
- Correctness: Captures original experience

**Recommendation:** Always capture snapshots for frames. The memory cost is minimal compared to the benefits of correct compression and no re-rendering overhead.

## Testing

```typescript
it('captures frame snapshots', () => {
  const space = new Space(veilState);
  space.addTransform(new FrameSnapshotTransform());
  
  // Process a frame
  space.emit({ 
    topic: 'test', 
    payload: { /* ... */ } 
  });
  
  await space.requestFrame();
  
  // Check snapshot was captured
  const frames = veilState.getState().frameHistory;
  const latestFrame = frames[frames.length - 1];
  
  expect(latestFrame.renderedSnapshot).toBeDefined();
  expect(latestFrame.renderedSnapshot.content).toBeTruthy();
  expect(latestFrame.renderedSnapshot.tokens).toBeGreaterThan(0);
});

it('compression uses snapshots', () => {
  // Setup with snapshots
  const compressionTransform = new CompressionTransform({ engine });
  
  // Verify it uses snapshots instead of re-rendering
  const renderedFrames = compressionTransform['getRenderedFrames'](state);
  
  // Should return snapshot data, not re-rendered data
  expect(renderedFrames[0].content).toBe(
    state.frameHistory[0].renderedSnapshot.content
  );
});
```

## Related Changes

This implementation completes the frame attribution work started earlier:
- Frame snapshots store the ground truth
- No need for message-level extraction
- Compression directly accesses frame snapshots
- Poly-temporality issue resolved
