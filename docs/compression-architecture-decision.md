# Compression Architecture Decision

## Summary

After analysis, we've determined that **frames are the correct unit of compression**, not individual facets or content IDs.

## Key Insights

1. **Addressing Fragility**: Facet-based compression breaks when facets are deleted or modified. Frame-based compression uses immutable frame sequence numbers.

2. **Rendered Context Variability**: The rendered context changes between turns. We can't reliably reference "what was rendered" without stable frame references.

3. **Frames as the Bridge**: Frames tie together both VEIL operations and their rendered representation, providing the stable reference we need.

## Final Architecture

### Core Principle
Compression works on frame ranges (e.g., "compress frames 10-50"), not individual facets.

### Data Flow
```
Frames → Operations → Effects (Facets) → Rendering
   ↓                                          ↓
   └──────── Compression Unit ────────────────┘
```

### Key Interfaces
```typescript
interface CompressionEngine {
  compress(input: {
    frames: VEILFrame[];                  // Operations to compress
    frameRenderSegments: RenderSegment[]; // How they rendered
    currentState: Map<string, Facet>;     // Current VEIL state
  }): CompressionResult;
}

interface CompressionResult {
  compressedRanges: Array<{
    fromFrame: number;
    toFrame: number;
    narrative: string;
  }>;
}
```

### Why This Works

1. **Stable References**: Frame numbers never change
2. **Clear Boundaries**: Frames are atomic units of change
3. **Handles Deletion**: Even if facets are deleted, we know which frames were compressed
4. **Preserves Both Levels**: Access to both VEIL operations and rendered form

## Implementation Impact

1. **FrameAwareXmlHUD was correct**: It maintains frame boundaries through rendering
2. **Memory System tracks frame ranges**: Not individual facets
3. **Compression creates frame-range replacements**: Not facet replacements

## Conclusion

By using frames as the unit of compression, we achieve the stability and consistency needed for reliable memory management while maintaining access to both VEIL metadata and rendered context for sophisticated compression strategies.
