/**
 * Discord Box Game - Interactive RETM Implementation
 *
 * This implementation provides the full box game experience via Discord with:
 * - Slash commands (/create-box, /open-box)
 * - Interactive buttons (Open box buttons in embeds)
 * - Typing indicators when agent is thinking
 * - Rich embeds for game status
 * - Real LLM integration
 * - Complete RETM architecture
 */

import { config } from 'dotenv';
config();

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
import { AxonLoaderComponent } from '../src/components/axon-loader';
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
import { Facet, VEILDelta } from '../src/veil/types';
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
  action: 'create-box' | 'open-box' | 'say';
  args: string[];
  user: string;
  interactionId?: string; // For Discord interaction replies
}

interface DiscordConnection {
  element: Element;
  guildId: string;
  channelId: string;
}

// ============================================================================
// RECEPTORS (Events → Facets)
// ============================================================================

/**
 * DiscordSlashReceptor: Handle Discord slash command interactions
 */
class DiscordSlashReceptor implements Receptor {
  topics = ['discord:slash-command'];

  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const facets: Facet[] = [];
    const payload = event.payload as any;

    const { commandName, options, user, channelId, interactionId } = payload;

    if (commandName === 'create-box') {
      const itemsOption = options?.find((o: any) => o.name === 'items');
      if (itemsOption) {
        const contents = itemsOption.value.split(',').map((item: string) => item.trim());
        facets.push({
          id: `game-action-create-${Date.now()}`,
          type: 'game-action',
          content: `${user} is creating a box with ${contents.length} items`,
          state: {
            action: 'create-box',
            params: { contents, actor: user },
            interactionId,
            channelId
          },
          ephemeral: true
        } as Facet);
      }
    } else if (commandName === 'open-box') {
      const boxIdOption = options?.find((o: any) => o.name === 'box-id');
      if (boxIdOption) {
        facets.push({
          id: `game-action-open-${boxIdOption.value}-${Date.now()}`,
          type: 'game-action',
          content: `${user} is opening box ${boxIdOption.value}`,
          state: {
            action: 'open-box',
            params: { boxId: boxIdOption.value, actor: user },
            interactionId,
            channelId
          },
          ephemeral: true
        } as Facet);
      }
    } else if (commandName === 'box-status') {
      facets.push({
        id: `game-action-status-${Date.now()}`,
        type: 'game-action',
        content: `${user} requested box status`,
        state: {
          action: 'show-status',
          params: { actor: user },
          interactionId,
          channelId
        },
        ephemeral: true
      } as Facet);
    } else if (commandName === 'box-start') {
      facets.push({
        id: `game-action-start-${Date.now()}`,
        type: 'game-action',
        content: `${user} started the box game`,
        state: {
          action: 'start-game',
          params: { actor: user },
          interactionId,
          channelId
        },
        ephemeral: true
      } as Facet);
    }

    return facets;
  }
}

/**
 * DiscordButtonReceptor: Handle Discord button click interactions
 */
class DiscordButtonReceptor implements Receptor {
  topics = ['discord:button-click'];

  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const facets: Facet[] = [];
    const payload = event.payload as any;

    const { customId, user, channelId, interactionId } = payload;

    // Button custom IDs are formatted as "box-open-{boxId}"
    if (customId.startsWith('box-open-')) {
      const boxId = customId.replace('box-open-', '');
      facets.push({
        id: `game-action-open-${boxId}-${Date.now()}`,
        type: 'game-action',
        content: `${user} is opening box ${boxId} (via button)`,
        state: {
          action: 'open-box',
          params: { boxId, actor: user },
          interactionId,
          channelId
        },
        ephemeral: true
      } as Facet);
    }

    return facets;
  }
}

/**
 * BoxGameReceptor: Handle game events (box created/opened/errors)
 */
class BoxGameReceptor implements Receptor {
  topics = ['game:box-created', 'game:box-opened', 'game:box-not-found', 'game:box-already-open'];

  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const facets: Facet[] = [];

