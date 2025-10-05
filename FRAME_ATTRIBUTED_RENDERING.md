# Frame-Attributed Rendering for Compression

## Problem Statement

Compression needs to extract specific frame ranges from rendered context, but current implementation loses frame attribution when building messages. This makes it impossible to reliably extract "frames 100-150" from rendered context.

## Solution Architecture

### 1. Add Frame Attribution to RenderedContext

```typescript
// types-v2.ts
export interface RenderedContext {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
    // NEW: Track which frames contributed to this message
    sourceFrames?: {
      from: number;
      to: number;
    };
  }>;
  
  metadata: {
    totalTokens: number;
    renderedFrames: RenderedFrame[];
    droppedFrames?: number[];
    // NEW: Quick lookup for frame range extraction
    frameToMessageIndex?: Map<number, number>;
  };
}
```

### 2. Update Frame Type to Store Rendered Snapshot

```typescript
// veil/types.ts
export interface Frame {
  sequence: number;
  events: SpaceEvent[];
  deltas: VEILDelta[];
  timestamp?: number;
  
  // NEW: Snapshot of rendered state at frame creation
  renderedSnapshot?: {
    // Content added by THIS frame only (not cumulative)
    deltaContent: string;
    deltaTokens: number;
    
    // Full cumulative context up to this frame (optional, expensive)
    cumulativeContext?: string;
    cumulativeTokens?: number;
    
    // Role of this frame's message
    role: 'user' | 'assistant' | 'system';
    
    // Track which facets were rendered
    renderedFacetIds: string[];
  };
}
```

### 3. Update HUD to Track Frame Attribution

```typescript
// frame-tracking-hud.ts
private buildFrameBasedMessages(
  frameContents: Array<{ 
    type: 'user' | 'agent' | 'system' | 'compressed'; 
    content: string; 
    sequence: number 
  }>,
  currentFacets: Map<string, Facet>,
  config: HUDConfig
): {
  messages: RenderedContext['messages'];
  frameToMessageIndex: Map<number, number>;
} {
  const messages: RenderedContext['messages'] = [];
  const frameToMessageIndex = new Map<number, number>();
  
  // Each frame becomes its own message
  for (const frame of frameContents) {
    let role: 'user' | 'assistant' | 'system';
    switch (frame.type) {
      case 'user': role = 'user'; break;
      case 'agent': role = 'assistant'; break;
      case 'system': role = 'system'; break;
      default: role = 'assistant'; break;
    }

    const messageIndex = messages.length;
    frameToMessageIndex.set(frame.sequence, messageIndex);
    
    messages.push({
      role,
      content: frame.content,
      sourceFrames: {
        from: frame.sequence,
        to: frame.sequence
      }
    });
  }
  
  // ... handle ambient/system messages ...
  
  return { messages, frameToMessageIndex };
}
```

### 4. Add Frame Range Extraction Utility

```typescript
// hud/frame-extraction.ts
export interface ExtractedFrameRange {
  content: string;
  tokens: number;
  messages: RenderedContext['messages'];
  sourceFrames: { from: number; to: number };
}

/**
 * Extract a specific frame range from rendered context
 */
export function extractFrameRange(
  context: RenderedContext,
  fromFrame: number,
  toFrame: number
): ExtractedFrameRange {
  const messages: RenderedContext['messages'] = [];
  let content = '';
  let tokens = 0;
  
  for (const message of context.messages) {
    if (!message.sourceFrames) {
      // System messages without frames - include if they're before our range
      continue;
    }
    
    const { from, to } = message.sourceFrames;
    
    // Include messages that overlap with our range
    if (from <= toFrame && to >= fromFrame) {
      messages.push(message);
      content += message.content + '\n\n';
      tokens += estimateTokens(message.content);
    }
  }
  
  return {
    content: content.trim(),
    tokens,
    messages,
    sourceFrames: { from: fromFrame, to: toFrame }
  };
}

/**
 * Extract using stored frame snapshot (preferred)
 */
export function extractFromSnapshot(
  frames: Frame[],
  fromFrame: number,
  toFrame: number
): ExtractedFrameRange {
  let content = '';
  let tokens = 0;
  const messages: RenderedContext['messages'] = [];
  
  for (const frame of frames) {
    if (frame.sequence >= fromFrame && frame.sequence <= toFrame) {
      if (frame.renderedSnapshot) {
        content += frame.renderedSnapshot.deltaContent + '\n\n';
        tokens += frame.renderedSnapshot.deltaTokens;
        
        messages.push({
          role: frame.renderedSnapshot.role,
          content: frame.renderedSnapshot.deltaContent,
          sourceFrames: {
            from: frame.sequence,
            to: frame.sequence
          }
        });
      }
    }
  }
  
  return {
    content: content.trim(),
    tokens,
    messages,
    sourceFrames: { from: fromFrame, to: toFrame }
  };
}
```

