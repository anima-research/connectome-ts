#!/usr/bin/env tsx
/**
 * Complete Console Chat with Host - Pure RETM Architecture
 * 
 * Demonstrates:
 * - ConsoleAfferent (external input via readline)
 * - ConsoleMessageReceptor (events → facets)
 * - ConsoleSpeechEffector (speech → console output)
 * - AgentEffector + ContextTransform (agent processing)
 * - Component-state management (VEIL-based persistence)
 * - Full Host infrastructure
 * 
 * All state in VEIL, no @persistent decorators!
 */

import { config } from 'dotenv';
config();

import {
  ConnectomeHost,
  Space,
  VEILStateManager,
  Element,
  ConsoleAfferent,
  ConsoleMessageReceptor,
  ConsoleSpeechEffector,
  AgentEffector,
  BasicAgent,
  ContextTransform,
  AnthropicProvider,
  MockLLMProvider,
  ComponentRegistry,
  ElementRequestReceptor,
  ElementTreeMaintainer
} from '../src';
import { ConnectomeApplication } from '../src/host/types';
import { AfferentContext } from '../src/spaces/receptor-effector-types';

class ConsoleApplication implements ConnectomeApplication {
  async createSpace(hostRegistry?: Map<string, any>): Promise<{ space: Space; veilState: VEILStateManager }> {
    const veilState = new VEILStateManager();
    const space = new Space(veilState, hostRegistry);
    return { space, veilState };
  }
  
  async initialize(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🎮 Initializing Console Chat application...\n');
    
    // Register components FIRST
    ComponentRegistry.register('ConsoleAfferent', ConsoleAfferent);
    
    // Add element tree infrastructure
    space.addReceptor(new ElementRequestReceptor());
    space.addMaintainer(new ElementTreeMaintainer(space));
    
    // Add console receptors/effectors
    space.addReceptor(new ConsoleMessageReceptor());
    
    // Create console element via VEIL
    space.emit({
      topic: 'element:create',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: {
        parentId: space.id,
        name: 'console',
        components: [{
          type: 'ConsoleAfferent',
          config: {
            streamId: 'console:main',
            prompt: '> '
          }
        }]
      }
    });
    
    // Wait for element creation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Find the console element and afferent
    const consoleElem = space.children.find(c => c.name === 'console');
    if (!consoleElem) {
      throw new Error('Console element not created!');
    }
    
    const consoleAfferent = consoleElem.components[0] as ConsoleAfferent;
    
    // Initialize and start the afferent
    const context: AfferentContext<any> = {
      config: {
        streamId: 'console:main',
        prompt: '> '
      },
      afferentId: 'console-main',
      emit: (event) => space.emit(event),
      emitError: (error) => console.error('[ConsoleAfferent Error]:', error)
    };
    
    await consoleAfferent.initialize(context);
    await consoleAfferent.start();
    
    // Add speech effector with reference to afferent
    space.addEffector(new ConsoleSpeechEffector(consoleAfferent));
    
    // Create agent element (for persistence, create via VEIL)
    const agentElem = new Element('agent');
    space.addChild(agentElem);
    
    // Get LLM provider from space references (registered by Host as 'provider:llm.primary')
    const llmProvider = (space as any).getReference?.('provider:llm.primary') || 
                        (space as any).getReference?.('llmProvider');
    if (!llmProvider) {
      console.error('Available references:', (space as any).listReferences?.());
      throw new Error('No LLM provider found in space references!');
    }
    
    // Create agent with LLM provider
    const agent = new BasicAgent({
      config: {
        name: 'ConsoleAgent',
        systemPrompt: `You are a helpful AI assistant in a terminal chat interface.
Be concise and friendly. You can use markdown formatting in your responses.`
      },
      provider: llmProvider,
      veilStateManager: veilState
    });
    
    // Add agent processing pipeline
    space.addEffector(new AgentEffector(agentElem, agent));
    
    const contextTransform = new ContextTransform(veilState);
    await contextTransform.mount(space); // Mount auto-registers with Space
    
    console.log('✅ Console Chat initialized\n');
    console.log('Type messages to chat with the agent');
    console.log('Commands: /quit to exit, /sleep [seconds] to sleep\n');
  }
  
  getComponentRegistry(): typeof ComponentRegistry {
    // ConsoleAfferent needs to be registered before initialize() is called
    ComponentRegistry.register('ConsoleAfferent', ConsoleAfferent);
    
    return ComponentRegistry;
  }
  
  async onStart(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🚀 Console Chat started!\n');
  }
  
  async onRestore(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('♻️  Console Chat restored from snapshot\n');
    
    // Reconnect console afferent
    const consoleElem = space.children.find(c => c.name === 'console');
    if (consoleElem) {
      const consoleAfferent = consoleElem.components[0] as ConsoleAfferent;
      
      // Re-create context and restart
      const context: AfferentContext<any> = {
        config: consoleAfferent.getComponentState(),
        afferentId: 'console-main',
        emit: (event) => space.emit(event),
        emitError: (error) => console.error('[ConsoleAfferent Error]:', error)
      };
      
      await consoleAfferent.initialize(context);
      await consoleAfferent.start();
    }
  }
}

async function main() {
  console.log('💬 Console Chat with Host - Pure RETM Architecture');
  console.log('==================================================\n');
  
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const useMock = args.includes('--mock') || process.env.USE_MOCK_LLM === 'true';
  
  if (reset) {
    console.log('🔄 Reset flag detected - starting fresh\n');
  }
  
  // Create LLM provider
  let llmProvider;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (useMock || !apiKey) {
    console.log('🤖 Using mock LLM provider\n');
    llmProvider = new MockLLMProvider();
    llmProvider.setResponses([
      "Hello! I'm here and ready to chat!",
      "That's an interesting question. Let me think about it...",
      "I understand what you're asking. Here's my thoughts on that...",
      "Great point! Let me elaborate on that.",
      "I see what you mean. Here's how I would approach that...",
      "Absolutely! That makes sense.",
      "Hmm, let me consider that for a moment...",
      "Good question! Here's what I think...",
    ]);
  } else {
    console.log('🧠 Using Anthropic Claude\n');
    llmProvider = new AnthropicProvider({
      apiKey,
      defaultModel: 'claude-3-5-sonnet-20241022',
      defaultMaxTokens: 1000,
      defaultTemperature: 1
    });
  }
  
  // Create application
  const app = new ConsoleApplication();
  
  // Create host
  const host = new ConnectomeHost({
    providers: {
      'llm.primary': llmProvider
    },
    persistence: {
      enabled: !reset,
      storageDir: './console-chat-state'
    },
    debug: {
      enabled: false  // No debug UI for console app
    },
    reset
  });
  
  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\n\n👋 Shutting down gracefully...');
    await host.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  // Start the host
  try {
    await host.start(app);
  } catch (error) {
    console.error('❌ Failed to start:', error);
    process.exit(1);
  }
}

main();
