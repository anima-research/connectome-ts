import { VEILStateManager } from '../veil/veil-state';
import { CompressionEngine } from '../compression/types';
import { HUD } from '../hud/types';
import { 
  AgentLoopConfig, 
  AgentActivationResult,
  LLMProvider 
} from './types';
import { OutgoingVEILFrame } from '../veil/types';

/**
 * The main agent loop that coordinates VEIL, Compression, HUD, and LLM
 */
export class AgentLoop {
  private sequenceCounter = 1000; // Start outgoing sequences at 1000

  constructor(
    private veilState: VEILStateManager,
    private compressionEngine: CompressionEngine,
    private hud: HUD,
    private config: AgentLoopConfig
  ) {}

  /**
   * Process agent activation(s) from the current VEIL state
   */
  async processActivations(): Promise<AgentActivationResult> {
    let cycles = 0;
    let totalTokens = 0;
    const maxCycles = this.config.maxCycles || 10;

    try {
      while (cycles < maxCycles) {
        // Check if we have an activation
        const hasActivation = this.checkForActivation();
        if (!hasActivation) {
          return {
            cycles,
            totalTokens,
            stopped: cycles === 0 ? 'no_activation' : 'complete'
          };
        }

        // Process one cycle
        const result = await this.processOneCycle();
        cycles++;
        totalTokens += result.tokens || 0;

        // Check if agent requested another cycle
        if (!result.requestedCycle) {
          return {
            cycles,
            totalTokens,
            stopped: 'complete'
          };
        }

        // If requested delay, wait
        if (result.cycleDelay) {
          await this.delay(result.cycleDelay);
        }
      }

      return {
        cycles,
        totalTokens,
        stopped: 'max_cycles'
      };

    } catch (error) {
      return {
        cycles,
        totalTokens,
        stopped: 'error',
        error: error as Error
      };
    }
  }

  private async processOneCycle(): Promise<{
    tokens?: number;
    requestedCycle: boolean;
    cycleDelay?: number;
  }> {
    // Get current VEIL state
    const state = this.veilState.getState();
    const activeFacets = this.veilState.getActiveFacets();
    const focus = this.veilState.getCurrentFocus();

    // Compress facets into blocks
    const compressionResult = await this.compressionEngine.compress(activeFacets, {
      // Let compression engine decide what to include
    });

    // Render to LLM context
    const context = this.hud.render(
      compressionResult.blocks,
      {
        temperature: this.config.defaultTemperature,
        maxTokens: this.config.defaultMaxTokens,
        prefillFormat: true
      },
      focus
    );

    // Call LLM
    const completion = await this.config.llmProvider.complete(
      context.system,
      context.messages,
      {
        temperature: this.config.defaultTemperature,
        maxTokens: this.config.defaultMaxTokens,
        stopSequences: ['</my_turn>']
      }
    );

    // Parse completion
    const parsed = this.hud.parseCompletion(completion);

    // Create outgoing frame
    const outgoingFrame: OutgoingVEILFrame = {
      sequence: this.sequenceCounter++,
      timestamp: new Date().toISOString(),
      operations: parsed.operations
    };

    // Record the outgoing frame
    this.veilState.recordOutgoingFrame(outgoingFrame);

    // Process tool calls
    await this.processToolCalls(parsed.operations);

    // Check for cycle request
    const cycleRequest = parsed.operations.find(op => op.type === 'cycleRequest');
    
    return {
      tokens: compressionResult.totalTokens,
      requestedCycle: !!cycleRequest || parsed.hasMoreToSay || false,
      cycleDelay: cycleRequest?.type === 'cycleRequest' ? cycleRequest.delayMs : undefined
    };
  }

  private checkForActivation(): boolean {
    // Look for agent activation in recent frames
    const state = this.veilState.getState();
    
    // Simple check: look at last few incoming frames
    for (let i = state.frameHistory.length - 1; i >= 0; i--) {
      const frame = state.frameHistory[i];
      
      // Only check incoming frames
      if (!('operations' in frame)) continue;
      
      // Check if this frame requested activation
      const hasActivation = frame.operations.some(
        op => op.type === 'agentActivation'
      );
      
      if (hasActivation) return true;
      
      // Don't look too far back
      if (i < state.frameHistory.length - 5) break;
    }

    return false;
  }

  private async processToolCalls(operations: any[]): Promise<void> {
    // Tool call processing would be implemented here
    // For now, just log them
    for (const op of operations) {
      if (op.type === 'toolCall') {
        console.log(`Tool call: ${op.toolName}`, op.parameters);
        // In real implementation, this would look up the tool's callback
        // and execute it
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