### 5. Update CompressionTransform to Use Extraction

```typescript
// compression-transform.ts
process(state: ReadonlyVEILState): VEILDelta[] {
  const deltas: VEILDelta[] = [];
  
  // Get compression ranges
  const ranges = this.engine.identifyCompressibleRanges(...);
  
  for (const range of ranges) {
    // Try snapshot-based extraction first (when available)
    let extracted: ExtractedFrameRange;
    
    if (this.hasRenderedSnapshots(state.frameHistory, range)) {
      extracted = extractFromSnapshot(
        state.frameHistory,
        range.fromFrame,
        range.toFrame
      );
    } else {
      // Fallback: render current state and extract range
      const currentContext = this.hud.render(
        state.frameHistory,
        new Map(state.facets)
      );
      
      extracted = extractFrameRange(
        currentContext,
        range.fromFrame,
        range.toFrame
      );
    }
    
    // Start async compression with extracted content
    this.compressAsync(range, extracted);
  }
  
  // Emit result facets for completed compressions
  return deltas;
}
```

### 6. Store Snapshots During Frame Creation

```typescript
// space.ts - in finalize()
private finalizeFrame(
  frame: Frame,
  veilState: VEILStateManager
): void {
  // Render this frame to capture its snapshot
  const frameHistory = [...veilState.getState().frameHistory, frame];
  const currentFacets = veilState.getState().facets;
  
  // Render just this frame in isolation to get its delta content
  const { content, role, tokens, facetIds } = this.renderSingleFrame(
    frame,
    currentFacets
  );
  
  // Store snapshot
  frame.renderedSnapshot = {
    deltaContent: content,
    deltaTokens: tokens,
    role,
    renderedFacetIds: facetIds
  };
  
  // Optionally: Store cumulative context (expensive!)
  // Only do this periodically or on-demand
  if (this.shouldStoreCumulativeSnapshot(frame.sequence)) {
    const fullContext = this.hud.render(frameHistory, currentFacets);
    frame.renderedSnapshot.cumulativeContext = 
      fullContext.messages.map(m => m.content).join('\n\n');
    frame.renderedSnapshot.cumulativeTokens = 
      fullContext.metadata.totalTokens;
  }
}
```

## Implementation Plan

### Phase 1: Frame Attribution (Immediate)
1. ✅ Update RenderedContext type to include sourceFrames
2. ✅ Update buildFrameBasedMessages to track frame attribution  
3. ✅ Add extractFrameRange utility
4. ✅ Update CompressionTransform to use extraction

This fixes the immediate issue without requiring frame snapshots.

### Phase 2: Snapshot Storage (Next)
1. Add renderedSnapshot to Frame type
2. Capture snapshots during frame finalization
3. Update extractFromSnapshot to use stored snapshots
4. Add snapshot-based compression path

### Phase 3: Optimization (Future)
1. Delta-only storage (not full cumulative)
2. Compression-aware snapshot strategy
3. Tentative freezing for invalidation detection
4. On-demand cumulative reconstruction

## Benefits

1. **Correct Frame Range Extraction**: Can reliably extract "frames 100-150"
2. **Snapshot Preservation**: Captures original subjective experience
3. **Compression Independence**: Compression results are stable even if later transforms modify history
4. **No Priority Dependency**: Transforms can run in any order
5. **Backwards Compatible**: Falls back to current rendering if snapshots unavailable

## Storage Concerns

**Delta Storage (Efficient):**
- Each frame stores ~1-2KB delta content
- 10,000 frames = ~10-20MB
- Acceptable for in-memory

**Cumulative Storage (Expensive):**
- Each frame stores full context up to that point
- Quadratic growth: 10,000 frames = ~5GB
- Only store periodically or on-demand

**Recommendation:** Store delta content always, cumulative context only at checkpoints (every 100 frames?) or when explicitly needed for compression.
