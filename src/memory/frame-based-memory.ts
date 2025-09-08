import { Facet, IncomingVEILFrame, OutgoingVEILFrame } from '../veil/types';
import { MemorySystem, MemoryQuery, MemoryResult, MemoryBlock } from './types';

// Memory types for this system
type FrameMemoryType = 'facet' | 'frame-summary' | 'compressed';

interface FrameMemoryMetadata {
  frameSequence: number;
  timestamp: string;
  operationType?: string;
  facetId?: string;
}

/**
 * Memory system that understands frame history
 * Tracks which operations happened in which frames
 * Enables frame-range compression while preserving causality
 */
export class FrameBasedMemory implements MemorySystem {
  private memories: Map<string, MemoryBlock<FrameMemoryType>> = new Map();
  private frameIndex: Map<number, Set<string>> = new Map(); // frame seq -> memory IDs
  
  /**
   * Process frame history to create memory blocks
   * Each frame's operations become memory blocks tagged with frame sequence
   */
  async ingestFrames(frames: (IncomingVEILFrame | OutgoingVEILFrame)[]): Promise<void> {
    for (const frame of frames) {
      const frameSeq = frame.sequence;
      const frameTime = frame.timestamp;
      
      if (!this.frameIndex.has(frameSeq)) {
        this.frameIndex.set(frameSeq, new Set());
      }
      
      // Process each operation in the frame
      for (const operation of frame.operations) {
        const blockId = `frame-${frameSeq}-op-${Math.random().toString(36).substr(2, 9)}`;
        let block: MemoryBlock<FrameMemoryType> | null = null;
        
        switch (operation.type) {
          case 'addFacet':
            if ('facet' in operation) {
              block = {
                id: blockId,
                type: 'facet',
                content: this.renderFacetAddition(operation.facet),
                metadata: {
                  frameSequence: frameSeq,
                  timestamp: frameTime,
                  operationType: 'addFacet',
                  facetId: operation.facet.id
                } as FrameMemoryMetadata
              };
            }
            break;
            
          case 'changeState':
            block = {
              id: blockId,
              type: 'facet',
              content: `State change: ${operation.facetId} -> ${JSON.stringify(operation.updates)}`,
              metadata: {
                frameSequence: frameSeq,
                timestamp: frameTime,
                operationType: 'changeState',
                facetId: operation.facetId
              } as FrameMemoryMetadata
            };
            break;
            
          case 'addStream':
            if ('stream' in operation) {
              block = {
                id: blockId,
                type: 'facet',
                content: `New stream: ${operation.stream.id} - ${operation.stream.name || ''}`,
                metadata: {
                  frameSequence: frameSeq,
                  timestamp: frameTime,
                  operationType: 'addStream'
                } as FrameMemoryMetadata
              };
            }
            break;
            
          // Handle outgoing operations
          case 'speak':
            if ('content' in operation) {
              // For outgoing operations, we don't have the facet yet
              // So we create blocks that describe the operation
              block = {
                id: blockId,
                type: 'facet',
                content: operation.content,
                metadata: {
                  frameSequence: frameSeq,
                  timestamp: frameTime,
                  operationType: 'speak',
                  target: operation.target,
                  isAgentGenerated: true
                } as FrameMemoryMetadata
              };
            }
            break;
            
          case 'toolCall':
            if ('toolName' in operation) {
              block = {
                id: blockId,
                type: 'facet',
                content: `Action: ${operation.toolName}(${JSON.stringify(operation.parameters)})`,
                metadata: {
                  frameSequence: frameSeq,
                  timestamp: frameTime,
                  operationType: 'toolCall',
                  toolName: operation.toolName
                } as FrameMemoryMetadata
              };
            }
            break;
            
          case 'innerThoughts':
            if ('content' in operation) {
              block = {
                id: blockId,
                type: 'facet',
                content: `Thought: ${operation.content}`,
                metadata: {
                  frameSequence: frameSeq,
                  timestamp: frameTime,
                  operationType: 'innerThoughts'
                } as FrameMemoryMetadata
              };
            }
            break;
        }
        
        if (block) {
          this.memories.set(blockId, block);
          this.frameIndex.get(frameSeq)!.add(blockId);
        }
      }
    }
  }
  
