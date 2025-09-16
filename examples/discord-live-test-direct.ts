#!/usr/bin/env npx ts-node

/**
 * Live Discord AXON Test (Direct Component)
 * 
 * Tests with real Discord bot connection using direct component instantiation
 */

import { Space } from '../src/spaces/space';
import { Element } from '../src/spaces/element';
import { VEILStateManager } from '../src/veil/veil-state';
import { BasicAgent } from '../src/agent/basic-agent';
import { AgentComponent } from '../src/agent/agent-component';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { DiscordAxonComponent } from '../src/components/discord-axon';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';

async function runLiveTest() {
  console.log('=== Discord AXON Live Test (Direct) ===\n');
  
  // Load Discord config
  const configPath = path.join(__dirname, '../../connectome-adapters/config/discord_config.yaml');
  const configContent = fs.readFileSync(configPath, 'utf8');
  const config = yaml.load(configContent) as any;
  
  const botToken = config.adapter.bot_token;
  const applicationId = config.adapter.application_id;
  
  console.log('📋 Config loaded:');
  console.log(`- Application ID: ${applicationId}`);
  console.log(`- Bot Token: ${botToken.substring(0, 20)}...`);
  
  // We need the guild ID
  const guildId = process.env.DISCORD_GUILD_ID || '1289595876716707911';
  
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
    console.error('1. cd ../examples/discord-axon-server');
    console.error('2. npm install');
    console.error(`3. DISCORD_BOT_TOKEN="${botToken}" npm start`);
    return;
  }
  
  // Create Discord element with component
  const discordEl = new Element('discord');
  const discordComponent = new DiscordAxonComponent();
  discordEl.addComponent(discordComponent);
  space.addChild(discordEl);
  
  // Set connection parameters directly
  discordComponent.setConnectionParams({
    host: 'localhost:8081',  // WebSocket server port
    path: '',  // /ws is added automatically
    token: botToken,
    guild: guildId,
    agent: 'Connectome'
  });
  
  // Trigger a frame to allow VEIL operations
  space.activateAgent('discord', { reason: 'init-discord' });
  await new Promise(r => setTimeout(r, 100));
  
  console.log('\n🔌 Connecting to Discord...');
  console.log('📊 Current Discord state:', veilState.getState().facets.get('discord-state'));
  
  // Wait for connection
  await new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const checkConnection = setInterval(() => {
      attempts++;
      const state = veilState.getState().facets.get('discord-state');
      
      if ((state?.attributes as any)?.state === 'connected') {
        clearInterval(checkConnection);
        console.log('✅ Connected to Discord!\n');
        resolve();
      } else if ((state?.attributes as any)?.state === 'error') {
        clearInterval(checkConnection);
        console.log('❌ Connection failed:', (state?.attributes as any)?.error);
        reject(new Error('Connection failed'));
      } else if (attempts > 100) { // 10 seconds
        clearInterval(checkConnection);
        console.log('❌ Connection timeout');
        reject(new Error('Timeout'));
      } else if (attempts % 20 === 0) { // Log every 2 seconds
        console.log(`⏳ Still waiting... (${attempts/10}s) - state:`, (state?.attributes as any)?.state || 'no state');
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
    source: discordEl.getRef(),
    payload: {
      path: [discordEl.id, 'channels'],  // [element-id, action-name]
      parameters: {}
    },
    timestamp: Date.now()
  });
  space.activateAgent('discord', { reason: 'action' });
  
  // Wait for channel list with polling
  let channels: any[] = [];
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    const discordState = veilState.getState().facets.get('discord-state');
    channels = (discordState?.attributes as any)?.availableChannels || [];
    if (channels.length > 0) break;
  }
  
  // Double-check with fresh state
  if (channels.length === 0) {
    await new Promise(r => setTimeout(r, 500));
    const discordState = veilState.getState().facets.get('discord-state');
    channels = (discordState?.attributes as any)?.availableChannels || [];
  }
  
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
    source: discordEl.getRef(),
    payload: {
      path: [discordEl.id, 'join'],
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
    source: discordEl.getRef(),
    payload: {
      path: [discordEl.id, 'send'],
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
  const processedMessages = new Set<string>();
  
  // Create a handler for Discord messages
  const handleDiscordMessage = async (event: any) => {
    if (event.topic !== 'discord:message') return;
    
    messageCount++;
    const msg = event.payload;
    
    // Extract content safely from payload (could be from different sources)
    const content = msg.content || '';
    const author = msg.author || 'unknown';
    
    console.log(`[${new Date().toLocaleTimeString()}] ${author}: ${content}`);
    
    // Agent responds to mentions or questions
    const shouldRespond = 
      content.toLowerCase().includes('connectome') ||
      content.includes('?') ||
      content.toLowerCase().includes('hello') ||
      content.toLowerCase().includes('hi');
    
    if (shouldRespond && author !== 'Connectome') {
      console.log('  → Agent is responding...');
      
      // Activate agent with the message
      space.activateAgent('discord', { 
        reason: 'message',
        metadata: {
          message: content,
          author: author,
          channelId: msg.channelId
        }
      });
      
      // Small delay for natural feel
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
      
      // Agent's response
      space.emit({
        topic: 'element:action',
        source: discordEl.getRef(),
        payload: {
          path: [discordEl.id, 'send'],
          parameters: {
            channelId: msg.channelId,
            message: `@${msg.author} I'm happy to help! How can I assist you today?`
          }
        },
        timestamp: Date.now()
      });
      space.activateAgent('discord', { reason: 'response' });
    }
  };
  
  // Poll for discord messages
  setInterval(() => {
    // Check for any discord:message events in facets
    const events = veilState.getState().facets;
    let foundMessages = 0;
    events.forEach((facet, id) => {
      if (facet.type === 'event' && id.startsWith('discord-msg-')) {
        foundMessages++;
        // Process new messages that haven't been handled
        if (!processedMessages.has(id)) {
          console.log(`📥 Processing Discord message facet: ${id}`);
          // Extract message data from facet attributes and content
          const messageData = {
            ...facet.attributes,
            content: facet.attributes?.content || '',
            // If content is not in attributes, extract from facet content
            // Format: "[Discord] author: content"
            ...(facet.content && !facet.attributes?.content ? {
              content: facet.content.replace(/^\[Discord\] [^:]+: /, '')
            } : {})
          };
          
          handleDiscordMessage({ 
            topic: 'discord:message', 
            payload: messageData 
          });
          
          // Mark as processed
          processedMessages.add(id);
        }
      }
    });
    // Debug logging every few polls
    const pollCount = Math.floor(Date.now() / 500) % 20;
    if (pollCount === 0 && foundMessages > 0) {
      console.log(`📊 Polling: ${events.size} total facets, ${foundMessages} Discord messages`);
    }
  }, 500);
  
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
