import { ContentBlock } from '../compression/types';
import { Facet, ActionFacet } from '../veil/types';
import { 
  FrameAwareHUD, 
  RenderSegment, 
  FrameAwareRenderRequest, 
  FrameAwareRenderResult,
  MemoryFormationRequest 
} from './frame-aware-types';

/**
 * HUD implementation that maintains frame-to-content mappings
 * Enables memory compression with preserved attention hooks
 * Incorporates turn-based rendering from TurnBasedXmlHUD
 */
export class FrameAwareXmlHUD implements FrameAwareHUD {
  
  renderSegments(
    blocks: ContentBlock[],
    request: FrameAwareRenderRequest
  ): FrameAwareRenderResult {
    const segments: RenderSegment[] = [];
    let totalTokens = 0;
    const droppedSegments: RenderSegment[] = [];
    
    // Track frame range
    let minFrame = Infinity;
    let maxFrame = -Infinity;
    
    // Group blocks by frame sequence to create segments
    const blocksByFrame = new Map<number, ContentBlock[]>();
    
    for (const block of blocks) {
      // Frame sequence should come from block metadata
      const frameSeq = block.metadata?.frameSequence || 0;
      
      if (!blocksByFrame.has(frameSeq)) {
        blocksByFrame.set(frameSeq, []);
      }
      blocksByFrame.get(frameSeq)!.push(block);
      
      minFrame = Math.min(minFrame, frameSeq);
      maxFrame = Math.max(maxFrame, frameSeq);
    }
    
    // Sort frames and create segments
    const sortedFrames = Array.from(blocksByFrame.keys()).sort((a, b) => a - b);
    
    for (const frameSeq of sortedFrames) {
      const frameBlocks = blocksByFrame.get(frameSeq)!;
      
      // Render all blocks for this frame into a segment
      const segmentContent = this.renderFrameBlocks(frameBlocks, request.focus);
      const tokens = this.estimateTokens(segmentContent);
      
      // Check token budget
      if (request.maxTokens && totalTokens + tokens > request.maxTokens) {
        // This segment would exceed budget
        droppedSegments.push({
          content: segmentContent,
          sourceFrames: [frameSeq],
          blockIds: frameBlocks.map(b => b.id),
          tokens,
          type: this.inferSegmentType(frameBlocks)
        });
        continue;
      }
      
      segments.push({
        content: segmentContent,
        sourceFrames: [frameSeq],
        blockIds: frameBlocks.map(b => b.id),
        tokens,
        type: this.inferSegmentType(frameBlocks)
      });
      
      totalTokens += tokens;
    }
    
    return {
      segments,
      totalTokens,
      metadata: {
        segmentCount: segments.length,
        frameRange: { 
          min: minFrame === Infinity ? 0 : minFrame, 
          max: maxFrame === -Infinity ? 0 : maxFrame 
        },
        droppedSegments: droppedSegments.length > 0 ? droppedSegments : undefined
      }
    };
  }
  
  private renderFrameBlocks(blocks: ContentBlock[], focus?: string): string {
    // Note: In proper VEIL usage, all blocks in a frame are either agent OR environment,
    // never mixed. But this code handles both cases for robustness.
    const agentBlocks = blocks.filter(b => this.isAgentGenerated(b));
    const envBlocks = blocks.filter(b => !this.isAgentGenerated(b));
    
    const parts: string[] = [];
    
    // Render environment blocks first
    if (envBlocks.length > 0) {
      for (const block of envBlocks) {
        const rendered = this.renderEnvironmentBlock(block);
        if (rendered) {
          parts.push(rendered);
        }
      }
    }
    
    // Then render agent blocks as a turn
    if (agentBlocks.length > 0) {
      const agentTurn = this.renderAgentTurn(agentBlocks);
      if (agentTurn) {
        parts.push(agentTurn);
      }
    }
    
    return parts.join('\n\n');
  }
  
  private renderAgentTurn(blocks: ContentBlock[]): string {
    const parts: string[] = [];
    
    // Render blocks in original order
    for (const block of blocks) {
      if (!block.source) continue;
      
      const facet = block.source;
      let rendered: string | null = null;
      
      switch (facet.type) {
        case 'speech':
          rendered = this.renderSpeech(facet);
          break;
        case 'thought':
          rendered = this.renderThought(facet);
          break;
        case 'action':
          rendered = this.renderAction(facet);
          break;
        default:
          // Handle legacy event facets with agentAction attribute
          const action = facet.attributes?.agentAction;
          if (action === 'speak') {
            rendered = facet.content || '';
          } else if (action === 'innerThoughts') {
            rendered = `<inner_thoughts>\n${facet.content || ''}\n</inner_thoughts>`;
          } else if (action === 'toolCall') {
            rendered = this.renderToolCall(block);
          }
      }
      
      if (rendered) {
        parts.push(rendered);
      }
    }
    
    // Only render my_turn if there's actual content
    if (parts.length === 0) {
      return '';
    }
    
    return `<my_turn>\n\n${parts.join('\n\n')}\n\n</my_turn>`;
  }

