import { Facet } from '../veil/types';
import { 
  CompressionEngine, 
  CompressionRequest, 
  CompressionResult, 
  ContentBlock 
} from './types';

/**
 * Compression engine that implements floating ambient facets.
 * Ambient facets are rendered at a preferred depth from the current moment
 * to keep them in the attention zone while respecting temporal constraints.
 */
export class FloatingAmbientEngine implements CompressionEngine {
  private preferredAmbientDepth: number;

  constructor(preferredAmbientDepth: number = 3) {
    this.preferredAmbientDepth = preferredAmbientDepth;
  }

  async compress(
    facets: Map<string, Facet>, 
    request: CompressionRequest
  ): Promise<CompressionResult> {
    const blocks: ContentBlock[] = [];
    const events: ContentBlock[] = [];
    const states: ContentBlock[] = [];
    const ambient: ContentBlock[] = [];
    let totalTokens = 0;

    // First, identify which facets are children of other facets
    const childIds = new Set<string>();
    for (const [id, facet] of facets) {
      if (facet.children) {
        for (const child of facet.children) {
          childIds.add(child.id);
        }
      }
    }

    // Categorize facets
    let creationCounter = 0;
    for (const [id, facet] of facets) {
      // Skip if this is a child of another facet (will be rendered with parent)
      if (childIds.has(id)) {
        continue;
      }

      // Skip if type filtering is requested and doesn't match
      if (request.includeTypes && !request.includeTypes.includes(facet.type as any)) {
        continue;
      }

      // Skip tool facets - they never render
      if (facet.type === 'tool') {
        continue;
      }

      // Create block from facet
      const block: ContentBlock = {
        id: facet.id,
        type: 'facet',
        content: facet.content || '',
        source: facet,
        metadata: {
          facetType: facet.type,
          displayName: facet.displayName,
          attributes: facet.attributes,
          // Track creation order for ambient floating
          creationIndex: creationCounter++
        }
      };

      // Categorize by type
      if (facet.type === 'event' || facet.attributes?.agentGenerated) {
        events.push(block);
      } else if (facet.type === 'state') {
        states.push(block);
      } else if (facet.type === 'ambient') {
        // Put agent ambient (inner thoughts) with events
        if (facet.attributes?.agentGenerated) {
          events.push(block);
        } else {
          ambient.push(block);
        }
      }

      totalTokens += this.estimateTokens(block.content);
    }

    // Build the final block order
    // First, combine all events and states to establish the timeline
    const timelineBlocks: ContentBlock[] = [...events];
    
    // Now intelligently place ambient facets
    if (ambient.length > 0 && timelineBlocks.length > 0) {
      // Sort ambient by creation order
      ambient.sort((a, b) => {
        const aIndex = a.metadata?.creationIndex || 0;
        const bIndex = b.metadata?.creationIndex || 0;
        return aIndex - bIndex;
      });
      
      // Insert each ambient at its preferred position
      for (const ambientBlock of ambient) {
        const creationIndex = ambientBlock.metadata?.creationIndex || 0;
        
        // Find where this ambient can validly appear (after its creation point)
        let earliestValidIndex = 0;
        for (let i = 0; i < timelineBlocks.length; i++) {
          const block = timelineBlocks[i];
          const blockCreationIndex = block.metadata?.creationIndex || 0;
          if (blockCreationIndex >= creationIndex) {
            earliestValidIndex = i;
            break;
          }
        }
        
        // Calculate preferred position (depth from current end of timeline)
        const currentLength = timelineBlocks.length;
        const preferredIndex = Math.max(
          currentLength - this.preferredAmbientDepth,
          earliestValidIndex
        );
        
        // Insert at the preferred position
        timelineBlocks.splice(preferredIndex, 0, ambientBlock);
      }
    } else if (ambient.length > 0) {
      // No events, just add ambient at the beginning
      timelineBlocks.push(...ambient);
    }
    
    // Copy timeline to final blocks
    blocks.push(...timelineBlocks);
    
    // Finally add current states at the end
    blocks.push(...states);

    // Respect max blocks limit
    if (request.maxBlocks && blocks.length > request.maxBlocks) {
      blocks.splice(request.maxBlocks);
    }

    return {
      blocks,
      totalTokens,
      compressionRatio: 1.0  // No compression
    };
  }

  private estimateTokens(content: string): number {
    // Rough estimate: 1 token per 4 characters
    return Math.ceil(content.length / 4);
  }
}
