#!/usr/bin/env ts-node
import { ConnectomeHost } from '../src/host/host';
import { ConnectomeApplication } from '../src/host/types';
import { DebugLLMProvider } from '../src/llm/debug-llm-provider';
import { LLMMessage } from '../src/llm/llm-interface';
import { Component } from '../src/spaces/component';
import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { ComponentRegistry as PersistenceRegistry } from '../src/persistence/component-registry';
import { Element } from '../src/spaces/element';

// Simple component that uses LLM
class TestLLMComponent extends Component {
  constructor(private llmProvider: DebugLLMProvider) {
    super();
  }
  
  async askQuestion(question: string): Promise<string> {
    
    console.log(`\n📝 Asking debug LLM: "${question}"`);
    
    const messages: LLMMessage[] = [
      { role: 'user', content: question }
    ];
    
    try {
      const response = await this.llmProvider.generate(messages);
      console.log(`✅ Received response: "${response.content}"`);
      return response.content;
    } catch (error) {
      console.error('❌ Error from LLM:', error);
      throw error;
    }
  }
}

// Register component
PersistenceRegistry.register('TestLLMComponent', TestLLMComponent);

// Simple test application with debug LLM
class TestDebugLLMApp implements ConnectomeApplication {
  constructor(private debugLLM: DebugLLMProvider) {}
  
  async createSpace() {
    const veilState = new VEILStateManager();
    const space = new Space(veilState);
    return { space, veilState };
  }
  
  async initialize(space: Space, veilState: VEILStateManager) {
    // Create test element with LLM component
    const testElement = new Element('test-llm', 'Test LLM Element');
    const component = new TestLLMComponent(this.debugLLM);
    await testElement.addComponentAsync(component);
    space.addChild(testElement);
    
    // Ask a few questions after a delay to ensure everything is mounted
    setTimeout(async () => {
      try {
        await component.askQuestion("What is 2 + 2?");
        await component.askQuestion("Tell me about TypeScript");
        await component.askQuestion("How does Connectome work?");
      } catch (error) {
        console.error('Failed to ask questions:', error);
      }
    }, 1000);
  }
  
  getComponentRegistry() {
    return PersistenceRegistry;
  }
}

// Main
async function main() {
  console.log('🚀 Starting test debug LLM application...');
  console.log('📌 Debug server will be on port 3015');
  console.log('🔌 Connect MCP with: connect({ port: 3015 })');
  console.log('💡 Then use getDebugLLMRequests() to see pending requests');
  console.log('✏️  Complete with: completeDebugLLMRequest({ requestId: "...", content: "..." })');
  
  // Create debug LLM provider
  const debugLLM = new DebugLLMProvider({ description: 'Test Debug LLM' });
  
  // Create host with debug enabled
  const host = new ConnectomeHost({
    debug: {
      enabled: true,
      port: 3015
    },
    providers: {
      'llm.debug': debugLLM
    }
  });
  
  // Create and start application
  const app = new TestDebugLLMApp(debugLLM);
  await host.start(app);
  
  console.log('\n⏳ Application is running. Pending LLM requests should be visible in debug UI.');
  console.log('Press Ctrl+C to exit.\n');
}

// Run
main().catch(console.error);
