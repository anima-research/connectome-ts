# Clean Compression Interface Design

## Core Principle

The compression interface should work with VEIL primitives (Frames, Operations, Facets) and rendering primitives (RenderedFrames), not implementation-specific concepts like "narratives" or "summaries".

## What Belongs at High Level

### ✅ Core Data Types
- **VEILFrame** - Temporal units with operations
- **VEILOperation** - Actions that modify state
- **Facet** - The actual data (events, states, ambient)
- **RenderedFrame** - How a frame renders to text

### ❌ Implementation Details
- ~~Narrative~~ - Specific to narrative compression
- ~~Summary~~ - Specific to summarization engines
- ~~ContentBlock~~ - Unnecessary abstraction
- ~~MemoryBlock~~ - Too prescriptive

## Proposed Clean Interface

```typescript
// Core compression interface
interface CompressionEngine {
  // Analyze what can be compressed
  identifyCompressibleRanges(
    frames: VEILFrame[],
    rendered: RenderedFrame[]
  ): CompressibleRange[];
  
  // Compress a specific range
  compressRange(
    range: CompressibleRange,
    frames: VEILFrame[],
    rendered: RenderedFrame[]
  ): CompressionResult;
  
  // Apply compression when rendering
  shouldReplaceFrame(frameSeq: number): boolean;
  getReplacement(frameSeq: number): string | null;
}

// What can be compressed
interface CompressibleRange {
  fromFrame: number;
  toFrame: number;
  reason: string;  // "exceeds token limit", "low saliency", etc.
}

// Result of compression
interface CompressionResult {
  replacesFrames: { from: number; to: number };
  // Internal data specific to engine - opaque to HUD
  engineData: unknown;
}

// How frames render
interface RenderedFrame {
  frameSequence: number;
  content: string;
  tokens: number;
  facetIds: string[];  // Which facets were rendered
}
```

## How Different Engines Work

### Narrative Engine
```typescript
class NarrativeEngine implements CompressionEngine {
  private narratives = new Map<string, string>();
  
  compressRange(range, frames, rendered) {
    // Create narrative from rendered content
    const narrative = this.createNarrative(rendered);
    const id = `narr-${range.fromFrame}-${range.toFrame}`;
    this.narratives.set(id, narrative);
    
    return {
      replacesFrames: range,
      engineData: { narrativeId: id }  // Engine-specific
    };
  }
  
  getReplacement(frameSeq) {
    // Find narrative covering this frame
    for (const [id, narrative] of this.narratives) {
      if (this.coversFrame(id, frameSeq)) {
        return narrative;
      }
    }
    return null;
  }
}
```

### Embedding Engine
```typescript
class EmbeddingEngine implements CompressionEngine {
  private embeddings = new Map<number, Float32Array>();
  
  compressRange(range, frames, rendered) {
    // Create embeddings instead of text
    const embedding = this.embed(rendered);
    
    return {
      replacesFrames: range,
      engineData: { embedding }  // Engine-specific
    };
  }
  
  getReplacement(frameSeq) {
    // Reconstruct from embeddings
    const embedding = this.embeddings.get(frameSeq);
    return this.decode(embedding);
  }
}
```

## Benefits

1. **Clean Separation** - Interface doesn't assume implementation
2. **Flexibility** - Engines can use any internal representation
3. **Type Safety** - Work with VEIL types, not generic blocks
4. **Clear Responsibilities** - HUD renders, Engine compresses

## What This Eliminates

- No ContentBlock wrapping facets
- No prescribed "narrative" or "summary" types
- No generic MemoryBlock interface
- No metadata soup for frame tracking

The compression engine is free to implement any strategy while the HUD just needs to know which frames are replaced and what to show instead.
