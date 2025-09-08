import { Facet } from '../veil/types';
import { MemorySystem, MemoryQuery, MemoryResult, MemoryBlock } from './types';

// Memory types for this system
type ChunkingMemoryType = 'raw' | 'chunk' | 'compressed';

interface ChunkMetadata {
  frameRange: { from: number; to: number };
  facetCount: number;
  tokenEstimate: number;
  needsCompression: boolean;
  compressed?: boolean;
  compressionRequested?: string; // timestamp
}

/**
 * Memory system that chunks content and tracks compression needs
 * Does NOT perform compression itself - that happens asynchronously
 * via agent self-narration to preserve attention hooks
 */
export class ChunkingMemory implements MemorySystem {
  private memories: Map<string, MemoryBlock<ChunkingMemoryType>> = new Map();
  private chunks: Map<string, ChunkMetadata> = new Map();
  
  // Configuration
  private chunkSizeTokens = 2000;  // Target chunk size
  private compressionThreshold = 1500; // Compress chunks over this size
  
  async ingest(facets: Map<string, Facet>): Promise<void> {
    // First, convert all facets to raw memory blocks
    const newBlocks: Array<[string, MemoryBlock<ChunkingMemoryType>]> = [];
    
    for (const [id, facet] of facets) {
      if (facet.type === 'tool') continue;
      
      // Skip if already processed
      if (this.memories.has(id)) continue;
      
      const block: MemoryBlock<ChunkingMemoryType> = {
        id: facet.id,
        type: 'raw',
        content: facet.content || '',
        source: facet,
        metadata: {
          frameSequence: facet.frameSequence,
          timestamp: facet.timestamp || new Date().toISOString(),
          tokens: this.estimateTokens(facet.content || '')
        }
      };
      
      newBlocks.push([id, block]);
    }
    
    // Add new blocks
    for (const [id, block] of newBlocks) {
      this.memories.set(id, block);
    }
    
    // Re-evaluate chunks
    this.updateChunks();
  }
  
  private updateChunks(): void {
    // Get all raw blocks sorted by frame sequence
    const rawBlocks = Array.from(this.memories.values())
      .filter(b => b.type === 'raw')
      .sort((a, b) => {
        const aSeq = a.metadata?.frameSequence || 0;
        const bSeq = b.metadata?.frameSequence || 0;
        return aSeq - bSeq;
      });
    
    // Clear existing chunks
    this.chunks.clear();
    
    // Create new chunks
    let currentChunk: MemoryBlock<ChunkingMemoryType>[] = [];
    let currentTokens = 0;
    let chunkStart = 0;
    
    for (let i = 0; i < rawBlocks.length; i++) {
      const block = rawBlocks[i];
      const blockTokens = block.metadata?.tokens || 0;
      
      // Start new chunk if adding this block would exceed limit
      if (currentTokens + blockTokens > this.chunkSizeTokens && currentChunk.length > 0) {
        this.finalizeChunk(currentChunk, chunkStart, i - 1);
        currentChunk = [];
        currentTokens = 0;
        chunkStart = i;
      }
      
      currentChunk.push(block);
      currentTokens += blockTokens;
    }
    
    // Finalize last chunk
    if (currentChunk.length > 0) {
      this.finalizeChunk(currentChunk, chunkStart, rawBlocks.length - 1);
    }
  }
  
  private finalizeChunk(
    blocks: MemoryBlock<ChunkingMemoryType>[], 
    startIdx: number, 
    endIdx: number
  ): void {
    const chunkId = `chunk-${startIdx}-${endIdx}`;
    const totalTokens = blocks.reduce((sum, b) => sum + (b.metadata?.tokens || 0), 0);
    
    const minFrame = Math.min(...blocks.map(b => b.metadata?.frameSequence || 0));
    const maxFrame = Math.max(...blocks.map(b => b.metadata?.frameSequence || 0));
    
    this.chunks.set(chunkId, {
      frameRange: { from: minFrame, to: maxFrame },
      facetCount: blocks.length,
      tokenEstimate: totalTokens,
      needsCompression: totalTokens > this.compressionThreshold,
      compressed: false
    });
  }
  
  private estimateTokens(content: string): number {
    // Simple estimation: ~4 characters per token
    return Math.ceil(content.length / 4);
  }
  
