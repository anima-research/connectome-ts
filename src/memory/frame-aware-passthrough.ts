import { Facet, VEILFrame } from '../veil/types';
import { MemorySystem, MemoryQuery, MemoryResult, MemoryBlock } from './types';

// Memory types for this system
type FramePassthroughType = 'facet';

/**
 * Frame-aware passthrough memory that tracks which frame created each facet
 * Combines the simplicity of PassthroughMemory with frame tracking
 */
export class FrameAwarePassthroughMemory implements MemorySystem {
  private memories: Map<string, MemoryBlock<FramePassthroughType>> = new Map();
  private facetToFrame: Map<string, number> = new Map();
  
  /**
   * Process frame history to track facet creation
   */
  async ingestFrames(frames: VEILFrame[]): Promise<void> {
    // Clear existing data
    this.facetToFrame.clear();
    
    // Track which facets were created in which frames
    const seenFacets = new Set<string>();
    
    for (const frame of frames) {
      const newFacetsInFrame: string[] = [];
      
      // Look for facets created by this frame
      for (const operation of frame.operations) {
        if (operation.type === 'addFacet' && 'facet' in operation) {
          const facet = operation.facet;
          if (!seenFacets.has(facet.id)) {
            seenFacets.add(facet.id);
            this.facetToFrame.set(facet.id, frame.sequence);
            newFacetsInFrame.push(facet.id);
            
            // Also track children
            if (facet.children) {
              this.trackChildFacets(facet.children, frame.sequence, seenFacets);
            }
          }
        }
      }
    }
  }
  
  private trackChildFacets(children: Facet[], frameSeq: number, seenFacets: Set<string>): void {
    for (const child of children) {
      if (!seenFacets.has(child.id)) {
        seenFacets.add(child.id);
        this.facetToFrame.set(child.id, frameSeq);
        
        if (child.children) {
          this.trackChildFacets(child.children, frameSeq, seenFacets);
        }
      }
    }
  }
  
  async ingest(facets: Map<string, Facet>): Promise<void> {
    // Clear previous blocks
    this.memories.clear();
    
    // Convert each facet to a memory block with frame metadata
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
      
      // Get frame sequence for this facet
      const frameSequence = this.facetToFrame.get(id) || 0;
      
      const block: MemoryBlock<FramePassthroughType> = {
        id: facet.id,
        type: 'facet',
        content: facet.content || '',
        source: facet,
        metadata: {
          frameSequence,
          timestamp: new Date().toISOString(),
          facetType: facet.type,
          displayName: facet.displayName,
          attributes: facet.attributes
        }
      };
      
      this.memories.set(id, block);
    }
  }
  
  async query(request: MemoryQuery): Promise<MemoryResult> {
    let blocks = Array.from(this.memories.values());
    
    // Apply filters
    if (request.filter) {
      if (request.filter.types) {
        blocks = blocks.filter(b => request.filter!.types!.includes(b.type));
      }
      
      if (request.filter.contentPattern) {
        const pattern = new RegExp(request.filter.contentPattern, 'i');
        blocks = blocks.filter(b => pattern.test(b.content));
      }
      
      // Filter by frame sequence if requested
      if (request.filter.metadata?.frameSequence !== undefined) {
        const targetFrame = request.filter.metadata.frameSequence;
        blocks = blocks.filter(b => b.metadata?.frameSequence === targetFrame);
      }
    }
    
    // Sort by frame sequence
    blocks.sort((a, b) => {
      const aFrame = a.metadata?.frameSequence || 0;
      const bFrame = b.metadata?.frameSequence || 0;
      return aFrame - bFrame;
    });
    
    // Apply limit
    if (request.maxBlocks) {
      blocks = blocks.slice(0, request.maxBlocks);
    }
    
    return {
      blocks,
      totalMemories: this.memories.size
    };
  }
  
  async getAllBlocks(): Promise<MemoryBlock[]> {
    return Array.from(this.memories.values());
  }
  
  async prune(): Promise<void> {
    // Simple pruning: remove old blocks
    const cutoff = Date.now() - 3600000; // 1 hour
    const toDelete: string[] = [];
    
    for (const [id, block] of this.memories) {
      const timestamp = new Date(block.metadata?.timestamp || 0).getTime();
      if (timestamp < cutoff) {
        toDelete.push(id);
      }
    }
    
    toDelete.forEach(id => this.memories.delete(id));
  }
}
