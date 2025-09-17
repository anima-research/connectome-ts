import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { BasicAgent } from '../src/agent/basic-agent';
import { AgentComponent } from '../src/agent/agent-component';
import { TransitionManager } from '../src/persistence/transition-manager';
import { FileStorageAdapter } from '../src/persistence/file-storage';
import { Element } from '../src/spaces/element';
import { ComponentRegistry } from '../src/persistence/component-registry';
import { IncomingVEILFrame } from '../src/veil/types';
import { DiscordChatComponent } from '../src/components/discord-chat';
import { AnthropicProvider } from '../src/llm/anthropic-provider';
import { LLMProvider } from '../src/llm/llm-interface';
import { createDefaultTracer } from '../src/tracing';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

// Register all core components
import '../src/core-components';

// Load Discord config
const configPath = path.join(__dirname, '../../connectome-adapters/config/discord_config.yaml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;

console.log('\n=== Discord Persistent Agent Test ===\n');

// Parse command line args
const args = process.argv.slice(2);
const command = args[0] || 'start';

// Initialize file-based tracing
const traceDir = path.resolve(__dirname, '../../discord-agent-traces');
createDefaultTracer({
  type: 'file',
  fileConfig: {
    directory: traceDir,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    rotationPolicy: 'size',
    keepFiles: 10
  }
});
console.log(`📊 Tracing enabled: ${traceDir}\n`);

// Storage directory for persistence
const storageDir = path.join(__dirname, '../../discord-agent-state');
if (!existsSync(storageDir)) {
  mkdirSync(storageDir, { recursive: true });
}

// Check if saved state exists
function hasExistingState(): boolean {
  const snapshotDir = path.join(storageDir, 'snapshots');
  if (!existsSync(snapshotDir)) return false;
  
  try {
    const files = readdirSync(snapshotDir);
    return files.some(f => f.endsWith('.json'));
  } catch {
    return false;
  }
}

// Clear all saved state
function clearState(): void {
  console.log('🗑️  Clearing all saved state...');
  if (existsSync(storageDir)) {
    rmSync(storageDir, { recursive: true, force: true });
    mkdirSync(storageDir, { recursive: true });
  }
  console.log('✅ State cleared');
}

async function createNewAgent() {
  console.log('🚀 Starting new Discord agent...\n');
  
  // Create core systems
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Enable debug server
  space.enableDebugServer({ port: 8889 });
  console.log('🔍 Debug UI available at http://localhost:8889\n');
  
  // Create persistence manager with correct storage path (must be absolute)
  const persistence = new TransitionManager(space, veilState, {
    storagePath: path.resolve(storageDir)
  });
  
  // Create LLM provider
  let llm: LLMProvider;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (apiKey) {
    console.log('✅ Using Anthropic provider with Claude');
    llm = new AnthropicProvider({
      apiKey,
      defaultModel: 'claude-3-5-sonnet-20240620',
      defaultMaxTokens: 1000
    });
  } else {
    console.log('⚠️  No ANTHROPIC_API_KEY found, using mock provider');
    console.log('   To use a real LLM: export ANTHROPIC_API_KEY="your-api-key"');
    const { MockLLMProvider } = await import('../src/llm/mock-llm-provider');
    llm = new MockLLMProvider();
    
    // Set up mock responses
    const responses = [
      "Hello! I'm Connectome, your AI assistant. How can I help you today?",
      "That's an interesting question! Let me think about that...",
      "I remember our previous conversation. You were asking about...",
      "Based on what we discussed earlier, I think...",
      "Great to see you again! Shall we continue where we left off?",
      "I'm here to help! What would you like to know?",
      "That reminds me of something we talked about before...",
      "I've been thinking about your earlier question, and..."
    ];
    (llm as any).setResponses(responses);
  }
  
  // Create agent
  const agentConfig = {
    id: 'discord-agent',
    displayName: 'Connectome Agent',
    systemPrompt: `You are Connectome, a helpful AI assistant operating in a Discord server. You ARE actually connected to Discord through the Connectome bridge system.

When you see Discord messages from users (marked with [Discord]), these are REAL messages from REAL Discord users. Respond to them naturally and conversationally.

Keep your responses concise and friendly. You're a helpful Discord bot, so engage naturally with the users just like any other Discord bot would.`
  };
  const agent = new BasicAgent(agentConfig, llm, veilState);
  agent.enableAutoActionRegistration();
  
  // Create agent element and component
  const agentEl = new Element('discord-agent');
  const agentComponent = new AgentComponent();
  agentComponent.setAgent(agent);
  agentEl.addComponent(agentComponent);
  space.addChild(agentEl);
  
  // Create Discord element with chat component
  const discord = new Element('discord');
  const discordComponent = new DiscordChatComponent();
  discord.addComponent(discordComponent);
  space.addChild(discord);
  
  // Configure Discord connection
  const { bot_token: botToken, application_id: applicationId } = config.adapter;
  const guildId = '1289595876716707911'; // Hardcoded guild ID
  
  console.log('📋 Discord config:');
  console.log(`- Bot Token: ${botToken.substring(0, 24)}...`);
  console.log(`- Guild ID: ${guildId}`);
  console.log(`- Agent Name: Connectome\n`);
  
  // Space already has veilState from constructor
  // Wire up agent responses  
  space.subscribe('agent:frame-ready');
  
  // Activate agent
  space.activateAgent('discord-agent', { reason: 'init' });
  
  // Wait for first frame to process
  await new Promise(r => setTimeout(r, 500));
  
  // Configure Discord component
  discordComponent.setConnectionParams({
    host: 'localhost:8081',
    path: '/ws',
    token: botToken,
    guild: guildId,
    agent: 'Connectome'
  });
  
  // Process a frame to ensure Discord component initializes
  space.activateAgent('discord', { reason: 'init-discord' });
  
  // Wait a bit for the connection event to be emitted
  await new Promise(r => setTimeout(r, 100));
  
  // Wait for connection with status checks
  console.log('⏳ Waiting for Discord connection...');
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    
    const state = veilState.getState();
    const discordState = Array.from(state.facets.values()).find((f: any) => f.id === 'discord-state') as any;
    
    if (discordState?.attributes?.state === 'connected') {
      console.log('✅ Connected after', i + 1, 'seconds');
      break;
    } else if (i === 9) {
      console.log('❌ Connection timeout after 10 seconds');
      console.log('Final Discord state:', discordState);
    } else {
      console.log(`   Attempt ${i + 1}/10: ${discordState?.attributes?.state || 'no state'}`);
    }
  }
  
  // Final check
  const state = veilState.getState();
  const discordState = Array.from(state.facets.values()).find((f: any) => f.id === 'discord-state') as any;
  
  if (discordState?.attributes?.state === 'connected') {
    console.log('✅ Connected to Discord!\n');
    
    // Join general channel
    space.emit({
      topic: 'element:action',
      source: discord.getRef(),
      payload: {
        path: [discord.id, 'join'],
        parameters: { channelId: '1289595876716707914' } // #general
      },
      timestamp: Date.now()
    });
    space.activateAgent('discord-agent', { reason: 'join' });
    
    await new Promise(r => setTimeout(r, 2000));
    
    console.log('📢 Joined #general\n');
    
    // Configure chat triggers
    discordComponent.setTriggerConfig({
      mentions: true,
      keywords: ['hi', 'hello', 'help', '?', 'connectome'],
      cooldown: 2
    });
    
    console.log('💬 Agent is now live in Discord!');
    console.log('   - Responds to mentions');
    console.log('   - Responds to keywords: hi, hello, help, ?, connectome\n');
    
    // Save state periodically
    setInterval(async () => {
      const snapshot = await persistence.createSnapshot();
      console.log(`💾 Saved state (${state.facets.size} facets, ${state.frameHistory.length} frames)`);
    }, 30000); // Every 30 seconds
    
    return { space, veilState, persistence };
  } else {
    console.error('❌ Failed to connect to Discord');
    process.exit(1);
  }
}

