/**
 * Full Migration Example with Debug Server
 * Tests the new attribution system with debug visibility
 */

import * as readline from 'readline';
import { config } from 'dotenv';
config();

import { 
  Space,
  VEILStateManager,
  AgentElement,
  BasicAgent,
  AnthropicProvider,
  MockLLMProvider,
  DebugServer
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
      if (trimmed === '/quit' || trimmed === 'exit') {
        console.log('Goodbye!');
        this.rl.close();
        process.exit(0);
      } else if (trimmed) {
        this.onInput(trimmed);
      }
      this.rl.prompt();
    });
  }
  
  start() {
    console.log('Full Migration Test with Debug Server');
    console.log('Type messages to chat, /quit to exit');
    console.log('Debug UI available at http://localhost:8889');
    this.rl.prompt();
  }
}

async function main() {
  // Create VEIL state and Space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Start debug server on a different port to avoid conflicts
  const debugServer = new DebugServer(space, {
    enabled: true,
    port: 8889,
    host: '127.0.0.1'
  });
  debugServer.start();
  
  // Set up agent
  const useMock = process.env.USE_MOCK_LLM === 'true';
  const provider = useMock
    ? new MockLLMProvider()
    : new AnthropicProvider({ 
        apiKey: process.env.ANTHROPIC_API_KEY!,
        defaultModel: 'claude-3-haiku-20240307' 
      });
      
  if (provider instanceof MockLLMProvider) {
    console.log('Using mock LLM provider');
  }
  
  const agent = new BasicAgent({
    config: {
      name: 'Assistant',
      systemPrompt: 'You are a helpful assistant. Keep responses brief and friendly.'
    },
    provider: provider,
    veilStateManager: veilState
  });
  
  // PHASE 1: Events → VEIL (Receptors)
  space.addReceptor(new ConsoleInputReceptor());
  
  // PHASE 2: VEIL → VEIL (Transforms)
  space.addTransform(new ContextTransform(veilState, undefined, {
    systemPrompt: 'You are a helpful assistant. Keep responses brief and friendly.',
    maxTokens: 4000
  }));
  
  // Create an agent element with proper type identification
  const agentElement = new AgentElement('Assistant', 'assistant-agent');
  space.addChild(agentElement);
  
  // PHASE 3: VEIL → Events/Actions (Effectors)
  space.addEffector(new AgentEffector(agentElement, agent));
  space.addEffector(new ConsoleOutputEffector((content) => {
    console.log(`\n[Assistant]: ${content}`);
  }));
  
  console.log('Pipeline registered:');
  console.log('  1. ConsoleInputReceptor → message + activation facets');
  console.log('  2. ContextTransform → rendered-context facets');
  console.log('  3. AgentEffector → speech/action/thought facets');
  console.log('  4. ConsoleOutputEffector → console output');
  console.log('\n');
  
  // Set up console interface
  const consoleInterface = new ConsoleInterface((input) => {
    console.log(`[You]: ${input}`);
    
    // Emit console input event
    space.emit({
      topic: 'console:input',
      source: { elementId: 'console', elementPath: ['console'] },
      timestamp: Date.now(),
      payload: { input }
    });
  });
  
  consoleInterface.start();
}

main().catch(console.error);

