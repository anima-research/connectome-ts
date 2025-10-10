/**
 * Console Chat Element
 * 
 * Provides interactive console-based chat interface for testing the full system.
 * Handles async console input and routes messages through VEIL.
 */

import * as readline from 'readline';
import { Element } from '../spaces/element';
import { Component } from '../spaces/component';
import { Space } from '../spaces/space';
import { SpaceEvent, StreamRef } from '../spaces/types';
import { 
  Frame, 
  VEILDelta,
  SpeechFacet,
  hasStreamAspect,
  hasAgentGeneratedAspect,
  hasStateAspect
} from '../veil/types';
import { createAgentActivation, createEventFacet, createStreamRewriteFacet } from '../helpers/factories';
import { 
  TraceStorage, 
  TraceCategory, 
  getGlobalTracer 
} from '../tracing';

export class ConsoleChatComponent extends Component {
  private rl?: readline.Interface;
  private isActive: boolean = false;
  private messageCount: number = 0;
  private pendingMessage?: {
    id: string;
    content: string;
  };
  private consoleStream: StreamRef = {
    streamId: 'console:main',
    streamType: 'console',
    metadata: {
      terminal: process.env.TERM || 'unknown'
    }
  };
  private pendingActivationFacetId?: string;
  private tracer: TraceStorage | undefined;
  private displayedSpeechIds = new Set<string>();

  async onMount(): Promise<void> {
    console.log('\n[Console Chat] Mounting...');
    this.tracer = getGlobalTracer();
    
    // Stream registration is now handled through VEIL operations in handleEvent
    // The space will route messages to this component through the event system
    
    // Set up readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });
    
    // Start listening for input
    this.startListening();
    
    // Subscribe to events we care about
    this.element.subscribe('frame:start');
    this.element.subscribe('frame:end');
    this.element.subscribe('agent:pending-activation');
    
    console.log('[Console Chat] Ready! Type messages to chat with the agent.');
    console.log('[Console Chat] Commands: /quit to exit, /sleep to toggle agent sleep\n');
    
    // Show initial prompt
    this.rl?.prompt();
  }

  async onUnmount(): Promise<void> {
    console.log('\n[Console Chat] Unmounting...');
    
    // Stream cleanup is handled automatically by VEIL state
    
    this.isActive = false;
    this.rl?.close();
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
        this.handleCommand(trimmed);
        return;
      }
      