  private renderFacetAddition(facet: Facet): string {
    // Simple rendering for now
    if (facet.displayName) {
      return `<${facet.displayName}>${facet.content || ''}</${facet.displayName}>`;
    }
    return facet.content || '';
  }
  
  /**
   * Get memory blocks for a specific frame range
   */
  async getFrameRange(fromSeq: number, toSeq: number): Promise<MemoryBlock[]> {
    const blocks: MemoryBlock[] = [];
    
    for (let seq = fromSeq; seq <= toSeq; seq++) {
      const blockIds = this.frameIndex.get(seq);
      if (blockIds) {
        for (const id of blockIds) {
          const block = this.memories.get(id);
          if (block) {
            blocks.push(block);
          }
        }
      }
    }
    
    return blocks;
  }
  
  /**
   * Replace a frame range with a compressed memory
   */
  async compressFrameRange(
    fromSeq: number, 
    toSeq: number, 
    compressedContent: string
  ): Promise<void> {
    // Remove all blocks in the range
    const toRemove: string[] = [];
    for (let seq = fromSeq; seq <= toSeq; seq++) {
      const blockIds = this.frameIndex.get(seq);
      if (blockIds) {
        toRemove.push(...blockIds);
        this.frameIndex.delete(seq);
      }
    }
    
    toRemove.forEach(id => this.memories.delete(id));
    
    // Add compressed block
    const compressedId = `compressed-${fromSeq}-${toSeq}`;
    const compressedBlock: MemoryBlock<FrameMemoryType> = {
      id: compressedId,
      type: 'compressed',
      content: compressedContent,
      metadata: {
        frameRange: { from: fromSeq, to: toSeq },
        compressionTime: new Date().toISOString()
      }
    };
    
    this.memories.set(compressedId, compressedBlock);
  }
  
  // Standard MemorySystem interface implementation
  async ingest(facets: Map<string, Facet>): Promise<void> {
    // This system works with frames, not individual facets
    throw new Error('FrameBasedMemory requires frame history. Use ingestFrames() instead.');
  }
  
  async query(request: MemoryQuery): Promise<MemoryResult> {
    let blocks = Array.from(this.memories.values());
    
    // Apply filters
    if (request.filter) {
      if (request.filter.types) {
        blocks = blocks.filter(b => request.filter!.types!.includes(b.type));
      }
      
      if (request.filter.metadata?.frameRange) {
        const range = request.filter.metadata.frameRange as { from: number; to: number };
        blocks = blocks.filter(b => {
          const meta = b.metadata as FrameMemoryMetadata;
          if (meta.frameSequence) {
            return meta.frameSequence >= range.from && meta.frameSequence <= range.to;
          }
          return false;
        });
      }
    }
    
    // Sort by frame sequence
    blocks.sort((a, b) => {
      const aSeq = (a.metadata as FrameMemoryMetadata)?.frameSequence || 0;
      const bSeq = (b.metadata as FrameMemoryMetadata)?.frameSequence || 0;
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
  
  async getAllBlocks(): Promise<MemoryBlock[]> {
    return Array.from(this.memories.values());
  }
  
  async prune(): Promise<void> {
    // Keep compressed blocks and recent frame blocks
    const cutoff = Date.now() - 3600000; // 1 hour
    const toDelete: string[] = [];
    
    for (const [id, block] of this.memories) {
      if (block.type === 'facet') {
        const meta = block.metadata as FrameMemoryMetadata;
        const timestamp = new Date(meta.timestamp).getTime();
        if (timestamp < cutoff) {
          toDelete.push(id);
        }
      }
    }
    
    toDelete.forEach(id => {
      this.memories.delete(id);
      // Also remove from frame index
      for (const [seq, ids] of this.frameIndex) {
        ids.delete(id);
        if (ids.size === 0) {
          this.frameIndex.delete(seq);
        }
      }
    });
  }
}