async function restoreAgent() {
  console.log('🔄 Restoring Discord agent...\n');
  
  // Load Discord config
  const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
  
  // Check if we have saved state
  const storage = new FileStorageAdapter(storageDir);
  const snapshots = await storage.listSnapshots();
  console.log('Available snapshots:', snapshots);
  
  if (snapshots.length === 0) {
    console.log('❌ No saved state found. Use "start" to create a new agent.');
    process.exit(1);
  }
  
  // Create systems
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Enable debug server
  space.enableDebugServer({ port: 8889 });
  console.log('🔍 Debug UI available at http://localhost:8889\n');
  
  const persistence = new TransitionManager(space, veilState, {
    storagePath: path.resolve(storageDir)
  });
  
  // Get latest snapshot
  const latestSnapshot = snapshots[snapshots.length - 1];
  console.log(`📁 Loading snapshot: ${latestSnapshot}`);
  
  // Restore state
  console.log('Restoring from:', latestSnapshot);
  // Extract sequence number from filename like "snapshot-13-main.json"
  const match = latestSnapshot.match(/snapshot-(\d+)-/);
  const sequence = match ? parseInt(match[1]) : undefined;
  console.log('Extracted sequence:', sequence);
  await persistence.restore(sequence);
  
  console.log(`✅ Restored state:`);
  console.log(`   - ${space.children.length} elements`);
  console.log(`   - ${veilState.getState().facets.size} facets`);
  console.log(`   - ${veilState.getState().frameHistory.length} frames in history\n`);
  
  // Show recent conversation
  console.log('📜 Recent conversation:');
  const recentFrames = veilState.getState().frameHistory.slice(-10);
  
  if (recentFrames.length === 0) {
    console.log('   (No conversation history found)');
  } else {
    console.log(`   Found ${recentFrames.length} recent frames`);
    let conversationFound = false;
    
    recentFrames.forEach((frame: any, idx: number) => {
      // Debug: show frame structure
      console.log(`   Frame ${idx}: type=${frame.type}, seq=${frame.sequence}, ops=${frame.operations?.length || 0}`);
      
      // Look for speak operations in outgoing frames
      if (frame.operations) {
        frame.operations.forEach((op: any) => {
          if (op.type === 'speak') {
            console.log(`   🤖 Agent: ${op.content.substring(0, 60)}...`);
            conversationFound = true;
          }
          // Look for Discord messages
          if (op.type === 'addFacet' && op.facet?.id?.includes('discord-msg-')) {
            const author = op.facet.attributes?.author || 'unknown';
            const content = op.facet.attributes?.content || op.facet.content || '(no content)';
            console.log(`   💬 ${author}: ${content.substring(0, 60)}...`);
            conversationFound = true;
          }
        });
      }
    });
    
    if (!conversationFound) {
      console.log('   (No conversation content found in frames)');
    }
  }
  console.log('');
  
  // Get Discord element and agent
  console.log('Space children:', space.children.map(c => ({ id: c.id, components: c.components.length })));
  const discord = space.findChild('discord');
  const discordComponent = discord?.components[0] as DiscordChatComponent;
  const agentEl = space.findChild('discord-agent');
  const agentComponent = agentEl?.components[0] as AgentComponent;
  console.log('Agent element:', agentEl?.id, 'component:', agentComponent?.constructor.name);
  const agent = agentComponent ? (agentComponent as any).agent as BasicAgent : null;
  
  if (!discord || !agentComponent) {
    console.error('❌ Could not find Discord element or agent component in restored state');
    console.error('Discord element:', discord?.id);
    console.error('Agent element:', agentEl?.id);
    console.error('Agent component:', agentComponent);
    process.exit(1);
  }
  
  // Create LLM provider (same logic as createNewAgent)
  let llm: LLMProvider;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (apiKey) {
    console.log('✅ Using Anthropic provider with Claude');
    llm = new AnthropicProvider({
      apiKey,
      defaultModel: 'claude-3-5-sonnet-20240620',
      defaultMaxTokens: 1000
    });
  } else {
    console.log('⚠️  No ANTHROPIC_API_KEY found, using mock provider');
    const { MockLLMProvider } = await import('../src/llm/mock-llm-provider');
    llm = new MockLLMProvider();
    
    // Set continuation responses
    const continuationResponses = [
      "Welcome back! I remember our conversation from before.",
      "Hello again! As we were discussing...",
      "Good to see you return! Let me help you with that.",
      "I recall what we talked about. Would you like to continue?",
      "Based on our previous discussion, I think...",
      "Ah yes, picking up where we left off...",
      "I've retained all our conversation history. How can I assist?",
      "Great timing! I was just thinking about your earlier questions."
    ];
    
    // Set continuation responses - MockLLMProvider will cycle through them
    (llm as any).setResponses(continuationResponses);
  }
  
  // Reconnect agent to LLM if we found it
  if (agent) {
    (agent as any).llmProvider = llm;
  } else {
    // Create new agent if not found
    const agentConfig = {
      id: 'discord-agent',
      displayName: 'Connectome Agent',
      systemPrompt: "You are Connectome, a helpful AI assistant in Discord. You remember all previous conversations."
    };
    const newAgent = new BasicAgent(agentConfig, llm, veilState);
    newAgent.enableAutoActionRegistration();
    
    // Set the agent in the component
    if (agentComponent) {
      agentComponent.setAgent(newAgent);
      console.log('✅ Created and set new agent for restored component');
    }
  }
  
  // Space already has veilState from constructor
  // Wire up agent responses  
  space.subscribe('agent:frame-ready');
  
  // Reactivate Discord connection
  console.log('🔌 Reconnecting to Discord...');
  
  // Re-set Discord connection parameters
  if (discordComponent) {
    const { bot_token: botToken, application_id: applicationId } = config.adapter;
    const guildId = '1289595876716707911';
    
    discordComponent.setConnectionParams({
      host: 'localhost:8081',
      path: '/ws',
      token: botToken,
      guild: guildId,
      agent: 'Connectome'
    });
  }
  
  space.activateAgent('discord-agent', { reason: 'restore' });
  
  // The Discord component should auto-reconnect based on its persisted state
  await new Promise(r => setTimeout(r, 3000));
  
  // Check reconnection
  const state = veilState.getState();
  const discordState = Array.from(state.facets.values()).find((f: any) => f.id === 'discord-state') as any;
  
  if (discordState?.attributes?.state === 'connected') {
    console.log('✅ Reconnected to Discord!\n');
    
    // Rejoin the general channel
    space.emit({
      topic: 'element:action',
      source: discord.getRef(),
      payload: {
        path: [discord.id, 'join'],
        parameters: { channelId: '1289595876716707914' } // #general
      },
      timestamp: Date.now()
    });
    
    // Wait for join to complete
    await new Promise(r => setTimeout(r, 2000));
    console.log('📢 Rejoined #general\n');
    
    // Activate agent to process any pending events
    space.activateAgent('discord-agent', { reason: 'channel-joined' });
    
    console.log('💭 Agent has full memory of previous conversations');
    console.log('🎯 Continue chatting - the agent remembers you!\n');
    
    // Save state periodically
    setInterval(async () => {
      const snapshot = await persistence.createSnapshot();
      console.log(`💾 Saved state (${state.facets.size} facets, ${state.frameHistory.length} frames)`);
    }, 30000);
    
    return { space, veilState, persistence };
  } else {
    console.error('❌ Failed to reconnect to Discord');
    process.exit(1);
  }
}

