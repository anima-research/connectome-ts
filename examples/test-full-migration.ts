/**
 * Full Migration Example - Complete Receptor/Effector Architecture
 * 
 * This demonstrates the full migration with:
 * - ConsoleInputReceptor: console input → message + activation facets
 * - ContextTransform: activation facets → rendered-context facets  
 * - AgentEffector: activation + context → speech/action/thought facets
 * - ConsoleOutputEffector: speech facets → console output
 */

import * as readline from 'readline';
import { config } from 'dotenv';
config();

import { 
  Space,
  VEILStateManager,
  Element,
  BasicAgent,
  AnthropicProvider,
  MockLLMProvider
} from '../src';
import { ConsoleInputReceptor, ConsoleOutputEffector } from '../src/components/console-receptors';
import { ContextTransform } from '../src/hud/context-transform';
import { AgentEffector } from '../src/agent/agent-effector';

// Simple console interface
class ConsoleInterface {
  private rl: readline.Interface;
  
  constructor(private onInput: (input: string) => void) {
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
    console.log('Full Migration Test - Receptor/Effector Architecture');
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
  
  // Create LLM provider
  const provider = process.env.USE_MOCK_LLM === 'true' 
    ? new MockLLMProvider()
    : new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY!
      });
      
  if (provider instanceof MockLLMProvider) {
    console.log('Using mock LLM provider\n');
    provider.addResponse('hello', 'Hello! How are you today?');
    provider.addResponse('hi', 'Hi there! Nice to meet you!');
    provider.addResponse('test', 'This is a test response.');
    // Add more mock responses as needed
  }
  
  // Create agent
  const agent = new BasicAgent({
    config: {
      name: 'Assistant',
      systemPrompt: 'You are a helpful assistant. Keep responses brief and friendly.'
    },
    provider: provider,
    veilStateManager: veilState
  });
  
  // Register the three-phase processing pipeline:
  
  // PHASE 1: Events → Facets (Receptors)
  space.addReceptor(new ConsoleInputReceptor());
  
  // PHASE 2: VEIL → VEIL (Transforms)
  space.addTransform(new ContextTransform(veilState, undefined, {
    systemPrompt: 'You are a helpful assistant. Keep responses brief and friendly.',
    maxTokens: 4000
  }));
  
  // PHASE 3: VEIL → Events/Actions (Effectors)
  space.addEffector(new AgentEffector(agent));
  space.addEffector(new ConsoleOutputEffector((content) => {
    console.log(`\n[Assistant]: ${content}`);
  }));
  
  console.log('Pipeline registered:');
  console.log('  1. ConsoleInputReceptor → message + activation facets');
  console.log('  2. ContextTransform → rendered-context facets');
  console.log('  3. AgentEffector → speech/action/thought facets');
  console.log('  4. ConsoleOutputEffector → console output\n');
  
  // Create console interface
  const consoleInterface = new ConsoleInterface((input) => {
    console.log(`[You]: ${input}`);
    
    // Emit console input event - this triggers the whole pipeline
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
