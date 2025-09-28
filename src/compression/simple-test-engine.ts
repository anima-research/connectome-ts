/**
 * Simple test compression engine for verifying frame-based compression
 */

import { CompressionEngine, CompressibleRange, CompressionResult, RenderedFrame, StateDelta } from './types-v2';
import { Facet, IncomingVEILFrame, OutgoingVEILFrame } from '../veil/types';

// Union type for frames
type VEILFrame = IncomingVEILFrame | OutgoingVEILFrame;

export class SimpleTestCompressionEngine implements CompressionEngine {
  private compressions = new Map<number, string>();
  private stateDeltas = new Map<number, StateDelta>();
  
  identifyCompressibleRanges(
    frames: VEILFrame[],
    renderedFrames: RenderedFrame[]
  ): CompressibleRange[] {
    const ranges: CompressibleRange[] = [];
    
    // Simple strategy: compress every 5 frames that exceed 200 tokens total
    let rangeStart = 0;
    let rangeTokens = 0;
    
    for (let i = 0; i < renderedFrames.length; i++) {
      rangeTokens += renderedFrames[i].tokens;
      
      // Check if we should end this range
      if (i - rangeStart >= 4 || i === renderedFrames.length - 1) {
        if (rangeTokens > 200) {
          ranges.push({
            fromFrame: renderedFrames[rangeStart].frameSequence,
            toFrame: renderedFrames[i].frameSequence,
            totalTokens: rangeTokens,
            reason: 'Token threshold exceeded'
          });
        }
        // Start new range
        rangeStart = i + 1;
        rangeTokens = 0;
      }
    }
    
    return ranges;
  }
  
  async compressRange(
    range: CompressibleRange,
    frames: VEILFrame[],
    renderedFrames: RenderedFrame[],
    currentFacets: Map<string, Facet>
  ): Promise<CompressionResult> {
    // Find frames in range
    const framesInRange = frames.filter(f => 
      f.sequence >= range.fromFrame && f.sequence <= range.toFrame
    );
    
    // Track state changes
    const stateDelta: StateDelta = {
      changes: new Map(),
      added: [],
      deleted: []
    };
    
    // Process all deltas to compute net state effect
    for (const frame of framesInRange) {
      if ('deltas' in frame) {
        for (const op of frame.deltas) {
          if (op.type === 'addFacet' && op.facet?.type === 'state') {
            stateDelta.added.push(op.facet.id);
            stateDelta.changes.set(op.facet.id, op.facet);
          } else if (op.type === 'changeFacet' && 'facetId' in op && 'updates' in op) {
            // Apply updates to tracked state
            const existing = stateDelta.changes.get(op.id);
            if (existing) {
              // Merge updates into existing tracked state
              stateDelta.changes.set(op.id, {
                ...existing,
                ...op.changes,
                attributes: {
                  ...existing.attributes,
                  ...(op.changes.attributes || {})
                }
              } as Partial<Facet>);
            } else if (!stateDelta.added.includes(op.id)) {
              // Track updates for facets that existed before this range
              stateDelta.changes.set(op.id, {
                ...op.changes,
                type: 'state' // Ensure we keep the type
              } as Partial<Facet>);
            }
          }
          // Handle deleteScope operations that might delete facets
          // For now, we'll skip this complexity
        }
      }
    }
    
    // Create simple summary
    const eventCount = framesInRange.filter(f => 
      f.deltas.some((op: any) => op.type === 'addFacet' && op.facet?.type === 'event')
    ).length;
    
    const agentCount = framesInRange.filter(f =>
      f.deltas.some((op: any) => op.type === 'speak' || op.type === 'act' || op.type === 'think')
    ).length;
    
    const summary = `[Frames ${range.fromFrame}-${range.toFrame}: ${eventCount} events, ${agentCount} agent actions]`;
    
    // Store compression and state delta
    for (let seq = range.fromFrame; seq <= range.toFrame; seq++) {
      this.compressions.set(seq, summary);
      if (stateDelta.changes.size > 0 || stateDelta.added.length > 0 || stateDelta.deleted.length > 0) {
        this.stateDeltas.set(seq, stateDelta);
      }
    }
    
    return {
      replacesFrames: {
        from: range.fromFrame,
        to: range.toFrame
      },
      stateDelta: stateDelta.changes.size > 0 || stateDelta.added.length > 0 || stateDelta.deleted.length > 0 ? stateDelta : undefined,
      engineData: { summary }
    };
  }
  
  shouldReplaceFrame(frameSequence: number): boolean {
    return this.compressions.has(frameSequence);
  }
  
  getReplacement(frameSequence: number): string | null {
    // Only return replacement for the first frame in a compressed range
    const replacement = this.compressions.get(frameSequence);
    if (!replacement) return null;
    
    // Check if this is the first frame of a compressed range
    const previousReplacement = this.compressions.get(frameSequence - 1);
    if (previousReplacement === replacement) {
      // Not the first frame of this compression
      return '';  // Return empty string to skip
    }
    
    return replacement;
  }
  
  getStateDelta(frameSequence: number): StateDelta | null {
    // Only return state delta for the first frame in a compressed range
    const delta = this.stateDeltas.get(frameSequence);
    if (!delta) return null;
    
    // Check if this is the first frame of a compressed range
    const previousDelta = this.stateDeltas.get(frameSequence - 1);
    if (previousDelta === delta) {
      // Not the first frame of this compression
      return null;
    }
    
    return delta;
  }
  
  clearCache(): void {
    this.compressions.clear();
    this.stateDeltas.clear();
  }
}
