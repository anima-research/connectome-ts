/**
 * Clean HUD implementation that tracks frames for compression
 * Works directly with VEIL primitives, no ContentBlock abstraction
 */

import { Facet, StateFacet, IncomingVEILFrame, OutgoingVEILFrame, VEILOperation } from '../veil/types';
import { CompressibleHUD, RenderedContext, HUDConfig } from './types-v2';
import { CompressionEngine, RenderedFrame, StateDelta } from '../compression/types-v2';
import { getGlobalTracer, TraceCategory } from '../tracing';

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
    const tracer = getGlobalTracer();
    const traceId = `hud-render-${Date.now()}`;
    
    tracer?.record({
      id: traceId,
      timestamp: Date.now(),
      level: 'info',
      category: TraceCategory.HUD_RENDER,
      component: 'FrameTrackingHUD',
      operation: 'renderWithFrameTracking',
      data: {
        frameCount: frames.length,
        currentFacetCount: currentFacets.size,
        config
      }
    });
    
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
    const removals = new Map<string, 'hide' | 'delete'>();
    
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
      
      // For incoming frames, we need both before and after states
      let beforeState: Map<string, Facet> | undefined;
      
      if (this.isIncomingFrame(frame)) {
        // Deep clone the state before updates to detect transitions
        beforeState = new Map();
        for (const [id, facet] of replayedState) {
          // Deep clone the facet including nested objects
          const clonedFacet: any = { ...facet };
          if (facet.attributes && typeof facet.attributes === 'object') {
            clonedFacet.attributes = { ...facet.attributes };
          }
          beforeState.set(id, clonedFacet as Facet);
        }
        this.updateReplayedState(frame as IncomingVEILFrame, replayedState, removals);
      }
      
      // Render frame with both states available
      const { content, facetIds } = this.renderFrame(frame, replayedState, beforeState, removals);
      const tokens = this.estimateTokens(content);
      
      // Trace each frame rendering
      tracer?.record({
        id: `${traceId}-frame-${frame.sequence}`,
        timestamp: Date.now(),
        level: 'debug',
        category: TraceCategory.HUD_RENDER,
        component: 'FrameTrackingHUD',
        operation: 'renderFrame',
        data: {
          frameSequence: frame.sequence,
          frameType: this.isIncomingFrame(frame) ? 'incoming' : 'outgoing',
          operationCount: frame.operations.length,
          operations: frame.operations.map(op => op.type),
          contentLength: content.length,
          contentPreview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
          tokens,
          facetIds,
          isEmpty: !content.trim()
        },
        parentId: traceId
      });
      
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
    replayedState: Map<string, Facet>,
    beforeState?: Map<string, Facet>,
    removals?: Map<string, 'hide' | 'delete'>
  ): { content: string; facetIds: string[] } {
    const parts: string[] = [];
    const facetIds: string[] = [];
    
    // Separate handling for incoming vs outgoing frames
    if (this.isIncomingFrame(frame)) {
      const content = this.renderIncomingFrame(frame as IncomingVEILFrame, replayedState, beforeState, removals);
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
    replayedState: Map<string, Facet>,
    beforeState?: Map<string, Facet>,
    removals?: Map<string, 'hide' | 'delete'>
  ): string {
    const parts: string[] = [];
    const renderedStates = new Map<string, string>(); // Track rendered states by facet ID
    
    // First pass: collect all state operations in this frame
    for (const operation of frame.operations) {
      switch (operation.type) {
        case 'addFacet':
          if ('facet' in operation && operation.facet.type === 'state') {
            // Skip removed facets
            if (removals?.has(operation.facet.id)) {
              break;
            }
            // Store the initial state rendering
            const rendered = this.renderFacet(operation.facet);
            if (rendered) {
              renderedStates.set(operation.facet.id, rendered);
            }
          }
          break;
          
        case 'changeState':
          if ('updates' in operation && operation.updates) {
            // Check if facet is removed
            const removal = removals?.get(operation.facetId);
            if (removal === 'delete') {
              // Ignore changes to deleted facets
              break;
            }
            
            const currentFacet = replayedState.get(operation.facetId);
            if (currentFacet && currentFacet.type === 'state') {
              const updatedFacet = {
                ...currentFacet,
                ...operation.updates,
                attributes: {
                  ...currentFacet.attributes,
                  ...(operation.updates.attributes || {})
                }
              } as StateFacet;
              
              // Ensure transitionRenderers are preserved
              if ('transitionRenderers' in currentFacet) {
                updatedFacet.transitionRenderers = (currentFacet as StateFacet).transitionRenderers;
              }
              
              
              // Check for transition renderers if attributes changed
              const changedAttributes: Record<string, { oldValue: any, newValue: any }> = {};
              if (operation.updates.attributes && beforeState) {
                const beforeFacet = beforeState.get(operation.facetId) as StateFacet;
                if (beforeFacet) {
                  for (const [key, newValue] of Object.entries(operation.updates.attributes)) {
                    const oldValue = beforeFacet.attributes?.[key];
                    if (oldValue !== newValue) {
                      changedAttributes[key] = { oldValue, newValue };
                    }
                  }
                }
              }
              
              
              // Try transition rendering first if we have changed attributes
              let rendered: string | null = null;
              // Skip transition rendering for hidden facets
              if (removal !== 'hide' && Object.keys(changedAttributes).length > 0 && updatedFacet.transitionRenderers) {
                rendered = this.renderTransitions(updatedFacet, changedAttributes);
              }
              
              // If no transition rendering, fall back to normal rendering
              if (!rendered) {
                if (operation.updateMode === 'attributesOnly' && operation.updates.attributes) {
                  rendered = this.renderAttributeChanges(
                    currentFacet as StateFacet,
                    operation.updates.attributes
                  );
                } else {
                  // Full render
                  rendered = this.renderFacet(updatedFacet);
                }
              }
              
              if (rendered) {
                renderedStates.set(operation.facetId, rendered);
              }
              
              // Update the replayed state for subsequent operations
              replayedState.set(operation.facetId, updatedFacet);
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
            // Skip removed facets
            if (removals?.has(operation.facet.id)) {
              break;
            }
            
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
          // Skip removed facets
          if (removals?.has(operation.facetId)) {
            break;
          }
          
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
    const tracer = getGlobalTracer();
    
    // Skip tool facets and empty facets
    if (facet.type === 'tool') return null;
    if (!facet.content && (!facet.children || facet.children.length === 0)) {
      return null;
    }
    
    const parts: string[] = [];
    
    // Trace facet rendering
    const facetTraceId = `facet-render-${facet.id}-${Date.now()}`;
    tracer?.record({
      id: facetTraceId,
      timestamp: Date.now(),
      level: 'trace',
      category: TraceCategory.HUD_RENDER,
      component: 'FrameTrackingHUD',
      operation: 'renderFacet',
      data: {
        facetId: facet.id,
        facetType: facet.type,
        displayName: facet.displayName,
        hasContent: !!facet.content,
        contentPreview: facet.content ? facet.content.substring(0, 100) + (facet.content.length > 100 ? '...' : '') : null,
        childCount: facet.children?.length || 0,
        attributes: facet.attributes
      }
    });
    
    // Use displayName as tag if available
    if (facet.displayName) {
      const tag = this.sanitizeTagName(facet.displayName);
      
      // Render the facet's own content
      if (facet.content) {
        parts.push(`<${tag}>${facet.content}</${tag}>`);
      }
      
      // Render child facets
      if (facet.children && facet.children.length > 0) {
        const childParts: string[] = [];
        for (const child of facet.children) {
          const rendered = this.renderFacet(child);
          if (rendered) {
            childParts.push(rendered);
          }
        }
        if (childParts.length > 0) {
          // If facet has both content and children, wrap children
          if (facet.content) {
            parts.push(`<${tag}-children>`);
            parts.push(...childParts);
            parts.push(`</${tag}-children>`);
          } else {
            // If only children, include them in the main tag
            return `<${tag}>\n${childParts.join('\n')}\n</${tag}>`;
          }
        }
      }
      
      return parts.join('\n');
    }
    
    // No tag for facets without displayName
    if (facet.content) {
      parts.push(facet.content);
    }
    
    // Still render children even without displayName
    if (facet.children && facet.children.length > 0) {
      for (const child of facet.children) {
        const rendered = this.renderFacet(child);
        if (rendered) {
          parts.push(rendered);
        }
      }
    }
    
    return parts.length > 0 ? parts.join('\n') : null;
  }
  
  private renderTransitions(
    facet: StateFacet,
    changedAttributes: Record<string, { oldValue: any, newValue: any }>
  ): string | null {
    if (!facet.transitionRenderers) return null;
    
    const parts: string[] = [];
    
    // Check each changed attribute for a transition renderer
    for (const [key, { oldValue, newValue }] of Object.entries(changedAttributes)) {
      const renderer = facet.transitionRenderers[key];
      if (renderer) {
        const rendered = renderer(newValue, oldValue);
        if (rendered) {
          // For transitions, we typically want to replace the entire content
          // rather than append, so we'll use the first non-null transition
          if (facet.displayName) {
            const tag = this.sanitizeTagName(facet.displayName);
            return `<${tag}>${rendered}</${tag}>`;
          } else {
            return rendered;
          }
        }
      }
    }
    
    return null;
  }
  
  private renderAttributeChanges(
    currentFacet: StateFacet, 
    newAttributes: Record<string, any>
  ): string | null {
    const parts: string[] = [];
    
    
    // If there are attribute renderers, use them
    if (currentFacet.attributeRenderers) {
      for (const [key, newValue] of Object.entries(newAttributes)) {
        const renderer = currentFacet.attributeRenderers[key];
        if (renderer) {
          const oldValue = currentFacet.attributes?.[key];
          const rendered = renderer(newValue, oldValue);
          if (rendered) {
            parts.push(rendered);
          }
        }
      }
    }
    
    // If we got any rendered parts, combine them
    if (parts.length > 0) {
      if (currentFacet.displayName) {
        const tag = this.sanitizeTagName(currentFacet.displayName);
        return `<${tag}>${parts.join(' ')}</${tag}>`;
      } else {
        return parts.join(' ');
      }
    }
    
    return null;
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
  
  private updateReplayedState(frame: IncomingVEILFrame, replayedState: Map<string, Facet>, removals?: Map<string, 'hide' | 'delete'>): void {
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
          
        case 'removeFacet':
          if ('facetId' in operation && 'mode' in operation) {
            if (removals) {
              removals.set(operation.facetId, operation.mode);
              // Cascade to children
              const facet = replayedState.get(operation.facetId);
              if (facet && facet.children) {
                for (const child of facet.children) {
                  removals.set(child.id, operation.mode);
                }
              }
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
