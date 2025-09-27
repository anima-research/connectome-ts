/**
 * Example demonstrating the new Receptor/Effector architecture
 */

import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { 
  Receptor, 
  Effector, 
  Transform,
  ReadonlyVEILState,
  FacetDelta
} from '../src/spaces/receptor-effector-types';
import { SpaceEvent } from '../src/spaces/types';
import { Facet } from '../src/veil/types';

// Example 1: Message Receptor
// Converts discord:message events into message facets
class DiscordMessageReceptor implements Receptor {
  topics = ['discord:message'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const { messageId, content, author, channelId } = event.payload;
    
    return [{
      id: `discord-msg-${messageId}`,
      type: 'discord-message',
      content,
      temporal: 'persistent',
      renderable: true,
      attributes: {
        author,
        channelId,
        timestamp: event.timestamp
      }
    }];
  }
}

// Example 2: Agent Activation Effector
// Watches for activation trigger patterns and creates activation facets
class ActivationEffector implements Effector {
  facetFilters = [{
    type: 'discord-message',
    attributeMatch: { author: { bot: false } } // Only human messages
  }];
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<any> {
    const events: SpaceEvent[] = [];
    
    for (const change of changes) {
      if (change.type === 'added' && change.facet.content?.toLowerCase().includes('hello')) {
        // Create activation event
        events.push({
          topic: 'agent:activate',
          source: { elementId: 'system', componentId: 'activation-effector' },
          timestamp: Date.now(),
          payload: {
            reason: 'User said hello',
            priority: 'normal',
            streamRef: {
              streamId: change.facet.attributes?.channelId,
              streamType: 'discord'
            }
          }
        });
      }
    }
    
    return { events };
  }
}

// Example 3: Message Count Transform
// Creates index facets for quick message counting
class MessageCountTransform implements Transform {
  process(state: ReadonlyVEILState): Facet[] {
    const messagesByChannel = new Map<string, number>();
    
    // Count messages by channel
    for (const facet of state.facets.values()) {
      if (facet.type === 'discord-message') {
        const channelId = facet.attributes?.channelId;
        if (channelId) {
          messagesByChannel.set(channelId, (messagesByChannel.get(channelId) || 0) + 1);
        }
      }
    }
    
    // Create index facets
    return Array.from(messagesByChannel.entries()).map(([channelId, count]) => ({
      id: `msg-count-${channelId}`,
      type: 'index-message-count',
      temporal: 'ephemeral', // Recreated each frame
      visibility: 'system',
      state: { count },
      attributes: { channelId }
    }));
  }
}

// Example 4: Speech Effector
// Sends agent speech to Discord
class DiscordSpeechEffector implements Effector {
  facetFilters = [{
    type: 'speech',
    attributeMatch: { agentGenerated: true }
  }];
  
  constructor(private sendMessage: (channelId: string, message: string) => Promise<void>) {}
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<any> {
    const externalActions = [];
    
    for (const change of changes) {
      if (change.type === 'added') {
        const target = change.facet.attributes?.target;
        if (target && change.facet.content) {
          externalActions.push({
            type: 'discord-send',
            description: `Send to channel ${target}`,
            channelId: target,
            message: change.facet.content
          });
          
          // Actually send the message
          await this.sendMessage(target, change.facet.content);
        }
      }
    }
    
    return { externalActions };
  }
}

// Usage example
async function example() {
  // Create Space with new architecture
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Register components
  space.addReceptor(new DiscordMessageReceptor());
  space.addEffector(new ActivationEffector());
  space.addTransform(new MessageCountTransform());
  space.addEffector(new DiscordSpeechEffector(async (channelId, message) => {
    console.log(`[Discord] Sending to ${channelId}: ${message}`);
  }));
  
  // Simulate Discord message
  space.emit({
    topic: 'discord:message',
    source: { elementId: 'discord', componentId: 'chat' },
    timestamp: Date.now(),
    payload: {
      messageId: '123',
      content: 'Hello bot!',
      author: { id: 'user123', bot: false },
      channelId: 'general'
    }
  });
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Check state
  const state = veilState.getState();
  console.log('Facets:', Array.from(state.facets.values()));
}

// Run example
example().catch(console.error);
