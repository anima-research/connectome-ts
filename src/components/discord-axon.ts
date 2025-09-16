/**
 * Discord AXON Component
 * 
 * Bridges Connectome agents to Discord via WebSocket connection
 */

import { InteractiveComponent } from './base-components';
import { SpaceEvent } from '../spaces/types';
import { persistent } from '../persistence/decorators';
import WebSocket from 'ws';

interface DiscordConnectionParams {
  host: string;
  path: string;
  token?: string;
  guild?: string;
  agent?: string;
}

interface DiscordMessage {
  channelId: string;
  messageId: string;
  author: string;
  content: string;
  timestamp: string;
}

export class DiscordAxonComponent extends InteractiveComponent {
  // Connection parameters
  @persistent() private serverUrl: string = '';
  @persistent() private connectionParams: Record<string, any> = {};
  
  // Discord-specific state
  @persistent() private botToken: string = '';
  @persistent() private guildId: string = '';
  @persistent() private agentName: string = 'Connectome Agent';
  
  // Persistent state
  @persistent() private connectionState: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  @persistent() private lastError?: string;
  @persistent() private connectionAttempts: number = 0;
  @persistent() private joinedChannels: string[] = [];
  @persistent() private lastRead: Record<string, string> = {};
  @persistent() private scrollbackLimit: number = 50;
  
  private ws?: WebSocket;
  private reconnectTimeout?: NodeJS.Timeout;
  
  // Declare available actions
  static actions = {
    join: {
      description: 'Join a Discord channel',
      params: ['channelId']
    },
    leave: {
      description: 'Leave a Discord channel',
      params: ['channelId']
    },
    send: {
      description: 'Send a message to a channel',
      params: ['channelId', 'message']
    },
    channels: {
      description: 'List available channels'
    },
    status: {
      description: 'Get connection status'
    }
  };
  
  constructor() {
    super();
    
    // Register actions
    this.registerAction('join', async (params) => this.join(params.channelId || params));
    this.registerAction('leave', async (params) => this.leave(params.channelId || params));
    this.registerAction('send', async (params) => this.send(params.channelId, params.message));
    this.registerAction('channels', async () => {
      console.log('[Discord] Channels action triggered');
      return this.listChannels();
    });
    this.registerAction('status', async () => { 
      const status = await this.getStatus();
      console.log(status);
    });
  }
  
  /**
   * Called by AxonElement to set connection parameters
   */
  setConnectionParams(params: DiscordConnectionParams): void {
    const oldParams = this.connectionParams;
    this.connectionParams = params;
    this.trackPropertyChange('connectionParams', oldParams, params);
    
    const oldUrl = this.serverUrl;
    this.serverUrl = `ws://${params.host}${params.path || ''}/ws`;
    this.trackPropertyChange('serverUrl', oldUrl, this.serverUrl);
    
    // Extract Discord-specific params
    if (params.token) {
      const old = this.botToken;
      this.botToken = params.token;
      this.trackPropertyChange('botToken', old, this.botToken);
    }
    
    if (params.guild) {
      const old = this.guildId;
      this.guildId = params.guild;
      this.trackPropertyChange('guildId', old, this.guildId);
    }
    
    if (params.agent) {
      const old = this.agentName;
      this.agentName = params.agent;
      this.trackPropertyChange('agentName', old, this.agentName);
    }
  }
  
  async onMount(): Promise<void> {
    await super.onMount();
    
    // Subscribe to frame events
    this.subscribe('frame:start');
    
    // Subscribe to Discord events
    this.subscribe('discord:connected');
    this.subscribe('discord:connection-failed');
    this.subscribe('discord:history-received');
    this.subscribe('discord:message');
    this.subscribe('discord:websocket-message');
    
  }
  
  async onFirstFrame(): Promise<void> {
    // Add Discord state facet
    this.addFacet({
      id: 'discord-state',
      type: 'state',
      displayName: 'discord',
      content: this.getStatusMessage(),
      attributes: {
        state: this.connectionState,
        agentName: this.agentName,
        joinedChannels: this.joinedChannels,
        guildId: this.guildId,
        attempts: this.connectionAttempts
      }
    });
    
    // Start connection if we have parameters (from restoration or setConnectionParams)
    if (this.serverUrl && this.botToken) {
      this.startConnection();
    }
  }
  
  async onUnmount(): Promise<void> {
    // Clean up connection
    this.cleanup();
    await super.onUnmount();
  }
  
