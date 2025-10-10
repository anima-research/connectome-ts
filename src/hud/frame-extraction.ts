/**
 * Utilities for extracting specific frame ranges from rendered context
 * 
 * Works at the frame-rendering level (not message level) since messages
 * can contain multiple frames or frames can be split across messages.
 */

import { RenderedContext } from './types-v2';
import { RenderedFrame } from '../compression/types-v2';

export interface ExtractedFrameRange {
  content: string;
  tokens: number;
  frames: RenderedFrame[];
  sourceFrames: { from: number; to: number };
}

/**
 * Extract a specific frame range from rendered context
 * 
 * Works at the frame-rendering level, not message level, since the
 * relationship between frames and messages is many-to-many.
 * 
 * @param context - The full rendered context
 * @param fromFrame - Starting frame sequence (inclusive)
 * @param toFrame - Ending frame sequence (inclusive)
 * @returns Extracted frame renderings and concatenated content
 */
export function extractFrameRange(
  context: RenderedContext,
  fromFrame: number,
  toFrame: number
): ExtractedFrameRange {
  const frames: RenderedFrame[] = [];
  const contentParts: string[] = [];
  let tokens = 0;
  
  // Extract from frameRenderings metadata (the ground truth)
  for (const frameRendering of context.metadata.renderedFrames) {
    if (frameRendering.frameSequence >= fromFrame && 
        frameRendering.frameSequence <= toFrame) {
      frames.push(frameRendering);
      contentParts.push(frameRendering.content);
      tokens += frameRendering.tokens;
    }
  }
  
  return {
    content: contentParts.join('\n\n'),
    tokens,
    frames,
    sourceFrames: { from: fromFrame, to: toFrame }
  };
}

/**
 * Quick check if a range contains any renderable frames
 */
export function hasFramesInRange(
  context: RenderedContext,
  fromFrame: number,
  toFrame: number
): boolean {
  for (const frameRendering of context.metadata.renderedFrames) {
    if (frameRendering.frameSequence >= fromFrame && 
        frameRendering.frameSequence <= toFrame) {
      return true;
    }
  }
  return false;
}

/**
 * Get all frame sequences present in the rendered context
 */
export function getRenderedFrameSequences(context: RenderedContext): number[] {
  return context.metadata.renderedFrames
    .map(f => f.frameSequence)
    .sort((a, b) => a - b);
}

/**
 * Find gaps in frame coverage (missing frames in rendered context)
 */
export function findFrameGaps(context: RenderedContext): Array<{ from: number; to: number }> {
  const sequences = getRenderedFrameSequences(context);
  if (sequences.length === 0) return [];
  
  const gaps: Array<{ from: number; to: number }> = [];
  
  for (let i = 0; i < sequences.length - 1; i++) {
    const current = sequences[i];
    const next = sequences[i + 1];
    
    if (next - current > 1) {
      gaps.push({
        from: current + 1,
        to: next - 1
      });
    }
  }
  
  return gaps;
}
