/**
 * Discord V2 Architecture Test
 * 
 * This test demonstrates how to integrate Discord with the new
 * Receptor/Effector/Transform/Maintainer architecture.
 */

import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { 
  Receptor, 
  Effector, 
  ReadonlyVEILState,
  FacetDelta,
  EffectorResult,
  Facet,
  SpaceEvent,
  VEILDelta
} from '../src';
import { 
  createEventFacet,
  createAgentActivation,
  createSpeechFacet
} from '../src/helpers/factories';
import { ContextTransform } from '../src/hud/context-transform';
import { 
  AgentEffector,
  MockLLMProvider,
  BasicAgent,
  AgentElement
} from '../src';

/**
 * Discord Message Receptor
 * Converts Discord message events into facets
 */
class DiscordMessageReceptor implements Receptor {
  topics = ['discord:message'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const { channelId, author, content, messageId } = event.payload as any;
    
    // Create message event facet
    const messageFacet = createEventFacet({
      id: `discord-msg-${messageId}`,
      content: `${author}: ${content}`,
      source: 'discord',
      eventType: 'discord-message',
      metadata: {
        channelId,
        author,
        messageId
      },
      streamId: `discord:${channelId}`,
      streamType: 'discord'
    });
    
    // Create activation for the agent
    const activationFacet = createAgentActivation(`Discord message from ${author}`, {
      id: `activation-${messageId}`,
      priority: 'normal',
      sourceAgentId: 'discord-user',
      sourceAgentName: author,
      streamRef: {
        streamId: `discord:${channelId}`,
        streamType: 'discord'
      }
    });
    
    return [messageFacet, activationFacet];
  }
}

/**
 * Discord Send Effector
 * Watches for speech facets directed to Discord and sends them
 */
class DiscordSendEffector implements Effector {
  facetFilters = [{ type: 'speech' }];
  
  constructor(
    private mockDiscord: MockDiscordConnection
  ) {}
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    
    for (const change of changes) {
      if (change.type === 'added' && change.facet.type === 'speech') {
        const speech = change.facet as any;
        
        // Debug: Log speech facet
        console.log('[DiscordEffector] Processing speech facet:', {
          content: speech.content,
          streamId: speech.state?.streamId,
          agentId: speech.agentId
        });
        
        // Check if this speech is for Discord
        // Speech facets may not have streamId, so check for active Discord context
        const hasDiscordContext = Array.from(state.facets.values()).some(f => 
          f.type === 'event' && (f as any).streamId?.startsWith('discord:')
        );
        
        if (hasDiscordContext || speech.state?.streamId?.startsWith('discord:')) {
          // Find the channel from recent Discord events
          let channelId = 'general'; // default
          if (speech.state?.streamId) {
            channelId = speech.state.streamId.split(':')[1];
          } else {
            // Look for recent Discord message to determine channel
            const recentDiscordEvent = Array.from(state.facets.values())
              .filter(f => f.type === 'event' && (f as any).streamId?.startsWith('discord:'))
              .pop() as any;
            if (recentDiscordEvent?.streamId) {
              channelId = recentDiscordEvent.streamId.split(':')[1];
            }
          }
          
          // Mock sending to Discord
          await this.mockDiscord.sendMessage(channelId, speech.content);
          
          // Emit confirmation event
          events.push({
            topic: 'discord:message-sent',
            source: { elementId: 'discord-effector', elementPath: [] },
            timestamp: Date.now(),
            payload: {
              channelId,
              content: speech.content,
              messageId: `sent-${Date.now()}`
            }
          });
        }
      }
    }
    
    return { events };
  }
}

/**
 * Mock Discord connection for testing
 */
class MockDiscordConnection {
  private messageHandlers: ((msg: any) => void)[] = [];
  
  async connect() {
    console.log('[MockDiscord] Connected');
  }
  
  async sendMessage(channelId: string, content: string) {
    console.log(`[MockDiscord] Sending to #${channelId}: ${content}`);
    // Simulate message being sent
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  simulateIncomingMessage(channelId: string, author: string, content: string) {
    const message = {
      channelId,
      author,
      content,
      messageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    this.messageHandlers.forEach(handler => handler(message));
  }
  
  onMessage(handler: (msg: any) => void) {
    this.messageHandlers.push(handler);
  }
}

async function main() {
  console.log('=== Discord V2 Architecture Test ===\n');
  
  // Setup
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create mock Discord connection
  const mockDiscord = new MockDiscordConnection();
  await mockDiscord.connect();
  
  // Register Discord receptor and effector
  space.addReceptor(new DiscordMessageReceptor());
  space.addTransform(new ContextTransform(veilState));
  space.addEffector(new DiscordSendEffector(mockDiscord));
  
  // Create agent
  const agentElement = new AgentElement('discord-bot');
  space.addChild(agentElement);
  
  const mockProvider = new MockLLMProvider();
  mockProvider.setResponses([
    "Hello! I'm the Discord bot. How can I help you?",
    "That's an interesting question. Let me think about it...",
    "I've processed your request. Is there anything else?"
  ]);
  
  const agent = new BasicAgent({
    config: {
      name: 'DiscordBot',
      systemPrompt: 'You are a helpful Discord bot. Keep responses brief and friendly.'
    },
    provider: mockProvider,
    veilStateManager: veilState
  });
  
  space.addEffector(new AgentEffector(agentElement, agent));
  
  // Set up Discord message handler
  mockDiscord.onMessage((msg) => {
    console.log(`\n[Discord] New message in #${msg.channelId} from ${msg.author}: "${msg.content}"`);
    
    // Emit as space event
    space.emit({
      topic: 'discord:message',
      source: { elementId: 'discord', elementPath: [] },
      timestamp: Date.now(),
      payload: msg
    });
  });
  
  console.log('1. Simulating Discord messages...\n');
  
  // Simulate incoming Discord messages
  mockDiscord.simulateIncomingMessage('general', 'User123', 'Hello bot!');
  await new Promise(resolve => setTimeout(resolve, 500));
  
  mockDiscord.simulateIncomingMessage('general', 'User456', 'Can you help me with something?');
  await new Promise(resolve => setTimeout(resolve, 500));
  
  mockDiscord.simulateIncomingMessage('support', 'User789', 'I need assistance');
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log('\n2. Checking final state...');
  
  const state = veilState.getState();
  console.log(`- Total frames: ${state.currentSequence}`);
  console.log(`- Total facets: ${state.facets.size}`);
  
  // Count facet types
  const facetTypes = new Map<string, number>();
  for (const [, facet] of state.facets) {
    const count = facetTypes.get(facet.type) || 0;
    facetTypes.set(facet.type, count + 1);
  }
  
  console.log('\n3. Facet breakdown:');
  for (const [type, count] of facetTypes) {
    console.log(`  ${type}: ${count}`);
  }
  
  console.log('\n✅ Discord V2 integration test complete!');
  console.log('\nKey aspects demonstrated:');
  console.log('- Discord messages converted to facets via Receptor');
  console.log('- Agent activation triggered by Discord messages');
  console.log('- Context generated for agent responses');
  console.log('- Agent speech sent back to Discord via Effector');
}

main().catch(console.error);