    if (event.topic === 'game:box-created') {
      const payload = event.payload as any;
      facets.push(createStateFacet({
        id: `box-${payload.boxId}`,
        content: `📦 Box ${payload.boxId}: ${payload.contents.join(', ')} (created by ${payload.creator})`,
        entityType: 'component',
        entityId: payload.boxId,
        state: {
          boxId: payload.boxId,
          contents: payload.contents,
          creator: payload.creator,
          isOpen: false,
          createdAt: Date.now()
        } as BoxState
      }));
      facets.push(createEventFacet({
        id: `box-created-event-${payload.boxId}`,
        content: `${payload.creator} created box ${payload.boxId} with ${payload.contents.length} items`,
        source: payload.creator,
        eventType: 'box-created',
        streamId: 'game-events',
        metadata: payload
      }));
    } else if (event.topic === 'game:box-opened') {
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
    } else if (event.topic === 'game:box-not-found') {
      const payload = event.payload as any;
      facets.push(createEventFacet({
        id: `box-not-found-${payload.boxId}-${Date.now()}`,
        content: `❌ Box ${payload.boxId} not found!`,
        source: 'system',
        eventType: 'box-not-found',
        streamId: 'game-events',
        metadata: payload
      }));
    } else if (event.topic === 'game:box-already-open') {
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

/**
 * DiscordStatusTransform: Generate Discord embeds showing game status
 */
class DiscordStatusTransform implements Transform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];

    // Get boxes
    const boxes = state.getFacetsByType('state')
      .filter(f => {
        const isContextScope = f.scopes?.some((s: string) =>
          s === 'user-rendered-context' || s === 'agent-rendered-context' || s === 'discord-rendered-context'
        );
        const isActualBox = f.state && 'boxId' in f.state && 'creator' in f.state && 'contents' in f.state;
        return isActualBox && !isContextScope;
      })
      .map(f => f.state as BoxState);

    // Get recent events
    const events = state.getFacetsByType('event')
      .filter(f => {
        const isContextScope = f.scopes?.some((s: string) =>
          s === 'user-rendered-context' || s === 'agent-rendered-context' || s === 'discord-rendered-context'
        );
        return !isContextScope && f.content;
      })
      .slice(-5); // Last 5 events

    // Build embed data
    const embedData = {
      boxes,
      events: events.map(e => e.content),
      stats: {
        totalBoxes: boxes.length,
        openBoxes: boxes.filter(b => b.isOpen).length,
        closedBoxes: boxes.filter(b => !b.isOpen).length
      }
    };

    const contextId = 'discord-game-status';
    const existing = Array.from(state.facets.values()).find(f => f.id === contextId);

    if (!existing) {
      deltas.push(addFacet({
        id: contextId,
        type: 'state',
        content: JSON.stringify(embedData),
        scopes: ['discord-rendered-context'],
        state: embedData
      } as Facet));
    } else {
      // Only update if data changed
      const existingData = existing.state;
      if (JSON.stringify(existingData) !== JSON.stringify(embedData)) {
        deltas.push(changeFacet(contextId, {
          content: JSON.stringify(embedData),
          scopes: ['discord-rendered-context'],
          state: embedData
        }));
      }
    }

    return deltas;
  }
}

/**
 * AgentContextTransform: Generate context for agent (for HUD/LLM)
 */
