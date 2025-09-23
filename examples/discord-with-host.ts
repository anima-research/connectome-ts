#!/usr/bin/env tsx

/**
 * Discord Bot Example using Connectome Host
 *
 * This demonstrates the simplified architecture where the Host handles
 * all infrastructure concerns (persistence, restoration, debug UI, etc.)
 * and the application just defines the business logic.
 */

// Load environment variables from .env file
import { config } from 'dotenv';
config();

import { ConnectomeHost } from '../src/host';
import { DiscordApplication } from './discord-app';
import { AnthropicProvider } from '../src/llm/anthropic-provider';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { DebugLLMProvider } from '../src/llm/debug-llm-provider';
import { join } from 'path';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

async function main() {
  console.log('🤖 Connectome Discord Bot with Host Architecture');
  console.log('================================================\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const debugPort = parseInt(args.find(a => a.startsWith('--debug-port='))?.split('=')[1] || '3000');
  const useDebugLLM = args.includes('--debug-llm');
  
  if (reset) {
    console.log('🔄 Reset flag detected - starting fresh\n');
  }
  
  // Load Discord config - environment variables override YAML config
  let config: any = {};
  const configPath = join(__dirname, '../discord_config.yaml');
  if (fs.existsSync(configPath)) {
    config = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
  }

  const botToken = process.env.DISCORD_BOT_TOKEN || config.discord?.botToken;
  const guildId = process.env.DISCORD_GUILD_ID || config.discord?.guild || '1289595876716707911'; // Default guild
  const autoJoinChannels = process.env.DISCORD_AUTO_JOIN_CHANNELS
    ? process.env.DISCORD_AUTO_JOIN_CHANNELS.split(',')
    : config.discord?.autoJoinChannels || ['1289595876716707914']; // Default channels
  const modulePort = parseInt(process.env.DISCORD_MODULE_PORT || '') || config.discord?.modulePort || 8080;

  // Validate required Discord configuration
  if (!botToken) {
    console.error('❌ Discord bot token is required!');
    console.error('   Set DISCORD_BOT_TOKEN environment variable or configure discord.botToken in discord_config.yaml');
    process.exit(1);
  }

  console.log('🔧 Discord Configuration:');
  console.log(`   Guild ID: ${guildId}`);
  console.log(`   Auto-join channels: ${autoJoinChannels.join(', ')}`);
  console.log(`   Module port: ${modulePort}`);
  console.log(`   Bot token: ${botToken.substring(0, 10)}...\n`);

  // Create LLM provider
  let llmProvider;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (useDebugLLM) {
    console.log('🧪 Using Debug LLM provider (manual UI mode)');
    llmProvider = new DebugLLMProvider({ description: 'Discord Bot Debug Mode' });
  } else if (apiKey) {
    console.log('✅ Using Anthropic provider with Claude');
    llmProvider = new AnthropicProvider({
      apiKey,
      defaultModel: 'claude-3-5-sonnet-20240620',
      defaultMaxTokens: 1000
    });
  } else {
    console.log('⚠️  No ANTHROPIC_API_KEY found, using mock provider');
    const mockProvider = new MockLLMProvider();
    
    // Set some responses for the mock
    mockProvider.setResponses([
      "Hello! I'm Connectome, your AI assistant. How can I help you today?",
      "That's an interesting question! Let me think about that...",
      "I'm connected to Discord and ready to chat!",
      "Feel free to ask me anything - I'm here to help.",
      "I see you're testing the new Host architecture. It's working great!",
      "The Host handles all the infrastructure concerns like persistence and restoration.",
      "Components can now declare their dependencies with @reference decorators.",
      "This makes the whole system much more modular and maintainable.",
    ]);
    
    llmProvider = mockProvider;
  }
  
  // Create the Host with configuration
  const providers: Record<string, any> = {
    'llm.primary': llmProvider
  };
  
  // Only add debug provider if debug LLM is enabled
  if (useDebugLLM) {
    providers['llm.debug'] = new DebugLLMProvider({ description: 'UI manual mode' });
  }
  
  const host = new ConnectomeHost({
    persistence: {
      enabled: true,
      storageDir: './discord-host-state'
    },
    debug: {
      enabled: true,
      port: debugPort
    },
    providers,
    secrets: {
      'discord.token': botToken
    },
    reset
  });
  
  // Create the Discord application
  const app = new DiscordApplication({
    agentName: 'Connectome',
    systemPrompt: `You are Connectome, a helpful AI assistant in Discord.
You can join channels, send messages, and have conversations with users.
You remember all previous conversations and can reference them.
Be friendly, helpful, and engaging!`,
    llmProviderId: 'provider:llm.primary',
    discord: {
      host: 'localhost:8081',
      guild: guildId,
      modulePort: modulePort,  // The Discord AXON server runs module serving
      autoJoinChannels: autoJoinChannels  // Channels to auto-join from config
    }
  });
  
  // Start the application
  try {
    const space = await host.start(app);
    
    console.log('\n📡 Discord bot is running!');
    if (useDebugLLM) {
      console.log('🧪 Debug LLM mode active - use the debug UI to complete responses manually');
      console.log(`🌐 Debug UI available at: http://localhost:${debugPort}`);
      console.log('📝 Navigate to "Manual LLM Completions" panel to handle requests');
    }
    console.log('Send messages in Discord to interact with the bot.\n');
    
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
