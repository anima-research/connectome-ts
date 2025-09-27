/**
 * Console Receptors and Effectors for the new architecture
 */

import { 
  Receptor, 
  Effector, 
  ReadonlyVEILState,
  FacetDelta,
  EffectorResult
} from '../spaces/receptor-effector-types';
import { SpaceEvent } from '../spaces/types';
import { Facet } from '../veil/types';

/**
 * Converts console input events into message AND activation facets
 */
export class ConsoleInputReceptor implements Receptor {
  topics = ['console:input'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const payload = event.payload as { input: string; timestamp?: number };
    const timestamp = payload.timestamp || Date.now();
    const messageId = `console-msg-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    
    const facets = [
      // The message facet
      {
        id: messageId,
        type: 'console-message',
        content: payload.input,
        temporal: 'persistent' as const,
        renderable: true,
        attributes: {
          source: 'console',
          timestamp
        }
      },
      // The activation facet to trigger agents
      {
        id: `activation-${messageId}`,
        type: 'agentActivation',
        content: 'Console input received',
        temporal: 'ephemeral' as const, // Activations are one-time triggers
        attributes: {
          source: 'console',
          sourceAgentId: 'user',
          sourceAgentName: 'User',
          priority: 'normal',
          reason: 'user_message',
          streamRef: {
            streamId: 'console',
            streamType: 'console'
          }
        }
      }
    ];
    
    return facets;
  }
}

/**
 * Watches for speech facets and outputs to console
 */
export class ConsoleOutputEffector implements Effector {
  facetFilters = [{
    type: 'speech',
    attributeMatch: { agentGenerated: true }
  }];
  
  constructor(
    private write: (content: string) => void = console.log
  ) {}
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const externalActions = [];
    
    for (const change of changes) {
      if (change.type === 'added' && change.facet.content) {
        // Output to console
        this.write(`\n${change.facet.content}\n`);
        
        externalActions.push({
          type: 'console-output',
          description: `Output to console`,
          content: change.facet.content
        });
      }
    }
    
    return { externalActions };
  }
}
