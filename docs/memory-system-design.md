# Memory System Design

## Overview

The Memory System is responsible for processing, summarizing, and storing memories from VEIL facets. Unlike the previous "Compression Engine" which only reordered blocks, the Memory System provides true summarization and intelligent memory management.

## Key Design Principles

### 1. Flexible Type System

Each memory system can define its own taxonomy of memory types:

```typescript
// PassthroughMemory uses simple types
type PassthroughBlockType = 'raw';

// NarrativeMemory uses content-based types
type NarrativeBlockType = 'narrative' | 'event' | 'state' | 'ambient';

// EpisodicMemory uses temporal organization
type EpisodeType = 'episode' | 'scene' | 'moment' | 'transition';
```

### 2. Generic Interface

The `MemoryBlock` interface is generic, allowing each system to specify its types:

```typescript
export interface MemoryBlock<TType extends string = string> {
  id: string;
  type: TType;
  content: string;
  metadata?: Record<string, any>;
  source?: Facet;
}
```

### 3. Flexible Querying

Memory queries use a flexible filter system instead of rigid type enums:

```typescript
export interface MemoryQuery {
  maxBlocks?: number;
  filter?: {
    types?: string[];
    metadata?: Record<string, any>;
    contentPattern?: string;
  };
}
```

## Memory System Types

### PassthroughMemory
- Simple 1:1 conversion of facets to memory blocks
- No summarization or processing
- Useful for testing and debugging

### ChunkingMemory
- Tracks token counts and identifies chunks needing compression
- Maintains frame sequence metadata
- Provides compression candidates but doesn't compress itself

### FrameBasedMemory
- Works with frame history rather than individual facets
- Tracks which operations happened in which frames
- Enables precise frame-range compression
- Maintains causal relationships between operations

## Future Memory Systems

The flexible design allows for:
- **SemanticMemory**: Concept and relationship extraction
- **GraphMemory**: Knowledge graph construction
- **RAGMemory**: Vector embeddings and similarity search
- **CompressedMemory**: LLM-based intelligent summarization

## Integration with HUD

The Memory System provides blocks to the HUD, which then:
1. Manages token budget
2. Applies saliency-based selection
3. Handles final rendering format

This separation ensures each component has a focused responsibility.