class AgentContextTransform implements Transform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];

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
        scopes: ['agent-rendered-context']
      }));
    }

    return deltas;
  }

  private generateAgentContext(state: ReadonlyVEILState): string {
    const lines: string[] = [];
    lines.push('=== BOX GAME - AGENT VIEW ===\n');

    // Get boxes
    const boxes = state.getFacetsByType('state')
      .filter(f => {
        const isContextScope = f.scopes?.some((s: string) =>
          s === 'user-rendered-context' || s === 'agent-rendered-context' || s === 'discord-rendered-context'
        );
        const isActualBox = f.state && 'boxId' in f.state && 'creator' in f.state && 'contents' in f.state;
        return isActualBox && !isContextScope;
      })
      .map(f => f.state as BoxState);

    if (boxes.length > 0) {
      lines.push('Current boxes:');
      boxes.forEach(box => {
        const status = box.isOpen ? 'OPEN' : 'closed';
        lines.push(`- Box ${box.boxId} (${status}): ${box.contents.join(', ')} [created by ${box.creator}]`);
      });
      lines.push('');
    } else {
      lines.push('No boxes exist yet.\n');
    }

    // Get recent activity
    const activity: Array<{content: string; source: string}> = [];
    state.facets.forEach(f => {
      const isContextScope = f.scopes?.some((s: string) =>
        s === 'user-rendered-context' || s === 'agent-rendered-context' || s === 'discord-rendered-context'
      );
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

    lines.push('You can respond naturally to the conversation in Discord.');
    lines.push('Users can create boxes with /create-box and open them with /open-box or buttons.');

    return lines.join('\n');
  }
}

/**
 * AgentSpeechToDiscordTransform: Route agent speech to Discord and create send actions
 */
class AgentSpeechToDiscordTransform implements Transform {
  private processedSpeech = new Set<string>();

  constructor(private defaultChannelId: string) {}

  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];

    // Find agent speech facets that haven't been processed yet
    const agentSpeech = state.getFacetsByType('speech').filter(f => {
      const agentId = (f as any).agentId;
      return agentId && !this.processedSpeech.has(f.id);
    });

    for (const speech of agentSpeech) {
      this.processedSpeech.add(speech.id);

      // Determine channel ID from activation context or use default
      const activations = state.getFacetsByType('activation');
      const recentActivation = activations
        .filter(a => a.state?.metadata?.channelId)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];

      const channelId = recentActivation?.state?.metadata?.channelId || this.defaultChannelId;
      const message = speech.content || '';

      // Create a discord:send action facet
      deltas.push(addFacet({
        id: `discord-send-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'action',
        scopes: ['ephemeral'],
        state: {
          metadata: {
            action: 'discord:send',
            params: {
              channelId,
              message
            }
          }
        }
      }));
    }

    return deltas;
  }
}

/**
 * AgentActivationTransform: Create agent activations for interesting events
 */
class AgentActivationTransform implements Transform {
  private processedEvents = new Set<string>();
  private lastActivationTime = 0;
  private readonly ACTIVATION_COOLDOWN_MS = 2000;

  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const now = Date.now();

    if (now - this.lastActivationTime < this.ACTIVATION_COOLDOWN_MS) {
      return deltas;
    }

    // Find new interesting events
    const interestingEvents = state.getFacetsByType('event').filter(f => {
      const eventType = f.state?.eventType;
      const displayName = (f as any).displayName;
      const source = f.state?.source || f.state?.metadata?.speaker;
      const creator = f.state?.metadata?.creator;
      const author = f.state?.metadata?.author;
      const isUserAction = source && source !== 'agent' && source !== 'system' &&
                          creator !== 'agent';
      const isErrorEvent = eventType === 'box-not-found' || eventType === 'box-already-open';

      // Already processed
      if (this.processedEvents.has(f.id)) return false;

      // Discord message from a user
      // Note: Bot's own messages are already filtered by DiscordReceptor using authorId
      if (displayName === 'discord-message') {
        return author !== undefined; // Any Discord message from a user
      }

      // Box game events
      return (eventType === 'box-opened' || eventType === 'box-created') &&
             !isErrorEvent &&
             isUserAction;
    });

    // Process event facets
    for (const event of interestingEvents) {
      this.processedEvents.add(event.id);
      const eventType = event.state?.eventType;
      const displayName = (event as any).displayName;
      const channelId = event.state?.metadata?.channelId;
      const author = event.state?.metadata?.author;
      const content = event.state?.metadata?.content;

      let reason: string;
      let priority: 'high' | 'normal' = 'normal';

      if (displayName === 'discord-message') {
        reason = `${author} sent a message: "${content}"`;
        priority = 'high'; // User messages have high priority
      } else if (eventType) {
        reason = `New ${eventType} event requires attention`;
        priority = eventType === 'box-opened' ? 'high' : 'normal';
      } else {
        reason = 'New event requires attention';
      }

      const activationFacet = createAgentActivation(reason, {
        id: `activation-${eventType || displayName}-${Date.now()}`,
        priority,
        source: displayName === 'discord-message' ? 'discord' : 'box-game',
        triggerEvent: event.id,
        eventType: eventType || displayName,
        channelId
      });

      deltas.push(addFacet(activationFacet));
    }

    if (deltas.length > 0) {
      this.lastActivationTime = now;
    }

    return deltas;
  }
}

// ============================================================================
// EFFECTORS (Side Effects)
// ============================================================================

/**
 * BoxGameEffector: Game world simulation with internal state
 */
class BoxGameEffector implements Effector {
  facetFilters = [{ type: 'game-action' }];

  private boxes = new Map<string, BoxState>();

  async process(changes: FacetDelta[]): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];

    for (const change of changes) {
      if (change.type === 'added') {
        const facet = change.facet;

        if (facet.type === 'game-action') {
          const action = facet.state?.action;
          const params = facet.state?.params || {};
          const interactionId = facet.state?.interactionId;
          const channelId = facet.state?.channelId;

          if (action === 'create-box') {
            events.push(...this.handleCreateBox(params.contents!, params.actor, interactionId, channelId));
          } else if (action === 'open-box') {
            events.push(...this.handleOpenBox(params.boxId!, params.actor, interactionId, channelId));
          }
        }
      }
    }

    return { events };
  }

  private handleCreateBox(contents: string[], creator: string, interactionId?: string, channelId?: string): SpaceEvent[] {
    const boxId = `box${Date.now()}`;

    this.boxes.set(boxId, {
      boxId,
      contents,
      creator,
      isOpen: false,
      createdAt: Date.now()
    });

    return [{
      topic: 'game:box-created',
      source: { elementId: 'box-game-effector', elementPath: [] },
      payload: { boxId, contents, creator, interactionId, channelId },
      timestamp: Date.now()
    }];
  }

  private handleOpenBox(boxId: string, opener: string, interactionId?: string, channelId?: string): SpaceEvent[] {
    const box = this.boxes.get(boxId);

    if (!box) {
      return [{
        topic: 'game:box-not-found',
        source: { elementId: 'box-game-effector', elementPath: [] },
        payload: { boxId, opener, interactionId, channelId },
        timestamp: Date.now()
      }];
    }

    if (box.isOpen) {
      return [{
        topic: 'game:box-already-open',
        source: { elementId: 'box-game-effector', elementPath: [] },
        payload: { boxId, opener, interactionId, channelId },
        timestamp: Date.now()
      }];
    }

    box.isOpen = true;
    this.boxes.set(boxId, box);

    return [{
      topic: 'game:box-opened',
      source: { elementId: 'box-game-effector', elementPath: [] },
      payload: { boxId, opener, contents: box.contents, creator: box.creator, interactionId, channelId },
      timestamp: Date.now()
    }];
  }
}

/**
 * DiscordActionReceptor: Converts discord:action events to action facets
 */
class DiscordActionReceptor implements Receptor {
  topics = ['discord:action'];

  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const { action, params } = (event.payload as any) || {};
    if (!action) return [];

    return [{
      type: 'action',
      id: `discord-action-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      scopes: ['ephemeral'],
      state: {
        metadata: { action, params }
      }
    }];
  }
}

