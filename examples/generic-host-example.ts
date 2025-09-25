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
import { ConsoleChatComponent } from '../src/elements/console-chat';
import { AgentComponent } from '../src/agent/agent-component';
import { AnthropicProvider } from '../src/llm/anthropic-provider';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { Element } from '../src/spaces/element';
import { NotesElement } from '../src/elements/notes';

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
  
  async createSpace(): Promise<{ space: Space; veilState: VEILStateManager }> {
    // Create VEIL state manager
    const veilState = new VEILStateManager();
    
    // Create root space
    const space = new Space(veilState);
    
    // Register the LLM provider reference
    space.registerReference('llmProvider', this.config.llmProviderId);
    
    return { space, veilState };
  }
  
  async initialize(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🎮 Initializing console chat application...');
    
    // Create space notes element (available to all agents)
    const notesElem = new NotesElement('notes');
    space.addChild(notesElem);
    console.log('📝 Space notes available');
    
    // Create console chat element
    const consoleElem = new Element('console-chat', 'console');
    const consoleChat = new ConsoleChatComponent();
    consoleElem.addComponent(consoleChat);
    space.addChild(consoleElem);
    
    // Create agent element
    const agentElem = new Element('agent', 'agent');
    const agentComponent = new AgentComponent();
    
    // Store config for agent creation
    const agentConfig = {
      name: this.config.agentName,
      systemPrompt: this.config.systemPrompt,
      autoActionRegistration: true
    };
    
    // Save config for restoration
    (agentComponent as any).agentConfig = agentConfig;
    
    agentElem.addComponent(agentComponent);
    space.addChild(agentElem);
    
    console.log('✅ Application initialized');
  }
  
  getComponentRegistry(): typeof ComponentRegistry {
    return ComponentRegistry;
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
