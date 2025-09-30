/**
 * Console Receptors and Effectors for the new architecture
 */

import { BaseReceptor, BaseEffector } from './base-martem';
import { 
  Receptor, 
  Effector, 
  ReadonlyVEILState,
  FacetDelta,
  EffectorResult
} from '../spaces/receptor-effector-types';
import { SpaceEvent } from '../spaces/types';
import { Facet, hasContentAspect } from '../veil/types';
import { createAgentActivation, createEventFacet } from '../helpers/factories';

/**
 * Converts console input events into message AND activation facets
 */
export class ConsoleInputReceptor extends BaseReceptor {
  topics = ['console:input'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const payload = event.payload as { input: string; timestamp?: number };
    const timestamp = payload.timestamp || Date.now();
    const messageId = `console-msg-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    
    const messageFacet = createEventFacet({
      id: messageId,
      content: payload.input,
      source: 'console',
      eventType: 'console-message',
      metadata: { timestamp },
      streamId: 'console',
      streamType: 'console'
    });

    const activationFacet = createAgentActivation('Console input received', {
      id: `activation-${messageId}`,
      priority: 'normal',
      sourceAgentId: 'user',
      sourceAgentName: 'User',
      streamRef: {
        streamId: 'console',
        streamType: 'console'
      }
    });
    
    return [messageFacet, activationFacet];
  }
}

/**
 * Watches for speech facets and outputs to console
 */
export class ConsoleOutputEffector extends BaseEffector {
  facetFilters = [{
    type: 'speech'
  }];
  
  constructor(
    private write: (content: string) => void = console.log
  ) {
    super();
  }
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const externalActions = [];
    
    for (const change of changes) {
      if (change.type === 'added' && hasContentAspect(change.facet)) {
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
