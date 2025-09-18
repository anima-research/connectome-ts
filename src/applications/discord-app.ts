/**
 * Discord Application for Connectome
 */

import { ConnectomeApplication } from '../host/types';
import { Space } from '../spaces/space';
import { VEILStateManager } from '../veil/veil-state';
import { ComponentRegistry } from '../persistence/component-registry';
import { BasicAgent } from '../agent/basic-agent';
import { AgentComponent } from '../agent/agent-component';
import { DiscordAxonComponent } from '../components/discord-axon';
import { DiscordChatComponent } from '../components/discord-chat';
import { persistable } from '../persistence/decorators';
import { Element } from '../spaces/element';

export interface DiscordAppConfig {
  agentName: string;
  systemPrompt: string;
  llmProviderId: string;
  discord: {
    host: string;
    guild: string;
    autoJoinChannels?: string[];
  };
}

/**
 * Discord-aware agent that auto-joins channels on connection
 */
@persistable(1)
export class DiscordAgent extends BasicAgent {
  private autoJoinChannels: string[];
  
  constructor(config: any, llmProvider: any, veilState: any, autoJoinChannels: string[] = []) {
    super(config, llmProvider, veilState);
    this.autoJoinChannels = autoJoinChannels;
  }
  
  async onFrameComplete(frame: any, state: any): Promise<any> {
    // Check for discord:connected event
    const connectedEvent = frame.events?.find((e: any) => e.topic === 'discord:connected');
    if (connectedEvent && this.autoJoinChannels.length > 0) {
      console.log('🤖 Discord connected, auto-joining channels:', this.autoJoinChannels);
      
      // Create a response to join channels
      this.pendingSpeech.push(`I'm now connected to Discord! Let me join the configured channels.`);
      
      for (const channel of this.autoJoinChannels) {
        this.pendingActions.push({
          tool: 'discord.join',
          parameters: { channelId: channel }
        });
      }
    }
    
    return super.onFrameComplete(frame, state);
  }
}

export class DiscordApplication implements ConnectomeApplication {
  constructor(private config: DiscordAppConfig) {}
  
  async createSpace(): Promise<{ space: Space; veilState: VEILStateManager }> {
    const veilState = new VEILStateManager();
    const space = new Space(veilState);
    
    // Register llmProvider reference that will be injected by Host
    space.registerReference('llmProvider', this.config.llmProviderId);
    
    // Register agent factory for Discord agents
    const autoJoinChannels = this.config.discord.autoJoinChannels || ['general'];
    space.registerReference('agentFactory', (config: any, llm: any, veil: any) => {
      const agent = new DiscordAgent(config, llm, veil, autoJoinChannels);
      return agent;
    });
    
    return { space, veilState };
  }
  
  async initialize(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🎮 Initializing Discord application...');
    
    // Create Discord element with axon component
    const discordElem = new Element('discord');
    const discordComponent = new DiscordAxonComponent();
    
    // Set connection parameters (without token, that comes from Host)
    discordComponent.setConnectionParams({
      host: this.config.discord.host,
      path: '/ws',
      guild: this.config.discord.guild,
      agent: this.config.agentName
    });
    
    discordElem.addComponent(discordComponent);
    
    // Add Discord chat trigger component
    const chatComponent = new DiscordChatComponent();
    chatComponent.setTriggerConfig({
      mentions: true,
      directMessages: true,
      keywords: ['hi', 'hello', 'help', '?', 'connectome'],
      channels: [],  // Empty means all channels
      cooldown: 10
    });
    discordElem.addComponent(chatComponent);
    
    // Add Discord element to space
    space.addChild(discordElem);
    
    // Create agent element
    const agentElem = new Element('discord-agent');
    
    // Create agent component without agent (will be created after references are resolved)
    const agentComponent = new AgentComponent();
    
    // Store config for agent creation
    const agentConfig = {
      name: this.config.agentName,
      systemPrompt: this.config.systemPrompt,
      autoActionRegistration: true,
      // Custom field for Discord
      autoJoinChannels: this.config.discord.autoJoinChannels || ['general']
    };
    
    // Save config for restoration
    (agentComponent as any).agentConfig = agentConfig;
    
    agentElem.addComponent(agentComponent);
    
    // Add agent element to space
    space.addChild(agentElem);
    
    // Subscribe to agent response events
    space.subscribe('agent:frame-ready');
    
    console.log('✅ Discord application initialized');
  }
  
  getComponentRegistry(): ComponentRegistry {
    const registry = ComponentRegistry.getInstance();
    
    // Register all components that can be restored
    registry.register('DiscordAxonComponent', DiscordAxonComponent);
    registry.register('DiscordChatComponent', DiscordChatComponent);
    registry.register('AgentComponent', AgentComponent);
    registry.register('DiscordAgent', DiscordAgent);
    
    return registry;
  }
  
  async onStart(space: Space, veilState: VEILStateManager): Promise<void> {
    // Activate the agent
    space.activateAgent('discord-agent', { 
      reason: 'startup',
      source: 'discord-app'
    });
    
    console.log('🚀 Discord application started!');
  }
  
  async onRestore(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('♻️ Discord application restored from snapshot');
    
    // Re-activate the agent after restoration
    space.activateAgent('discord-agent', { 
      reason: 'restore',
      source: 'discord-app'
    });
  }
}
