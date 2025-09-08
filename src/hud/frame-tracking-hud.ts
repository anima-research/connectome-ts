/**
 * Clean HUD implementation that tracks frames for compression
 * Works directly with VEIL primitives, no ContentBlock abstraction
 */

import { Facet, IncomingVEILFrame, OutgoingVEILFrame, VEILOperation } from '../veil/types';
import { CompressibleHUD, RenderedContext, HUDConfig } from './types-v2';
import { CompressionEngine, RenderedFrame } from '../compression/types-v2';

// Union type for frames
type VEILFrame = IncomingVEILFrame | OutgoingVEILFrame;

export class FrameTrackingHUD implements CompressibleHUD {
  
  render(
    frames: VEILFrame[],
    currentFacets: Map<string, Facet>,
    compression?: CompressionEngine,
    config: HUDConfig = {}
  ): RenderedContext {
    const { context } = this.renderWithFrameTracking(
      frames,
      currentFacets,
      compression,
      config
    );
    return context;
  }
  
  renderWithFrameTracking(
    frames: VEILFrame[],
    currentFacets: Map<string, Facet>,
    compression?: CompressionEngine,
    config: HUDConfig = {}
  ): {
    context: RenderedContext;
    frameRenderings: RenderedFrame[];
  } {
    const frameRenderings: RenderedFrame[] = [];
    const renderedParts: string[] = [];
    let totalTokens = 0;
    
    // Render each frame
    for (const frame of frames) {
      // Check if this frame is compressed
      if (compression?.shouldReplaceFrame(frame.sequence)) {
        const replacement = compression.getReplacement(frame.sequence);
        if (replacement !== null) {
          // Add replacement even if it's empty string (for compressed frames)
          if (replacement) {
            renderedParts.push(replacement);
            totalTokens += this.estimateTokens(replacement);
          }
          continue;
        }
      }
      
      // Render frame normally
      const { content, facetIds } = this.renderFrame(frame, currentFacets);
      const tokens = this.estimateTokens(content);
      
      frameRenderings.push({
        frameSequence: frame.sequence,
        content,
        tokens,
        facetIds
      });
      
      // Check token budget
      if (config.maxTokens && totalTokens + tokens > config.maxTokens) {
        break;
      }
      
      // Only add non-empty content
      if (content.trim()) {
        renderedParts.push(content);
        totalTokens += tokens;
      }
    }
    
    // Apply floating ambient facets
    const ambientFacets = this.getAmbientFacets(currentFacets);
    const partsWithAmbient = this.insertFloatingAmbient(renderedParts, ambientFacets);
    
    // Render current state (non-ambient facets that persist)
    const stateContent = this.renderCurrentState(currentFacets, config);
    if (stateContent) {
      partsWithAmbient.push(stateContent);
      totalTokens += this.estimateTokens(stateContent);
    }
    
    // Build final context
    const messages = this.buildMessages(partsWithAmbient.join('\n\n'), config);
    
    return {
      context: {
        messages,
        metadata: {
          totalTokens,
          renderedFrames: frameRenderings
        }
      },
      frameRenderings
    };
  }
  
  private renderFrame(
    frame: VEILFrame,
    currentFacets: Map<string, Facet>
  ): { content: string; facetIds: string[] } {
    const parts: string[] = [];
    const facetIds: string[] = [];
    
    // Separate handling for incoming vs outgoing frames
    if (this.isIncomingFrame(frame)) {
      const content = this.renderIncomingFrame(frame as IncomingVEILFrame, currentFacets);
      return { content, facetIds: this.extractFacetIds(frame) };
    } else {
      const content = this.renderOutgoingFrame(frame as OutgoingVEILFrame);
      return { content, facetIds: [] };
    }
  }
  
  private isIncomingFrame(frame: VEILFrame): boolean {
    // Check if frame has any incoming operations
    const incomingOps = ['addFacet', 'changeState', 'addStream', 'updateStream', 'deleteStream', 'addScope', 'deleteScope', 'agentActivation'];
    const outgoingOps = ['speak', 'toolCall', 'innerThoughts', 'cycleRequest'];
    
    // Check for any incoming operations
    return frame.operations.some((op: any) => 
      incomingOps.includes(op.type) || 'facet' in op
    );
  }
  
  private renderIncomingFrame(
    frame: IncomingVEILFrame,
    currentFacets: Map<string, Facet>
  ): string {
    const parts: string[] = [];
    
    for (const operation of frame.operations) {
      switch (operation.type) {
        case 'addFacet':
          if ('facet' in operation) {
            // Render events and states when they're added (to show initial values)
            // Skip ambient facets - they use floating behavior
            if (operation.facet.type === 'event' || operation.facet.type === 'state') {
              const rendered = this.renderFacet(operation.facet);
              if (rendered) parts.push(rendered);
            }
          }
          break;
          
        case 'changeState':
          // Render the updated state
          const facet = currentFacets.get(operation.facetId);
          if (facet) {
            const rendered = this.renderFacet(facet);
            if (rendered) parts.push(rendered);
          }
          break;
          
        // Handle other operations as needed
      }
    }
    
    return parts.join('\n');
  }
  
