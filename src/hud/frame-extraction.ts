/**
 * Utilities for extracting specific frame ranges from rendered context
 */

import { RenderedContext } from './types-v2';

export interface ExtractedFrameRange {
  content: string;
  tokens: number;
  messages: RenderedContext['messages'];
  sourceFrames: { from: number; to: number };
}

/**
 * Estimate token count (simple heuristic: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract a specific frame range from rendered context
 * 
 * This uses the sourceFrames attribution to find messages that overlap
 * with the requested range [fromFrame, toFrame] (inclusive).
 * 
 * @param context - The full rendered context with frame attribution
 * @param fromFrame - Starting frame sequence (inclusive)
 * @param toFrame - Ending frame sequence (inclusive)
 * @returns Extracted content, messages, and metadata
 */
export function extractFrameRange(
  context: RenderedContext,
  fromFrame: number,
  toFrame: number
): ExtractedFrameRange {
  const messages: RenderedContext['messages'] = [];
  const contentParts: string[] = [];
  let tokens = 0;
  
  for (const message of context.messages) {
    if (!message.sourceFrames) {
      // System messages without frames - skip them for compression
      // They're floating context, not part of frame history
      continue;
    }
    
    const { from, to } = message.sourceFrames;
    
    // Include messages that overlap with our range
    // A message overlaps if: message.from <= toFrame && message.to >= fromFrame
    if (from <= toFrame && to >= fromFrame) {
      messages.push(message);
      contentParts.push(message.content);
      tokens += estimateTokens(message.content);
    }
  }
  
  return {
    content: contentParts.join('\n\n'),
    tokens,
    messages,
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
  for (const message of context.messages) {
    if (!message.sourceFrames) continue;
    
    const { from, to } = message.sourceFrames;
    if (from <= toFrame && to >= fromFrame) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get all frame sequences present in the rendered context
 */
export function getRenderedFrameSequences(context: RenderedContext): number[] {
  const sequences = new Set<number>();
  
  for (const message of context.messages) {
    if (message.sourceFrames) {
      // Add all frames in this message's range
      for (let seq = message.sourceFrames.from; seq <= message.sourceFrames.to; seq++) {
        sequences.add(seq);
      }
    }
  }
  
  return Array.from(sequences).sort((a, b) => a - b);
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
