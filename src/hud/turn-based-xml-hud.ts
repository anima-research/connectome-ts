import { 
  HUD, 
  HUDConfig, 
  RenderedContext, 
  ParsedCompletion,
  ExtractedToolCall 
} from './types';
import { ContentBlock } from '../compression/types';
import { OutgoingVEILOperation, Facet, ActionFacet } from '../veil/types';

interface Turn {
  isAgent: boolean;
  blocks: ContentBlock[];
}

/**
 * Turn-based XML HUD that groups agent actions into <my_turn> blocks
 */
export class TurnBasedXmlHUD implements HUD {
  render(
    blocks: ContentBlock[],
    config: HUDConfig,
    focus?: string
  ): RenderedContext {
    const systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
    const userPrompt = config.userPrompt || '<cmd>cat log.txt</cmd>';
    
    // Group blocks into turns
    const turns = this.groupIntoTurns(blocks);
    
    // Render turns
    const mainContent = this.renderTurns(turns);
    
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

  private groupIntoTurns(blocks: ContentBlock[]): Turn[] {
    const turns: Turn[] = [];
    let currentAgentTurn: ContentBlock[] = [];
    
    for (const block of blocks) {
      const isAgentBlock = this.isAgentGenerated(block);
      
      if (isAgentBlock) {
        // Add to current agent turn
        currentAgentTurn.push(block);
      } else {
        // If we have accumulated agent blocks, create a turn
        if (currentAgentTurn.length > 0) {
          turns.push({ isAgent: true, blocks: currentAgentTurn });
          currentAgentTurn = [];
        }
        // Add environment block as its own turn
        turns.push({ isAgent: false, blocks: [block] });
      }
    }
    
    // Don't forget the last agent turn if any
    if (currentAgentTurn.length > 0) {
      turns.push({ isAgent: true, blocks: currentAgentTurn });
    }
    
    return turns;
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

  private renderTurns(turns: Turn[]): string {
    const parts: string[] = [];
    
    for (const turn of turns) {
      if (turn.isAgent) {
        parts.push(this.renderAgentTurn(turn.blocks));
      } else {
        // Environment blocks render individually
        for (const block of turn.blocks) {
          const rendered = this.renderEnvironmentBlock(block);
          if (rendered) {
            parts.push(rendered);
          }
        }
      }
    }
    
    return parts.join('\n\n');
  }

  private renderAgentTurn(blocks: ContentBlock[]): string {
    const parts: string[] = ['<my_turn>'];
    
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
    
    parts.push('</my_turn>');
    return parts.join('\n\n');
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

  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  private getDefaultSystemPrompt(): string {
    return 'You are an AI assistant in a CLI simulation environment.';
  }

  getFormat(): string {
    return 'turn-based-xml';
  }

  parseCompletion(completion: string): ParsedCompletion {
    const operations: OutgoingVEILOperation[] = [];
    let hasMoreToSay = false;
    
    // Extract tool calls
    const toolCallRegex = /<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call>/g;
    let match;
    
    while ((match = toolCallRegex.exec(completion)) !== null) {
      const [, toolName, paramsXml] = match;
      const parameters: Record<string, any> = {};
      
      // Parse parameters
      const paramRegex = /<parameter\s+name="([^"]+)">([^<]+)<\/parameter>/g;
      let paramMatch;
      
      while ((paramMatch = paramRegex.exec(paramsXml)) !== null) {
        const [, paramName, paramValue] = paramMatch;
        parameters[paramName] = this.unescapeXml(paramValue);
      }
      
      operations.push({
        type: 'toolCall',
        toolName,
        parameters
      });
    }

    // Extract inner thoughts
    const thoughtRegex = /<inner_thoughts>([\s\S]*?)<\/inner_thoughts>/g;
    while ((match = thoughtRegex.exec(completion)) !== null) {
      operations.push({
        type: 'innerThoughts',
        content: this.unescapeXml(match[1].trim())
      });
    }

    // Extract speech (everything not in tool calls or inner thoughts)
    let speechContent = completion;
    speechContent = speechContent.replace(toolCallRegex, '');
    speechContent = speechContent.replace(thoughtRegex, '');
    speechContent = speechContent.trim();
    
    if (speechContent) {
      // Split by paragraphs but keep as single speak operation
      operations.push({
        type: 'speak',
        content: speechContent
      });
    }

    // Check for explicit cycle request
    if (completion.includes('<request_cycle>')) {
      hasMoreToSay = true;
    }

    return {
      content: completion,
      operations,
      hasMoreToSay
    };
  }

  private unescapeXml(str: string): string {
    return str
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }
}
