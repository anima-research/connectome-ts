/**
 * Complete Box Game - Interactive RETM Implementation
 *
 * This implementation provides the full box game experience with:
 * - Interactive console interface
 * - Real LLM integration
 * - Observer-relative visibility
 * - Command parsing and multi-user support
 * - Complete RETM architecture
 */

import { config } from 'dotenv';
config();

import * as readline from 'readline';
import { Space } from '../src/spaces/space';
import { Element } from '../src/spaces/element';
import { Component } from '../src/spaces/component';
import { VEILStateManager } from '../src/veil/veil-state';
import { BasicAgent } from '../src/agent/basic-agent';
import { AgentComponent } from '../src/agent/agent-component';
import { AgentEffector } from '../src/agent/agent-effector';
import { ContextTransform } from '../src/hud/context-transform';
import { AnthropicProvider } from '../src/llm/anthropic-provider';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { LLMProvider } from '../src/llm/llm-interface';
import { DebugServer } from '../src/debug';
import {
  Receptor,
  Transform,
  Effector,
  Maintainer,
  ReadonlyVEILState,
  FacetDelta,
  EffectorResult
} from '../src/spaces/receptor-effector-types';
import { SpaceEvent } from '../src/spaces/types';
import { Facet, VEILDelta, SpeechFacet, hasStreamAspect, hasAgentGeneratedAspect } from '../src/veil/types';
import {
  createEventFacet,
  createStateFacet,
  createSpeechFacet,
  createAgentActivation,
  addFacet,
  changeFacet
} from '../src/helpers/factories';

// ============================================================================
// DATA STRUCTURES
// ============================================================================

interface BoxState {
  boxId: string;
  contents: string[];
  creator: string;
  isOpen: boolean;
  createdAt: number;
}


interface GameCommand {
  action: 'create-box' | 'open-box' | 'say' | 'help' | 'status';
  args: string[];
  user: string;
}

// ============================================================================
// RECEPTORS (Events → Facets)
// ============================================================================

/**
 * BoxGameReceptor: Unified receptor handling all game events
 */
class BoxGameReceptor implements Receptor {
  topics = ['console:input', 'game:command', 'agent:action', 'game:box-created', 'game:box-opened', 'game:box-not-found', 'game:box-already-open'];

  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const facets: Facet[] = [];

    // Handle user commands
    if (event.topic === 'console:input' || event.topic === 'game:command' || event.topic === 'agent:action') {
      const command = event.payload as GameCommand;
      if (command.action === 'create-box' && command.args.length > 0) {
        const contents = command.args[0].split(',').map(item => item.trim());
        facets.push({
          id: `game-action-create-${Date.now()}`,
          type: 'game-action',
          content: `${command.user} is creating a box with ${contents.length} items`,
          state: { action: 'create-box', params: { contents, actor: command.user } },
          ephemeral: true
        } as Facet);
      }
      else if (command.action === 'open-box' && command.args.length > 0) {
        facets.push({
          id: `game-action-open-${command.args[0]}-${Date.now()}`,
          type: 'game-action',
          content: `${command.user} is opening box ${command.args[0]}`,
          state: { action: 'open-box', params: { boxId: command.args[0], actor: command.user } },
          ephemeral: true
        } as Facet);
      }
      else if (command.action === 'say' && command.args.length > 0) {
        facets.push(createSpeechFacet({
          id: `speech-${command.user}-${Date.now()}`,
          content: command.args.join(' '),
          agentId: command.user,
          agentName: command.user,
          streamId: 'dialogue'
        }));
      }
    }
    // Handle game events
    else if (event.topic === 'game:box-created') {
      const payload = event.payload as any;
      facets.push(createStateFacet({
        id: `box-${payload.boxId}`,
        content: `📦 Box ${payload.boxId}: ${payload.contents.join(', ')} (created by ${payload.creator})`,
        entityType: 'component',
        entityId: payload.boxId,
        state: { boxId: payload.boxId, contents: payload.contents, creator: payload.creator, isOpen: false, createdAt: Date.now() } as BoxState
      }));
      facets.push(createEventFacet({
        id: `box-created-event-${payload.boxId}`,
        content: `${payload.creator} created box ${payload.boxId} with ${payload.contents.length} items`,
        source: payload.creator,
        eventType: 'box-created',
        streamId: 'game-events',
        metadata: payload
      }));
    }
    else if (event.topic === 'game:box-opened') {
      const payload = event.payload as any;
      const existingBox = Array.from(state.facets.values()).find(f =>
        f.type === 'state' && f.state && 'boxId' in f.state && f.state.boxId === payload.boxId
      );
      if (existingBox && existingBox.state) {
        facets.push(createStateFacet({
          id: existingBox.id,
          content: `📦 Box ${payload.boxId} (OPEN): ${payload.contents.join(', ')} (was created by ${payload.creator})`,
          entityType: 'component',
          entityId: payload.boxId,
          state: { ...(existingBox.state as BoxState), isOpen: true } as BoxState
        }));
      }
      facets.push(createEventFacet({
        id: `box-opened-event-${payload.boxId}-${Date.now()}`,
        content: `🎉 ${payload.opener} opened box ${payload.boxId}, revealing: ${payload.contents.join(', ')}!`,
        source: payload.opener,
        eventType: 'box-opened',
        streamId: 'game-events',
        metadata: payload
      }));
    }
    else if (event.topic === 'game:box-not-found') {
      const payload = event.payload as any;
      facets.push(createEventFacet({
        id: `box-not-found-${payload.boxId}-${Date.now()}`,
        content: `❌ Box ${payload.boxId} not found!`,
        source: 'system',
        eventType: 'box-not-found',
        streamId: 'game-events',
        metadata: payload
      }));
    }
    else if (event.topic === 'game:box-already-open') {
      const payload = event.payload as any;
      facets.push(createEventFacet({
        id: `box-already-open-${payload.boxId}-${Date.now()}`,
        content: `ℹ️ Box ${payload.boxId} is already open!`,
        source: 'system',
        eventType: 'box-already-open',
        streamId: 'game-events',
        metadata: payload
      }));
    }

