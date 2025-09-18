#!/usr/bin/env tsx

/**
 * Discord Bot Example using Connectome Host
 * 
 * This demonstrates the simplified architecture where the Host handles
 * all infrastructure concerns (persistence, restoration, debug UI, etc.)
 * and the application just defines the business logic.
 */

import { ConnectomeHost } from '../src/host';
import { DiscordApplication } from './discord-app';
import { AnthropicProvider } from '../src/llm/anthropic-provider';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
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
  
  if (reset) {
    console.log('🔄 Reset flag detected - starting fresh\n');
  }
  
  // Load Discord config
  const configPath = join(__dirname, '../../connectome-adapters/config/discord_config.yaml');
  const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
  const { bot_token: botToken, application_id: applicationId } = config.adapter;
  const guildId = config.adapter.guild || '1289595876716707911'; // Your test guild
  
  // Create LLM provider
  let llmProvider;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (apiKey) {
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
  const host = new ConnectomeHost({
    persistence: {
      enabled: true,
      storageDir: './discord-host-state'
    },
    debug: {
      enabled: true,
      port: debugPort
    },
    providers: {
      'llm.primary': llmProvider
    },
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
      autoJoinChannels: ['1289595876716707914']  // #general channel ID
    }
  });
  
  // Start the application
  try {
    const space = await host.start(app);
    
    console.log('\n📡 Discord bot is running!');
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
