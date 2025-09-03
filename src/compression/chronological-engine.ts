import { Facet } from '../veil/types';
import { 
  CompressionEngine, 
  CompressionRequest, 
  CompressionResult, 
  ContentBlock 
} from './types';

/**
 * Compression engine that preserves chronological order and separates events from state
 */
export class ChronologicalCompressionEngine implements CompressionEngine {
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
          attributes: facet.attributes
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

    // Combine in order: events first (chronological), then ambient, then current states
    blocks.push(...events);
    blocks.push(...ambient);
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
