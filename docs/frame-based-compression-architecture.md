# Frame-Based Compression Architecture

**This is the current compression architecture based on the requirements in [connectome-ts-reqs.md](connectome-ts-reqs.md).**

## The Core Insight

Frames are the stable unit that bridges VEIL operations and rendered output. By compressing at frame boundaries, we solve the addressing fragility problem.

## Why Frames?

### The Fragility Problem

If we compress individual facets:
- Facets can be deleted/modified after compression
- Rendered context changes between turns
- No stable reference for what was compressed

### Frames Provide Stability

- Frame numbers are immutable
- Frames contain operations (the changes)
- Operations have lasting effects (facets)
- Compressing frames = summarizing operations and their effects

## Architecture

### Data Structures

```typescript
interface VEILFrame {
  sequence: number;
  timestamp: string;
  operations: Operation[];
}

interface FrameRenderSegment {
  frameSequence: number;
  content: string;
  operations: Operation[];
  resultingFacets: string[]; // IDs of facets created/modified
}

interface CompressionEngine {
  compress(input: {
    frames: VEILFrame[];                    // Frame operations
    frameSegments: FrameRenderSegment[];    // How frames rendered
    currentFacets: Map<string, Facet>;      // Current VEIL state
  }): CompressionResult;
}

interface CompressionResult {
  compressedRanges: Array<{
    fromFrame: number;
    toFrame: number;
    narrative: string;
    replacesOperations: Operation[];
  }>;
}
```

### How It Works

1. **Frame-Aware Rendering**
   - HUD tracks which frame's operations created which rendered content
   - Maintains frame boundaries in rendered segments

2. **Frame-Based Compression**
   - Compress ranges of frames (e.g., frames 10-50)
   - Narrative summarizes the operations and their effects
   - Stable reference: frame numbers

3. **Applying Compression**
   - When rendering, check if content comes from compressed frames
   - If yes, show narrative instead of original operations' effects
   - Uncompressed frames render normally

### Example Flow

```
Frame 1: addFacet(event-1) → "Sensor activated"
Frame 2: addFacet(event-2) → "Anomaly detected"  
Frame 3: addFacet(ambient-1) → "Mission: Explore"
Frame 4: speak("Investigating")

Compress frames 1-2:
  narrative: "[Sensors detected anomaly]"
  replacesFrames: [1, 2]

Future renders show:
  [Sensors detected anomaly]     ← Compressed frames 1-2
  Mission: Explore               ← Frame 3 (not compressed)
  <my_turn>Investigating</my_turn> ← Frame 4 (not compressed)
```

## Benefits

1. **Stable Addressing**: Frame numbers never change
2. **Consistency**: Clear what was compressed (specific operations)
3. **Flexibility**: Can compress any frame range
4. **Correctness**: Handles facet deletion/modification properly

## Implementation Requirements

### HUD Must:
- Track frame sequence through rendering
- Group rendered content by source frame
- Apply compression by frame ranges

### Compression Engine Must:
- Work with frame-based inputs
- Produce frame-range replacements
- Access both operations and rendered form

### Memory System Must:
- Track which frame ranges are compressed
- Store narratives with frame references
- Enable querying by frame range

## Conclusion

Frame-based compression solves the addressing fragility by using immutable frame sequences as the unit of compression. This maintains consistency between VEIL operations and their rendered representation, regardless of how the state changes over time.
