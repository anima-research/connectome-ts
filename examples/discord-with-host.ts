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
  
  // Load Discord config - priority: env vars > .env file > YAML config > defaults
  let yamlConfig: any = {};
  const configPath = join(__dirname, '../discord_config.yaml');
  if (fs.existsSync(configPath)) {
    yamlConfig = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
  }

  const botToken = process.env.DISCORD_BOT_TOKEN || yamlConfig.discord?.botToken;
  const guildId = process.env.DISCORD_GUILD_ID || yamlConfig.discord?.guild || '1289595876716707911'; // Default guild
  const autoJoinChannels = process.env.DISCORD_AUTO_JOIN_CHANNELS
    ? process.env.DISCORD_AUTO_JOIN_CHANNELS.split(',')
    : yamlConfig.discord?.autoJoinChannels || ['1289595876716707914']; // Default channels
  const modulePort = parseInt(process.env.DISCORD_MODULE_PORT || '') || yamlConfig.discord?.modulePort || 8080;
  
  if (!botToken) {
    console.error('❌ No Discord bot token found!');
    console.error('   Set DISCORD_BOT_TOKEN in your environment or create a .env file');
    process.exit(1);
  }
  
  // Configure LLM provider
  const providers: Record<string, any> = {};
  
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('✅ Using Anthropic API for LLM');
    providers['provider:llm.primary'] = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultModel: 'claude-3-5-sonnet-20241022',
      defaultMaxTokens: 1000
    });
  } else {
    console.log('⚠️  No ANTHROPIC_API_KEY found, using mock provider');
    const mockProvider = new MockLLMProvider();
    mockProvider.setResponses([
      'Hello! I\'m Claude, the Connectome Discord agent. How can I help you today?',
      'That\'s interesting! Tell me more about that.',
      'I understand. Let me help you with that.',
      'Great question! Here\'s what I think...',
      'Thanks for sharing that with me. What else would you like to discuss?'
    ]);
    providers['provider:llm.primary'] = mockProvider;
  }
  
  // Replace with debug provider if requested
  if (useDebugLLM) {
    console.log('🔍 Using debug LLM provider instead of configured provider');
    providers['provider:llm.primary'] = new DebugLLMProvider({
      providerId: 'llm.primary',
      description: 'Debug LLM Provider for testing'
    });
  }
  
  // Create the Host with all infrastructure
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
    reset
  });
  
  // Create the Discord application
  const app = new DiscordApplication({
    agentName: 'Claude',
    systemPrompt: `You are Claude, an AI assistant powered by Connectome framework, now bridging to Discord.
You are helpful, harmless, and honest. You engage naturally in conversations and help users with their questions.
Remember that you're chatting on Discord, so keep responses concise and conversational.`,
    llmProviderId: 'provider:llm.primary',
    discord: {
      host: botToken,  // The bot token is passed as 'host' for backwards compatibility
      guild: guildId,
      modulePort,
      autoJoinChannels
    }
  });
  
  // Start the application with the Host
  await host.start(app);
  
  console.log('\n🎉 Discord bot is running!');
  console.log(`   Guild: ${guildId}`);
  console.log(`   Auto-join channels: ${autoJoinChannels.join(', ')}`);
  console.log(`   Debug UI: http://localhost:${debugPort}`);
  console.log('\n📝 Make sure discord-axon is running on port', modulePort);
  console.log('   Run: cd ../discord-axon && npm start\n');
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down gracefully...');
    await host.stop();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});