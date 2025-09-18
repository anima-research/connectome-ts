/**
 * Discord Chat Component
 * 
 * Extends DiscordAxonComponent to provide chat interface functionality.
 * Handles message triggers and agent activation based on configurable rules.
 */

import { DiscordAxonComponent } from './discord-axon';
import { SpaceEvent } from '../spaces/types';
import { persistent } from '../persistence/decorators';
import { persistable } from '../persistence/decorators';
import { external } from '../host/decorators';

interface TriggerConfig {
  mentions: boolean;          // Respond to @mentions
  directMessages: boolean;    // Respond to DMs
  keywords: string[];        // Keywords to trigger on
  channels: string[];        // Specific channels to monitor (empty = all)
  cooldown: number;          // Minimum seconds between responses
}

@persistable(1)
export class DiscordChatComponent extends DiscordAxonComponent {
  // Re-declare external token for decorator to work (decorators don't inherit)
  @external('secret:discord.token') protected botToken?: string;
  
  // Chat-specific configuration
  @persistent() private triggerConfig: TriggerConfig = {
    mentions: true,
    directMessages: true,
    keywords: ['hello', 'hi', 'help', '?'],
    channels: [],
    cooldown: 2
  };
  
  @persistent() private lastResponseTime: Record<string, number> = {};
  private processedMessages: Set<string> = new Set();
  
  /**
   * Configure trigger settings
   */
  setTriggerConfig(config: Partial<TriggerConfig>): void {
    this.triggerConfig = { ...this.triggerConfig, ...config };
    this.trackPropertyChange('triggerConfig', this.triggerConfig, this.triggerConfig);
  }
  
  async onMount(): Promise<void> {
    await super.onMount();
    // Subscribe to agent frame ready events
    this.subscribe('agent:frame-ready');
    // Subscribe to history events to mark messages as processed
    this.subscribe('discord:history-received');
  }
  
  // Track last active channel
  private lastActiveChannel?: string;
  
  /**
   * Override handleEvent to add chat-specific behavior
   */
  async handleEvent(event: SpaceEvent): Promise<void> {
    await super.handleEvent(event);
    
    // Handle new Discord messages
    if (event.topic === 'discord:message') {
      const msg = event.payload as any;
      
      // Skip if already processed
      if (this.processedMessages.has(msg.messageId)) {
        return;
      }
      
      // Track last active channel
      this.lastActiveChannel = msg.channelId;
      
      // Check if we should respond
      const shouldRespond = this.shouldRespond(msg);
      console.log(`[DiscordChat] Message from ${msg.author}: "${msg.content}" - shouldRespond: ${shouldRespond}`);
      
      if (shouldRespond) {
        this.processedMessages.add(msg.messageId);
        
        // Check cooldown
        const channelLastResponse = this.lastResponseTime[msg.channelId] || 0;
        const timeSinceLastResponse = (Date.now() - channelLastResponse) / 1000;
        
        if (timeSinceLastResponse < this.triggerConfig.cooldown) {
          console.log(`[DiscordChat] Cooldown active for channel ${msg.channelId}`);
          return;
        }
        
        // Trigger agent activation
        console.log(`[DiscordChat] Triggering agent activation for channel ${msg.channelId}`);
        this.addOperation({
          type: 'agentActivation',
          source: `discord:${msg.channelId}`,
          reason: 'discord_message',
          priority: 'normal'
        });
        
        // Update last response time
        this.lastResponseTime[msg.channelId] = Date.now();
        this.trackPropertyChange('lastResponseTime', {...this.lastResponseTime}, this.lastResponseTime);
      }
    }
    
    // Handle history received events - mark all as processed to avoid responding to old messages
    // Note: These messages are now added to VEIL by DiscordAxonComponent for full context,
    // but we don't want to trigger agent activations for historical messages
    if (event.topic === 'discord:history-received') {
      const { messages } = event.payload as any;
      console.log(`[DiscordChat] Marking ${messages.length} historical messages as processed`);
      for (const msg of messages) {
        this.processedMessages.add(msg.messageId);
      }
    }
    
    // Handle agent frame ready events
    if (event.topic === 'agent:frame-ready') {
      const { frame } = event.payload as any;
      console.log(`[DiscordChat] Agent frame ready with ${frame.operations?.length || 0} operations`);
      
      // Look for speak operations
      if (frame.operations) {
        for (const op of frame.operations) {
          if (op.type === 'speak') {
            console.log(`[DiscordChat] Found speak operation: "${op.content}"`);
            
            // Send to the last active channel
            const targetChannel = this.getLastActiveChannel();
            
            if (targetChannel) {
              console.log(`[DiscordChat] Sending to Discord channel: ${targetChannel}`);
              await this.send(targetChannel, op.content);
            } else {
              console.log('[DiscordChat] No target channel for agent message');
            }
          }
        }
      }
    }
  }
  
  /**
   * Check if we should respond to a message
   */
  private shouldRespond(msg: any): boolean {
    // Skip bot's own messages
    if (msg.author === this.agentName) {
      return false;
    }
    
    // Check channel filter
    if (this.triggerConfig.channels.length > 0 && 
        !this.triggerConfig.channels.includes(msg.channelId)) {
      return false;
    }
    
    // Check Discord mentions
    if (this.triggerConfig.mentions) {
      // Debug logging
      console.log(`[DiscordChat] Checking mentions - botUserId: ${this.botUserId}, agentName: ${this.agentName}`);
      
      // Check for @mention using bot user ID
      if (this.botUserId && msg.content.includes(`<@${this.botUserId}>`)) {
        console.log(`[DiscordChat] Found mention <@${this.botUserId}>`);
        return true;
      }
      // Also check for nickname mention format
      if (this.botUserId && msg.content.includes(`<@!${this.botUserId}>`)) {
        console.log(`[DiscordChat] Found nickname mention <@!${this.botUserId}>`);
        return true;
      }
      // Fallback to agent name check
      if (msg.content.toLowerCase().includes(this.agentName.toLowerCase())) {
        console.log(`[DiscordChat] Found agent name mention: ${this.agentName}`);
        return true;
      }
    }
    
    // Check keywords
    const lowerContent = msg.content.toLowerCase();
    for (const keyword of this.triggerConfig.keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        return true;
      }
    }
    
    // TODO: Check for direct messages when we have that info
    
    return false;
  }
  
  /**
   * Get the last active channel
   */
  private getLastActiveChannel(): string | undefined {
    return this.lastActiveChannel || (this.joinedChannels.length > 0 ? this.joinedChannels[0] : undefined);
  }
  
  /**
   * Clear processed messages (useful for testing)
   */
  clearProcessedMessages(): void {
    this.processedMessages.clear();
    this.trackPropertyChange('processedMessages', new Set(), this.processedMessages);
  }
}
