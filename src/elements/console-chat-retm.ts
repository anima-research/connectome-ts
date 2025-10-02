/**
 * Console Chat - RETM Architecture
 * 
 * Proper implementation using Afferent + Receptors/Effectors:
 * - ConsoleAfferent: Manages readline, emits events when user types
 * - ConsoleMessageReceptor: Converts console:message events to facets + activations
 * - ConsoleSpeechEffector: Displays agent speech to console
 */

import * as readline from 'readline';
import { BaseAfferent } from '../components/base-afferent';
import { BaseReceptor, BaseEffector } from '../components/base-martem';
import { SpaceEvent, StreamRef } from '../spaces/types';
import { ReadonlyVEILState, FacetDelta, EffectorResult } from '../spaces/receptor-effector-types';
import { Facet, VEILDelta } from '../veil/types';
import { persistable, persistent } from '../persistence/decorators';
import { wrapFacetsAsDeltas } from '../helpers/factories';

// ============================================
// AFFERENT: Console Input Handler
// ============================================

interface ConsoleConfig {
  prompt?: string;
  streamId?: string;
}

type ConsoleCommand = 
  | { type: 'quit' }
  | { type: 'sleep'; duration?: number }
  | { type: 'wake' }
  | { type: 'help' };

@persistable(1)
export class ConsoleAfferent extends BaseAfferent<ConsoleConfig, ConsoleCommand> {
  private rl?: readline.Interface;
  private isActive = false;
  
  @persistent()
  private messageCount = 0;
  
  @persistent()
  private streamId = 'console:main';
  
  private consoleStream: StreamRef = {
    streamId: 'console:main',
    streamType: 'console',
    metadata: {
      terminal: process.env.TERM || 'unknown'
    }
  };
  
  protected async onInitialize(): Promise<void> {
    console.log('\n[ConsoleAfferent] Initializing...');
    
    if (this.context.config.streamId) {
      this.streamId = this.context.config.streamId;
      this.consoleStream.streamId = this.streamId;
    }
  }
  
  protected async onStart(): Promise<void> {
    console.log('[ConsoleAfferent] Starting readline...');
    
    // Set up readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.context.config.prompt || '> '
    });
    
    this.startListening();
    
    console.log('[ConsoleAfferent] Ready! Type messages to chat with the agent.');
    console.log('[ConsoleAfferent] Commands: /quit to exit, /sleep to toggle agent sleep\n');
    
    this.rl?.prompt();
  }
  
  protected async onStop(): Promise<void> {
    console.log('\n[ConsoleAfferent] Stopping...');
    this.isActive = false;
    this.rl?.close();
  }
  
  protected async onDestroyAfferent(): Promise<void> {
    console.log('[ConsoleAfferent] Destroyed');
  }
  
  protected async onCommand(command: ConsoleCommand): Promise<void> {
    switch (command.type) {
      case 'quit':
        console.log('\n[ConsoleAfferent] Goodbye!');
        await this.stop();
        setTimeout(() => process.exit(0), 100);
        break;
        
      case 'sleep':
        // Emit sleep command event
        this.emit({
          topic: 'agent:command',
          source: { elementId: this.element?.id || 'console', elementPath: [] },
          timestamp: Date.now(),
          payload: { type: 'sleep', duration: command.duration }
        });
        
        if (command.duration) {
          console.log(`[ConsoleAfferent] Agent will sleep for ${command.duration} seconds`);
          
          // Auto-wake after duration
          setTimeout(() => {
            this.enqueueCommand({ type: 'wake' });
          }, command.duration * 1000);
        }
        break;
        
      case 'wake':
        this.emit({
          topic: 'agent:command',
          source: { elementId: this.element?.id || 'console', elementPath: [] },
          timestamp: Date.now(),
          payload: { type: 'wake' }
        });
        console.log('[ConsoleAfferent] Agent woken up');
        break;
        
      case 'help':
        console.log('\nCommands:');
        console.log('  /quit, /exit - Exit the chat');
        console.log('  /sleep [seconds] - Toggle agent sleep or sleep for N seconds');
        console.log('  /help - Show this help\n');
        this.rl?.prompt();
        break;
    }
  }
  
  private startListening(): void {
    if (!this.rl) return;
    
    this.isActive = true;
    
    // Handle line input
    this.rl.on('line', (input) => {
      if (!this.isActive) return;
      
      const trimmed = input.trim();
      if (!trimmed) {
        this.rl?.prompt();
        return;
      }
      
      // Handle commands
      if (trimmed.startsWith('/')) {
        this.handleCommandInput(trimmed);
        return;
      }
      
      // Process as message
      this.handleMessageInput(trimmed);
    });
    
    // Handle close
    this.rl.on('close', () => {
      if (this.isActive) {
        this.enqueueCommand({ type: 'quit' });
      }
    });
  }
  
  private handleCommandInput(command: string): void {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();
    
    switch (cmd) {
      case '/quit':
      case '/exit':
        this.enqueueCommand({ type: 'quit' });
        break;
        
      case '/sleep':
        const duration = parts[1] ? parseInt(parts[1], 10) : undefined;
        this.enqueueCommand({ 
          type: 'sleep', 
          duration: duration && !isNaN(duration) ? duration : undefined 
        });
        this.rl?.prompt();
        break;
        
      case '/help':
        this.enqueueCommand({ type: 'help' });
        break;
        
      default:
        console.log(`Unknown command: ${command}`);
        this.rl?.prompt();
    }
  }
  
  private handleMessageInput(message: string): void {
    this.messageCount++;
    const messageId = `console-msg-${this.messageCount}`;
    
    console.log(`\n[You]: ${message}`);
    
    // Emit console message event
    this.emit({
      topic: 'console:message',
      source: { elementId: this.element?.id || 'console', elementPath: [] },
      timestamp: Date.now(),
      payload: {
        messageId,
        content: message,
        streamId: this.streamId,
        streamType: 'console'
      },
      priority: 'high' // User messages have high priority
    });
  }
  
  // Public API for displaying output
  displayOutput(text: string): void {
    console.log(text);
    if (this.rl && this.isActive) {
      this.rl.prompt();
    }
  }
  
  static persistentProperties = [
    { propertyKey: 'messageCount' },
    { propertyKey: 'streamId' }
  ];
}