  private renderToolCall(block: ContentBlock): string {
    // Legacy format handling
    const attrs = block.source?.attributes as any;
    const toolName = attrs?.toolName || 'unknown';
    const parameters = attrs?.parameters || {};
    
    const parts: string[] = [`<tool_call name="${toolName}">`];
    
    for (const [key, value] of Object.entries(parameters)) {
      parts.push(`<parameter name="${key}">${this.escapeXml(String(value))}</parameter>`);
    }
    
    parts.push('</tool_call>');
    return parts.join('\n');
  }

  private renderEnvironmentBlock(block: ContentBlock): string | null {
    if (!block.source) return null;
    
    const facet = block.source;
    
    // Skip facets with no content AND no children
    if (!facet.content && (!facet.children || facet.children.length === 0)) {
      return null;
    }
    
          switch (facet.type) {
        case 'event':
          return this.renderEvent(facet);
        case 'state':
          return this.renderState(facet);
        case 'ambient':
          return this.renderAmbient(facet);
        case 'speech':
          return this.renderSpeech(facet);
        case 'thought':
          return this.renderThought(facet);
        case 'action':
          return this.renderAction(facet);
              case 'tool':
        return null; // Tools don't render
      default:
        return (facet as any).content || null;
      }
  }

  private renderEvent(facet: Facet): string {
    // If no displayName, just return the content
    if (!facet.displayName) {
      return facet.content || '';
    }
    
    const attrs = facet.attributes || {};
    
    // Filter attributes for rendering
    const attrStr = Object.entries(attrs)
      .filter(([k]) => k !== 'agentGenerated' && k !== 'agentAction')
      .filter(([k, v]) => typeof v !== 'object') // Skip complex objects
      .map(([k, v]) => `${k}="${this.escapeXml(String(v))}"`)
      .join(' ');
    
    const tagName = this.sanitizeTagName(facet.displayName);
    return `<${tagName}${attrStr ? ' ' + attrStr : ''}>\n${facet.content}\n</${tagName}>`;
  }

  private renderState(facet: Facet): string {
    // Build content parts
    const parts: string[] = [];
    if (facet.content) {
      parts.push(facet.content);
    }
    
    // Render children if any
    if (facet.children && facet.children.length > 0) {
      for (const child of facet.children) {
        const childContent = this.renderChildFacet(child);
        if (childContent) {
          parts.push(childContent);
        }
      }
    }
    
    const content = parts.join('\n');
    
    // If no displayName, just return the content
    if (!facet.displayName) {
      return content;
    }
    
    const tagName = this.sanitizeTagName(facet.displayName);
    const attrs = facet.attributes || {};
    
    // Filter out internal attributes
    const renderableAttrs = Object.entries(attrs)
      .filter(([k]) => k !== 'agentGenerated' && k !== 'agentAction')
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {} as Record<string, any>);
    
    const attrStr = Object.entries(renderableAttrs)
      .map(([k, v]) => `${k}="${this.escapeXml(String(v))}"`)
      .join(' ');
    
