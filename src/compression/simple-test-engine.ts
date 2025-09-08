/**
 * Simple test compression engine for verifying frame-based compression
 */

import { CompressionEngine, CompressibleRange, CompressionResult, RenderedFrame } from './types-v2';
import { Facet, IncomingVEILFrame, OutgoingVEILFrame } from '../veil/types';

// Union type for frames
type VEILFrame = IncomingVEILFrame | OutgoingVEILFrame;

export class SimpleTestCompressionEngine implements CompressionEngine {
  private compressions = new Map<number, string>();
  
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
    
    // Create simple summary
    const eventCount = framesInRange.filter(f => 
      f.operations.some((op: any) => op.type === 'addFacet' && op.facet?.type === 'event')
    ).length;
    
    const agentCount = framesInRange.filter(f =>
      f.operations.some((op: any) => op.type === 'speak' || op.type === 'toolCall')
    ).length;
    
    const summary = `[Frames ${range.fromFrame}-${range.toFrame}: ${eventCount} events, ${agentCount} agent actions]`;
    
    // Store compression
    for (let seq = range.fromFrame; seq <= range.toFrame; seq++) {
      this.compressions.set(seq, summary);
    }
    
    return {
      replacesFrames: {
        from: range.fromFrame,
        to: range.toFrame
      },
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
  
  clearCache(): void {
    this.compressions.clear();
  }
}