  async query(request: MemoryQuery): Promise<MemoryResult> {
    let blocks = Array.from(this.memories.values());
    
    // Apply filters
    if (request.filter) {
      if (request.filter.types) {
        blocks = blocks.filter(b => request.filter!.types!.includes(b.type));
      }
      
      if (request.filter.metadata?.needsCompression) {
        // Find blocks in chunks that need compression
        const chunksNeedingCompression = Array.from(this.chunks.entries())
          .filter(([_, meta]) => meta.needsCompression && !meta.compressed)
          .map(([id, _]) => id);
        
        blocks = blocks.filter(b => {
          const chunkId = this.findChunkForBlock(b);
          return chunkId && chunksNeedingCompression.includes(chunkId);
        });
      }
    }
    
    // Sort by frame sequence
    blocks.sort((a, b) => {
      const aSeq = a.metadata?.frameSequence || 0;
      const bSeq = b.metadata?.frameSequence || 0;
      return aSeq - bSeq;
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
  
  private findChunkForBlock(block: MemoryBlock): string | null {
    const frameSeq = block.metadata?.frameSequence;
    if (!frameSeq) return null;
    
    for (const [chunkId, meta] of this.chunks) {
      if (frameSeq >= meta.frameRange.from && frameSeq <= meta.frameRange.to) {
        return chunkId;
      }
    }
    return null;
  }
  
  /**
   * Get chunks that need compression
   */
  async getCompressionCandidates(): Promise<{
    chunkId: string;
    frameRange: { from: number; to: number };
    blocks: MemoryBlock[];
    totalTokens: number;
  }[]> {
    const candidates = [];
    
    for (const [chunkId, meta] of this.chunks) {
      if (meta.needsCompression && !meta.compressed) {
        const blocks = Array.from(this.memories.values())
          .filter(b => {
            const seq = b.metadata?.frameSequence || 0;
            return seq >= meta.frameRange.from && seq <= meta.frameRange.to;
          })
          .sort((a, b) => {
            const aSeq = a.metadata?.frameSequence || 0;
            const bSeq = b.metadata?.frameSequence || 0;
            return aSeq - bSeq;
          });
        
        candidates.push({
          chunkId,
          frameRange: meta.frameRange,
          blocks,
          totalTokens: meta.tokenEstimate
        });
      }
    }
    
    return candidates;
  }
  
  /**
   * Mark a chunk as having compression requested
   */
  async markCompressionRequested(chunkId: string): Promise<void> {
    const chunk = this.chunks.get(chunkId);
    if (chunk) {
      chunk.compressionRequested = new Date().toISOString();
    }
  }
  
  /**
   * Replace a chunk with its compressed version
   */
  async applyCompression(
    chunkId: string, 
    compressedBlock: MemoryBlock<'compressed'>
  ): Promise<void> {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return;
    
    // Remove all blocks in the chunk's frame range
    const toRemove: string[] = [];
    for (const [id, block] of this.memories) {
      const seq = block.metadata?.frameSequence || 0;
      if (seq >= chunk.frameRange.from && seq <= chunk.frameRange.to) {
        toRemove.push(id);
      }
    }
    
    toRemove.forEach(id => this.memories.delete(id));
    
    // Add the compressed block
    this.memories.set(compressedBlock.id, compressedBlock as MemoryBlock<ChunkingMemoryType>);
    
    // Update chunk metadata
    chunk.compressed = true;
  }
  
  async getAllBlocks(): Promise<MemoryBlock[]> {
    return Array.from(this.memories.values());
  }
  
  async prune(): Promise<void> {
    // Keep compressed blocks and recent raw blocks
    const cutoff = Date.now() - 3600000; // 1 hour
    const toDelete: string[] = [];
    
    for (const [id, block] of this.memories) {
      if (block.type === 'raw') {
        const timestamp = new Date(block.metadata?.timestamp || 0).getTime();
        if (timestamp < cutoff) {
          // Check if it's part of a compressed chunk
          const chunkId = this.findChunkForBlock(block);
          if (chunkId) {
            const chunk = this.chunks.get(chunkId);
            if (chunk?.compressed) {
              toDelete.push(id);
            }
          }
        }
      }
    }
    
    toDelete.forEach(id => this.memories.delete(id));
  }
}