  /**
   * Start async connection - returns immediately
   */
  private startConnection(): void {
    if (this.connectionState === 'connecting') {
      return; // Already connecting
    }
    
    // Update state synchronously
    const oldState = this.connectionState;
    this.connectionState = 'connecting';
    this.trackPropertyChange('connectionState', oldState, 'connecting');
    
    this.connectionAttempts++;
    this.trackPropertyChange('connectionAttempts', this.connectionAttempts - 1, this.connectionAttempts);
    
    this.updateState('discord-state', {
      content: this.getStatusMessage(),
      attributes: { 
        state: 'connecting',
        attempts: this.connectionAttempts
      }
    }, 'full');
    
    // Start async connection
    this.connectAsync()
      .then(() => {
        // Success - emit event
        this.element.emit({
          topic: 'discord:connected',
          source: this.element.getRef(),
          payload: {
            agentName: this.agentName,
            guildId: this.guildId,
            reconnect: this.connectionAttempts > 1
          },
          timestamp: Date.now()
        });
      })
      .catch((error) => {
        // Failure - emit event
        this.element.emit({
          topic: 'discord:connection-failed',
          source: this.element.getRef(),
          payload: {
            error: error.message,
            attempts: this.connectionAttempts,
            willRetry: this.connectionAttempts < 3
          },
          timestamp: Date.now()
        });
      });
  }
  
