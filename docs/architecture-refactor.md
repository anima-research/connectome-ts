# Architecture Refactor: Memory System vs HUD

## Current Issues

The current architecture conflates several concerns:
- "Compression Engine" doesn't actually compress, it just reorders blocks
- Token budget management is unclear - is it in Compression or HUD?
- Saliency-based pruning responsibility is ambiguous

## Proposed Architecture

### Memory System
**Purpose**: Long-term memory management and intelligent summarization

**Responsibilities**:
- **Ingestion**: Process new facets as they arrive
- **Summarization**: Convert old event sequences into narrative memories
- **Extraction**: Pull out key facts and patterns
- **Storage**: Maintain a persistent memory store
- **Retrieval**: Query relevant memories based on current context

**Key Interfaces**:
```typescript
interface MemorySystem {
  ingest(facets: Map<string, Facet>): Promise<void>;
  query(request: MemoryQuery): Promise<MemoryResult>;
  getAllBlocks(): Promise<MemoryBlock[]>;
  prune(): Promise<void>;
}
```

### HUD (Heads-Up Display)
**Purpose**: Final context assembly with intelligent selection

**Responsibilities**:
- **Token Budget Management**: Stay within context window limits
- **Saliency-Based Selection**: Use saliency hints to prioritize content
- **Content Pruning**: Drop low-relevance content when needed
- **Format Rendering**: XML, JSON, or other formats
- **Floating Ambient**: Position ambient facets at preferred depths

**Key Interfaces**:
```typescript
interface HUD {
  render(context: HUDContext, config: HUDConfig): RenderedContext;
  parseCompletion(completion: string): ParsedCompletion;
}
```

## Data Flow

1. **VEIL State** → Maintains current facets
2. **Memory System** → Processes facets into memories
3. **HUD** → Combines current facets + memories, applies selection logic
4. **LLM** → Receives optimized context

## Benefits

1. **Clear Separation**: Each component has a focused responsibility
2. **Flexibility**: Can swap memory implementations (narrative, RAG, etc.)
3. **Intelligent Context**: HUD makes final decisions based on all available signals
4. **Scalability**: Memory system can grow independently of rendering concerns

## Migration Path

1. Rename `compression/` → `memory/`
2. Update interfaces to reflect new responsibilities
3. Move token budget logic to HUD
4. Move saliency-based selection to HUD
5. Add true summarization capabilities to Memory System

