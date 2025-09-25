/**
 * Test the full agent integration with Space/Element system
 */

import { Space, Element } from '../src/spaces';
import { VEILStateManager } from '../src/veil/veil-state';
import { BasicAgent, AgentComponent, ToolDefinition } from '../src/agent';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { Component } from '../src/spaces/component';
import { SpaceEvent } from '../src/spaces/types';

/**
 * Discord-like adapter that generates messages
 */
class DiscordAdapterComponent extends Component {
  private pendingMessages: Array<{content: string, author: string}> = [];
  
  onMount() {
    console.log('[Discord] Adapter mounted');
    
    // Subscribe to frame events to see what's happening
    this.element.subscribe('frame:*');
    this.element.subscribe('discord:message');
    
    // Queue messages to be added during next frame
    setTimeout(() => {
      this.pendingMessages.push({ content: 'Hello agent!', author: 'user123' });
      this.triggerFrame();
    }, 100);
    
    setTimeout(() => {
      this.pendingMessages.push({ content: 'Can you help me?', author: 'user123' });
      this.triggerFrame();
    }, 500);
  }
  
  private triggerFrame() {
    // Emit an event to trigger frame processing
    this.element.space.emit({
      topic: 'discord:incoming',
      source: this.element.getRef(),
      payload: {},
      timestamp: Date.now()
    });
  }
  
  private simulateMessage(content: string, author: string) {
    console.log(`\n[Discord] Message from ${author}: "${content}"`);
    
    const space = this.element.space as Space;
    const frame = space.getCurrentFrame();
    console.log(`[Discord] Current frame exists: ${!!frame}`);
    
    if (frame) {
      // Add message as event facet
      frame.operations.push({
        type: 'addFacet',
        facet: {
          id: `msg-${Date.now()}`,
          type: 'event',
          displayName: 'message',
          content: content,
          attributes: {
            author,
            channel: 'general'
          }
        }
      });
      
      // Set active stream
      frame.activeStream = {
        streamId: 'discord:general',
        streamType: 'discord',
        metadata: { channel: 'general', guild: 'test-guild' }
      };
      
      // Request agent activation
      frame.operations.push({
        type: 'addFacet',
        facet: {
          id: `agent-activation-${Date.now()}-1`,
          type: 'agentActivation',
          content: 'User sent initial message',
          attributes: {
            source: this.element.getRef().elementId,
            priority: 'normal',
            reason: 'User sent initial message'
          }
        }
      });
      
      console.log(`[Discord] Added ${frame.operations.length} operations to frame`);
    } else {
      console.log('[Discord] No active frame - triggering frame creation');
      // Emit a dummy event to trigger frame creation
      space.emit({
        topic: 'discord:message',
        source: this.element.getRef(),
        payload: { content, author },
        timestamp: Date.now()
      });
    }
  }
  
  override handleEvent(event: SpaceEvent): void {
    if (event.topic.startsWith('frame:')) {
      console.log(`[Discord] Received ${event.topic}`);
    }
    
    // Process pending messages during frame:start
    if (event.topic === 'frame:start' && this.pendingMessages.length > 0) {
      const space = this.element.space as Space;
      const frame = space.getCurrentFrame();
      
      if (frame) {
        // Process all pending messages
        for (const msg of this.pendingMessages) {
          console.log(`\n[Discord] Processing message from ${msg.author}: "${msg.content}"`);
          
          // Add message as event facet
          frame.operations.push({
            type: 'addFacet',
            facet: {
              id: `msg-${Date.now()}-${Math.random()}`,
              type: 'event',
              displayName: 'message',
              content: msg.content,
              attributes: {
                author: msg.author,
                channel: 'general'
              }
            }
          });
        }
        
        // Set active stream
        frame.activeStream = {
          streamId: 'discord:general',
          streamType: 'discord',
          metadata: { channel: 'general', guild: 'test-guild' }
        };
        
        // Request agent activation
        frame.operations.push({
          type: 'addFacet',
          facet: {
            id: `agent-activation-${Date.now()}-2`,
            type: 'agentActivation',
            content: 'Waiting user input received',
            attributes: {
              source: this.element.getRef().elementId,
              priority: 'normal',
              reason: 'Waiting user input received'
            }
          }
        });
        
        console.log(`[Discord] Added ${frame.operations.length} operations to frame`);
        
        // Clear pending messages
        this.pendingMessages = [];
      }
    }
    
    if (event.topic === 'agent:response') {
      const { content, streamRef } = event.payload as any;
      if (streamRef?.streamId === 'discord:general') {
        console.log(`[Discord] Sending to channel: "${content}"`);
      }
    }
  }
}