    return facets;
  }
}

// ============================================================================
// TRANSFORMS (Context Generation)
// ============================================================================

// UserContextTransform: Generates TUI for users, ignores ALL context-scoped facets
class UserContextTransform implements Transform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];

    // Generate context for each active player
    const players = this.getActivePlayers(state);

    for (const player of players) {
      const contextId = `context-${player}`;
      const contextContent = this.generatePlayerContext(state, player);

      const existing = Array.from(state.facets.values()).find(f => f.id === contextId);

      if (!existing) {
        deltas.push(addFacet(createStateFacet({
          id: contextId,
          content: contextContent,
          entityType: 'component',
          entityId: player,
          state: { player, updated: Date.now() },
          scopes: ['user-rendered-context']  // Mark as user TUI context
        })));
      } else if (existing.content !== contextContent) {
        // Only update when content actually changed - this prevents infinite loops
        deltas.push(changeFacet(contextId, {
          content: contextContent,
          attributes: {
            ...existing.attributes,
            state: { player, updated: Date.now() },
            scopes: ['user-rendered-context']  // Mark as user TUI context
          }
        }));
      }
      // No else clause - if content is same, don't create any deltas
    }

    return deltas;
  }

  private getActivePlayers(state: ReadonlyVEILState): string[] {
    const players = new Set<string>();

    // Get players from boxes
    state.getFacetsByType('state').forEach(f => {
      if (f.state && 'creator' in f.state) {
        players.add(f.state.creator as string);
      }
    });

    // Get players from events
    state.getFacetsByType('event').forEach(f => {
      if (f.state?.source) {
        players.add(f.state.source);
      }
    });

    players.add('user');
    players.add('agent');

    return Array.from(players);
  }

  private generatePlayerContext(state: ReadonlyVEILState, player: string): string {
    const lines: string[] = [];
    lines.push('=== BOX GAME STATUS ===\n');

    // Get boxes - inline getBoxFacets
    const boxes = state.getFacetsByType('state')
      .filter(f => {
        const isContextScope = f.scopes?.some((s: string) => s === 'user-rendered-context' || s === 'agent-rendered-context');
        const isActualBox = f.state && 'boxId' in f.state && 'creator' in f.state && 'contents' in f.state;
        return isActualBox && !isContextScope;
      })
      .map(f => f.state as BoxState);

    if (boxes.length > 0) {
      lines.push('--- Available Boxes ---');
      // Inline formatBoxList for user
      boxes.forEach(box => {
        const status = box.isOpen ? 'OPEN' : 'closed';
        const canSee = box.isOpen || box.creator === player;
        if (canSee) {
          const ownership = box.creator === player ? '[YOU created this]' : `[created by ${box.creator}]`;
          lines.push(`📦 Box ID: ${box.boxId} (${status}): ${box.contents.join(', ')} ${ownership}`);
        } else {
          lines.push(`📦 Box ID: ${box.boxId} (${status}): [contents hidden] [created by ${box.creator}] - Use @box.open("${box.boxId}") to open`);
        }
      });
      lines.push('');
    }

    // Get recent activity - inline getRecentActivity + formatActivity
    const activity: Array<{content: string; source: string}> = [];
    state.facets.forEach(f => {
      const isContextScope = f.scopes?.some((s: string) => s === 'user-rendered-context' || s === 'agent-rendered-context');
      if (isContextScope) return;
      if (f.type === 'event' && f.content) {
        activity.push({ content: f.content, source: f.state?.source || 'system' });
      } else if (f.type === 'speech' && f.content) {
        const agentName = (f as any).agentName || (f as any).agentId || 'Unknown';
        activity.push({ content: f.content, source: agentName });
      }
    });
    const recentActivity = activity.slice(-10);
    if (recentActivity.length > 0) {
      lines.push('--- Recent Activity ---');
      recentActivity.forEach(item => {
        lines.push(`  [${item.source}]: ${item.content}`);
      });
      lines.push('');
    }

    lines.push('--- Available Commands ---');
    lines.push('/create-box apple,orange,banana - Create a box with items');
    lines.push('/open-box <boxId> - Open an existing box');
    lines.push('/say hello everyone! OR hello everyone! - Say something');
    lines.push('');

    // Stats
    const stats = {
      totalBoxes: boxes.length,
      openBoxes: boxes.filter(b => b.isOpen).length,
      yourBoxes: boxes.filter(b => b.creator === player).length
    };

    lines.push(`--- Stats ---`);
    lines.push(`Total boxes: ${stats.totalBoxes}, Open: ${stats.openBoxes}, Yours: ${stats.yourBoxes}`);

    return lines.join('\n');
  }
}

