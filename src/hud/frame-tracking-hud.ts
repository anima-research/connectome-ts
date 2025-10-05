/**
 * Clean HUD implementation that tracks frames for compression
 * Works directly with VEIL primitives, no ContentBlock abstraction
 */

import {
  Facet,
  Frame,
  OutgoingVEILOperation,
  hasContentAspect,
  hasStateAspect
} from '../veil/types';
import { CompressibleHUD, RenderedContext, HUDConfig } from './types-v2';
import { CompressionEngine, RenderedFrame, StateDelta } from '../compression/types-v2';
import { getGlobalTracer, TraceCategory } from '../tracing';

export class FrameTrackingHUD implements CompressibleHUD {
  
  render(
    frames: Frame[],
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
    frames: Frame[],
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
      type: 'user' | 'agent' | 'system' | 'compressed';
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

      const source = this.getFrameSource(frame);

      const { content, facetIds } = this.renderFrameContent(frame, source, replayedState, removals);
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
          frameSource: source,
          operationCount: frame.deltas.length,
          deltas: frame.deltas.map(op => op.type),
          contentLength: content.length,
          contentPreview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
          tokens,
          facetIds,
          isEmpty: !content.trim()
        },
        parentId: traceId
      });

      frameRenderings.push({
        frameSequence: frame.sequence,
        content,
        tokens,
        facetIds
      });

      // Only add non-empty content
      if (content.trim()) {
        frameContents.push({
          type: source,
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
    const { messages, frameToMessageIndex } = this.buildFrameBasedMessages(frameContents, currentFacets, config);
    
    // Calculate total tokens from messages
    totalTokens = messages.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0);
    
    return {
      context: {
        messages,
        metadata: {
          totalTokens,
          renderedFrames: frameRenderings,
          frameToMessageIndex
        }
      },
      frameRenderings
    };
  }
  
  private renderAgentFrame(frame: Frame): string {
    const parts: string[] = [];

    for (const operation of frame.deltas) {
      if (operation.type === 'addFacet') {
        const facet = operation.facet;
        switch (facet.type) {
          case 'speech':
            if (hasContentAspect(facet)) {
              parts.push(facet.content);
            }
            break;

          case 'action':
            if (hasStateAspect(facet)) {
              const { toolName, parameters } = facet.state as {
                toolName?: string;
                parameters?: Record<string, unknown>;
              };
              if (toolName) {
                parts.push(this.renderToolCall(toolName, parameters ?? {}));
              }
            }
            break;

          case 'thought':
            if (hasContentAspect(facet)) {
              parts.push(`<thought>${facet.content}</thought>`);
            }
            break;
        }
      }
    }

    // Wrap agent operations in turn marker
    if (parts.length > 0) {
      return `<my_turn>\n\n${parts.join('\n\n')}\n\n</my_turn>`;
    }

    return '';
  }

  private getFrameSource(frame: Frame): 'user' | 'agent' | 'system' {
    if (!frame.events || frame.events.length === 0) {
      return 'system';
    }

    // Check for user input events
    const userTopics = ['console:input', 'discord:message', 'minecraft:chat'];
    if (frame.events.some(event => userTopics.includes(event.topic))) {
      return 'user';
    }

    // Check for agent-generated events by looking at VEIL operations from agent elements
    if (frame.events.some(event => {
      if (event.topic === 'veil:operation' && event.source) {
        // Check if source is an AgentElement by elementType
        // This is more robust than string matching on elementId
        return event.source.elementType === 'AgentElement';
      }
      return false;
    })) {
      return 'agent';
    }

    // Check if any events have agent-related topics
    const agentTopics = ['agent:speech', 'agent:thought', 'agent:action'];
    if (frame.events.some(event => agentTopics.includes(event.topic))) {
      return 'agent';
    }

    return 'system';
  }

  private renderFrameContent(
    frame: Frame,
    source: 'user' | 'agent' | 'system',
    replayedState: Map<string, Facet>,
    removals?: Map<string, 'hide' | 'delete'>
  ): { content: string; facetIds: string[] } {
    if (source === 'agent') {
      return {
        content: this.renderAgentFrame(frame),
        facetIds: []
      };
    }

    const content = this.renderEnvironmentFrame(frame, replayedState, removals);
    return {
      content,
      facetIds: this.extractFacetIds(frame)
    };
  }

  private renderEnvironmentFrame(
    frame: Frame,
    replayedState: Map<string, Facet>,
    removals?: Map<string, 'hide' | 'delete'>
  ): string {
    const parts: string[] = [];
    const renderedStates = new Map<string, string>();

    for (const operation of frame.deltas) {
      switch (operation.type) {
        case 'addFacet': {
          const facet = operation.facet;
          if (!facet) {
            console.error('[FrameTrackingHUD] Invalid addFacet operation - missing facet:', operation);
            break;
          }
          if (removals?.has(facet.id)) {
            break;
          }
          if (facet.type === 'state') {
            const rendered = this.renderFacet(facet);
            if (rendered) {
              renderedStates.set(facet.id, rendered);
            }
          }
          replayedState.set(facet.id, facet);
          break;
        }

        case 'rewriteFacet': {
          if (removals?.get(operation.id) === 'delete') {
            break;
          }

          const currentFacet = replayedState.get(operation.id);
          if (!currentFacet) {
            break;
          }

          const updatedFacet = this.mergeFacetChanges(currentFacet, operation.changes);
          const rendered = this.renderFacet(updatedFacet);
          if (rendered) {
            renderedStates.set(operation.id, rendered);
          }
          replayedState.set(operation.id, updatedFacet);
          break;
        }

        case 'removeFacet':
          break;
      }
    }

    for (const operation of frame.deltas) {
      switch (operation.type) {
        case 'addFacet': {
          const facet = operation.facet;
          if (!facet) {
            console.error('[FrameTrackingHUD] Invalid addFacet operation in second pass - missing facet:', operation);
            break;
          }
          if (removals?.has(facet.id)) {
            break;
          }

          if (renderedStates.has(facet.id)) {
            const finalRendering = renderedStates.get(facet.id);
            if (finalRendering) {
              parts.push(finalRendering);
            }
            renderedStates.delete(facet.id);
            break;
          }

          const rendered = this.renderFacet(facet);
          if (rendered) {
            parts.push(rendered);
          }
          break;
        }

        case 'rewriteFacet': {
          if (removals?.has(operation.id)) {
            break;
          }

          const finalRendering = renderedStates.get(operation.id);
          if (finalRendering) {
            parts.push(finalRendering);
            renderedStates.delete(operation.id);
          }
          break;
        }

        case 'removeFacet': {
          renderedStates.delete(operation.id);
          if (removals) {
            removals.set(operation.id, 'delete');
            const facet = replayedState.get(operation.id);
            if (facet && Array.isArray((facet as any)?.children)) {
              for (const child of (facet as any).children as Facet[]) {
                removals.set(child.id, 'delete');
              }
            }
          }
          replayedState.delete(operation.id);
          break;
        }
      }
    }

    return parts.join('\n');
  }

  private renderFacet(facet: Facet): string | null {
    const tracer = getGlobalTracer();
    
    // Only render facets with ContentAspect
    // This allows component developers to create custom content facets
    if (!hasContentAspect(facet)) {
      return null;
    }

    const facetContent = facet.content;
    const facetChildren = Array.isArray((facet as any)?.children)
      ? ((facet as any).children as Facet[])
      : [];

    if (!facetContent && facetChildren.length === 0) {
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
        id: facet.id,
        facetType: facet.type,
        displayName: (facet as any).displayName,
        hasContent: true, // We already checked hasContentAspect
        contentPreview: facetContent
          ? facetContent.substring(0, 100) + (facetContent.length > 100 ? '...' : '')
          : null,
        childCount: facetChildren.length,
        state: hasStateAspect(facet) ? facet.state : undefined
      }
    });
    
    // Use displayName as tag if available
    const displayName = (facet as any).displayName;
    if (typeof displayName === 'string' && displayName.length > 0) {
      const tag = this.sanitizeTagName(displayName);

      // Render the facet's own content
      if (facetContent) {
        parts.push(`<${tag}>${facetContent}</${tag}>`);
      }
      
      // Render child facets
      if (facetChildren.length > 0) {
        const childParts: string[] = [];
        for (const child of facetChildren) {
          const rendered = this.renderFacet(child);
          if (rendered) {
            childParts.push(rendered);
          }
        }
        if (childParts.length > 0) {
          // If facet has both content and children, wrap children
          if (facetContent) {
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
    if (facetContent) {
      parts.push(facetContent);
    }
    
    // Still render children even without displayName
    if (facetChildren.length > 0) {
      for (const child of facetChildren) {
        const rendered = this.renderFacet(child);
        if (rendered) {
          parts.push(rendered);
        }
      }
    }
    
    return parts.length > 0 ? parts.join('\n') : null;
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
    frameContents: Array<{ type: 'user' | 'agent' | 'system' | 'compressed'; content: string; sequence: number }>,
    currentFacets: Map<string, Facet>,
    config: HUDConfig
  ): { messages: RenderedContext['messages']; frameToMessageIndex: Map<number, number> } {
    const messages: RenderedContext['messages'] = [];
    const frameToMessageIndex = new Map<number, number>();
    
    // Each frame becomes its own message
    for (const frame of frameContents) {
      let role: 'user' | 'assistant' | 'system';
      switch (frame.type) {
        case 'user':
          role = 'user';
          break;
        case 'agent':
          role = 'assistant';
          break;
        case 'system':
          role = 'system';
          break;
        default:
          role = 'assistant';
          break;
      }

      const messageIndex = messages.length;
      frameToMessageIndex.set(frame.sequence, messageIndex);

      messages.push({
        role,
        content: frame.content,
        sourceFrames: {
          from: frame.sequence,
          to: frame.sequence
        }
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
    
    return { messages, frameToMessageIndex };
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
  
  private extractFacetIds(frame: Frame): string[] {
    const ids: string[] = [];
    
    for (const op of frame.deltas) {
      if (op.type === 'addFacet') {
        ids.push(op.facet.id);
      } else if (op.type === 'rewriteFacet' || op.type === 'removeFacet') {
        ids.push(op.id);
      }
    }
    
    return ids;
  }
  
  private sanitizeTagName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
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
        const updated = this.mergeFacetChanges(existing, changes);
        replayedState.set(facetId, updated);
      }
    }
    
    // Note: New facets in delta.added would need full facet data,
    // which would be included in delta.changes with their full state
  }

  private cloneFacet(facet: Facet): Facet {
    const cloned = { ...facet } as Facet;

    if (hasStateAspect(facet)) {
      (cloned as Facet & { state: Record<string, unknown> }).state = {
        ...facet.state
      };
    }

    if (Array.isArray((facet as any)?.children)) {
      (cloned as any).children = ((facet as any).children as Facet[]).map(child =>
        this.cloneFacet(child)
      );
    }

    return cloned;
  }

  private mergeFacetChanges(existing: Facet, changes: Partial<Facet>): Facet {
    const merged = { ...existing, ...changes } as Facet;
    const changeRecord = changes as Record<string, unknown>;

    if ('state' in changeRecord && changeRecord.state && typeof changeRecord.state === 'object') {
      const newState = changeRecord.state as Record<string, unknown>;
      if (hasStateAspect(existing)) {
        (merged as Facet & { state: Record<string, unknown> }).state = {
          ...existing.state,
          ...newState
        };
      } else {
        (merged as any).state = { ...newState };
      }
    }

    if ('content' in changeRecord && typeof changeRecord.content === 'string') {
      (merged as any).content = changeRecord.content;
    }

    if ('children' in changeRecord && Array.isArray(changeRecord.children)) {
      (merged as any).children = changeRecord.children;
    }

    if ('displayName' in changeRecord) {
      (merged as any).displayName = changeRecord.displayName;
    }

    return merged;
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
    operations: OutgoingVEILOperation[];
    hasMoreToSay: boolean;
  } {
    // TODO: Implement parsing
    return {
      operations: [],
      hasMoreToSay: false
    };
  }
  
  needsCompression(frames: Frame[], config: HUDConfig): boolean {
    // Simple check based on frame count or estimated tokens
    return frames.length > 50;
  }
  
  getFormat(): string {
    return 'xml';
  }
}
