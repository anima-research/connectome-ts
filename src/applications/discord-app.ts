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
import { persistable, persistent } from '../persistence/decorators';
import { Element } from '../spaces/element';
import { Component } from '../spaces/component';
import { SpaceEvent } from '../spaces/types';

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
 * Test component that auto-joins Discord channels when connected
 */
@persistable(1)
class DiscordAutoJoinComponent extends Component {
  @persistent() private channels: string[] = [];
  @persistent() private hasJoined: boolean = false;
  
  constructor(channels: string[] = ['1289595876716707914']) {  // Default to #general channel ID
    super();
    this.channels = channels;
  }
  
  onMount(): void {
    // Listen for Discord connected event at the space level
    const space = this.element.space;
    if (space) {
      space.subscribe('discord:connected');
      console.log('🔔 DiscordAutoJoinComponent subscribed to discord:connected at space level');
    }
    // Also subscribe at element level just in case
    this.element.subscribe('discord:connected');
  }
  
  async handleEvent(event: SpaceEvent): Promise<void> {
    console.log('🔔 DiscordAutoJoinComponent received event:', event.topic, 'from:', event.source);
    
    if (event.topic === 'discord:connected' && !this.hasJoined) {
      console.log('🤖 Discord connected! Auto-joining channels:', this.channels);
      
      // Find the Discord element and emit join actions to it
      const space = this.element.space;
      console.log('Looking for Discord element. Space children:', space?.children.map(c => ({ id: c.id, name: c.name })));
      const discordElement = space?.children.find(child => child.name === 'discord');
      
      if (discordElement) {
        console.log('Found Discord element:', discordElement.name, 'with id:', discordElement.id);
        for (const channelId of this.channels) {
          console.log(`📢 Requesting to join channel: ${channelId}`);
          
          // Emit an action event with the correct format for Element handling
          this.element.space?.emit({
            topic: 'element:action',
            source: this.element.getRef(),
            payload: {
              path: [discordElement.id, 'join'],  // [elementId, action]
              parameters: { channelId }
            },
            timestamp: Date.now()
          });
        }
      } else {
        console.log('Discord element not found!');
      }
      
      this.hasJoined = true;
    }
  }
}

export class DiscordApplication implements ConnectomeApplication {
  constructor(private config: DiscordAppConfig) {}
  
  async createSpace(): Promise<{ space: Space; veilState: VEILStateManager }> {
    const veilState = new VEILStateManager();
    const space = new Space(veilState);
    
    // Register llmProvider reference that will be injected by Host
    space.registerReference('llmProvider', this.config.llmProviderId);
    
    return { space, veilState };
  }
  
  async initialize(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🎮 Initializing Discord application...');
    
    // Create Discord element with chat component (which extends axon component)
    const discordElem = new Element('discord');
    const chatComponent = new DiscordChatComponent();
    
    // Set connection parameters (without token, that comes from Host)
    chatComponent.setConnectionParams({
      host: this.config.discord.host,
      path: '/ws',
      guild: this.config.discord.guild,
      agent: this.config.agentName
    });
    
    // Configure chat triggers
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
      autoActionRegistration: true
    };
    
    // Save config for restoration
    (agentComponent as any).agentConfig = agentConfig;
    
    agentElem.addComponent(agentComponent);
    
    // Add auto-join component for testing
    if (this.config.discord.autoJoinChannels && this.config.discord.autoJoinChannels.length > 0) {
      const autoJoinComponent = new DiscordAutoJoinComponent(this.config.discord.autoJoinChannels);
      agentElem.addComponent(autoJoinComponent);
    }
    
    // Add agent element to space
    space.addChild(agentElem);
    
    // Subscribe to agent response events
    space.subscribe('agent:frame-ready');
    
    console.log('✅ Discord application initialized');
  }
  
  getComponentRegistry(): ComponentRegistry {
    const registry = ComponentRegistry.getInstance();
    
    // Register all components that can be restored
    registry.register('DiscordChatComponent', DiscordChatComponent);
    registry.register('AgentComponent', AgentComponent);
    registry.register('DiscordAutoJoinComponent', DiscordAutoJoinComponent);
    
    return registry;
  }
  
  async onStart(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🚀 Discord application started!');
    // No initial activation - wait for Discord messages to trigger the agent
  }
  
  async onRestore(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('♻️ Discord application restored from snapshot');
    // No activation needed - Discord messages will trigger the agent
  }
}