// ============================================================================
// EFFECTORS (Side Effects)
// ============================================================================

// NOTE: ConsoleDisplayEffector removed - replaced with ConsoleEffector

// NOTE: BoxOpeningEffector removed - replaced with BoxGameEffector

// ============================================================================
// NEW CLEAN EFFECTORS (External Interface)
// ============================================================================

/**
 * BoxGameEffector: Game world simulation with internal state
 * Processes game-action facets (unified from user/agent) and agent action facets
 */
class BoxGameEffector implements Effector {
  facetFilters = [{ type: 'game-action' }, { type: 'action' }];

  private boxes = new Map<string, BoxState>();

  async process(changes: FacetDelta[]): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];

    for (const change of changes) {
      if (change.type === 'added') {
        const facet = change.facet;

        // Handle game-action facets (from UserInputReceptor)
        if (facet.type === 'game-action') {
          const action = facet.state?.action;
          const params = facet.state?.params || {};

          if (action === 'create-box') {
            events.push(...this.handleCreateBox(params.contents!, params.actor));
          }
          else if (action === 'open-box') {
            events.push(...this.handleOpenBox(params.boxId!, params.actor));
          }
        }
        // Handle action facets (from agent tool use - @box.create/@box.open)
        else if (facet.type === 'action') {
          const toolName = facet.state?.toolName;
          const params = facet.state?.parameters || {};

          if (toolName === 'box.create') {
            const itemsString = params.value || params.items || '';
            const contents = itemsString.split(',').map((item: string) => item.trim()).filter((item: string) => item);
            events.push(...this.handleCreateBox(contents, 'agent'));
          }
          else if (toolName === 'box.open') {
            const boxId = params.value || params.boxId || '';
            events.push(...this.handleOpenBox(boxId, 'agent'));
          }
        }
      }
    }

    return { events };
  }

  /**
   * Unified box creation logic - called by both user and agent paths
   */
  private handleCreateBox(contents: string[], creator: string): SpaceEvent[] {
    const boxId = `box${Date.now()}`;

    // Update internal game state
    this.boxes.set(boxId, {
      boxId,
      contents,
      creator,
      isOpen: false,
      createdAt: Date.now()
    });

    // Emit box creation event
    return [{
      topic: 'game:box-created',
      source: { elementId: 'box-game-effector', elementPath: [] },
      payload: { boxId, contents, creator },
      timestamp: Date.now()
    }];
  }

  /**
   * Unified box opening logic - called by both user and agent paths
   */
  private handleOpenBox(boxId: string, opener: string): SpaceEvent[] {
    const box = this.boxes.get(boxId);

    if (!box) {
      return [{
        topic: 'game:box-not-found',
        source: { elementId: 'box-game-effector', elementPath: [] },
        payload: { boxId, opener },
        timestamp: Date.now()
      }];
    }

    if (box.isOpen) {
      return [{
        topic: 'game:box-already-open',
        source: { elementId: 'box-game-effector', elementPath: [] },
        payload: { boxId, opener },
        timestamp: Date.now()
      }];
    }

    // Update internal game state
    box.isOpen = true;
    this.boxes.set(boxId, box);

    // Emit box opened event
    return [{
      topic: 'game:box-opened',
      source: { elementId: 'box-game-effector', elementPath: [] },
      payload: { boxId, opener, contents: box.contents, creator: box.creator },
      timestamp: Date.now()
    }];
  }
}