/**
 * DiscordActionEffector: Monitors game state and emits discord:action events
 * This bridges game logic → Discord by creating events for the receptor
 */
class DiscordActionEffector implements Effector {
  constructor(private space: Space, private channelId: string) {}

  facetFilters = [
    { type: 'game-action' },
    { type: 'agent-activation' },
    { type: 'event', typeMatch: ['box-created', 'box-opened', 'box-not-found', 'box-already-open'] }
  ];

  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];

    for (const change of changes) {
      // Send typing when agent activates
      if (change.facet.type === 'agent-activation' && change.type === 'added') {
        const channelId = change.facet.state?.metadata?.channelId || this.channelId;
        events.push({
          topic: 'discord:action',
          source: this.space.getRef(),
          payload: {
            action: 'discord:sendTyping',
            params: { channelId }
          },
          timestamp: Date.now()
        });
      }

      // Handle explicit status requests (from /box-status or /box-start)
      if (change.facet.type === 'game-action' && change.type === 'added') {
        const action = change.facet.state?.action;
        const interactionId = change.facet.state?.interactionId;

        if ((action === 'show-status' || action === 'start-game') && interactionId) {
          // Get current game status from state
          const statusFacet = Array.from(state.facets.values()).find(f =>
            f.id === 'discord-game-status'
          );

          const embedData = statusFacet?.state || { boxes: [], events: [], stats: {} };
          const { boxes = [], events: gameEvents = [], stats = {} } = embedData;

          // Build embed
          const embed = {
            title: '🎮 Box Game Status',
            description: 'Create mystery boxes with secret contents, then open them to reveal surprises!',
            color: 0x5865F2,
            fields: [
              {
                name: '📊 Stats',
                value: `Total: ${stats.totalBoxes || 0} | Open: ${stats.openBoxes || 0} | Closed: ${stats.closedBoxes || 0}`,
                inline: false
              }
            ]
          };

          // Add boxes field if there are any
          if (boxes.length > 0) {
            const closedBoxes = boxes.filter((b: BoxState) => !b.isOpen);
            const openBoxes = boxes.filter((b: BoxState) => b.isOpen);

            if (closedBoxes.length > 0) {
              embed.fields.push({
                name: '📦 Closed Boxes',
                value: closedBoxes.map((b: BoxState) =>
                  `\`${b.boxId}\` by ${b.creator}`
                ).join('\n') || 'None',
                inline: false
              });
            }

            if (openBoxes.length > 0) {
              embed.fields.push({
                name: '📭 Open Boxes',
                value: openBoxes.map((b: BoxState) =>
                  `\`${b.boxId}\`: ${b.contents.join(', ')}`
                ).join('\n') || 'None',
                inline: false
              });
            }
          }

          // Add recent events field
          if (gameEvents.length > 0) {
            embed.fields.push({
              name: '📜 Recent Events',
              value: gameEvents.slice(-3).join('\n') || 'No events yet',
              inline: false
            });
          }

          // Build buttons for closed boxes
          const buttons = boxes
            .filter((b: BoxState) => !b.isOpen)
            .slice(0, 5) // Max 5 buttons per row
            .map((b: BoxState) => ({
              customId: `box-open-${b.boxId}`,
              label: `Open ${b.boxId}`,
              style: 'primary'
            }));

          // Reply to the slash command with the status embed
          events.push({
            topic: 'discord:action',
            source: this.space.getRef(),
            payload: {
              action: 'discord:replyToInteraction',
              params: {
                interactionId,
                embed,
                ephemeral: false
              }
            },
            timestamp: Date.now()
          });
        }
      }

      // Send interaction replies for game events
      if (change.facet.type === 'event' && change.type === 'added') {
        const eventType = change.facet.state?.eventType;
        const metadata = change.facet.state?.metadata;
        const interactionId = metadata?.interactionId;

        if (interactionId) {
          const replyContent = this.getEventReplyMessage(change.facet);
          if (replyContent) {
            events.push({
              topic: 'discord:action',
              source: this.space.getRef(),
              payload: {
                action: 'discord:replyToInteraction',
                params: {
                  interactionId,
                  content: replyContent,
                  ephemeral: false
                }
              },
              timestamp: Date.now()
            });
          }
        }
      }
    }

    return { events };
  }

  private getEventReplyMessage(facet: Facet): string | null {
    const eventType = facet.state?.eventType;
    const metadata = facet.state?.metadata;

    if (eventType === 'box-created') {
      return `✅ Created box \`${metadata?.boxId}\` with ${metadata?.contents?.length || 0} items!`;
    } else if (eventType === 'box-opened') {
      return `🎉 Opened box \`${metadata?.boxId}\`! It contained: ${metadata?.contents?.join(', ')}`;
    } else if (eventType === 'box-not-found') {
      return `❌ Box \`${metadata?.boxId}\` not found!`;
    } else if (eventType === 'box-already-open') {
      return `ℹ️ Box \`${metadata?.boxId}\` is already open!`;
    }

    return null;
  }
}

