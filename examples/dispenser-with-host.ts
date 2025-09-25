#!/usr/bin/env tsx

/**
 * Box Dispenser Example using Connectome Host
 *
 * This demonstrates the complete Host architecture with:
 * - Automatic persistence and restoration
 * - Debug UI for observability
 * - Dependency injection for LLM providers
 * - Clean separation of concerns
 * 
 * The dispenser is a good regression test for:
 * - Dynamic element creation (boxes)
 * - Component interactions
 * - State management
 * - Action registration and handling
 */

// Load environment variables from .env file
import { config } from 'dotenv';
config();

import { ConnectomeHost } from '../src/host';
import { DispenserApplication } from './dispenser-app';
import { AnthropicProvider } from '../src/llm/anthropic-provider';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { DebugLLMProvider } from '../src/llm/debug-llm-provider';

async function main() {
  console.log('📦 Connectome Box Dispenser with Host Architecture');
  console.log('=================================================\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const debugPort = parseInt(args.find(a => a.startsWith('--debug-port='))?.split('=')[1] || '4000');
  const useDebugLLM = args.includes('--debug-llm');
  const enableConsole = !args.includes('--no-console');
  const autoDispense = args.includes('--auto-dispense');
  
  // Show help if requested
  if (args.includes('--help')) {
    console.log('Usage: npm run example:dispenser [options]\n');
    console.log('Options:');
    console.log('  --reset          Start fresh (clear persisted state)');
    console.log('  --debug-port=N   Set debug UI port (default: 4000)');
    console.log('  --debug-llm      Use manual LLM mode via debug UI');
    console.log('  --no-console     Disable console chat interface');
    console.log('  --auto-dispense  Auto-dispense a box on startup');
    console.log('  --help           Show this help message\n');
    process.exit(0);
  }
  
  if (reset) {
    console.log('🔄 Reset flag detected - starting fresh\n');
  }
  
  // Create LLM provider
  let llmProvider;
  let contentProvider;  // For box content generation
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (useDebugLLM) {
    console.log('🧪 Using Debug LLM provider (manual UI mode)');
    llmProvider = new DebugLLMProvider({ description: 'Dispenser Agent Debug Mode' });
    contentProvider = new MockLLMProvider();  // Use mock for content generation in debug mode
  } else if (apiKey) {
    console.log('✅ Using Anthropic provider with Claude');
    const anthropic = new AnthropicProvider({
      apiKey,
      defaultModel: 'claude-3-5-sonnet-20241022',
      defaultMaxTokens: 500
    });
    llmProvider = anthropic;
    contentProvider = anthropic;  // Use same provider for content
  } else {
    console.log('⚠️  No ANTHROPIC_API_KEY found, using mock provider');
    const mockProvider = new MockLLMProvider();
    
    // Set some responses for the mock
    mockProvider.setResponses([
      "Oh, a new box appeared! Let me take a look at what's inside.",
      "Interesting! This box contains something unique.",
      "I've changed the settings as requested. The next box will be different!",
      "Let me open this box and see what treasures it holds.",
      "The box is now closed. What shall we do next?",
      "*shakes the box* I can hear something rattling inside!",
      "Welcome to the Box Dispenser! You can ask me to dispense boxes, change their size or color, and interact with them.",
      "Each box contains mysterious items that I generate. Try opening one!",
      "The dispenser hums with anticipation, ready to create more boxes.",
    ]);
    
    llmProvider = mockProvider;
    contentProvider = mockProvider;
  }
  
  // Create the Host with configuration
  const host = new ConnectomeHost({
    persistence: {
      enabled: true,
      storageDir: './dispenser-host-state'
    },
    debug: {
      enabled: true,
      port: debugPort
    },
    providers: {
      'llm.primary': llmProvider,
      'llm.content': contentProvider
    },
    reset
  });
  
  // Create the Dispenser application
  const app = new DispenserApplication({
    agentName: 'Dispenser Assistant',
    systemPrompt: `You are the Dispenser Assistant, managing a magical box dispenser.

The dispenser creates mysterious boxes with unique contents. You can:
- Dispense new boxes with @dispenser.dispense()
- Change box size with @dispenser.setSize("small"|"medium"|"large")
- Change box color with @dispenser.setColor("red"|"blue"|"green"|"rainbow")
- Open boxes with @box-N.open()
- Close boxes with @box-N.close()
- Shake boxes with @box-N.shake()

Be playful and curious about the box contents. React to state changes and user actions.
Keep responses concise and engaging. When boxes are created or opened, comment on their contents!`,
    llmProviderId: 'llm.primary',
    enableConsole: enableConsole,
    autoDispenseOnStart: autoDispense,
    initialSettings: {
      size: 'medium',
      color: 'blue'
    }
  });
  
  // Start the application
  try {
    const space = await host.start(app);
    
    console.log('\n🎯 Box Dispenser is running!');
    
    if (useDebugLLM) {
      console.log('🧪 Debug LLM mode active - use the debug UI to complete responses manually');
      console.log('📝 Navigate to "Manual LLM Completions" panel to handle requests');
    }
    
    if (enableConsole) {
      console.log('\n💬 Console chat is enabled - type messages to interact');
      console.log('📝 You can also use actions directly like: @dispenser.dispense()');
    } else {
      console.log('\n💡 Console chat disabled - use the debug UI to interact');
    }
    
    console.log('\n📦 Try these commands:');
    console.log('   @dispenser.dispense() - Create a new box');
    console.log('   @dispenser.setSize("large") - Make bigger boxes');
    console.log('   @dispenser.setColor("rainbow") - Make colorful boxes');
    console.log('   @box-1.open() - Open the first box');
    console.log('   @box-1.shake() - Shake the first box\n');
    
    // Keep the process alive
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down...');
      await host.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start:', error);
    process.exit(1);
  }
}

// Run the application
main().catch(console.error);
