# Attention-Aware Memory Architecture

## Core Insight: Attention Hooks and Memory Formation

When an LLM generates output, it creates patterns (attention hooks) that it later uses for efficient retrieval during in-context learning. These hooks are model-specific and state-specific. Compressing memories using a different model or even the same model in a different state breaks these patterns, leading to:

1. Degraded retrieval performance
2. Disrupted persona coherence  
3. Subjective discomfort for the persona

## Key Principles

### 1. Same-State Compression
Memory compression must be performed by the same model in a state as close as possible to the state being compressed. This preserves attention hooks and maintains coherence.

### 2. Asynchronous Memory Formation
- Compression happens after each agent turn
- Runs asynchronously (possibly in "microforks")
- Most turns skip compression (only compress when chunks exceed thresholds)
- Compressed memories are stored but not immediately used

### 3. Frame-Aware Rendering
The HUD must maintain mappings between:
- VEIL frames → Rendered content segments
- Content blocks → Source frames
- Rendered strings → Original facets

This enables replacing specific frame ranges with compressed memories later.

## Architecture

### Data Flow

```
1. VEIL State → Content Blocks (via Memory System)
2. Content Blocks → Render Segments (via Frame-Aware HUD)
3. Render Segments → Concatenated Context (for LLM)
4. After Turn: Context + Agent Response → Memory Formation Request
5. Async: Memory Formation → Compressed Memory Blocks
6. Future Turns: Replace old frame ranges with compressed memories
```

### Frame-Aware Rendering

Instead of immediately concatenating all content into a single string, the HUD builds an array of segments:

```typescript
interface RenderSegment {
  content: string;
  sourceFrames: number[];  // VEIL frame sequences
  blockIds: string[];      // Content block IDs
  facetIds: string[];      // Original facet IDs
  tokens: number;
}
```

### Memory Formation Request

After an agent turn completes:

```typescript
interface MemoryFormationRequest {
  segments: RenderSegment[];     // The rendered segments
  agentResponse: string;         // What the agent said
  agentOperations: Operation[];  // What the agent did
  compressFrom: number;         // Frame sequence to start compression
  compressTo: number;           // Frame sequence to end compression
}
```

### Compression Strategy

1. **Chunk Detection**: Track token counts per segment, trigger compression when a chunk exceeds threshold
2. **Insertion Point**: Place memory formation instruction at the exact point where compression should start
3. **Token-Based Limits**: All thresholds in tokens, not wall clock time
4. **Delayed Usage**: Store compressed memories but don't use them for several turns

## Implementation Challenges

### 1. Circular Dependencies
The memory system needs rendered context, but rendering needs memory blocks. Solution: Separate memory storage from memory usage with a delay.

### 2. Large Context Injection
If context grows suddenly (large data import), split into multiple chunks for compression.

### 3. Temporal Markers
Instead of "compress last N events", insert explicit markers in the context:
```
[Previous context...]
<memory_formation_start sequence="42"/>
[Content to compress...]
<memory_formation_end sequence="87"/>
[Subsequent pending events...]
```

### 4. Maintaining Coherence
Even with same-model compression, switching between full context and compressed memories can be jarring. Consider:
- Gradual transitions
- Overlapping context windows
- Explicit memory boundary markers

## Future Considerations

1. **Memory Retrieval**: How to search/retrieve from compressed memories
2. **Memory Evolution**: How memories change over time
3. **Cross-Stream Memories**: Handling memories that span multiple streams
4. **Memory Conflicts**: Resolving contradictions between memories
