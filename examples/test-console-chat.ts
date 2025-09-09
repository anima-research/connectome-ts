/**
 * Test Console Chat Integration
 * 
 * Full end-to-end test of the system with interactive console chat.
 * Demonstrates async input handling and complete VEIL → Agent → Response flow.
 */

import { 
  Space, 
  Element,
  VEILStateManager, 
  BasicAgent,
  AnthropicProvider,
  MockLLMProvider,
  LLMProvider,
  AgentComponent,
  ConsoleChatComponent
} from '../src';
import { createDefaultTracer } from '../src/tracing';

// Create LLM provider based on environment
function createLLMProvider(): LLMProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (apiKey) {
    console.log('Using Anthropic provider (Claude 3.5 Sonnet)');
    return new AnthropicProvider({
      apiKey,
      defaultModel: 'claude-3-5-sonnet-20241022'
    });
  } else {
    console.log('No ANTHROPIC_API_KEY found, using mock provider');
    const mock = new MockLLMProvider();
    
    // Add some custom responses for testing - just plain text, no XML tags
    mock.addResponse(
      'hello', 
      'Hello! How can I assist you today?'
    );
    
    mock.addResponse(
      'hi',
      'Hi there! How are you doing today?'
    );
    
    mock.addResponse(
      'help',
      'I\'m here to help! You can ask me questions, have a conversation, or use commands like /sleep to toggle my availability.'
    );
    
    mock.addResponse(
      'weather',
      'I don\'t have access to real-time weather data, but I can help you with other questions!'
    );
    
    mock.addResponse(
      'what can you do',
      'I can help you with a variety of tasks! I can answer questions, have conversations, provide information, and assist with problem-solving. Feel free to ask me anything!'
    );
    
    // Default response
    mock.addResponse('I understand. How can I help you with that?');
    
    return mock;
  }
}

async function runConsoleChatTest() {
  console.log('=== Connectome Console Chat Test ===');
  console.log('Starting interactive console chat with full VEIL/Agent integration\n');
  
  // Create tracer for observability with file persistence
  const tracingEnabled = process.env.ENABLE_TRACING !== 'false';
  if (tracingEnabled) {
    const tracer = createDefaultTracer({
      type: 'file',
      fileConfig: {
        directory: './traces',
        maxFileSize: 50 * 1024 * 1024, // 50MB
        rotationPolicy: 'size',
        keepFiles: 5
      }
    });
    console.log('Tracing enabled - logs will be saved to ./traces directory');
    console.log('To disable tracing, set ENABLE_TRACING=false\n');
  } else {
    console.log('Tracing disabled\n');
  }
  
  // Create core components
  const veilState = new VEILStateManager();
  const llmProvider = createLLMProvider();
  
  // Create agent with system prompt
  const agent = new BasicAgent({
    name: 'Assistant',
    systemPrompt: `You're chatting through a console interface. Be yourself and keep things concise.`,
    defaultMaxTokens: 200,
    defaultTemperature: 1.0
  }, llmProvider, veilState);
  
  // Create space and attach agent
  const space = new Space(veilState);
  space.setAgent(agent);
  
  // Add agent component for automatic processing
  const agentComponent = new AgentComponent(agent);
  space.addComponent(agentComponent);
  
  // Subscribe space to all events for monitoring
  space.subscribe('*');
  
  // Create console chat element
  const consoleElement = new Element('console-chat');
  space.addChild(consoleElement);
  
  // Add console chat component
  const consoleChatComponent = new ConsoleChatComponent();
  consoleElement.addComponent(consoleChatComponent);
  
  // Subscribe to relevant events
  consoleElement.subscribe('console:*');
  consoleElement.subscribe('agent:response');
  
  console.log('System initialized with:');
  console.log('- Space with VEIL state manager');
  console.log('- Agent with', llmProvider.getProviderName(), 'provider');
  console.log('- Console chat interface');
  console.log('');
  
  // Keep the process running
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    process.exit(0);
  });
  
  // Prevent the script from exiting immediately
  // The readline interface in ConsoleChatComponent will keep it alive
  setInterval(() => {
    // Heartbeat to keep process alive
  }, 60000);
}

// Run the test
runConsoleChatTest().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
