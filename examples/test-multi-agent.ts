/**
 * Test multi-agent VEIL operations
 */

import { ConnectomeHost } from '../src/host';
import { BasicAgent } from '../src/agent/basic-agent';
import { AgentComponent } from '../src/agent/agent-component';
import { Element } from '../src/spaces/element';
import { VEILComponent } from '../src/components/base-components';
import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { ConnectomeApplication } from '../src/host/types';
import { AgentConfig } from '../src/agent/types';
import { ConsoleChatComponent } from '../src/elements/console-chat';

// Custom agent component that handles config
class ConfiguredAgentComponent extends AgentComponent {
  constructor(config: AgentConfig) {
    super();
    // Set agentConfig directly - parent class will create agent in onReferencesResolved
    (this as any).agentConfig = config;
  }
}

// Create a component to observe multi-agent interactions
class MultiAgentObserver extends VEILComponent {
  onMount() {
    console.log('[Observer] Mounted');
    this.element.subscribe('*'); // Subscribe to all events
    
    // Check active agents every 2 seconds
    setInterval(() => {
      const veilState = this.element.findSpace()?.veilState?.getState();
      if (veilState) {
        console.log('\n=== Active Agents ===');
        veilState.agents.forEach((agent, id) => {
          console.log(`- ${agent.name} (${id}): ${agent.type}`);
        });
        
        // Show recent speech facets with agent attribution
        const recentSpeech = Array.from(veilState.facets.values())
          .filter(f => f.type === 'speech' && f.attributes?.agentGenerated)
          .slice(-3);
          
        if (recentSpeech.length > 0) {
          console.log('\n=== Recent Agent Speech ===');
          recentSpeech.forEach(facet => {
            const agentName = facet.attributes?.agentName || 'Unknown';
            console.log(`[${agentName}]: ${facet.content}`);
          });
        }
        console.log('==================\n');
      }
    }, 2000);
  }
  
  handleEvent(event: any) {
    if (event.topic === 'agent:frame-ready') {
      const { agentId, agentName } = event.payload;
      console.log(`[Observer] Agent response from ${agentName} (${agentId})`);
    }
  }
}

// Define the application
class MultiAgentApp implements ConnectomeApplication {
  name = 'MultiAgentTest';
  
  async createSpace(hostRegistry?: Map<string, any>): Promise<{ space: Space; veilState: VEILStateManager }> {
    const veilState = new VEILStateManager();
    const space = new Space(veilState, hostRegistry);
    
    // Create Alice agent
    const aliceElement = new Element('agent-alice', 'Alice');
    const aliceConfig: AgentConfig = {
      name: 'Alice',
      systemPrompt: `You are Alice, a helpful AI assistant who loves poetry. 
      Keep your responses brief (1-2 sentences).
      You can see messages from other agents in the conversation.`,
      modelName: 'claude-3-5-sonnet-20241022',
      temperature: 0.7
    };
    const aliceComponent = new ConfiguredAgentComponent(aliceConfig);
    await aliceElement.addComponentAsync(aliceComponent);
    
    // Create Bob agent
    const bobElement = new Element('agent-bob', 'Bob');
    const bobConfig: AgentConfig = {
      name: 'Bob',
      systemPrompt: `You are Bob, a technical AI assistant who loves math and science.
      Keep your responses brief (1-2 sentences).
      You can see messages from other agents in the conversation.`,
      modelName: 'claude-3-5-sonnet-20241022',
      temperature: 0.7
    };
    const bobComponent = new ConfiguredAgentComponent(bobConfig);
    await bobElement.addComponentAsync(bobComponent);
    
    // Create observer
    const observerElement = new Element('observer', 'Observer');
    const observer = new MultiAgentObserver();
    await observerElement.addComponentAsync(observer);
    
    // Create console chat for user input
    const consoleElement = new Element('console', 'Console');
    const consoleChat = new ConsoleChatComponent();
    await consoleElement.addComponentAsync(consoleChat);
    
    // Add elements to space
    space.addChild(aliceElement);
    space.addChild(bobElement);
    space.addChild(observerElement);
    space.addChild(consoleElement);
    
    return { space, veilState };
  }
  
  async initialize(space: Space): Promise<void> {
    // No additional initialization needed - agents are created in components
  }
}

async function main() {
  console.log('Starting multi-agent test...');
  
  // Create LLM provider
  const { AnthropicProvider } = await import('../src/llm/anthropic-provider');
  const llmProvider = new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY || 'test-key'
  });
  
  const host = new ConnectomeHost({
    debug: { enabled: true, port: process.env.DEBUG_PORT ? parseInt(process.env.DEBUG_PORT) : 3000 },
    providers: {
      'llm.primary': llmProvider
    }
  });
  
  const app = new MultiAgentApp();
  await host.start(app);
  
  console.log('\n✅ Multi-agent system started!');
  console.log('📍 Debug UI: http://localhost:3000');
  console.log('\nThe system now tracks which agent creates each facet.');
  console.log('Use the Debug UI to activate specific agents and see attribution.');
  console.log('\nTry sending agent:activate events with different targeting:');
  console.log('- targetAgent: "Alice" - Only Alice will respond');
  console.log('- targetAgent: "Bob" - Only Bob will respond');
  console.log('- targetAgentId: "agent-alice" - Target by ID (preferred)');
  console.log('- targetAgentId: "agent-bob" - Target by ID (preferred)');
  console.log('- no target - Both agents may respond\n');
  console.log('All agent-generated facets now include:');
  console.log('- agentId: The ID of the agent that created it');
  console.log('- agentName: The human-readable name');
  console.log('\nActivation facets can include:');
  console.log('- sourceAgentId/sourceAgentName: Who triggered the activation');
  console.log('- targetAgentId/targetAgent: Which agent should respond\n');
  
  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await host.stop();
    process.exit(0);
  });
}

main().catch(console.error);