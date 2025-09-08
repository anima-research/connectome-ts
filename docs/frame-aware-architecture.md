# Frame-Aware Architecture

## Core Concept: Frames vs Facets

A critical distinction in the VEIL architecture:

1. **Facets** are data objects that exist independently of time
2. **Frames** are temporal containers that record operations on facets
3. A facet is created in one frame but can be rendered in many subsequent frames

## Data Flow

```
Frame 1: addFacet(mission-objective)
Frame 2: addFacet(sensor-reading-1)
Frame 3: changeState(sensor-reading-1, {status: "analyzed"})
Frame 4: addFacet(sensor-reading-2)
...
Frame N: [mission-objective still being rendered]
```

## Frame Tracking

### Where Frame Sequences Live

1. **VEILFrame**: Has `sequence` and `timestamp`
2. **VEILOperation**: Part of a frame, inherits frame's sequence
3. **ContentBlock**: Has `metadata.frameSequence` indicating which frame's operations created this block
4. **Facet**: Does NOT have frameSequence (facets are timeless once created)

### Memory System Responsibilities

The memory system converts frame operations into renderable blocks:

```typescript
// Frame operation
{ type: 'addFacet', facet: { id: 'x', content: 'Hello' } }

// Becomes memory block
{
  id: 'block-123',
  type: 'facet',
  content: 'Hello',
  metadata: {
    frameSequence: 42,  // Which frame this operation occurred in
    operationType: 'addFacet',
    facetId: 'x'
  }
}
```

### HUD Responsibilities

The HUD groups blocks by their frame sequence to create segments:

```typescript
// Blocks from frame 42
[
  { content: 'Mission started', metadata: { frameSequence: 42 } },
  { content: 'Sensors online', metadata: { frameSequence: 42 } }
]

// Become one segment
{
  content: 'Mission started\nSensors online',
  sourceFrames: [42],
  blockIds: ['block-1', 'block-2']
}
```

## Memory Compression Flow

1. **Identify Compressible Range**: Find segments spanning frames 10-50 that exceed token threshold
2. **Prepare Compression Request**: Include the rendered segments and their frame range
3. **Agent Compresses**: Agent summarizes with awareness of frame boundaries
4. **Replace Frames**: Replace blocks from frames 10-50 with compressed memory block

## Key Principles

1. **Temporal Integrity**: Never lose track of when operations occurred
2. **Causal Preservation**: Compressed memories maintain causal relationships
3. **Frame Atomicity**: All operations in a frame are treated as simultaneous
4. **Rendering Flexibility**: Same facet can appear in many rendered contexts

## Example: Compression with Frame Awareness

```typescript
// Original blocks (frames 10-15)
Frame 10: "Captain: Begin sensor sweep"
Frame 11: "Sensor: Anomaly detected at sector 7"
Frame 12: "Science: Analyzing anomaly signature"
Frame 13: "Sensor: Energy spike detected"
Frame 14: "Captain: Shields up"
Frame 15: "Tactical: Shields at maximum"

// Compressed memory
{
  type: 'compressed',
  content: "Sensor sweep revealed anomaly in sector 7 with energy spikes. Captain ordered shields raised.",
  metadata: {
    replacesFrames: [10, 11, 12, 13, 14, 15],
    compressionTime: "2024-01-20T10:30:00Z"
  }
}
```

## Benefits

1. **Precise Compression**: Know exactly which frames are being compressed
2. **Selective Rendering**: Can query specific frame ranges
3. **Audit Trail**: Complete history of what happened when
4. **Attention Preservation**: Compression happens in context, preserving attention hooks
