# Compression Architecture Proposal

**Note: This document has been superseded by the frame-based compression architecture. See [compression-architecture-decision.md](compression-architecture-decision.md) for the final design.**

## The Core Question
Should compression work on VEIL level or RenderedContext level?

**Answer: Both!** We need a hybrid architecture that provides access to both levels.

## Key Requirements

1. **Pluggable compression strategies** - Different algorithms can coexist
2. **Access to VEIL metadata** - For saliency hints, facet types, relationships
3. **Access to rendered context** - For attention-preserving compression

## Proposed Architecture

### Data Flow

```
VEIL Facets → HUD → Rendered Segments → Compression → Narrative Blocks
     ↓                      ↓                ↓              ↓
  metadata              facet IDs      both inputs      instructions
                                                        for HUD
```

### Core Interfaces

```typescript
interface RenderedSegment {
  content: string;        // The rendered text
  facetIds: string[];     // Which facets created this
  metadata: {
    tokens: number;
    position: number;    // Temporal position
  };
}

interface CompressionEngine {
  compress(input: {
    facets: Map<string, Facet>;      // VEIL level data
    segments: RenderedSegment[];      // Rendered data
  }): CompressionResult;
}

interface CompressionResult {
  narratives: NarrativeBlock[];
  replacements: Map<string, string>;  // facetId → narrativeId
}
```

### How It Works

1. **HUD renders facets to segments**
   - Tracks which facets contribute to each segment
   - Preserves metadata about rendering

2. **Compression engine receives both**
   - Can analyze facet metadata (saliency, types)
   - Can see rendered format (for attention matching)
   - Makes decisions based on strategy

3. **Compression returns instructions**
   - Which facets are replaced
   - What narrative blocks to insert
   - Where to position them

4. **HUD applies compression**
   - Skips replaced facets
   - Inserts narrative blocks
   - Maintains temporal order

## Benefits

### Supports Multiple Strategies

**Simple Token-Based:**
```typescript
compress({ segments }) {
  // Only uses segments, ignores facets
  if (totalTokens > limit) {
    return compressOldest(segments);
  }
}
```

**Saliency-Aware:**
```typescript
compress({ facets, segments }) {
  // Uses facet metadata for decisions
  const lowSaliency = findLowSaliencyFacets(facets);
  return compressIfMany(lowSaliency);
}
```

**Attention-Preserving:**
```typescript
compress({ facets, segments }) {
  // Uses both for sophisticated compression
  const style = analyzeRenderingStyle(segments);
  const important = findImportantFacets(facets);
  return createMatchingNarrative(style, important);
}
```

### Clean Separation of Concerns

- **VEIL State**: Manages facets and operations
- **HUD**: Renders facets and applies compression
- **Compression**: Analyzes and creates narratives
- **Strategies**: Pluggable algorithms

## Implementation Notes

### Frame Sequence Tracking?

With this architecture, frame tracking becomes optional:
- Simple strategies can ignore it
- Temporal strategies can use segment positions
- Frame-aware strategies can track via metadata

The key is that we track **facet identity** through the pipeline, not necessarily frame sequences.

### Memory vs Compression

This architecture works whether we call it "Compression Engine" or "Memory System":
- Same interfaces
- Same data flow
- Just different internal implementations

## Conclusion

The hybrid approach satisfies all requirements:
- ✅ Pluggable strategies
- ✅ Access to VEIL metadata
- ✅ Access to rendered context
- ✅ Clean separation of concerns
- ✅ Flexible implementation options
