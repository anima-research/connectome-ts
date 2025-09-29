/**
 * Attention-aware compression engine
 * Inserts compression instructions at the right spot and wraps content
 */

import { CompressionEngine, CompressibleRange, CompressionResult, RenderedFrame, StateDelta } from './types-v2';
import { Facet, Frame } from '../veil/types';
import { LLMProvider, LLMMessage } from '../llm/llm-interface';

interface CompressionRecord {
  range: { from: number; to: number };
  summary: string;
  originalContent: string;
  stateDelta?: StateDelta;
}

export class AttentionAwareCompressionEngine implements CompressionEngine {
  private compressions = new Map<number, CompressionRecord>();
  private pendingCompressions: CompressibleRange[] = [];
  
  constructor(
    private llmProvider: LLMProvider,
    private config: {
      chunkThreshold: number;  // Min tokens to compress
      maxChunkSize: number;    // Max tokens in one compression
    } = {
      chunkThreshold: 500,
      maxChunkSize: 2000
    }
  ) {}
  
  identifyCompressibleRanges(
    frames: Frame[],
    renderedFrames: RenderedFrame[]
  ): CompressibleRange[] {
    const ranges: CompressibleRange[] = [];
    
    let rangeStart = 0;
    let rangeTokens = 0;
    
    for (let i = 0; i < renderedFrames.length; i++) {
      rangeTokens += renderedFrames[i].tokens;
      
      // Check if we should end this range
      const shouldEndRange = 
        rangeTokens >= this.config.chunkThreshold ||
        rangeTokens >= this.config.maxChunkSize ||
        i === renderedFrames.length - 1;
      
      if (shouldEndRange && rangeTokens >= this.config.chunkThreshold) {
        ranges.push({
          fromFrame: renderedFrames[rangeStart].frameSequence,
          toFrame: renderedFrames[i].frameSequence,
          totalTokens: rangeTokens,
          reason: rangeTokens >= this.config.maxChunkSize ? 
            'Maximum chunk size reached' : 
            'Token threshold exceeded'
        });
        
        // Start new range
        rangeStart = i + 1;
        rangeTokens = 0;
      } else if (rangeTokens >= this.config.maxChunkSize) {
        // Reset if we exceeded max without meeting threshold
        rangeStart = i + 1;
        rangeTokens = 0;
      }
    }
    
    // Store pending compressions for later
    this.pendingCompressions = ranges;
    return ranges;
  }
  
  async compressRange(
    range: CompressibleRange,
    frames: Frame[],
    renderedFrames: RenderedFrame[],
    currentFacets: Map<string, Facet>
  ): Promise<CompressionResult> {
    // Find frames in range
    const framesInRange = frames.filter(f => 
      f.sequence >= range.fromFrame && f.sequence <= range.toFrame
    );
    
    // Compute state delta
    const stateDelta = this.computeStateDelta(framesInRange);
    
    // Find the rendered content for this range
    const rangeContent = renderedFrames
      .filter(rf => rf.frameSequence >= range.fromFrame && rf.frameSequence <= range.toFrame)
      .map(rf => rf.content)
      .join('\n\n');
    
    // Build the compression request with proper framing
    const compressionPrompt = this.buildCompressionPrompt(rangeContent, range);
    
    // Call LLM to compress
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: compressionPrompt
      }
    ];
    
    const response = await this.llmProvider.generate(messages, {
      maxTokens: 200,  // Summaries should be concise
      temperature: 0.3  // More deterministic
    });
    
    // Store the compression
    const record: CompressionRecord = {
      range: { from: range.fromFrame, to: range.toFrame },
      summary: response.content,
      originalContent: rangeContent,
      stateDelta: stateDelta.changes.size > 0 || stateDelta.added.length > 0 || stateDelta.deleted.length > 0 ? stateDelta : undefined
    };
    
    // Map all frames in range to this compression
    for (let seq = range.fromFrame; seq <= range.toFrame; seq++) {
      this.compressions.set(seq, record);
    }
    
    return {
      replacesFrames: { from: range.fromFrame, to: range.toFrame },
      stateDelta: record.stateDelta,
      engineData: { summary: response.content }
    };
  }
  
  private buildCompressionPrompt(content: string, range: CompressibleRange): string {
    return `Please compress the following content into a brief summary that preserves key information and events. Focus on actions taken, important discoveries, and state changes.

<content_to_compress>
${content}
</content_to_compress>

Provide a concise summary in 1-3 sentences.`;
  }
  
  shouldReplaceFrame(frameSequence: number): boolean {
    return this.compressions.has(frameSequence);
  }
  
  getReplacement(frameSequence: number): string | null {
    const record = this.compressions.get(frameSequence);
    if (!record) return null;
    
    // Only return replacement for first frame in range
    if (frameSequence === record.range.from) {
      return record.summary;
    }
    
    // Skip other frames in compressed range
    return '';
  }
  
  /**
   * For attention-aware compression, we need to render with compression instructions
   */
  getCompressionInstructions(frameSequence: number): string | null {
    // Check if this frame starts a pending compression
    const pending = this.pendingCompressions.find(r => r.fromFrame === frameSequence);
    if (!pending) return null;
    
    return `<compression_instruction>
The following ${pending.toFrame - pending.fromFrame + 1} frames (${pending.totalTokens} tokens) will be compressed.
</compression_instruction>`;
  }
  
  getStateDelta(frameSequence: number): StateDelta | null {
    const record = this.compressions.get(frameSequence);
    if (!record || !record.stateDelta) return null;
    
    // Only return state delta for first frame in range
    if (frameSequence === record.range.from) {
      return record.stateDelta;
    }
    
    return null;
  }
  
  private computeStateDelta(frames: Frame[]): StateDelta {
    const stateDelta: StateDelta = {
      changes: new Map(),
      added: [],
      deleted: []
    };
    
    // Process all deltas to compute net state effect
    for (const frame of frames) {
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
    
    return stateDelta;
  }
  
  clearCache(): void {
    this.compressions.clear();
    this.pendingCompressions = [];
  }
}