// Message polling is now handled by DiscordChatComponent

// Global persistence reference
let globalPersistence: TransitionManager | null = null;

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n👋 Shutting down gracefully...');
  
  // Save final state if we have persistence
  if (globalPersistence) {
    await globalPersistence.createSnapshot();
    console.log('💾 Final state saved');
  }
  
  process.exit(0);
});

// Main execution
(async () => {
  try {
    let result;
    
    if (command === 'reset') {
      // Clear state and start fresh
      clearState();
      result = await createNewAgent();
    } else if (command === 'restore') {
      // Explicit restore command (kept for backwards compatibility)
      if (!hasExistingState()) {
        console.log('⚠️  No saved state found, creating new agent...');
        result = await createNewAgent();
      } else {
        result = await restoreAgent();
      }
    } else if (command === 'start' || !command) {
      // Default behavior: restore if state exists, create new otherwise
      if (hasExistingState()) {
        console.log('📂 Found existing state, restoring...');
        result = await restoreAgent();
      } else {
        console.log('🆕 No saved state found, creating new agent...');
        result = await createNewAgent();
      }
    } else {
      console.log('Usage: npm run discord:persist [command]');
      console.log('Commands:');
      console.log('  (default) - Restore existing agent or create new if none exists');
      console.log('  reset     - Clear all state and create a fresh agent');
      console.log('  restore   - Explicitly restore from saved state');
      process.exit(1);
    }
    
    // Store globally for shutdown handler
    globalPersistence = result.persistence;
    
    // Keep process alive
    console.log('\nPress Ctrl+C to stop and save state.\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
})();