    return `<${tagName}${attrStr ? ' ' + attrStr : ''}>\n${content}\n</${tagName}>`;
  }

  private renderChildFacet(facet: Facet): string | null {
    switch (facet.type) {
      case 'event':
        return this.renderEvent(facet);
      case 'state':
        return facet.content || null;
      case 'ambient':
        return this.renderAmbient(facet);
      case 'speech':
        return this.renderSpeech(facet);
      case 'thought':
        return this.renderThought(facet);
      case 'action':
        return this.renderAction(facet);
      case 'tool':
        return null;
      default:
        return (facet as any).content || null;
    }
  }

  private renderAmbient(facet: Facet): string {
    const scope = facet.scope?.join(',') || '';
    return `<ambient scope="${scope}">\n${facet.content}\n</ambient>`;
  }

  private renderSpeech(facet: Facet): string {
    // Speech renders as plain text when from agent
    if (facet.attributes?.agentGenerated) {
      return facet.content || '';
    }
    // Environment speech might have a displayName
    if (facet.displayName) {
      return `<${this.sanitizeTagName(facet.displayName)}>\n${facet.content}\n</${this.sanitizeTagName(facet.displayName)}>`;
    }
    return facet.content || '';
  }

  private renderThought(facet: Facet): string {
    return `<inner_thoughts>\n${facet.content || ''}\n</inner_thoughts>`;
  }

  private renderAction(facet: Facet): string {
    if (facet.type !== 'action') {
      return facet.content || '';
    }
    
    const actionFacet = facet as ActionFacet;
    const toolName = actionFacet.attributes.toolName || actionFacet.displayName || 'unknown';
    const parameters = actionFacet.attributes.parameters || {};
    
    const parts: string[] = [`<tool_call name="${toolName}">`];
    
    for (const [key, value] of Object.entries(parameters)) {
      parts.push(`<parameter name="${key}">${this.escapeXml(String(value))}</parameter>`);
    }
    
    parts.push('</tool_call>');
    return parts.join('\n');
  }

  private sanitizeTagName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/^[0-9]/, '_$&');
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private renderAttributes(attrs?: Record<string, any>): string {
    if (!attrs) return '';
    
    const filtered = Object.entries(attrs)
      .filter(([k, v]) => !['agentGenerated', 'agentAction'].includes(k))
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    
    return filtered ? ' ' + filtered : '';
  }
  
  private inferSegmentType(blocks: ContentBlock[]): RenderSegment['type'] {
    // If any block is a memory, the segment is a memory
    if (blocks.some(b => b.type !== 'facet')) {
      return 'memory';
    }
    
    // Otherwise, use the most common facet type
    const types = blocks
      .map(b => b.source?.type)
      .filter(Boolean) as string[];
    
    if (types.includes('event')) return 'event';
    if (types.includes('state')) return 'state';
    if (types.includes('ambient')) return 'ambient';
    
    return 'meta';
  }
  
  concatenateSegments(
    segments: RenderSegment[],
    systemPrompt?: string,
    memoryFormationMarker?: { afterSegmentIndex: number }
  ): string {
    const parts: string[] = [];
    
    if (systemPrompt) {
      parts.push(`<system>${systemPrompt}</system>`);
      parts.push('');
    }
    
    parts.push('<context>');
    
    // Join segments with appropriate spacing
    for (let i = 0; i < segments.length; i++) {
      if (i > 0) {
        // Add spacing between segments
        parts.push('');
      }
      
      parts.push(segments[i].content);
      
      // Insert memory formation marker if requested
      if (memoryFormationMarker && i === memoryFormationMarker.afterSegmentIndex) {
        const nextFrame = segments[i + 1]?.sourceFrames[0];
        parts.push(`\n<memory_formation_boundary next_frame="${nextFrame || 'end'}" />\n`);
      }
    }
    
    parts.push('');
    parts.push('</context>');
    
    return parts.join('\n');
  }
  
  prepareMemoryFormation(
    renderResult: FrameAwareRenderResult,
    agentResponse: string,
    chunkThresholdTokens: number
  ): MemoryFormationRequest | null {
    // Find continuous segments that exceed the chunk threshold
    let currentChunkTokens = 0;
    let chunkStart = 0;
    
    for (let i = 0; i < renderResult.segments.length; i++) {
      const segment = renderResult.segments[i];
      currentChunkTokens += segment.tokens || 0;
      
      if (currentChunkTokens >= chunkThresholdTokens) {
        // Found a chunk that needs compression
        const compressSegments = renderResult.segments.slice(chunkStart, i + 1);
        const minFrame = Math.min(...compressSegments.flatMap(s => s.sourceFrames));
        const maxFrame = Math.max(...compressSegments.flatMap(s => s.sourceFrames));
        
        return {
          segments: compressSegments,
          renderedContext: this.concatenateSegments(renderResult.segments),
          agentResponse,
          compressFrameRange: {
            from: minFrame,
            to: maxFrame
          },
          metadata: {
            turnSequence: Date.now(), // Should come from VEIL state
            timestamp: new Date().toISOString(),
            focus: undefined, // Should come from request
            totalTokens: renderResult.totalTokens
          }
        };
      }
    }
    
    return null;
  }
  
  private estimateTokens(content: string): number {
    // Simple estimation: ~4 characters per token
    return Math.ceil(content.length / 4);
  }
  
  private isAgentGenerated(block: ContentBlock): boolean {
    if (!block.source) return false;
    
    // New facet types that are always agent-generated
    if (['speech', 'thought', 'action'].includes(block.source.type)) {
      return block.source.attributes?.agentGenerated === true;
    }
    
    // Legacy check for event facets
    return block.source?.attributes?.agentGenerated === true;
  }
}
