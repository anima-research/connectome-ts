#!/usr/bin/env npx ts-node

/**
 * Live Discord AXON Test
 * 
 * Tests with real Discord bot connection
 */

import { Space } from '../src/spaces/space';
import { Element } from '../src/spaces/element';
import { VEILStateManager } from '../src/veil/veil-state';
import { BasicAgent } from '../src/agent/basic-agent';
import { AgentComponent } from '../src/agent/agent-component';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { AxonElement } from '../src/elements/axon-element';
import { DiscordAxonComponent } from '../src/components/discord-axon';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';

// Register component for local testing
import { ComponentRegistry } from '../src/persistence/component-registry';
ComponentRegistry.register('DiscordAxonComponent', DiscordAxonComponent);

async function runLiveTest() {
  console.log('=== Discord AXON Live Test ===\n');
  
  // Load Discord config
  const configPath = path.join(__dirname, '../../connectome-adapters/config/discord_config.yaml');
  const configContent = fs.readFileSync(configPath, 'utf8');
  const config = yaml.load(configContent) as any;
  
  const botToken = config.adapter.bot_token;
  const applicationId = config.adapter.application_id;
  
  console.log('📋 Config loaded:');
  console.log(`- Application ID: ${applicationId}`);
  console.log(`- Bot Token: ${botToken.substring(0, 20)}...`);
  
  // We need the guild ID - prompt user
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) {
    console.error('\n❌ Error: DISCORD_GUILD_ID environment variable required');
    console.error('Usage: DISCORD_GUILD_ID=your_guild_id npm run discord-live');
    console.error('\nTo get your guild ID:');
    console.error('1. Enable Developer Mode in Discord (Settings → Advanced)');
    console.error('2. Right-click your server name');
    console.error('3. Click "Copy Server ID"');
    return;
  }
  
  // Create the space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create agent with real responses
  const llm = new MockLLMProvider();
  llm.setResponses([
    'Hello Discord! I am Connectome, an AI agent framework now bridging to Discord.',
    'I can see the channel list. Which channel should I join?',
    'Great! I\'ve joined the channel. I can now see the recent message history.',
    'Hello everyone! I\'m a Connectome agent testing the Discord bridge. How is everyone today?',
    'That\'s interesting! Tell me more about that.',
    'I\'m doing well, thank you for asking! I\'m excited to be chatting on Discord.',
    'Yes, I can help with that. Let me think...',
    'Here\'s what I suggest: [provides helpful response]'
  ]);
  
  const agent = new BasicAgent({ name: 'Connectome' }, llm, veilState);
  const agentEl = new Element('agent');
  agentEl.addComponent(new AgentComponent(agent));
  space.addChild(agentEl);
  
  // Enable auto-registration
  if ('enableAutoActionRegistration' in agent) {
    (agent as any).enableAutoActionRegistration();
  }
  
  // First, check if the server is running
  console.log('\n🔍 Checking Discord AXON server...');
  try {
    const response = await fetch('http://localhost:8080/health');
    const health = await response.json();
    console.log('✅ Server is running:', health);
  } catch (error) {
    console.error('❌ Discord AXON server is not running!');
    console.error('\nPlease start the server first:');
    console.error('1. cd examples/discord-axon-server');
    console.error('2. npm install');
    console.error(`3. DISCORD_BOT_TOKEN="${botToken}" npm start`);
    return;
  }
  
  // Create Discord AXON element
  const discordUrl = `axon://localhost:8080/discord?token=${botToken}&guild=${guildId}&agent=Connectome`;
  const discord = new AxonElement({ id: 'discord' });
  
  // For local development, manually add the component
  const discordComponent = new DiscordAxonComponent();
  discord.addComponent(discordComponent);
  
  // Add to space
  space.addChild(discord);
  
  console.log('\n🔌 Connecting to Discord...');
  
  // Wait for connection
  await new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const checkConnection = setInterval(() => {
      attempts++;
      const state = veilState.getState().facets.get('discord-state');
      
      if (state?.attributes?.state === 'connected') {
        clearInterval(checkConnection);
        console.log('✅ Connected to Discord!\n');
        resolve();
      } else if (state?.attributes?.state === 'error') {
        clearInterval(checkConnection);
        console.log('❌ Connection failed:', state.attributes.error);
        reject(new Error('Connection failed'));
      } else if (attempts > 100) { // 10 seconds
        clearInterval(checkConnection);
        console.log('❌ Connection timeout');
        reject(new Error('Timeout'));
      }
    }, 100);
  });
  
  // Activate agent
  space.activateAgent('discord', { reason: 'init' });
  await new Promise(r => setTimeout(r, 500));
  
  // List channels
  console.log('📋 Fetching channel list...');
  space.emit({
    topic: 'element:action',
    source: discord.getRef(),
    payload: {
      action: 'channels',
      parameters: {}
    },
    timestamp: Date.now()
  });
  space.activateAgent('discord', { reason: 'action' });
  
  // Wait for channel list
  await new Promise(r => setTimeout(r, 2000));
  
  // Check available channels
  const discordState = veilState.getState().facets.get('discord-state');
  const channels = (discordState?.attributes as any)?.availableChannels || [];
  
  if (channels.length === 0) {
    console.log('❌ No channels found. Make sure the bot has access to text channels.');
    return;
  }
  
  console.log('\n📺 Available channels:');
  channels.forEach((ch: any) => {
    console.log(`  - #${ch.name} (${ch.id})${ch.joined ? ' [JOINED]' : ''}`);
  });
  
  // Join first available channel
  const targetChannel = channels[0];
  console.log(`\n📢 Joining #${targetChannel.name}...`);
  
  space.emit({
    topic: 'element:action',
    source: discord.getRef(),
    payload: {
      action: 'join',
      parameters: { channelId: targetChannel.id }
    },
    timestamp: Date.now()
  });
  space.activateAgent('discord', { reason: 'action' });
  await new Promise(r => setTimeout(r, 2000));
  
  // Send a test message
  console.log('\n💬 Sending test message...');
  space.emit({
    topic: 'element:action',
    source: discord.getRef(),
    payload: {
      action: 'send',
      parameters: {
        channelId: targetChannel.id,
        message: 'Hello Discord! This is Connectome testing the AXON bridge. 🚀'
      }
    },
    timestamp: Date.now()
  });
  space.activateAgent('discord', { reason: 'action' });
  await new Promise(r => setTimeout(r, 1000));
  
  // Set up message handler for responses
  console.log('\n👂 Listening for messages (press Ctrl+C to stop)...\n');
  
  let messageCount = 0;
  space.on('discord:message', async (event) => {
    messageCount++;
    const msg = event.payload;
    console.log(`[${new Date().toLocaleTimeString()}] ${msg.author}: ${msg.content}`);
    
    // Agent responds to mentions or questions
    const shouldRespond = 
      msg.content.toLowerCase().includes('connectome') ||
      msg.content.includes('?') ||
      msg.content.toLowerCase().includes('hello') ||
      msg.content.toLowerCase().includes('hi ');
    
    if (shouldRespond && msg.author !== 'Connectome') {
      console.log('  → Agent is responding...');
      
      // Activate agent with the message
      space.activateAgent('discord', { 
        reason: 'message',
        metadata: {
          message: msg.content,
          author: msg.author,
          channelId: msg.channelId
        }
      });
      
      // Small delay for natural feel
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
      
      // Agent's response (from MockLLMProvider)
      space.emit({
        topic: 'element:action',
        source: discord.getRef(),
        payload: {
          action: 'send',
          parameters: {
            channelId: msg.channelId,
            message: `@${msg.author} ${llm.getNextResponse()}`
          }
        },
        timestamp: Date.now()
      });
      space.activateAgent('discord', { reason: 'response' });
    }
  });
  
  // Show connection info
  console.log('✅ Live connection established!');
  console.log(`📍 Connected to guild: ${guildId}`);
  console.log(`📺 Active in channel: #${targetChannel.name}`);
  console.log('\n💡 The agent will respond to:');
  console.log('  - Messages mentioning "connectome"');
  console.log('  - Questions (containing "?")');
  console.log('  - Greetings (hello, hi)');
  console.log('\nPress Ctrl+C to disconnect.\n');
  
  // Keep running
  await new Promise(() => {}); // Run forever until Ctrl+C
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Disconnecting from Discord...');
  process.exit(0);
});

// Run the test
runLiveTest().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
