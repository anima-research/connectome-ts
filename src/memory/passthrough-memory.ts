import { Facet } from '../veil/types';
import { MemorySystem, MemoryQuery, MemoryResult, MemoryBlock } from './types';

// Define the types this memory system uses
type PassthroughBlockType = 'raw';

/**
 * Simple passthrough memory system that doesn't do any summarization
 * Just converts facets to memory blocks without modification
 */
export class PassthroughMemory implements MemorySystem {
  private blocks: Map<string, MemoryBlock<PassthroughBlockType>> = new Map();

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
      
      const block: MemoryBlock<PassthroughBlockType> = {
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
    let blocks = Array.from(this.blocks.values());
    
    // Apply filters if provided
    if (request.filter) {
      // Filter by type
      if (request.filter.types) {
        blocks = blocks.filter(b => request.filter!.types!.includes(b.type));
      }
      
      // Filter by content pattern
      if (request.filter.contentPattern) {
        const pattern = new RegExp(request.filter.contentPattern, 'i');
        blocks = blocks.filter(b => pattern.test(b.content));
      }
    }
    
    // Apply max blocks limit
    if (request.maxBlocks && blocks.length > request.maxBlocks) {
      blocks = blocks.slice(0, request.maxBlocks);
    }
    
    return {
      blocks,
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
