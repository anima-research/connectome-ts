# Interface Design Comparison

## Current Design (Problematic)

```typescript
// Mixes abstraction levels
interface ContentBlock {
  type: 'facet' | 'summary' | 'narrative';  // Implementation details!
  content: string;
  source?: Facet;
  metadata?: Record<string, any>;  // Where important data hides
}

// Forces specific memory concepts
interface MemoryBlock {
  type: 'raw' | 'compressed' | 'narrative';  // Too prescriptive
  content: string;
}

// HUD receives jumbled blocks
hud.render(blocks: ContentBlock[])  // Lost frame structure!
```

### Problems:
- Prescribes implementation concepts (narrative, summary)
- Loses frame structure in generic blocks
- Mixes facets with compressed content awkwardly
- Important data (frameSequence) hidden in metadata

## Clean Design (Proposed)

```typescript
// Works with VEIL primitives
interface RenderedFrame {
  frameSequence: number;  // Explicit!
  content: string;
  tokens: number;
  facetIds: string[];
}

// Compression interface is abstract
interface CompressionEngine {
  compressRange(
    range: CompressibleRange,
    frames: VEILFrame[],
    rendered: RenderedFrame[]
  ): CompressionResult;
  
  getReplacement(frameSeq: number): string | null;
}

// HUD works with frames
hud.render(
  frames: VEILFrame[],
  rendered: RenderedFrame[],
  compression: CompressionEngine
)
```

### Benefits:
- No prescribed types (narrative, summary)
- Frame structure preserved throughout
- Clean separation of concerns
- Compression engine internals are opaque

## Example Implementations

### Narrative Engine (Internal Detail)
```typescript
class NarrativeEngine implements CompressionEngine {
  // Internal - not exposed in interface!
  private narratives = new Map<string, string>();
  
  getReplacement(frameSeq: number): string | null {
    // Returns narrative text or null
    return this.findNarrativeFor(frameSeq);
  }
}
```

### Vector Engine (Internal Detail)
```typescript
class VectorEngine implements CompressionEngine {
  // Internal - not exposed in interface!
  private embeddings = new Map<number, Float32Array>();
  
  getReplacement(frameSeq: number): string | null {
    // Reconstructs from vectors
    return this.decodeEmbedding(frameSeq);
  }
}
```

## The Key Insight

The HUD shouldn't know or care whether the compression engine uses:
- Narratives
- Summaries
- Embeddings
- Neural compressions
- Huffman coding
- Or anything else!

It just needs to know:
1. Which frames are replaced
2. What text to show instead

Everything else is an implementation detail of the specific compression engine.
