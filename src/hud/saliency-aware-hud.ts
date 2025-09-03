import { ContentBlock } from '../compression/types';
import { Facet, StreamInfo } from '../veil/types';
import { XmlHUD } from './xml-hud';
import { HUDConfig, RenderedContext } from './types';

/**
 * Extended HUD config with saliency parameters
 */
export interface SaliencyHUDConfig extends HUDConfig {
  maxContextTokens?: number;  // Target context size
  focusBoost?: number;  // How much to boost focused stream content (default: 2.0)
  crossStreamRetention?: number;  // Base retention for cross-stream content (default: 0.8)
  transientDecayRate?: number;  // How fast transient content decays (default: 0.1)
}

/**
 * HUD that uses saliency hints to intelligently manage context
 */
export class SaliencyAwareHUD extends XmlHUD {
  render(
    blocks: ContentBlock[],
    config: SaliencyHUDConfig,
    focus?: string,
    streams?: Map<string, StreamInfo>
  ): RenderedContext {
    // Calculate saliency scores for each block
    const scoredBlocks = this.scoreBlocks(blocks, focus, streams, config);
    
    // Sort by saliency (highest first)
    scoredBlocks.sort((a, b) => b.score - a.score);
    
    // Select blocks up to token limit
    const selectedBlocks = this.selectBlocksByTokenLimit(
      scoredBlocks,
      config.maxContextTokens || 4000
    );

    // Render using parent class
    return super.render(selectedBlocks, config, focus);
  }

  private scoreBlocks(
    blocks: ContentBlock[],
    focus?: string,
    streams?: Map<string, StreamInfo>,
    config?: SaliencyHUDConfig
  ): Array<{ block: ContentBlock; score: number }> {
    const now = new Date();
    const focusBoost = config?.focusBoost || 2.0;
    const crossStreamRetention = config?.crossStreamRetention || 0.8;
    const transientDecayRate = config?.transientDecayRate || 0.1;

    return blocks.map(block => {
      let score = 1.0;  // Base score
      const facet = block.source;
      
      if (!facet?.saliency) {
        // No saliency hints - use defaults based on type
        score = this.getDefaultScore(facet);
      } else {
        const saliency = facet.saliency;

        // 1. Stream relevance
        if (saliency.crossStream) {
          score *= crossStreamRetention;
        } else if (saliency.streams && focus) {
          if (saliency.streams.includes(focus)) {
            score *= focusBoost;  // In focused stream
          } else {
            score *= 0.3;  // Out of focus
          }
        }

        // 2. Importance modifiers
        if (saliency.pinned) {
          score = 10.0;  // Pinned content always included
        }
        if (saliency.reference) {
          score *= 1.5;  // Reference material gets boost
        }

        // 3. Temporal decay
        if (saliency.transient !== undefined) {
          // transient is now a float: 0.0 (permanent) to 1.0 (very transient)
          const age = this.getBlockAge(block);
          const decayFactor = Math.exp(-age * saliency.transient * 0.5); // Exponential decay
          score *= decayFactor;
        }

        // 4. Graph relationships and temporal proximity
        if (saliency.linkedTo || saliency.linkedFrom) {
          const linkBoost = this.calculateLinkBoost(facet, blocks, saliency);
          score *= linkBoost;
        }
      }

      // 5. Type-specific adjustments
      score *= this.getTypeMultiplier(facet);

      return { block, score };
    });
  }

  private getDefaultScore(facet?: Facet): number {
    if (!facet) return 0.5;
    
    switch (facet.type) {
      case 'state':
        return 0.8;  // States are generally important
      case 'event':
        return 0.6;  // Events decay over time
      case 'ambient':
        return 0.7;  // Ambient info is background context
      default:
        return 0.5;
    }
  }

  private getTypeMultiplier(facet?: Facet): number {
    if (!facet) return 1.0;

    // Speech events (from agent) should be preserved
    if (facet.type === 'event' && facet.attributes?.source === 'agent') {
      return 2.0;
    }

    // User messages also important
    if (facet.type === 'event' && facet.attributes?.sender) {
      return 1.5;
    }

    return 1.0;
  }

  private getBlockAge(block: ContentBlock): number {
    if (!block.metadata?.timestamp) return 0;
    
    const now = new Date();
    const blockTime = new Date(block.metadata.timestamp);
    const ageMs = now.getTime() - blockTime.getTime();
    
    // Return age in hours
    return ageMs / (1000 * 60 * 60);
  }

  private selectBlocksByTokenLimit(
    scoredBlocks: Array<{ block: ContentBlock; score: number }>,
    maxTokens: number
  ): ContentBlock[] {
    const selected: ContentBlock[] = [];
    let totalTokens = 0;

    for (const { block, score } of scoredBlocks) {
      if (score <= 0) continue;  // Skip zero-score blocks
      
      const blockTokens = this.estimateBlockTokens(block.content);
      if (totalTokens + blockTokens <= maxTokens) {
        selected.push(block);
        totalTokens += blockTokens;
      } else {
        // Can't fit this block
        break;
      }
    }

    return selected;
  }

  private estimateBlockTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  private calculateLinkBoost(
    facet: Facet, 
    allBlocks: ContentBlock[],
    saliency: import('../veil/types').SaliencyHints
  ): number {
    let boost = 1.0;
    
    // Find linked facets in the current block set
    const linkedFacets = new Set<string>([
      ...(saliency.linkedTo || []),
      ...(saliency.linkedFrom || [])
    ]);

    if (linkedFacets.size === 0) return boost;

    // Check temporal proximity to linked facets
    const facetTime = this.getFacetTime(facet);
    let proximityBoosts: number[] = [];

    for (const block of allBlocks) {
      if (block.source && linkedFacets.has(block.source.id)) {
        const linkedTime = this.getFacetTime(block.source);
        const timeDiff = Math.abs(facetTime - linkedTime) / (1000 * 60); // Minutes
        
        // Boost based on temporal proximity (closer in time = higher boost)
        const proximityFactor = Math.exp(-timeDiff / 30); // 30-minute half-life
        proximityBoosts.push(1.0 + proximityFactor * 0.5);
      }
    }

    // Apply the maximum proximity boost found
    if (proximityBoosts.length > 0) {
      boost = Math.max(...proximityBoosts);
    }

    // Additional boost for bidirectional links
    if (saliency.linkedTo && saliency.linkedFrom) {
      boost *= 1.2;
    }

    return boost;
  }

  private getFacetTime(facet: Facet): number {
    // In a real implementation, we'd track creation time
    // For now, use current time
    return Date.now();
  }
}