  /**
   * The actual async connection logic
   */
  private async connectAsync(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[Discord] Connecting to ${this.serverUrl}`);
        this.ws = new WebSocket(this.serverUrl);
        
        const timeout = setTimeout(() => {
          this.ws?.close();
          reject(new Error('Connection timeout'));
        }, 10000);
        
        this.ws.onopen = () => {
          clearTimeout(timeout);
          console.log('[Discord] WebSocket connected, authenticating...');
          
          // Send auth
          this.ws!.send(JSON.stringify({
            type: 'auth',
            token: this.botToken,
            guild: this.guildId,
            agent: this.agentName
          }));
        };
        
        this.ws.onmessage = (event) => {
          const msg = JSON.parse(event.data.toString());
          
          if (msg.type === 'authenticated') {
            console.log('[Discord] Authenticated successfully');
            this.setupWebSocketHandlers();
            
            // Request history for joined channels
            this.requestChannelHistories();
            
            resolve();
          } else if (msg.type === 'error') {
            reject(new Error(msg.error || 'Authentication failed'));
          } else {
            // Handle other messages
            this.handleWebSocketMessage(msg);
          }
        };
        
        this.ws.onerror = (error) => {
          clearTimeout(timeout);
          reject(new Error('WebSocket error'));
        };
        
        this.ws.onclose = () => {
          clearTimeout(timeout);
          if (this.connectionState === 'connecting') {
            reject(new Error('Connection closed during setup'));
          }
        };
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Set up WebSocket message handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;
    
        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data.toString());
            // Emit an event to handle the message within a frame context
            this.element.emit({
              topic: 'discord:websocket-message',
              source: this.element.getRef(),
              payload: msg,
              timestamp: Date.now()
            });
          } catch (error) {
            console.error('[Discord] Error handling message:', error);
          }
        };
    
    this.ws.onclose = () => {
      console.log('[Discord] WebSocket closed');
      
      if (this.connectionState === 'connected') {
        // Unexpected disconnect
        this.connectionState = 'disconnected';
        this.trackPropertyChange('connectionState', 'connected', 'disconnected');
        
        // Schedule reconnect
        if (this.connectionAttempts < 3) {
          this.reconnectTimeout = setTimeout(() => {
            this.startConnection();
          }, 5000);
        }
      }
    };
  }
  
  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(msg: any): void {
    console.log('[Discord] Received message:', msg);
    switch (msg.type) {
      case 'history':
        // Emit event for history batch
        this.element.emit({
          topic: 'discord:history-received',
          source: this.element.getRef(),
          payload: {
            channelId: msg.channelId,
            channelName: msg.channelName,
            messages: msg.messages
          },
          timestamp: Date.now()
        });
        break;
        
      case 'message':
        // New Discord message
        this.element.emit({
          topic: 'discord:message',
          source: this.element.getRef(),
          payload: msg.payload,
          timestamp: Date.now()
        });
        break;
        
      case 'channels':
        // Channel list response
        this.updateState('discord-state', {
          attributes: {
            availableChannels: msg.channels
          }
        }, 'attributesOnly');
        break;
    }
  }
  
  /**
   * Request history for all joined channels
   */
  private requestChannelHistories(): void {
    for (const channelId of this.joinedChannels) {
      this.requestChannelHistory(channelId);
    }
  }
  
  private requestChannelHistory(channelId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.ws.send(JSON.stringify({
      type: 'action',
      action: 'history',
      parameters: {
        channelId,
        since: this.lastRead[channelId],
        limit: this.scrollbackLimit
      }
    }));
  }
  
  /**
   * Handle events
   */
  async handleEvent(event: SpaceEvent): Promise<void> {
    await super.handleEvent(event);
    
    switch (event.topic) {
      case 'discord:connected':
        // Update state on successful connection
        this.connectionState = 'connected';
        this.connectionAttempts = 0;
        this.trackPropertyChange('connectionState', 'connecting', 'connected');
        this.trackPropertyChange('connectionAttempts', this.connectionAttempts, 0);
        
        this.updateState('discord-state', {
          content: this.getStatusMessage(),
          attributes: { 
            state: 'connected',
            attempts: 0
          }
        }, 'full');
        
        // Add connection event
        this.addFacet({
          id: `discord-connected-${Date.now()}`,
          type: 'event',
          content: (event.payload as any).reconnect 
            ? 'Reconnected to Discord successfully'
            : 'Connected to Discord'
        });
        break;
        
      case 'discord:connection-failed':
        // Update state on failure
        this.connectionState = 'error';
        this.lastError = (event.payload as any).error;
        this.trackPropertyChange('connectionState', 'connecting', 'error');
        this.trackPropertyChange('lastError', undefined, (event.payload as any).error);
        
        this.updateState('discord-state', {
          content: this.getStatusMessage(),
          attributes: { 
            state: 'error',
            error: (event.payload as any).error
          }
        }, 'full');
        
        // Retry if needed
        if ((event.payload as any).willRetry) {
          this.reconnectTimeout = setTimeout(() => {
            this.startConnection();
          }, 5000);
        }
        break;
        
      case 'discord:history-received':
        // History batch received
        const { channelId, messages, channelName } = event.payload as any;
        
        if (messages && messages.length > 0) {
          this.addFacet({
            id: `discord-history-${channelId}-${Date.now()}`,
            type: 'event',
            displayName: 'channel-history',
            content: `Channel #${channelName} history (${messages.length} messages since last read)`,
            attributes: {
              channelId,
              channelName,
              messageCount: messages.length,
              messages: messages.map((m: DiscordMessage) => ({
                author: m.author,
                content: m.content,
                timestamp: m.timestamp
              }))
            }
          });
          
          // Update last read
          const lastMsg = messages[messages.length - 1];
          if (lastMsg) {
            this.lastRead[channelId] = lastMsg.messageId;
            this.trackPropertyChange('lastRead', {...this.lastRead}, this.lastRead);
          }
        }
        break;
        
      case 'discord:message':
        // New real-time message
        const msg = event.payload as DiscordMessage;
        
        this.addFacet({
          id: `discord-msg-${msg.messageId}`,
          type: 'event',
          displayName: 'discord-message',
          content: `[Discord] ${msg.author}: ${msg.content}`,
          attributes: {
            channelId: msg.channelId,
            messageId: msg.messageId,
            author: msg.author,
            timestamp: msg.timestamp
          }
        });
        
        // Update last read
        this.lastRead[msg.channelId] = msg.messageId;
        this.trackPropertyChange('lastRead', {...this.lastRead}, this.lastRead);
        break;
        
      case 'discord:websocket-message':
        // Handle WebSocket message within frame context
        this.handleWebSocketMessage(event.payload);
        break;
    }
  }
  
  /**
   * Actions
   */
  private async join(channelId: string): Promise<void> {
    if (!this.ws || this.connectionState !== 'connected') {
      throw new Error('Not connected to Discord');
    }
    
    if (!this.joinedChannels.includes(channelId)) {
      const old = [...this.joinedChannels];
      this.joinedChannels.push(channelId);
      this.trackPropertyChange('joinedChannels', old, this.joinedChannels);
    }
    
    // Send join request
    this.ws.send(JSON.stringify({
      type: 'action',
      action: 'join',
      parameters: { channelId }
    }));
    
    // Update state
    this.updateState('discord-state', {
      attributes: {
        joinedChannels: this.joinedChannels
      }
    }, 'attributesOnly');
    
    // Request history
    this.requestChannelHistory(channelId);
  }
  
  private async leave(channelId: string): Promise<void> {
    const index = this.joinedChannels.indexOf(channelId);
    if (index >= 0) {
      const old = [...this.joinedChannels];
      this.joinedChannels.splice(index, 1);
      this.trackPropertyChange('joinedChannels', old, this.joinedChannels);
      
      // Update state
      this.updateState('discord-state', {
        attributes: {
          joinedChannels: this.joinedChannels
        }
      }, 'attributesOnly');
    }
  }
  
  private async send(channelId: string, message: string): Promise<void> {
    if (!this.ws || this.connectionState !== 'connected') {
      throw new Error('Not connected to Discord');
    }
    
    if (!this.joinedChannels.includes(channelId)) {
      throw new Error(`Not joined to channel ${channelId}`);
    }
    
    this.ws.send(JSON.stringify({
      type: 'action',
      action: 'send',
      parameters: { channelId, message }
    }));
  }
  
  private async listChannels(): Promise<void> {
    if (!this.ws || this.connectionState !== 'connected') {
      throw new Error('Not connected to Discord');
    }
    
    const message = {
      type: 'action',
      action: 'channels'
    };
    console.log('[Discord] Sending message:', message);
    this.ws.send(JSON.stringify(message));
  }
  
  private async getStatus(): Promise<string> {
    return this.getStatusMessage();
  }
  
  /**
   * Get human-readable status message
   */
  private getStatusMessage(): string {
    switch (this.connectionState) {
      case 'disconnected':
        return 'Discord bridge (disconnected)';
      case 'connecting':
        return `Connecting to Discord... (attempt ${this.connectionAttempts})`;
      case 'connected':
        return `Connected to Discord as ${this.agentName}`;
      case 'error':
        return `Connection error: ${this.lastError}`;
    }
  }
  
  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    
    this.connectionState = 'disconnected';
  }
}