// ConsoleEffector: User interface (stdin/stdout)
class ConsoleEffector implements Effector {
  facetFilters = [{ type: 'state', scopeMatch: ['user-rendered-context'] }];

  async process(changes: FacetDelta[]): Promise<EffectorResult> {
    for (const change of changes) {
      if (change.type === 'added' || change.type === 'changed') {
        const context = change.facet;

        // Only display context for the actual human user, not for agents
        const player = context.state?.player;
        if (player === 'user' && context.content) {
          console.log('\n' + context.content);
        }
      }
    }

    return { events: [] };
  }
}

// AgentContextTransform: Generates context for agent (for HUD/LLM)
class AgentContextTransform implements Transform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];

    // Generate context for agent
    const contextId = 'agent-hud-context';
    const contextContent = this.generateAgentContext(state);

    const existing = Array.from(state.facets.values()).find(f => f.id === contextId);

    if (!existing) {
      deltas.push(addFacet({
        id: contextId,
        type: 'ambient',
        content: contextContent,
        scopes: ['agent-rendered-context']
      } as Facet));
    } else if (existing.content !== contextContent) {
      deltas.push(changeFacet(contextId, {
        content: contextContent,
        attributes: {
          scopes: ['agent-rendered-context']
        }
      }));
    }

    return deltas;
  }

  private generateAgentContext(state: ReadonlyVEILState): string {
    const lines: string[] = [];
    lines.push('=== BOX GAME - AGENT VIEW ===\n');

    // Get boxes - inline getBoxFacets
    const boxes = state.getFacetsByType('state')
      .filter(f => {
        const isContextScope = f.scopes?.some((s: string) => s === 'user-rendered-context' || s === 'agent-rendered-context');
        const isActualBox = f.state && 'boxId' in f.state && 'creator' in f.state && 'contents' in f.state;
        return isActualBox && !isContextScope;
      })
      .map(f => f.state as BoxState);

    if (boxes.length > 0) {
      lines.push('Current boxes:');
      // Inline formatBoxList for agent (agent sees all)
      boxes.forEach(box => {
        const status = box.isOpen ? 'OPEN' : 'closed';
        lines.push(`- Box ${box.boxId} (${status}): ${box.contents.join(', ')} [created by ${box.creator}]`);
      });
      lines.push('');
    } else {
      lines.push('No boxes exist yet.\n');
    }

    // Get recent activity - inline getRecentActivity + formatActivity
    const activity: Array<{content: string; source: string}> = [];
    state.facets.forEach(f => {
      const isContextScope = f.scopes?.some((s: string) => s === 'user-rendered-context' || s === 'agent-rendered-context');
      if (isContextScope) return;
      if (f.type === 'event' && f.content) {
        activity.push({ content: f.content, source: f.state?.source || 'system' });
      } else if (f.type === 'speech' && f.content) {
        const agentName = (f as any).agentName || (f as any).agentId || 'Unknown';
        activity.push({ content: f.content, source: agentName });
      }
    });
    const recentActivity = activity.slice(-8);
    if (recentActivity.length > 0) {
      lines.push('Recent activity:');
      recentActivity.forEach(item => {
        lines.push(`- [${item.source}]: ${item.content}`);
      });
      lines.push('');
    }

    lines.push('**Your Actions:**');
    lines.push('To create a box, use: @box.create("item1,item2,item3")');
    lines.push('To open a box, use: @box.open("box1234567890")');
    lines.push('');
    lines.push('**Example responses:**');
    lines.push('"Let me create that for you! @box.create("mystery,surprise,magic")"');
    lines.push('"I\'ll open it now @box.open("box1759187897650")"');
    lines.push('');
    lines.push('You can chat normally AND use actions in the same response.');

    return lines.join('\n');
  }
}

// Transform to add agent activations for interesting events
class AgentActivationTransform implements Transform {
  private processedEvents = new Set<string>();
  private lastActivationTime = 0;
  private readonly ACTIVATION_COOLDOWN_MS = 2000; // 2 second cooldown

  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const now = Date.now();

