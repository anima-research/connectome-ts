/**
 * ContextTransform - A Transform that renders context for agent activations
 * 
 * This is the new architecture version of FrameTrackingHUD.
 * It runs during Phase 2 of frame processing and creates ephemeral
 * rendered-context facets for any pending agent activations.
 */

import { BaseTransform } from '../components/base-martem';
import { Transform, ReadonlyVEILState } from '../spaces/receptor-effector-types';
import { Facet, hasStateAspect, VEILDelta } from '../veil/types';
import { FrameTrackingHUD } from './frame-tracking-hud';
import { CompressionEngine } from '../compression/types-v2';
import { HUDConfig } from './types-v2';
import { VEILStateManager } from '../veil/veil-state';

export class ContextTransform extends BaseTransform {
  // Priority: Run after compression (which has priority 10)
  // TODO [constraint-solver]: Replace with requires = ['compressed-frames']
  priority = 100;
  
  private hud: FrameTrackingHUD;
  
  constructor(
    private readonly veilStateManager: VEILStateManager,
    private compressionEngine?: CompressionEngine,
    private defaultOptions?: Partial<HUDConfig>
  ) {
    super();
    this.hud = new FrameTrackingHUD();
  }
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    
    // Find activation facets that need context
    for (const [id, facet] of state.facets) {
      if (facet.type === 'agent-activation' && hasStateAspect(facet)) {
        const activationState = facet.state as Record<string, any>;
        // Skip if context already rendered for this activation
        const contextExists = Array.from(state.facets.values()).some(f => 
          f.type === 'rendered-context' &&
          hasStateAspect(f) &&
          (f.state as Record<string, any>).activationId === id
        );
        
        if (contextExists) continue;
        
        // Get agent-specific options from activation
        const agentOptions = this.buildAgentOptions(activationState);
        
        // Render context using the existing HUD logic
        const fullState = this.veilStateManager.getState();
        
        // Get current frame from Space to include in rendering
        // This is critical: during Phase 2, the current frame hasn't been finalized
        // to frameHistory yet, so we need to explicitly include it
        const space = this.element?.findSpace() as any;
        const currentFrame = space?.getCurrentFrame();
        
        // Combine frameHistory with current frame so agent sees everything
        const allFrames = [...fullState.frameHistory];
        if (currentFrame) {
          allFrames.push(currentFrame);
        }
        
        const context = this.hud.render(
          allFrames,
          fullState.facets,
          this.compressionEngine,
          agentOptions
        );
        
        // Store the full rendered context object in state
        // The agent needs the message array with roles
        deltas.push({
          type: 'addFacet',
          facet: {
            id: `context-${id}-${Date.now()}`,
            type: 'rendered-context',
            state: {
              activationId: id,
              tokenCount: context.metadata.totalTokens,
              context: context // Store the full RenderedContext object
            },
            ephemeral: true
          }
        });
      }
    }
    
    return deltas;
  }
  
  private buildAgentOptions(activationState: Record<string, any>): HUDConfig {
    const options: HUDConfig = {
      ...this.defaultOptions,
      // Agent-specific overrides from activation
      systemPrompt: activationState.systemPrompt || this.defaultOptions?.systemPrompt,
      maxTokens: activationState.maxTokens || this.defaultOptions?.maxTokens || 4000,
      metadata: this.defaultOptions?.metadata
    };
    
    // Format configuration for agent output
    if (activationState.targetAgentId) {
      options.formatConfig = {
        assistant: {
          prefix: '<my_turn>\n',
          suffix: '\n</my_turn>'
        }
      };
    }

    return options as HUDConfig;
  }
}
