import { Facet } from '../veil/types';
import { MemorySystem, MemoryQuery, MemoryResult, MemoryBlock } from './types';

interface EventSequence {
  events: Facet[];
  startTime?: string;
  endTime?: string;
}

/**
 * Narrative Memory System that summarizes event sequences
 * into concise narrative blocks
 */
export class NarrativeMemory implements MemorySystem {
  private memories: Map<string, MemoryBlock> = new Map();
  private eventBuffer: Facet[] = [];
  private summaryThreshold = 5; // Summarize after 5 events
  
  async ingest(facets: Map<string, Facet>): Promise<void> {
    // Process new facets
    for (const [id, facet] of facets) {
      if (facet.type === 'tool') continue;
      
      // Check if facet already processed
      if (this.isProcessed(facet.id)) continue;
      
      if (facet.type === 'event' && !facet.attributes?.agentGenerated) {
        // Add to event buffer for potential summarization
        this.eventBuffer.push(facet);
        
        // Check if we should summarize
        if (this.eventBuffer.length >= this.summaryThreshold) {
          await this.summarizeEventBuffer();
        }
      } else {
        // Convert directly to memory block
        this.memories.set(facet.id, {
          id: facet.id,
          type: 'raw',
          content: facet.content || '',
          source: facet,
          metadata: {
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  }
  
  private async summarizeEventBuffer(): Promise<void> {
    if (this.eventBuffer.length < 2) return;
    
    // Create narrative summary
    const summary = this.createNarrativeSummary(this.eventBuffer);
    
    // Store as narrative memory
    const narrativeId = `narrative-${Date.now()}`;
    this.memories.set(narrativeId, {
      id: narrativeId,
      type: 'narrative',
      content: summary,
      metadata: {
        summary: true,
        originalFacets: this.eventBuffer.map(e => e.id),
        timestamp: new Date().toISOString()
      }
    });
    
    // Clear buffer
    this.eventBuffer = [];
  }
  
  private createNarrativeSummary(events: Facet[]): string {
    // Simple narrative generation
    const eventDescriptions = events.map(e => {
      const source = e.attributes?.source ? `${e.attributes.source} reported: ` : '';
      return source + (e.content || e.displayName || 'Unknown event');
    });
    
    // Group by similarity (simple approach)
    const narrative = `Over the past period, several events occurred: ${eventDescriptions.join('. ')}`;
    
    return narrative;
  }
  
  private isProcessed(facetId: string): boolean {
    // Check if in memories
    if (this.memories.has(facetId)) return true;
    
    // Check if in buffer
    if (this.eventBuffer.some(e => e.id === facetId)) return true;
    
    // Check if part of a narrative
    for (const memory of this.memories.values()) {
      if (memory.metadata?.originalFacets?.includes(facetId)) {
        return true;
      }
    }
    
    return false;
  }

  async query(request: MemoryQuery): Promise<MemoryResult> {
    let blocks = Array.from(this.memories.values());
    
    // Add current buffer as raw blocks
    for (const event of this.eventBuffer) {
      blocks.push({
        id: event.id,
        type: 'raw',
        content: event.content || '',
        source: event,
        metadata: {
          timestamp: new Date().toISOString()
        }
      });
    }
    
    // Filter by type
    if (request.includeTypes) {
      blocks = blocks.filter(b => request.includeTypes!.includes(b.type));
    }
    
    // Sort by relevance/recency
    blocks.sort((a, b) => {
      // Narratives first, then by timestamp
      if (a.type === 'narrative' && b.type !== 'narrative') return -1;
      if (b.type === 'narrative' && a.type !== 'narrative') return 1;
      return 0;
    });
    
    // Apply limit
    if (request.maxBlocks) {
      blocks = blocks.slice(0, request.maxBlocks);
    }
    
    return {
      blocks,
      totalMemories: this.memories.size + this.eventBuffer.length
    };
  }

  async getAllBlocks(): Promise<MemoryBlock[]> {
    const blocks: MemoryBlock[] = Array.from(this.memories.values());
    
    // Add buffer events
    for (const event of this.eventBuffer) {
      blocks.push({
        id: event.id,
        type: 'raw',
        content: event.content || '',
        source: event,
        metadata: {
          timestamp: new Date().toISOString()
        }
      });
    }
    
    return blocks;
  }

  async prune(): Promise<void> {
    // Remove old narratives (keep last 10)
    const narratives = Array.from(this.memories.entries())
      .filter(([_, m]) => m.type === 'narrative')
      .sort((a, b) => (b[1].metadata?.timestamp || '').localeCompare(a[1].metadata?.timestamp || ''));
    
    if (narratives.length > 10) {
      for (let i = 10; i < narratives.length; i++) {
        this.memories.delete(narratives[i][0]);
      }
    }
  }
}