  private renderOutgoingFrame(frame: OutgoingVEILFrame): string {
    const parts: string[] = [];
    
    for (const operation of frame.operations) {
      switch (operation.type) {
        case 'speak':
          if ('content' in operation) {
            parts.push(operation.content);
          }
          break;
          
        case 'toolCall':
          if ('toolName' in operation) {
            parts.push(this.renderToolCall(
              operation.toolName,
              operation.parameters
            ));
          }
          break;
          
        case 'innerThoughts':
          if ('content' in operation) {
            parts.push(`<thought>${operation.content}</thought>`);
          }
          break;
      }
    }
    
    // Wrap agent operations in turn marker
    if (parts.length > 0) {
      return `<my_turn>\n\n${parts.join('\n\n')}\n\n</my_turn>`;
    }
    
    return '';
  }
  
  private renderFacet(facet: Facet): string | null {
    // Skip tool facets and empty facets
    if (facet.type === 'tool') return null;
    if (!facet.content && (!facet.children || facet.children.length === 0)) {
      return null;
    }
    
    // Use displayName as tag if available
    if (facet.displayName) {
      const tag = this.sanitizeTagName(facet.displayName);
      return `<${tag}>${facet.content || ''}</${tag}>`;
    }
    
    // No tag for facets without displayName
    return facet.content || null;
  }
  
  private renderToolCall(toolName: string, parameters: any): string {
    const parts = [`<tool_call name="${toolName}">`];
    
    for (const [key, value] of Object.entries(parameters)) {
      parts.push(`<parameter name="${key}">${this.escapeXml(String(value))}</parameter>`);
    }
    
    parts.push('</tool_call>');
    return parts.join('\n');
  }
  
  private renderCurrentState(
    facets: Map<string, Facet>,
    config: HUDConfig
  ): string | null {
    const stateParts: string[] = [];
    
    // Render only state facets - ambient facets are handled separately with floating behavior
    for (const [id, facet] of facets) {
      if (facet.type === 'state') {
        const rendered = this.renderFacet(facet);
        if (rendered) stateParts.push(rendered);
      }
    }
    
    return stateParts.length > 0 ? stateParts.join('\n\n') : null;
  }
  
  private buildMessages(content: string, config: HUDConfig): RenderedContext['messages'] {
    const messages: RenderedContext['messages'] = [];
    
    if (config.systemPrompt) {
      messages.push({
        role: 'system',
        content: config.systemPrompt
      });
    }
    
    // Note: User prompts should be added by the calling context
    // This HUD only manages the assistant's rendered context
    
    messages.push({
      role: 'assistant',
      content: content
    });
    
    return messages;
  }
  
  private getAmbientFacets(facets: Map<string, Facet>): Array<[string, Facet]> {
    const ambient: Array<[string, Facet]> = [];
    for (const [id, facet] of facets) {
      if (facet.type === 'ambient') {
        ambient.push([id, facet]);
      }
    }
    return ambient;
  }
  
  private insertFloatingAmbient(
    renderedParts: string[],
    ambientFacets: Array<[string, Facet]>,
    preferredDepth: number = 5
  ): string[] {
    if (ambientFacets.length === 0 || renderedParts.length === 0) {
      return renderedParts;
    }
    
    // Calculate insertion position for floating ambient
    const insertPosition = Math.max(0, renderedParts.length - preferredDepth);
    
    // Create a new array with ambient facets inserted
    const result = [...renderedParts];
    const ambientContent: string[] = [];
    
    for (const [id, facet] of ambientFacets) {
      const rendered = this.renderFacet(facet);
      if (rendered) ambientContent.push(rendered);
    }
    
    if (ambientContent.length > 0) {
      result.splice(insertPosition, 0, ambientContent.join('\n\n'));
    }
    
    return result;
  }
  
  private extractFacetIds(frame: VEILFrame): string[] {
    const ids: string[] = [];
    
    for (const op of frame.operations) {
      if ('facet' in op && op.facet) {
        ids.push(op.facet.id);
      } else if ('facetId' in op && op.facetId) {
        ids.push(op.facetId);
      }
    }
    
    return ids;
  }
  
  private sanitizeTagName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  }
  
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  
  estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }
  
  parseCompletion(completion: string): {
    operations: any[];
    hasMoreToSay: boolean;
  } {
    // TODO: Implement parsing
    return {
      operations: [],
      hasMoreToSay: false
    };
  }
  
  needsCompression(frames: VEILFrame[], config: HUDConfig): boolean {
    // Simple check based on frame count or estimated tokens
    return frames.length > 50;
  }
  
  getFormat(): string {
    return 'xml';
  }
}
