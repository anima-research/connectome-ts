/**
 * Clean HUD implementation that tracks frames for compression
 * Works directly with VEIL primitives, no ContentBlock abstraction
 */

import { Facet, IncomingVEILFrame, OutgoingVEILFrame, VEILOperation } from '../veil/types';
import { CompressibleHUD, RenderedContext, HUDConfig } from './types-v2';
import { CompressionEngine, RenderedFrame, StateDelta } from '../compression/types-v2';

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
    const frameContents: Array<{ 
      type: 'incoming' | 'outgoing' | 'compressed';
      content: string;
      sequence: number;
    }> = [];
    let totalTokens = 0;
    
    // Note on token budget: We currently include ALL frames even if we exceed the budget.
    // Dropping frames (whether old or new) is problematic:
    // - Dropping old frames loses important context and setup
    // - Dropping new frames (the previous behavior) causes amnesia about recent messages
    // If frame dropping becomes necessary, it should be done intelligently (e.g., using
    // compression, importance scoring, or keeping a sliding window of recent + important frames).
    
    // Debug: Log frame sequences being rendered
    if ((config as any).name === 'interactive-explorer') {
      console.log('[HUD] Rendering frames:', frames.map(f => f.sequence).join(', '));
    }
    
    // Track state as we replay operations - start with empty state
    const replayedState = new Map<string, Facet>();
    
    // Render each frame
    for (const frame of frames) {
      // Check if this frame is compressed
      if (compression?.shouldReplaceFrame(frame.sequence)) {
        const replacement = compression.getReplacement(frame.sequence);
        if (replacement !== null) {
          // Apply state delta if present
          const stateDelta = compression.getStateDelta(frame.sequence);
          if (stateDelta) {
            this.applyStateDelta(stateDelta, replayedState);
          }
          
          // Add replacement even if it's empty string (for compressed frames)
          if (replacement) {
            frameContents.push({
              type: 'compressed',
              content: replacement,
              sequence: frame.sequence
            });
            totalTokens += this.estimateTokens(replacement);
          }
          continue;
        }
      }
      
      // Update replayed state if this is an incoming frame
      if (this.isIncomingFrame(frame)) {
        this.updateReplayedState(frame as IncomingVEILFrame, replayedState);
      }
      
      // Render frame with the state as it was at this point in time
      const { content, facetIds } = this.renderFrame(frame, replayedState);
      const tokens = this.estimateTokens(content);
      
      // Debug: Log frames with no content
      if ((config as any).name === 'interactive-explorer' && !content.trim()) {
        console.log(`[HUD] Frame ${frame.sequence} has no content. Operations:`, frame.operations.map(op => op.type));
      }
      
      frameRenderings.push({
        frameSequence: frame.sequence,
        content,
        tokens,
        facetIds
      });
      
      // Only add non-empty content
      if (content.trim()) {
        // Debug log frame content
        if ((config as any).name === 'interactive-explorer') {
          console.log(`[HUD] Frame ${frame.sequence} (${this.isIncomingFrame(frame) ? 'incoming' : 'outgoing'}):`, content.slice(0, 100) + '...');
        }
        frameContents.push({
          type: this.isIncomingFrame(frame) ? 'incoming' : 'outgoing',
          content,
          sequence: frame.sequence
        });
        totalTokens += tokens;
      }
    }
    
    // Check if we exceeded token budget (but don't drop frames)
    if (config.maxTokens && totalTokens > config.maxTokens) {
      console.warn(`[HUD] Token budget exceeded: ${totalTokens} > ${config.maxTokens}.`);
      console.warn(`[HUD] Including all ${frameContents.length} frames to preserve conversation coherence.`);
      console.warn(`[HUD] Consider increasing contextTokenBudget in AgentConfig.`);
    }
    
    // Build messages directly from frame contents
    const messages = this.buildFrameBasedMessages(frameContents, currentFacets, config);
    
    // Calculate total tokens from messages
    totalTokens = messages.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0);
    
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
    replayedState: Map<string, Facet>
  ): { content: string; facetIds: string[] } {
    const parts: string[] = [];
    const facetIds: string[] = [];
    
    // Separate handling for incoming vs outgoing frames
    if (this.isIncomingFrame(frame)) {
      const content = this.renderIncomingFrame(frame as IncomingVEILFrame, replayedState);
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
    replayedState: Map<string, Facet>
  ): string {
    const parts: string[] = [];
    const renderedStates = new Map<string, string>(); // Track rendered states by facet ID
    
    // First pass: collect all state operations in this frame
    for (const operation of frame.operations) {
      switch (operation.type) {
        case 'addFacet':
          if ('facet' in operation && operation.facet.type === 'state') {
            // Store the initial state rendering
            const rendered = this.renderFacet(operation.facet);
            if (rendered) {
              renderedStates.set(operation.facet.id, rendered);
            }
          }
          break;
          
        case 'changeState':
          if ('updates' in operation && operation.updates) {
            const currentFacet = replayedState.get(operation.facetId);
            if (currentFacet && currentFacet.type === 'state') {
              const updatedFacet = {
                ...currentFacet,
                ...operation.updates,
                attributes: {
                  ...currentFacet.attributes,
                  ...(operation.updates.attributes || {})
                }
              };
              const rendered = this.renderFacet(updatedFacet);
              if (rendered) {
                // Override any previous rendering of this state in this frame
                renderedStates.set(operation.facetId, rendered);
              }
            }
          }
          break;
      }
    }
    
    // Second pass: render everything in order, using final states
    for (const operation of frame.operations) {
      switch (operation.type) {
        case 'addFacet':
          if ('facet' in operation) {
            if (operation.facet.type === 'event') {
              // Events are always rendered
              const rendered = this.renderFacet(operation.facet);
              if (rendered) parts.push(rendered);
            } else if (operation.facet.type === 'state') {
              // For states, use the final version from renderedStates
              const finalRendering = renderedStates.get(operation.facet.id);
              if (finalRendering) {
                parts.push(finalRendering);
                // Remove from map so we don't render it again
                renderedStates.delete(operation.facet.id);
              }
            }
          }
          break;
          
        case 'changeState':
          // Check if we haven't already rendered this state
          const finalRendering = renderedStates.get(operation.facetId);
          if (finalRendering) {
            parts.push(finalRendering);
            // Remove from map so we don't render it again
            renderedStates.delete(operation.facetId);
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
          
        case 'action':
          if ('path' in operation && Array.isArray(operation.path)) {
            parts.push(this.renderAction(operation));
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
  
  private renderAction(action: any): string {
    // Render as the original @path syntax (e.g., @chat.general.say)
    const actionPath = action.path.join('.');
    
    if (action.parameters && Object.keys(action.parameters).length > 0) {
      const params = action.parameters;
      // Check if it's a simple single value parameter
      if (Object.keys(params).length === 1 && params.value !== undefined) {
        return `@${actionPath}("${params.value}")`;
      } else {
        // Multi-parameter, render as block
        const paramLines = Object.entries(params).map(([key, value]) => 
          `  ${key}: ${value}`
        ).join('\n');
        return `@${actionPath} {\n${paramLines}\n}`;
      }
    } else {
      // No parameters
      return `@${actionPath}`;
    }
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
  
  private buildFrameBasedMessages(
    frameContents: Array<{ type: 'incoming' | 'outgoing' | 'compressed'; content: string; sequence: number }>,
    currentFacets: Map<string, Facet>,
    config: HUDConfig
  ): RenderedContext['messages'] {
    const messages: RenderedContext['messages'] = [];
    
    // Each frame becomes its own message
    for (const frame of frameContents) {
      // Compressed frames are treated as assistant messages
      const role = frame.type === 'incoming' ? 'user' : 'assistant';
      
      messages.push({
        role,
        content: frame.content
      });
    }
    
    // Add floating ambient and state content as system context
    const ambientFacets = this.getAmbientFacets(currentFacets);
    const ambientContent: string[] = [];
    
    for (const [id, facet] of ambientFacets) {
      const rendered = this.renderFacet(facet);
      if (rendered) ambientContent.push(rendered);
    }
    
    // Don't add state content here - states are only rendered in frames where they're added or changed
    const contextParts = [...ambientContent];
    
    // Add pending activations info if present
    if (config.metadata?.pendingActivations) {
      const { count, sources } = config.metadata.pendingActivations;
      const pendingInfo = `<pending_activations>\nThere are ${count} pending activation(s) from: ${sources.join(', ')}\n</pending_activations>`;
      contextParts.push(pendingInfo);
    }
    
    if (contextParts.length > 0) {
      // Add context to the last user message or create a new one
      const contextContent = contextParts.join('\n\n');
      const lastMessage = messages[messages.length - 1];
      
      if (lastMessage && lastMessage.role === 'user') {
        // Append to last user message
        lastMessage.content = `${lastMessage.content}\n\n${contextContent}`;
      } else {
        // Create a new user message with context
        messages.push({
          role: 'user',
          content: contextContent
        });
      }
    }
    
    // Apply format config for prefill
    if (config.formatConfig?.assistant?.prefix) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        // Add prefix to existing assistant message
        lastMessage.content = config.formatConfig.assistant.prefix + lastMessage.content;
      } else {
        // Add new assistant message with just the prefix for prefill
        messages.push({
          role: 'assistant',
          content: config.formatConfig.assistant.prefix
        });
      }
    }
    
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
  
  private updateReplayedState(frame: IncomingVEILFrame, replayedState: Map<string, Facet>): void {
    for (const operation of frame.operations) {
      switch (operation.type) {
        case 'addFacet':
          if ('facet' in operation && operation.facet) {
            replayedState.set(operation.facet.id, operation.facet);
          }
          break;
          
        case 'changeState':
          if ('facetId' in operation && 'updates' in operation) {
            const existingFacet = replayedState.get(operation.facetId);
            if (existingFacet && existingFacet.type === 'state') {
              // Apply the updates to create the new state
              const updatedFacet = {
                ...existingFacet,
                ...operation.updates,
                attributes: {
                  ...existingFacet.attributes,
                  ...(operation.updates.attributes || {})
                }
              };
              replayedState.set(operation.facetId, updatedFacet);
            }
          }
          break;
          
        // Could handle deleteScope operations here to remove associated facets
        // but for now we'll keep it simple
      }
    }
  }
  
  private applyStateDelta(delta: StateDelta, replayedState: Map<string, Facet>): void {
    // Handle deletions first
    for (const deletedId of delta.deleted) {
      replayedState.delete(deletedId);
    }
    
    // Apply changes to existing facets
    for (const [facetId, changes] of delta.changes) {
      const existing = replayedState.get(facetId);
      if (existing) {
        // Merge changes into existing facet
        const updated = {
          ...existing,
          ...changes,
          attributes: {
            ...existing.attributes,
            ...(changes.attributes || {})
          }
        };
        replayedState.set(facetId, updated as Facet);
      }
    }
    
    // Note: New facets in delta.added would need full facet data,
    // which would be included in delta.changes with their full state
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