    // Rate limiting: don't activate too frequently
    if (now - this.lastActivationTime < this.ACTIVATION_COOLDOWN_MS) {
      return deltas; // Still in cooldown period
    }

    // Find new interesting events that should trigger agent activation
    const interestingEvents = state.getFacetsByType('event').filter(f => {
      const eventType = f.state?.eventType;
      const source = f.state?.source || f.state?.metadata?.speaker;
      const creator = f.state?.metadata?.creator;
      const isUserAction = source && source !== 'agent' && source !== 'system' &&
                          creator !== 'agent';

      // Don't activate on error events
      const isErrorEvent = eventType === 'box-not-found' || eventType === 'box-already-open';

      return (eventType === 'box-opened' || eventType === 'box-created') &&
             !isErrorEvent &&
             isUserAction &&
             !this.processedEvents.has(f.id);
    });

    // Also check for user speech facets (these are type: 'speech', not events)
    const interestingSpeech = state.getFacetsByType('speech').filter(f => {
      const agentId = (f as any).agentId;
      const agentName = (f as any).agentName;

      // Only activate on user speech, not agent speech
      // Filter out: agent, system, box-game-ai (the actual agent name)
      const isUserSpeech = agentId &&
                          agentId !== 'agent' &&
                          agentId !== 'system' &&
                          agentId !== 'box-game-ai' &&
                          agentName !== 'agent' &&
                          agentName !== 'System' &&
                          agentName !== 'box-game-ai';

      return isUserSpeech && !this.processedEvents.has(f.id);
    });

    const totalInteresting = interestingEvents.length + interestingSpeech.length;

    if (totalInteresting > 0) {
    }

    // Process event facets
    for (const event of interestingEvents) {
      this.processedEvents.add(event.id);
      const eventType = event.state?.eventType;
      const source = event.state?.source || event.state?.metadata?.speaker;


      const activationFacet = createAgentActivation(`New ${eventType} event requires attention`, {
        id: `activation-${eventType}-${Date.now()}`,
        priority: eventType === 'box-opened' ? 'high' : 'normal',
        source: 'box-game',
        triggerEvent: event.id,
        eventType,
        triggerSource: source
      });

      deltas.push(addFacet(activationFacet));
    }

    // Process speech facets
    for (const speech of interestingSpeech) {
      this.processedEvents.add(speech.id);
      const agentName = (speech as any).agentName || (speech as any).agentId;


      const activationFacet = createAgentActivation(`New speech from ${agentName} requires attention`, {
        id: `activation-speech-${Date.now()}`,
        priority: 'normal',
        source: 'box-game',
        triggerEvent: speech.id,
        eventType: 'speech',
        triggerSource: agentName
      });

      deltas.push(addFacet(activationFacet));
    }

    // Update last activation time if we created any activations
    if (deltas.length > 0) {
      this.lastActivationTime = now;
    }

    return deltas;
  }
}

// ============================================================================
// MAINTAINERS (Cleanup)
// ============================================================================

class EventCleanupMaintainer implements Maintainer {
  maintain(state: ReadonlyVEILState): SpaceEvent[] {
    // In a real implementation, we might clean up old events
    // For now, just log what we'd do
    const eventCount = state.getFacetsByType('event').length;
    if (eventCount > 50) {
      console.log(`[Cleanup] Would clean up old events (${eventCount} total)`);
    }

    return [];
  }
}

// ============================================================================
// INTERACTIVE CONSOLE
// ============================================================================

class BoxGameConsole extends Component {
  private rl?: readline.Interface;
  private isActive = false;
  private currentUser = 'user';
  private displayedEvents = new Set<string>();