      // Process as message
      this.handleMessage(trimmed);
    });
    
    // Handle close
    this.rl.on('close', () => {
      if (this.isActive) {
        console.log('\n[Console Chat] Goodbye!');
        // Emit an event to allow cleanup
        const space = this.element?.space as any;
        if (space && space.queueEvent) {
          space.queueEvent({
            topic: 'console:closing',
            payload: {},
            source: {
              elementId: this.element?.id || 'console',
              elementPath: this.element?.getPath() || []
            }
          });
        }
        // Give a moment for cleanup
        setTimeout(() => process.exit(0), 100);
      }
    });
  }

  private handleCommand(command: string): void {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();
    
    switch (cmd) {
      case '/quit':
      case '/exit':
        this.rl?.close();
        break;
        
      case '/sleep':
        // Parse optional duration in seconds
        const duration = parts[1] ? parseInt(parts[1], 10) : undefined;
        
        // Emit agent command with optional duration
        this.element.emit({
          topic: 'agent:command',
          source: this.element.getRef(),
          payload: { 
            type: 'sleep',
            duration: duration // duration in seconds
          },
          timestamp: Date.now()
        });
        
        if (duration && !isNaN(duration)) {
          console.log(`[Console Chat] Agent will sleep for ${duration} seconds`);
          
          // Set up auto-wake timer
          setTimeout(() => {
            this.element.emit({
              topic: 'agent:command',
              source: this.element.getRef(),
              payload: { type: 'wake' },
              timestamp: Date.now()
            });
            console.log('[Console Chat] Agent automatically woken up');
          }, duration * 1000);
        } else {
          console.log('[Console Chat] Toggled agent sleep mode');
        }
        this.rl?.prompt();
        break;
        
      case '/help':
        console.log('\nCommands:');
        console.log('  /quit, /exit - Exit the chat');
        console.log('  /sleep [seconds] - Toggle agent sleep mode or sleep for N seconds');
        console.log('  /help - Show this help\n');
        this.rl?.prompt();
        break;
        
      default:
        console.log(`Unknown command: ${command}`);
        this.rl?.prompt();
    }
  }

  private handleMessage(message: string): void {
    this.messageCount++;
    const messageId = `console-msg-${this.messageCount}`;
    
    console.log(`\n[You]: ${message}`);
    
    this.tracer?.record({
      id: `console-input-${messageId}`,
      timestamp: Date.now(),
      level: 'info',
      category: TraceCategory.ADAPTER_INPUT,
      component: 'ConsoleChat',
      operation: 'handleMessage',
      data: {
        messageId,
        content: message,
        messageCount: this.messageCount
      }
    });
    
    // Store pending message to be added in frame:start
    this.pendingMessage = {
      id: messageId,
      content: message
    };
    
    // Emit event to trigger frame creation
    this.element.emit({
      topic: 'console:input',
      source: this.element.getRef(),
      payload: { message },
      timestamp: Date.now(),
      priority: 'high' // User messages have high priority
    });
  }

  private hasStreamFacet(frame: Frame): boolean {
    return frame.deltas.some(op => 
      op.type === 'addFacet' &&
      op.facet?.type === 'stream-change' &&
      hasStateAspect(op.facet) &&
      op.facet.state.streamId === this.consoleStream.streamId &&
      op.facet.state.operation === 'add'
    );
  }

  async handleEvent(event: SpaceEvent): Promise<void> {
    // Handle frame:start - add pending message or activation operations
    if (event.topic === 'frame:start' && (this.pendingMessage || this.pendingActivationFacetId)) {
      const space = this.element.space as Space;
      const frame = space.getCurrentFrame();
      
      if (!frame) {
        console.error('[Console Chat] No frame in frame:start event!');
        return;
      }
      
      // Add operations to the frame
      const deltas: VEILDelta[] = [];
      
      // Add stream if not already added
      if (!this.hasStreamFacet(frame)) {
        deltas.push({
          type: 'addFacet',
          facet: createStreamRewriteFacet({
            operation: 'add',
            streamId: this.consoleStream.streamId,
            streamType: this.consoleStream.streamType
          })
        });
      }
      
      if (this.pendingMessage) {
        // Add message as event facet
        deltas.push({
          type: 'addFacet',
          facet: createEventFacet({
            id: this.pendingMessage.id,
            content: this.pendingMessage.content,
            source: 'user',
            eventType: 'console-message',
            metadata: {
              channel: 'console',
              timestamp: new Date().toISOString()
            },
            streamId: this.consoleStream.streamId,
            streamType: this.consoleStream.streamType
          })
        });
        
        // Request agent activation
        const activationId = `agent-activation-${Date.now()}`;
        deltas.push({
          type: 'addFacet',
          facet: createAgentActivation('User message received', {
            id: activationId,
            priority: 'normal',
            source: 'console-chat',
            sourceAgentId: 'user',
            sourceAgentName: 'User',
            streamRef: {
              streamId: this.consoleStream.streamId,
              streamType: this.consoleStream.streamType
            }
          })
        });
      } else if (this.pendingActivationFacetId) {
        // Activation facet persists in state, no need to re-add
      }
      
      // Add operations to frame
      frame.deltas.push(...deltas);
      
      // Set active stream
      frame.activeStream = this.consoleStream;
      
      // Clear pending data
      this.pendingMessage = undefined;
      this.pendingActivationFacetId = undefined;
    }
    
    // Handle frame end - check for speech facets targeted to console
    if (event.topic === 'frame:end') {
      const space = this.element.space as Space;
      const veilState = space?.getVEILState();
      if (veilState) {
        const state = veilState.getState();
        
        // Find speech facets targeted to our console stream that we haven't displayed yet
        const consoleSpeech = Array.from(state.facets.values())
          .filter((f): f is SpeechFacet => 
            f.type === 'speech' &&
            hasStreamAspect(f) &&
            f.streamId === this.consoleStream.streamId &&
            hasAgentGeneratedAspect(f) &&
            !this.displayedSpeechIds.has(f.id)
          );
        
        // Display new speech facets
        for (const speech of consoleSpeech) {
          this.displayedSpeechIds.add(speech.id);
          const agentName = speech.agentName || 'Agent';
          console.log(`\n[${agentName}]: ${speech.content}`);
          
          this.tracer?.record({
            id: `console-output-${Date.now()}`,
            timestamp: Date.now(),
            level: 'info',
            category: TraceCategory.ADAPTER_OUTPUT,
            component: 'ConsoleChat',
            operation: 'handleAgentSpeech',
            data: {
              content: speech.content,
              agentName,
              agentId: speech.agentId
            }
          });
        }
        
        if (consoleSpeech.length > 0) {
          this.rl?.prompt();
        }
      }
    }
    
    // Handle pending activations after wake
    if (event.topic === 'agent:pending-activation') {
      const { id } = event.payload as { id: string };
      
      // Store the activation facet ID for tracking
      this.pendingActivationFacetId = id;
      
      // Emit event to trigger frame processing
      this.element.emit({
        topic: 'console:input',
        source: this.element.getRef(),
        payload: { message: '[Processing pending activation from sleep]' },
        timestamp: Date.now(),
        priority: 'high' // Pending activations from sleep have high priority
      });
    }
  }
}
