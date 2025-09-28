/**
 * ContextTransform - A Transform that renders context for agent activations
 * 
 * This is the new architecture version of FrameTrackingHUD.
 * It runs during Phase 2 of frame processing and creates ephemeral
 * rendered-context facets for any pending agent activations.
 */

import { Transform, ReadonlyVEILState } from '../spaces/receptor-effector-types';
import { Facet, hasStateAspect } from '../veil/types';
import { FrameTrackingHUD } from './frame-tracking-hud';
import { CompressionEngine } from '../compression/types-v2';
import { HUDConfig } from './types-v2';
import { VEILStateManager } from '../veil/veil-state';

export class ContextTransform implements Transform {
  private hud: FrameTrackingHUD;
  
  constructor(
    private readonly veilStateManager: VEILStateManager,
    private compressionEngine?: CompressionEngine,
    private defaultOptions?: Partial<HUDConfig>
  ) {
    this.hud = new FrameTrackingHUD();
  }
  
  process(state: ReadonlyVEILState): Facet[] {
    const contextFacets: Facet[] = [];
    
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
        const context = this.hud.render(
          fullState.frameHistory,
          fullState.facets,
          this.compressionEngine,
          agentOptions
        );
        
        // Convert messages to a single content string
        const contentString = context.messages
          .map(msg => `<${msg.role}>\n${msg.content}\n</${msg.role}>`)
          .join('\n\n');
        
        // Create context facet
        contextFacets.push({
          id: `context-${id}-${Date.now()}`,
          type: 'rendered-context',
          content: contentString,
          state: {
            activationId: id,
            tokenCount: context.metadata.totalTokens
          },
          ephemeral: true
        });
      }
    }
    
    return contextFacets;
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