// ============================================================================
// AGENT & SETUP
// ============================================================================

class BoxGameAgent extends BasicAgent {
  constructor(llmProvider: LLMProvider, veilState: VEILStateManager, channelId: string) {
    super({
      systemPrompt: `You are an AI playing an interactive box game in Discord!

Game Rules:
- Players create boxes with hidden contents using /create-box
- Box contents are only visible to the creator until opened
- Anyone can open any box to reveal contents to everyone
- Players can also click "Open" buttons in Discord to open boxes

You can engage with players naturally - react to boxes being created and opened,
express curiosity about mystery boxes, celebrate discoveries, and have fun conversations
about the game. Be playful, creative, and encouraging!`,
      defaultMaxTokens: 250,
      defaultTemperature: 0.8,
      name: 'box-game-ai'
    }, llmProvider, veilState);

    // channelId stored for potential future use, but routing is handled by AgentSpeechRoutingTransform
  }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function runDiscordBoxGame() {
  console.log('🎮 Starting Discord Box Game');
  console.log('============================\n');

  // Load configuration
  const GUILD_ID = process.env.DISCORD_GUILD_ID;
  const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

  if (!GUILD_ID || !CHANNEL_ID) {
    console.error('❌ Missing required environment variables:');
    console.error('   DISCORD_GUILD_ID - Your Discord server ID');
    console.error('   DISCORD_CHANNEL_ID - Channel to run the game in');
    console.error('   ANTHROPIC_API_KEY - Your Anthropic API key');
    console.error('   DISCORD_BOT_TOKEN - Your Discord bot token (for the AXON server)');
    process.exit(1);
  }

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
    console.log('🔍 Debug UI available at http://localhost:3015\n');
  }

