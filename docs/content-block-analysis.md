# ContentBlock Analysis

## The Problem

`ContentBlock` is a questionable abstraction that sits between VEIL facets and rendered output. It's causing issues:

1. **Duplicates Facet Data**
   ```typescript
   interface ContentBlock {
     id: string;
     content: string;
     source?: Facet;  // Just wrapping a facet!
     metadata?: Record<string, any>;  // Where frameSequence lives
   }
   ```

2. **Not in Requirements**
   - Requirements mention: VEIL frames, facets, rendered context, narrative blocks
   - No mention of ContentBlock as an intermediate representation

3. **Creates Metadata Flow Problems**
   - Frame sequence needs to flow: Frame → ??? → ContentBlock → HUD
   - Current workarounds manually inject frameSequence into metadata
   - Awkward data pipeline

## What We Actually Need

Based on frame-based compression architecture:

### Option 1: Direct Frame-Facet-Render Pipeline
```typescript
interface FrameRenderData {
  frame: VEILFrame;
  facets: Facet[];  // Facets created/modified by this frame
  rendered: string;  // How this frame renders
}

// HUD works directly with frames and facets
class FrameAwareHUD {
  render(frames: VEILFrame[], currentFacets: Map<string, Facet>): RenderResult {
    // Group facets by their creation frame
    // Render maintaining frame boundaries
  }
}
```

### Option 2: Replace ContentBlock with FrameOperation
```typescript
interface FrameOperation {
  frameSequence: number;
  operation: VEILOperation;
  resultingFacets: Facet[];  // What this operation created/modified
}

// More explicit about frame-operation-facet relationship
```

### Option 3: Keep ContentBlock but Make it Frame-Aware
```typescript
interface FrameContentBlock {
  frameSequence: number;  // Required, not in metadata!
  operation: VEILOperation;
  facet?: Facet;  // If operation created/modified a facet
  narrative?: string;  // If this is a compressed narrative
}
```

## Current Usage Analysis

### Where ContentBlock is Used:
1. **CompressionEngine** returns `ContentBlock[]`
2. **HUD** renders `ContentBlock[]`  
3. **Memory Systems** create `ContentBlock[]` from facets

### The Real Flow Should Be:
1. **VEIL State** has frames and facets
2. **Memory System** tracks frame-to-facet mappings
3. **HUD** gets frames + facets + mappings
4. **Compression** works on frame ranges
5. **HUD** applies compression when rendering

## Recommendation

ContentBlock is trying to be too many things:
- A wrapper for facets
- A container for narratives  
- A carrier of frame metadata

We should either:
1. **Remove it** - Work directly with frames and facets
2. **Replace it** - With a proper frame-aware structure
3. **Fix it** - Make frameSequence explicit, not metadata

The current design creates an unnecessary abstraction layer that obscures the frame-facet relationship we need for compression.
