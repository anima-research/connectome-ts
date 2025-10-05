/**
 * FrameSnapshotTransform - Captures rendered snapshots of frames at creation time
 * 
 * This transform runs late in Phase 2 (after state stabilizes) and captures
 * how each frame renders. These snapshots are used by compression to preserve
 * the original subjective experience rather than re-rendering with current state.
 */

import { BaseTransform } from '../components/base-martem';
import { ReadonlyVEILState } from '../spaces/receptor-effector-types';
import { VEILDelta, Frame, Facet } from '../veil/types';
import { hasContentAspect } from '../veil/facet-types';

export class FrameSnapshotTransform extends BaseTransform {
  // Run late in Phase 2, after other transforms stabilize state
  // TODO [constraint-solver]: Replace with provides = ['frame-snapshots']
  priority = 200;
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    // Only process the most recent frame (current frame being finalized)
    const latestFrame = state.frameHistory[state.frameHistory.length - 1];
    
    if (!latestFrame || latestFrame.renderedSnapshot) {
      // Already captured or no frame to process
      return [];
    }
    
    // Capture snapshot of this frame
    this.captureSnapshot(latestFrame, state.facets);
    
    return []; // No VEIL deltas, just side effect on frame
  }
  
  private captureSnapshot(frame: Frame, currentFacets: ReadonlyMap<string, Facet>): void {
    const parts: string[] = [];
    const facetIds: string[] = [];
    
    // Determine role based on frame source
    const role = this.determineRole(frame);
    
    // Render this frame's deltas
    for (const delta of frame.deltas) {
      if (delta.type === 'addFacet') {
        const facet = (delta as any).facet as Facet;
        const rendered = this.renderFacet(facet);
        if (rendered) {
          parts.push(rendered);
          facetIds.push(facet.id);
        }
      }
    }
    
    const content = parts.join('\n\n');
    const tokens = this.estimateTokens(content);
    
    // Store snapshot on the frame
    frame.renderedSnapshot = {
      content,
      tokens,
      role,
      facetIds
    };
  }
  
  private determineRole(frame: Frame): 'user' | 'assistant' | 'system' {
    if (!frame.events || frame.events.length === 0) {
      return 'system';
    }
    
    // Check if any event indicates agent generation
    for (const event of frame.events) {
      if (event.topic.startsWith('agent:')) {
        return 'assistant';
      }
      if (event.source.elementId.includes('agent')) {
        return 'assistant';
      }
    }
    
    // Check frame deltas for agent-generated facets
    for (const delta of frame.deltas) {
      if (delta.type === 'addFacet') {
        const facet = (delta as any).facet as Facet;
        if (facet.type === 'speech' || facet.type === 'action' || facet.type === 'thought') {
          return 'assistant';
        }
      }
    }
    
    return 'user';
  }
  
  private renderFacet(facet: Facet): string | null {
    // Only render content-bearing facets
    if (!hasContentAspect(facet)) {
      return null;
    }
    
    const content = (facet as any).content as string;
    if (!content || !content.trim()) {
      return null;
    }
    
    // Add special formatting for certain types
    switch (facet.type) {
      case 'thought':
        return `<thought>${content}</thought>`;
      case 'action':
        // Extract tool call if present
        if ('state' in facet && facet.state) {
          const state = facet.state as Record<string, any>;
          if (state.toolName) {
            return this.renderToolCall(state.toolName, state.parameters || {});
          }
        }
        return content;
      case 'event':
      case 'speech':
      default:
        return content;
    }
  }
  
  private renderToolCall(toolName: string, parameters: Record<string, unknown>): string {
    const parts: string[] = [`<tool_call>${toolName}`];
    
    if (Object.keys(parameters).length > 0) {
      const paramStrs: string[] = [];
      for (const [key, value] of Object.entries(parameters)) {
        const valueStr = typeof value === 'string' 
          ? value 
          : JSON.stringify(value);
        paramStrs.push(`${key}=${valueStr}`);
      }
      parts.push(paramStrs.join(' '));
    }
    
    parts.push('</tool_call>');
    return parts.join('\n');
  }
  
  private estimateTokens(text: string): number {
    // Simple heuristic: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}