/**
 * Test tool that simulates looking up information
 */
const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: {
    location: { type: 'string', description: 'City name' }
  },
  handler: async (params) => {
    console.log(`[Tool] Getting weather for: ${params.location}`);
    return { temperature: 72, condition: 'sunny' };
  }
};

async function testAgentIntegration() {
  console.log('=== Testing Agent Integration ===\n');
  
  // Create core systems
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create mock LLM that responds to messages
  const mockLLM = new MockLLMProvider();
  mockLLM.addResponse(
    'Hello agent!',
    '<my_turn>\nHello! How can I assist you today?\n</my_turn>'
  );
  // Second response will match on more context
  mockLLM.addResponse(
    'Hello! How can I assist you today?',
    '<my_turn>\n<thought>The user is asking for help. I should offer my assistance.</thought>\nOf course! I\'m here to help. What do you need assistance with?\n</my_turn>'
  );
  
  // Create agent
  const agent = new BasicAgent(
    {
      name: 'Assistant',
      systemPrompt: 'You are a helpful assistant.',
      tools: [weatherTool]
    },
    mockLLM,
    veilState
  );
  
  // Add agent component to space
  const agentComponent = new AgentComponent(agent);
  space.addComponent(agentComponent);
  space.subscribe('*'); // Space listens to all events
  
  // Create Discord adapter
  const discordElement = new Element('discord-adapter');
  space.addChild(discordElement);
  
  const discordComponent = new DiscordAdapterComponent();
  discordElement.addComponent(discordComponent);
  discordElement.subscribe('agent:response');
  discordElement.subscribe('discord:*');
  
  console.log('System initialized with:');
  console.log('- Space with VEIL state manager');
  console.log('- Agent with mock LLM');
  console.log('- Discord adapter');
  
  // Let the system run
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Check for agent responses in VEIL state
  const midState = veilState.getState();
  console.log('\n--- Checking for agent responses ---');
  for (const frame of midState.frameHistory) {
    if ('operations' in frame && frame.operations.length > 0) {
      // Check if it's an outgoing frame
      const hasSpeak = frame.operations.some((op: any) => op.type === 'speak');
      if (hasSpeak) {
        console.log(`[Test] Found outgoing frame ${frame.sequence}:`);
        for (const op of frame.operations) {
          if ((op as any).type === 'speak') {
            console.log(`  Agent said: "${(op as any).content}"`);
          }
        }
      }
    }
  }
  
  // Check final state
  console.log('\n--- Final VEIL State ---');
  const state = veilState.getState();
  console.log(`Total frames: ${state.frameHistory.length}`);
  console.log(`Active facets: ${state.facets.size}`);
  
  // Show frame types
  const incomingFrames = state.frameHistory.filter(f => 'activeStream' in f).length;
  const outgoingFrames = state.frameHistory.length - incomingFrames;
  console.log(`Incoming frames: ${incomingFrames}`);
  console.log(`Outgoing frames (agent responses): ${outgoingFrames}`);
  
  // Test agent commands
  console.log('\n--- Testing Agent Commands ---');
  
  // Put agent to sleep
  space.emit({
    topic: 'agent:command',
    source: space.getRef(),
    payload: { type: 'sleep' },
    timestamp: Date.now()
  });
  
  // Try to activate while sleeping (should be ignored)
  setTimeout(() => {
    const discordComp = new DiscordAdapterComponent();
    discordComp['element'] = discordElement;
    discordComp['simulateMessage']('Are you there?', 'user456');
  }, 100);
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log('\n=== Test Complete ===');
}

testAgentIntegration().catch(console.error);