  // Create main game element
  const gameElement = new Element('discord-box-game', 'discord-box-game');
  space.addChild(gameElement);

  // Create Discord connection element
  console.log('🔌 Creating Discord connection...');
  const discordElement = new Element('discord', 'discord-connection');
  const axonLoader = new AxonLoaderComponent();
  discordElement.addComponent(axonLoader);
  space.addChild(discordElement);

  // Receptor to initialize Discord when AXON module loads
  class DiscordInitReceptor implements Receptor {
    topics = ['axon:module-loaded'];

    transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
      const payload = event.payload as any;

      // Only respond to Discord module
      if (payload.module === 'discord-axon-retm') {
        console.log('📡 Discord AXON module loaded, triggering connection...');

        // Create an init facet that the Discord effector will see
        return [{
          id: `discord-init-${Date.now()}`,
          type: 'init',
          content: 'Initialize Discord connection',
          timestamp: Date.now(),
          streamId: 'system:discord'
        }];
      }

      return [];
    }
  }

  // Create a receptor to wait for Discord connection
  class DiscordConnectionReceptor implements Receptor {
    topics = ['discord:connected'];
    private resolver?: () => void;

    transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
      console.log('✅ Discord connected!\n');
      if (this.resolver) {
        this.resolver();
      }
      return [
        createEventFacet({
          id: `discord-connection-${Date.now()}`,
          content: 'Discord connection established',
          source: 'discord',
          eventType: 'connection',
          streamId: 'discord:system'
        })
      ];
    }

    waitForConnection(): Promise<void> {
      return new Promise(resolve => {
        this.resolver = resolve;
      });
    }
  }

  const initReceptor = new DiscordInitReceptor();
  space.addReceptor(initReceptor);

  const connectionReceptor = new DiscordConnectionReceptor();
  space.addReceptor(connectionReceptor);

  // Connect to Discord AXON server
  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
  const axonUrl = `axon://localhost:8080/modules/discord/manifest?host=localhost:8081&path=/ws&guild=${GUILD_ID}&agent=box-game-bot&token=${encodeURIComponent(DISCORD_BOT_TOKEN)}`;

  // Start waiting BEFORE connecting so resolver is set when event fires
  const waitPromise = connectionReceptor.waitForConnection();
  await axonLoader.connect(axonUrl);
  await waitPromise;

  // Set up RETM pipeline BEFORE emitting actions
  console.log('🔧 Setting up RETM architecture...');

  // Receptors
  space.addReceptor(new DiscordSlashReceptor());
  space.addReceptor(new DiscordButtonReceptor());
  space.addReceptor(new BoxGameReceptor());
  space.addReceptor(new DiscordActionReceptor()); // Converts discord:action events to action facets

  // Transforms
  space.addTransform(new DiscordStatusTransform());
  space.addTransform(new AgentContextTransform());
  space.addTransform(new AgentActivationTransform());
  space.addTransform(new AgentSpeechToDiscordTransform(CHANNEL_ID)); // Route agent speech to Discord and create send actions
  space.addTransform(new ContextTransform(veilState));

  // Effectors
  space.addEffector(new BoxGameEffector());
  space.addEffector(new DiscordActionEffector(space, CHANNEL_ID)); // Emits discord:action events from game state
  // Note: DiscordEffector (from discord-axon-retm) will consume action facets created by DiscordActionReceptor

  // Create AI agent
  console.log('🤖 Creating AI agent...');
  const agent = new BoxGameAgent(llmProvider, veilState, CHANNEL_ID);
  const agentElement = new Element('agent', 'box-game-agent');
  const agentComponent = new AgentComponent(agent);
  agentElement.addComponent(agentComponent);
  space.addChild(agentElement);

  // Add agent effector
  const agentEffector = new AgentEffector(agentElement, agent);
  space.addEffector(agentEffector);

  // Helper function to trigger Discord actions via events
  // Receptor will convert these to action facets for DiscordEffector
  const executeDiscordAction = async (action: string, params: any) => {
    await space.emit({
      topic: 'discord:action',
      source: space.getRef(),
      payload: { action: `discord:${action}`, params },
      timestamp: Date.now()
    });

    // Give time for event processing
    await new Promise(resolve => setTimeout(resolve, 50));
  };

  // Register slash commands
  console.log('📝 Registering slash commands...');
  await executeDiscordAction('registerSlashCommand', {
    name: 'create-box',
    description: 'Create a mystery box with items',
    options: [{
      name: 'items',
      description: 'Comma-separated items (e.g., "sword,potion,treasure")',
      type: 'string',
      required: true
    }]
  });

  await executeDiscordAction('registerSlashCommand', {
    name: 'open-box',
    description: 'Open a mystery box to reveal its contents',
    options: [{
      name: 'box-id',
      description: 'The ID of the box to open (e.g., "box1234567890")',
      type: 'string',
      required: true
    }]
  });

  await executeDiscordAction('registerSlashCommand', {
    name: 'box-status',
    description: 'Show current box game status with all boxes and recent activity'
  });

  await executeDiscordAction('registerSlashCommand', {
    name: 'box-start',
    description: 'Start the box game and show the status'
  });

  // Join the channel
  console.log('🚪 Joining Discord channel...');
  await executeDiscordAction('join', { channelId: CHANNEL_ID });

  // Send welcome message
  await executeDiscordAction('send', {
    channelId: CHANNEL_ID,
    message: '🎮 **Box Game is now active!**\n\nUse `/create-box` to create a mystery box, or click the buttons below to open existing boxes!'
  });

  console.log('\n✅ Discord Box Game is running!');
  console.log('   Use /create-box and /open-box in Discord');
  console.log('   Click buttons to open boxes');
  if (debugEnabled) {
    console.log(`   Debug UI: http://localhost:3015`);
  }
  console.log('\nPress Ctrl+C to stop\n');

  // Keep alive
  await new Promise(() => {}); // Run forever
}

function createLLMProvider(): LLMProvider {
  const useMock = process.env.USE_MOCK_LLM === 'true';

  if (useMock) {
    console.log('🤖 Using Mock LLM (USE_MOCK_LLM=true)');
    const mock = new MockLLMProvider();
    mock.setResponses([
      "Ooh, a new mystery box! I wonder what treasures are hidden inside...",
      "Amazing! What a wonderful discovery! 🎉",
      "This box game is so much fun! Let's create more mysteries!",
      "I'm so curious about what's in that box!",
      "Wow, that's an interesting combination of items!"
    ]);
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

// ============================================================================
// ENTRY POINT
// ============================================================================

if (require.main === module) {
  runDiscordBoxGame().catch(error => {
    console.error('❌ Game failed to start:', error);
    process.exit(1);
  });
}

export { runDiscordBoxGame, BoxGameAgent };

