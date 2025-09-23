#!/usr/bin/env tsx

/**
 * Generic Connectome Host Example
 *
 * This demonstrates how to use the Connectome Host architecture
 * for any application, not just Discord. This example creates
 * a simple console-based chat application.
 */

// Load environment variables from .env file
import { config } from 'dotenv';
config();

import { ConnectomeHost } from '../src/host';
import { ConnectomeApplication } from '../src/host/types';
import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { ComponentRegistry } from '../src/persistence/component-registry';
import { ConsoleChatComponent } from '../src/components/console-chat';
import { AgentComponent } from '../src/agent/agent-component';
import { AnthropicProvider } from '../src/llm/anthropic-provider';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { Element } from '../src/spaces/element';

/**
 * Example of a simple console chat application
 */
class ConsoleApplication implements ConnectomeApplication {
  constructor(
    private config: {
      agentName: string;
      systemPrompt: string;
      llmProviderId: string;
    }
  ) {}
  
  async createSpace(): Promise<Space> {
    // Create VEIL state manager
    const veilState = new VEILStateManager();
    
    // Create root space
    const space = new Space({ 
      id: 'console-app-space',
      veilState 
    });
    
    // Register the LLM provider reference
    const llmProvider = space.getReference(this.config.llmProviderId);
    if (llmProvider) {
      space.registerReference('llmProvider', llmProvider);
    }
    
    return space;
  }
  
  async initialize(space: Space): Promise<void> {
    console.log('🎮 Initializing console chat application...');
    
    // Create console chat element
    const consoleElem = new Element({ id: 'console-chat' });
    const consoleChat = new ConsoleChatComponent();
    consoleElem.mountComponent(consoleChat);
    space.addChild(consoleElem);
    
    // Create agent element
    const agentElem = new Element({ id: 'agent' });
    const agent = new AgentComponent({
      name: this.config.agentName,
      systemPrompt: this.config.systemPrompt
    });
    agentElem.mountComponent(agent);
    space.addChild(agentElem);
    
    console.log('✅ Application initialized');
  }
  
  getComponentRegistry(): ComponentRegistry {
    return ComponentRegistry.getInstance();
  }
}

async function main() {
  console.log('🤖 Connectome Console Chat Example');
  console.log('==================================\\n');
  
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  // Create LLM provider
  const llmProvider = apiKey
    ? new AnthropicProvider({ apiKey })
    : new MockLLMProvider();
  
  if (!apiKey) {
    console.log('⚠️  No ANTHROPIC_API_KEY found, using mock responses\\n');
  }
  
  // Initialize host
  const host = new ConnectomeHost({
    persistence: {
      enabled: true,
      storageDir: './console-app-state'
    },
    debug: {
      enabled: true,
      port: 3000
    },
    providers: {
      'llm.primary': llmProvider
    }
  });
  
  // Create and start application
  const app = new ConsoleApplication({
    agentName: 'Assistant',
    systemPrompt: 'You are a helpful AI assistant.',
    llmProviderId: 'provider:llm.primary'
  });
  
  await host.start(app);
  
  console.log('\\n📝 Type your messages below (Ctrl+C to exit)\\n');
}

// Run the example
main().catch(error => {
  console.error('Failed to start:', error);
  process.exit(1);
});