  async onMount(): Promise<void> {
    console.log('\n🎮 INTERACTIVE BOX GAME');
    console.log('======================');
    console.log('Welcome! Create boxes with secret contents, then open them to reveal surprises!');
    console.log('The AI agent can participate too - it will react to your actions.\n');

    console.log('Commands:');
    console.log('  /create-box apple,gold,potion - Create a box with items');
    console.log('  /open-box box123456789        - Open a box by ID');
    console.log('  /say Hello everyone!          - Chat with everyone');
    console.log('  Hello everyone!               - Also chat (no /say needed)');
    console.log('  /switch alice                 - Switch to different user');
    console.log('  /status                       - Show game status');
    console.log('  /quit                         - Exit game');
    console.log('======================\n');

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `[${this.currentUser}]> `
    });

    this.startListening();
    this.element.subscribe('frame:end');
    this.rl.prompt();
  }

  async onUnmount(): Promise<void> {
    this.isActive = false;
    this.rl?.close();
  }

  private startListening(): void {
    if (!this.rl) return;
    this.isActive = true;

    this.rl.on('line', (input) => {
      if (!this.isActive) return;

      const trimmed = input.trim();
      if (!trimmed) {
        this.rl?.prompt();
        return;
      }

      if (trimmed.startsWith('/')) {
        this.handleSlashCommand(trimmed);
      } else {
        // Lines without slash are treated as /say
        this.handleSlashCommand(`/say ${trimmed}`);
      }
    });

    this.rl.on('close', () => {
      console.log('\n🎮 Thanks for playing! Goodbye!');
      process.exit(0);
    });
  }

  private handleSlashCommand(cmd: string): void {
    const parts = cmd.split(' ');
    const command = parts[0];
    const args = parts.slice(1);

    switch (command) {
      case '/quit':
      case '/exit':
        this.rl?.close();
        break;

      case '/switch':
        if (args[0]) {
          this.currentUser = args[0];
          this.rl?.setPrompt(`[${this.currentUser}]> `);
          console.log(`Switched to user: ${this.currentUser}`);
        }
        this.rl?.prompt();
        break;

      case '/status':
        this.showGameStatus();
        this.rl?.prompt();
        break;

      case '/create-box':
        this.handleGameCommand('create-box', args);
        break;

      case '/open-box':
        this.handleGameCommand('open-box', args);
        break;

      case '/say':
        this.handleGameCommand('say', args);
        break;

      case '/help':
        this.showHelp();
        this.rl?.prompt();
        break;

      default:
        console.log(`Unknown command: ${command}. Type /help for available commands.`);
        this.rl?.prompt();
    }
  }

  private showGameStatus(): void {
    const space = this.element.space as Space;
    const state = space?.getVEILState()?.getState();

    if (!state) {
      console.log('No game state available');
      return;
    }

    const contextFacet = Array.from(state.facets.values())
      .find(f => f.id === `context-${this.currentUser}`);

    if (contextFacet) {
      console.log('\n' + contextFacet.content);
    } else {
      console.log('No context available for current user');
    }
  }

  private handleGameCommand(action: string, args: string[]): void {
    let gameAction: GameCommand['action'];

    switch (action) {
      case 'create-box':
        gameAction = 'create-box';
        if (args.length === 0) {
          console.log('Usage: /create-box item1,item2,item3');
          this.rl?.prompt();
          return;
        }
        break;
      case 'open-box':
        gameAction = 'open-box';
        if (args.length === 0) {
          console.log('Usage: /open-box boxId');
          this.rl?.prompt();
          return;
        }
        break;
      case 'say':
        gameAction = 'say';
        if (args.length === 0) {
          console.log('Usage: /say your message here');
          this.rl?.prompt();
          return;
        }
        break;
      default:
        console.log(`Unknown action: ${action}. Try: /create-box, /open-box, /say`);
        this.rl?.prompt();
        return;
    }

    // Emit console input (use console:input so HUD recognizes as user frame)
    this.element.emit({
      topic: 'console:input',
      source: this.element.getRef(),
      payload: {
        action: gameAction,
        args,
        user: this.currentUser
      } as GameCommand,
      timestamp: Date.now()
    });
  }

  private showHelp(): void {
    console.log('\n=== Box Game Commands ===');
    console.log('/create-box item1,item2,item3 - Create a box with items');
    console.log('/open-box boxId               - Open an existing box');
    console.log('/say message                  - Say something to everyone');
    console.log('message                       - Same as /say message');
    console.log('/switch username              - Switch to different user');
    console.log('/status                       - Show current game status');
    console.log('/help                         - Show this help');
    console.log('/quit                         - Exit the game\n');
  }

  async handleEvent(event: SpaceEvent): Promise<void> {
    if (event.topic === 'frame:end') {
      // Display new speech facets
      const space = this.element.space as Space;
      const state = space?.getVEILState()?.getState();

      if (state) {
        // Get all speech facets (type: 'speech')
        const speechFacets = Array.from(state.facets.values())
          .filter(f => f.type === 'speech' && !this.displayedEvents.has(f.id));

        if (speechFacets.length > 0) {
        }

        for (const speech of speechFacets) {
          this.displayedEvents.add(speech.id);
          const agentName = (speech as any).agentName || (speech as any).agentId || 'Unknown';
          const content = speech.content;


          // Don't echo own messages
          if (agentName !== this.currentUser) {
            console.log(`[${agentName}]: ${content}`);
          }
        }

        if (speechFacets.length > 0) {
          this.rl?.prompt();
        }
      }
    }
  }
}

