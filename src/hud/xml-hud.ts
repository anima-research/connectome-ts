import { 
  HUD, 
  HUDConfig, 
  RenderedContext, 
  ParsedCompletion,
  ExtractedToolCall 
} from './types';
import { ContentBlock } from '../compression/types';
import { OutgoingVEILOperation } from '../veil/types';

/**
 * XML-based HUD that renders facets as XML elements
 */
export class XmlHUD implements HUD {
  getFormat(): string {
    return 'xml';
  }

  render(
    blocks: ContentBlock[],
    config: HUDConfig,
    focus?: string
  ): RenderedContext {
    const systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
    const userPrompt = config.userPrompt || '<cmd>cat log.txt</cmd>';
    
    // Build the main content from blocks
    const mainContent = this.renderBlocks(blocks);
    
    // Create prefill if requested
    let prefill = '';
    if (config.prefillFormat) {
      prefill = '<my_turn>';
    }

    // Build messages
    const messages = [
      { role: 'user' as const, content: userPrompt },
      { role: 'assistant' as const, content: mainContent }
    ];

    return {
      system: systemPrompt,
      messages,
      prefill,
      metadata: {
        blockCount: blocks.length,
        tokenCount: this.estimateTokens(mainContent),
        focus
      }
    };
  }

  parseCompletion(completion: string): ParsedCompletion {
    const operations: OutgoingVEILOperation[] = [];
    
    // Extract inner thoughts
    const innerThoughtsMatches = completion.matchAll(/<inner_thoughts>([\s\S]*?)<\/inner_thoughts>/g);
    for (const match of innerThoughtsMatches) {
      operations.push({
        type: 'innerThoughts',
        content: match[1].trim()
      });
    }

    // Extract tool calls
    const toolCallMatches = completion.matchAll(/<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call>/g);
    for (const match of toolCallMatches) {
      const toolName = match[1];
      const paramsXml = match[2];
      const parameters = this.parseToolParameters(paramsXml);
      
      operations.push({
        type: 'toolCall',
        toolName,
        parameters
      });
    }

    // Extract speak operations (everything not in special tags within my_turn)
    const myTurnMatch = completion.match(/<my_turn>([\s\S]*?)(?:<\/my_turn>|$)/);
    if (myTurnMatch) {
      const turnContent = myTurnMatch[1];
      
      // Remove special tags to get just the spoken content
      const spoken = turnContent
        .replace(/<inner_thoughts>[\s\S]*?<\/inner_thoughts>/g, '')
        .replace(/<tool_call[\s\S]*?<\/tool_call>/g, '')
        .trim();
      
      // Split into paragraphs/sentences for separate speak operations
      const speakChunks = spoken
        .split(/\n\n+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
      
      for (const chunk of speakChunks) {
        operations.push({
          type: 'speak',
          content: chunk
        });
      }
    }

    // Check for cycle request
    const cycleRequests = Array.from(
      completion.matchAll(/<tool_call\s+name="request_cycle">([\s\S]*?)<\/tool_call>/g)
    );
    
    for (const match of cycleRequests) {
      const params = this.parseToolParameters(match[1]);
      operations.push({
        type: 'cycleRequest',
        reason: params.reason as string,
        delayMs: params.delay_ms ? parseInt(params.delay_ms as string) : undefined
      });
    }

    // Determine if agent has more to say (unclosed my_turn tag)
    const hasMoreToSay = completion.includes('<my_turn>') && !completion.includes('</my_turn>');

    return {
      content: completion,
      operations,
      hasMoreToSay
    };
  }

  private renderBlocks(blocks: ContentBlock[]): string {
    const parts: string[] = [];

    for (const block of blocks) {
      if (block.type === 'facet' && block.source) {
        const rendered = this.renderFacet(block);
        if (rendered) {
          parts.push(rendered);
        }
      } else {
        // Non-facet blocks (summaries, narratives) render as-is
        parts.push(block.content);
      }
    }

    return parts.join('\n\n');
  }

  private renderFacet(block: ContentBlock): string | null {
    const facet = block.source;
    if (!facet || !facet.content) return null;

    const metadata = block.metadata || {};
    const facetType = metadata.facetType || facet.type;
    const attributes = metadata.attributes || {};

    switch (facetType) {
      case 'event':
        // Special handling for agent-generated tool calls
        if (attributes.agentGenerated && attributes.agentAction === 'toolCall') {
          return `<tool_call name="${attributes.toolName || 'unknown'}">\n${facet.content}\n</tool_call>`;
        }
        return this.renderEvent(facet.content, attributes, facet.displayName);
      
      case 'state':
        return this.renderState(facet.content, attributes, facet.displayName);
      
      case 'ambient':
        // Skip private agent thoughts
        if (attributes.agentGenerated && attributes.private) {
          return null;
        }
        return this.renderAmbient(facet.content, facet.scope);
      
      default:
        return facet.content;
    }
  }

  private renderEvent(content: string, attributes: Record<string, any>, displayName?: string): string {
    // If no displayName, just return the content
    if (!displayName) {
      return content;
    }
    
    const tagName = this.sanitizeTagName(displayName);
    const attrStr = this.renderAttributes(attributes);
    return `<${tagName}${attrStr}>\n${content}\n</${tagName}>`;
  }

  private renderState(content: string, attributes: Record<string, any>, displayName?: string): string {
    // If no displayName, just return the content
    if (!displayName) {
      return content;
    }
    
    const tagName = this.sanitizeTagName(displayName);
    const attrStr = this.renderAttributes(attributes);
    return `<${tagName}${attrStr}>\n${content}\n</${tagName}>`;
  }

  private renderAmbient(content: string, scope?: string[]): string {
    const scopeAttr = scope ? ` scope="${scope.join(',')}"` : '';
    return `<ambient${scopeAttr}>\n${content}\n</ambient>`;
  }

  private renderAttributes(attributes: Record<string, any>): string {
    const parts: string[] = [];
    
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined && value !== null) {
        parts.push(`${key}="${this.escapeXml(String(value))}"`);
      }
    }

    return parts.length > 0 ? ' ' + parts.join(' ') : '';
  }

  private parseToolParameters(xml: string): Record<string, any> {
    const params: Record<string, any> = {};
    
    // Simple XML parameter parsing
    const paramMatches = xml.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g);
    for (const match of paramMatches) {
      const key = match[1];
      const value = match[2].trim();
      params[key] = value;
    }

    return params;
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

  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  private getDefaultSystemPrompt(): string {
    return `You are an autonomous agent with the ability to perceive your environment and take actions through tools. You communicate naturally while processing information from various sources.

Your responses are formatted in XML. Use <my_turn> tags to indicate your response. Within your turn:
- Use <inner_thoughts> for private reasoning
- Use <tool_call name="..."> for invoking tools
- Regular text is your speech/communication

Focus on the current context and respond appropriately.`;
  }
}
