/**
 * Test Console Chat with Receptor/Effector Architecture
 * 
 * Demonstrates the complete loop:
 * Console input → ConsoleInputReceptor → Facet → (Agent) → Speech Facet → ConsoleOutputEffector → Console output
 */

import * as readline from 'readline';
import { config } from 'dotenv';
config();

import { 
  Space,
  VEILStateManager,
  Element,
  BasicAgent,
  AgentComponent,
  AnthropicProvider,
  MockLLMProvider
} from '../src';
import { 
  ConsoleInputReceptor, 
  ConsoleOutputEffector
} from '../src/components/console-receptors';

// Simple readline wrapper
class ConsoleInterface {
  private rl: readline.Interface;
  private onInput: (input: string) => void;
  
  constructor(onInput: (input: string) => void) {
    this.onInput = onInput;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });
    
    this.rl.on('line', (input) => {
      const trimmed = input.trim();
      if (trimmed === '/quit') {
        this.close();
        return;
      }
      if (trimmed) {
        this.onInput(trimmed);
      }
      this.rl.prompt();
    });
    
    this.rl.on('close', () => {
      console.log('\nGoodbye!');
      process.exit(0);
    });
  }
  
  start() {
    console.log('Console Chat (Receptor/Effector Architecture)');
    console.log('Type messages to chat, /quit to exit\n');
    this.rl.prompt();
  }
  
  close() {
    this.rl.close();
  }
}

async function main() {
  // Create VEIL state and Space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create agent
  const provider = process.env.USE_MOCK_LLM === 'true' 
    ? new MockLLMProvider()
    : new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY!
      });
      
  if (provider instanceof MockLLMProvider) {
    console.log('Using mock LLM provider\n');
    provider.addResponse('hello', 'Hello! How are you today?');
    provider.addResponse('hi', 'Hi there! Nice to meet you!');
    // MockLLMProvider doesn't have setDefaultResponse in current implementation
  }
  
  const agent = new BasicAgent({
    config: {
      name: 'Assistant',
      systemPrompt: 'You are a helpful assistant. Keep responses brief and friendly.'
    },
    provider: provider,
    veilStateManager: veilState
  });
  
  // Create agent element and component
  const agentElement = new Element('agent', space.id);
  agentElement.addComponent(new AgentComponent(agent));
  space.addChild(agentElement);
  
  // Register receptors and effectors
  space.addReceptor(new ConsoleInputReceptor());
  space.addEffector(new ConsoleOutputEffector((content) => {
    console.log(`\n[Assistant]: ${content}`);
  }));
  
  // Create console interface
  const consoleInterface = new ConsoleInterface((input) => {
    console.log(`[You]: ${input}`);
    
    // Emit console input event
    space.emit({
      topic: 'console:input',
      source: { elementId: 'console', elementPath: [] },
      timestamp: Date.now(),
      payload: {
        input,
        timestamp: Date.now()
      }
    });
  });
  
  // Keep process alive
  process.stdin.resume();
  
  // Start the interface
  consoleInterface.start();
}

main().catch(console.error);
