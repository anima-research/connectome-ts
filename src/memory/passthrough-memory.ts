import { Facet } from '../veil/types';
import { MemorySystem, MemoryQuery, MemoryResult, MemoryBlock } from './types';

/**
 * Simple passthrough memory system that doesn't do any summarization
 * Just converts facets to memory blocks without modification
 */
export class PassthroughMemory implements MemorySystem {
  private blocks: Map<string, MemoryBlock> = new Map();

  async ingest(facets: Map<string, Facet>): Promise<void> {
    // Clear previous blocks
    this.blocks.clear();
    
    // Convert each facet to a raw memory block
    for (const [id, facet] of facets) {
      // Skip tool facets
      if (facet.type === 'tool') {
        continue;
      }
      
      // Skip child facets (they'll be included with parents)
      let isChild = false;
      for (const [_, parentFacet] of facets) {
        if (parentFacet.children?.some(child => child.id === id)) {
          isChild = true;
          break;
        }
      }
      if (isChild) continue;
      
      const block: MemoryBlock = {
        id: facet.id,
        type: 'raw',
        content: facet.content || '',
        source: facet,
        metadata: {
          timestamp: new Date().toISOString()
        }
      };
      
      this.blocks.set(id, block);
    }
  }

  async query(request: MemoryQuery): Promise<MemoryResult> {
    const blocks = Array.from(this.blocks.values());
    
    // Filter by type if requested
    let filtered = blocks;
    if (request.includeTypes) {
      filtered = blocks.filter(b => request.includeTypes!.includes(b.type));
    }
    
    // Apply max blocks limit
    if (request.maxBlocks && filtered.length > request.maxBlocks) {
      filtered = filtered.slice(0, request.maxBlocks);
    }
    
    return {
      blocks: filtered,
      totalMemories: this.blocks.size
    };
  }

  async getAllBlocks(): Promise<MemoryBlock[]> {
    return Array.from(this.blocks.values());
  }

  async prune(): Promise<void> {
    // No-op for passthrough
  }
}