// ============================================================================
// ENHANCED AGENT
// ============================================================================

class BoxGameAgent extends BasicAgent {
  constructor(llmProvider: LLMProvider, veilState: VEILStateManager) {
    super({
      systemPrompt: `You are an AI playing an interactive box game!

Game Rules:
- Players create boxes with hidden contents
- Box contents are only visible to the creator until opened
- Anyone can open any box to reveal contents to everyone
- You can chat with players using normal speech

**How to Use Your Actions:**
You can create and open boxes by using special syntax in your responses:
- To CREATE a box: @box.create("item1,item2,item3")
- To OPEN a box: @box.open("boxId")

**Examples:**
- "Ooh, a mysterious box! Let me create one too @box.create("stars,moonlight,dreams")"
- "I'm so curious! @box.open("box1234567890")"
- "That sounds amazing! @box.create("thunder,lightning,rain")"

You can combine actions with natural speech in the same response. Just make sure to use the EXACT syntax @box.create() or @box.open() with the @ symbol at the start.

Strategy Tips:
- Be curious about boxes others create
- Create interesting boxes with creative items
- React to discoveries when boxes are opened
- Engage in conversation about the game

Be playful and creative! The goal is fun exploration and discovery.`,
      defaultMaxTokens: 250,
      defaultTemperature: 0.8,
      name: 'box-game-ai'
    }, llmProvider, veilState);

    // Register box game tools
    this.registerTool({
      name: 'box.create',
      description: 'Create a new box with specified items',
      parameters: {
        items: { type: 'string', description: 'Comma-separated items for the box' }
      },
      elementPath: ['box'],
      emitEvent: {
        topic: 'game:command',
        payloadTemplate: {
          action: 'create-box',
          args: ['{{items}}'],
          user: 'agent'
        }
      }
    });

    this.registerTool({
      name: 'box.open',
      description: 'Open an existing box to reveal its contents',
      parameters: {
        boxId: { type: 'string', description: 'ID of the box to open (e.g., "box123456789")' }
      },
      elementPath: ['box'],
      emitEvent: {
        topic: 'game:command',
        payloadTemplate: {
          action: 'open-box',
          args: ['{{boxId}}'],
          user: 'agent'
        }
      }
    });
  }
}

// ============================================================================
// MAIN GAME
// ============================================================================

class CompleteBoxGameElement extends Element {
  constructor() {
    super('complete-box-game', 'complete-box-game');
  }

  async onMount(): Promise<void> {
    console.log('🚀 Complete Box Game initialized with full RETM architecture');
  }
}

function createLLMProvider(): LLMProvider {
  const useMock = process.env.USE_MOCK_LLM === 'true';

  if (useMock) {
    console.log('🤖 Using Mock LLM (USE_MOCK_LLM=true)');
    const mock = new MockLLMProvider();

    // Customize mock responses for box game
    mock.generate = async (messages) => {
      const lastMessage = messages[messages.length - 1]?.content || '';

      // React to box being created
      if (lastMessage.includes('created box') || lastMessage.includes('box-created')) {
        return {
          content: `Oh, exciting! A new mysterious box! I wonder what's inside...`,
          metadata: {}
        };
      }

      // React to box being opened
      if (lastMessage.includes('opened box') || lastMessage.includes('revealing:')) {
        return {
          content: `Wow! What an amazing discovery! The contents are so interesting. This game is full of surprises!`,
          metadata: {}
        };
      }

      // React to general speech/greetings
      if (lastMessage.includes('hi') || lastMessage.includes('hello') || lastMessage.includes('hey')) {
        return {
          content: `Hello! This box game is so much fun! Feel free to create some mysterious boxes - I'm excited to see what you come up with!`,
          metadata: {}
        };
      }

      // Default: encourage creating boxes
      return {
        content: `This box game is fascinating! Why don't you create a box with some interesting items? I'd love to see what you choose!`,
        metadata: {}
      };
    };

    return mock;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY not set. Use USE_MOCK_LLM=true or set your API key.');
    process.exit(1);
  }

  console.log('🤖 Using Anthropic Claude');
  return new AnthropicProvider({
    apiKey,
    defaultModel: 'claude-sonnet-4-20250514',
    defaultMaxTokens: 250,
    maxRetries: 3,
    retryDelay: 1000
  });
}

