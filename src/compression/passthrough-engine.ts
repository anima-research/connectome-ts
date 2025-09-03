import { Facet } from '../veil/types';
import { 
  CompressionEngine, 
  CompressionRequest, 
  CompressionResult, 
  ContentBlock 
} from './types';

/**
 * Minimal compression engine that passes facets through as blocks
 * This is the simplest possible implementation for testing
 */
export class PassthroughCompressionEngine implements CompressionEngine {
  async compress(
    facets: Map<string, Facet>, 
    request: CompressionRequest
  ): Promise<CompressionResult> {
    const blocks: ContentBlock[] = [];
    let totalTokens = 0;

    // Convert facets to blocks, respecting type filters
    for (const [id, facet] of facets) {
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
        priority: this.getPriority(facet),
        metadata: {
          facetType: facet.type,
          displayName: facet.displayName,
          attributes: facet.attributes
        }
      };

      blocks.push(block);
      totalTokens += this.estimateTokens(block.content);

      // Respect max blocks limit
      if (request.maxBlocks && blocks.length >= request.maxBlocks) {
        break;
      }
    }

    // For passthrough, preserve chronological order (no sorting)

    return {
      blocks,
      totalTokens,
      compressionRatio: 1.0  // No compression in passthrough
    };
  }

  private getPriority(facet: Facet): number {
    // Simple priority heuristic
    switch (facet.type) {
      case 'event':
        return 100;  // Events are high priority (temporal)
      case 'state':
        return 80;   // States are important context
      case 'ambient':
        return 60;   // Ambient is background context
      default:
        return 50;
    }
  }

  private estimateTokens(content: string): number {
    // Rough estimate: 1 token per 4 characters
    return Math.ceil(content.length / 4);
  }
}