// ============================================
// RECEPTOR: Console Message → Facets
// ============================================

export class ConsoleMessageReceptor extends BaseReceptor {
  topics = ['console:message'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    const payload = event.payload as any;
    const { messageId, content, streamId, streamType } = payload;
    
    const facets: Facet[] = [];
    
    // Create message event facet
    facets.push({
      id: messageId,
      type: 'event',
      content: content,
      eventType: 'console-message',
      attributes: {
        messageId,
        source: 'user',
        streamId,
        streamType
      }
    });
    
    // Create agent activation
    facets.push({
      id: `activation-${messageId}`,
      type: 'agent-activation',
      content: 'User message received',
      state: {
        source: 'console-chat',
        reason: 'console_message',
        priority: 'normal',
        sourceAgentId: 'user',
        sourceAgentName: 'User',
        streamRef: {
          streamId,
          streamType,
          metadata: {
            terminal: process.env.TERM || 'unknown'
          }
        }
      },
      ephemeral: true
    });
    
    return wrapFacetsAsDeltas(facets);
  }
}

// ============================================
// EFFECTOR: Agent Speech → Console Output
// ============================================

export class ConsoleSpeechEffector extends BaseEffector {
  facetFilters = [{ type: 'speech' }];
  
  constructor(private consoleAfferent?: ConsoleAfferent) {
    super();
  }
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    
    for (const change of changes) {
      if (change.type !== 'added' || change.facet.type !== 'speech') continue;
      
      const speech = change.facet as any;
      const streamId = speech.streamId;
      
      // Check if this is for console
      if (!streamId || !streamId.startsWith('console:')) continue;
      
      // No need to track displayedSpeechIds - change.type === 'added' ensures
      // we only process each speech facet once (when it's first created)
      
      const agentName = speech.agentName || 'Agent';
      const content = speech.content;
      
      const output = `\n[${agentName}]: ${content}`;
      
      // Display using afferent if available, otherwise just console.log
      if (this.consoleAfferent) {
        this.consoleAfferent.displayOutput(output);
      } else {
        console.log(output);
      }
    }
    
    return { events };
  }
}

// ============================================
// Helper: Create Console Element with RETM
// ============================================

export function createConsoleElement(): {
  afferent: ConsoleAfferent;
  receptor: ConsoleMessageReceptor;
  effector: ConsoleSpeechEffector;
} {
  const afferent = new ConsoleAfferent();
  const receptor = new ConsoleMessageReceptor();
  const effector = new ConsoleSpeechEffector(afferent);
  
  return { afferent, receptor, effector };
}