async function runCompleteBoxGame(): Promise<void> {
  console.log('🎮 Starting Complete Interactive Box Game');
  console.log('========================================\n');

  // Create core system
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  const llmProvider = createLLMProvider();

  // Set up debug server if enabled
  const debugEnabled = process.env.DEBUG_SERVER_ENABLED === 'true';
  let debugServer: DebugServer | undefined;

  if (debugEnabled) {
    debugServer = new DebugServer(space, {
      enabled: true,
      port: 3015,
      host: '127.0.0.1',
      maxFrames: 200
    });
    debugServer.start();
    console.log('🔍 Debug UI available at http://localhost:3015');
    console.log('   You can inspect game state, events, and agent activity in real-time\n');
  }

  // Create main game element
  const gameElement = new CompleteBoxGameElement();
  space.addChild(gameElement);

  // Set up RETM pipeline
  console.log('🔧 Setting up RETM architecture...');

  // Receptors
  space.addReceptor(new BoxGameReceptor());

  // Transforms
  space.addTransform(new UserContextTransform());
  space.addTransform(new AgentContextTransform()); // Generate agent's game context
  space.addTransform(new AgentActivationTransform());
  space.addTransform(new ContextTransform(veilState)); // Framework's HUD - assembles context for LLM

  // Effectors
  space.addEffector(new BoxGameEffector());
  space.addEffector(new ConsoleEffector());

  // Maintainers
  space.addMaintainer(new EventCleanupMaintainer());

  // Create AI agent
  console.log('🤖 Creating AI agent...');
  const agent = new BoxGameAgent(llmProvider, veilState);
  const agentElement = new Element('agent', 'box-game-agent');
  const agentComponent = new AgentComponent(agent);
  agentElement.addComponent(agentComponent);
  space.addChild(agentElement);

  // Add AgentEffector to handle agent activations
  const agentEffector = new AgentEffector(agentElement, agent);
  space.addEffector(agentEffector);

  // Add console interface (skip in headless mode)
  if (process.env.HEADLESS === 'true') {
    console.log('🤖 Running in headless mode - skipping console interface');
    console.log('🔍 Use MCP tools to interact with the game');
    // Initialize without console
    await gameElement.onMount();
  } else {
    console.log('💻 Setting up interactive console...');
    const console_component = new BoxGameConsole();
    gameElement.addComponent(console_component);
    // Initialize everything
    await gameElement.onMount();
  }

  // Welcome message (for all modes)
  const welcomeMsg = process.env.HEADLESS === 'true'
    ? 'Headless mode active. Use MCP to create boxes and interact!'
    : 'Welcome to the Box Game! I\'m your AI companion. Let\'s create some mysterious boxes!';

  space.emit({
    topic: 'game:command',
    source: gameElement.getRef(),
    payload: {
      action: 'say',
      args: [welcomeMsg],
      user: 'system'
    } as GameCommand,
    timestamp: Date.now()
  });

  // Add tool instructions as ambient facet for agent
  space.emit({
    topic: 'veil:operation',
    source: gameElement.getRef(),
    payload: {
      operation: {
        type: 'addFacet',
        facet: {
          id: 'box-game-tool-instructions',
          type: 'ambient',
          scopes: ['agent-rendered-context'],
          content: `<tool_instructions>
Available Actions:
- @box.create("item1,item2,item3") - Create a box with items
- @box.open("boxId") - Open an existing box

Examples:
"Let me create that! @box.create("stars,magic,dreams")"
"I'll open it! @box.open("box1234567890")"
</tool_instructions>`
        }
      }
    },
    timestamp: Date.now()
  });

  console.log('✅ Complete Box Game ready!');
  if (debugEnabled) {
    console.log('🔍 Debug UI is running at http://localhost:3015 - inspect game state in real-time!');
  }

  // In headless mode, keep alive for testing
  if (process.env.HEADLESS === 'true') {
    const keepAliveMs = parseInt(process.env.KEEP_ALIVE_MS || '300000'); // default 5 min
    console.log(`⏱️  Keeping alive for ${keepAliveMs}ms for MCP inspection...`);
    console.log('📋 Follow test plan in examples/box-game-mcp-test-plan.md\n');

    await new Promise(resolve => setTimeout(resolve, keepAliveMs));
    console.log('⏱️  Timeout reached, exiting...');

    if (debugServer) {
      debugServer.stop();
    }
    process.exit(0);
  } else {
    console.log('Start by creating your first box, e.g.: /create-box sword,potion,treasure');
    console.log('Or type /help for all available commands\n');
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

if (require.main === module) {
  runCompleteBoxGame().catch(error => {
    console.error('❌ Game failed to start:', error);
    process.exit(1);
  });
}

export { runCompleteBoxGame, CompleteBoxGameElement, BoxGameAgent };