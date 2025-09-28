/**
 * Factory functions for creating common Connectome objects
 * These helpers reduce boilerplate and guide developers to create valid structures
 */

import type { 
  SpaceEvent, 
  ElementRef
} from '../spaces/types';
import type {
  VEILDelta,
  Facet,
  AgentActivationFacet,
  SpeechFacet,
  ThoughtFacet,
  ActionFacet,
  EventFacet,
  StateFacet,
  AmbientFacet,
  StreamChangeFacet
} from '../veil/types';
import { Element } from '../spaces/element';

// Counter for friendly sequential IDs
let idCounter = 0;

/**
 * Generate a friendly, readable ID
 * @param prefix - The prefix for the ID
 * @param unique - Whether to add a unique suffix (default: true)
 * @returns A friendly ID like "note-1" or "search-results"
 */
export function friendlyId(prefix: string, unique: boolean = true): string {
  if (!unique) return prefix;
  return `${prefix}-${++idCounter}`;
}

// ============================================
// Facet builder helpers (aspect-aware)
// ============================================

export interface SpeechFacetInit {
  content: string;
  agentId: string;
  streamId: string;
  id?: string;
  agentName?: string;
  streamType?: string;
}

export function createSpeechFacet(init: SpeechFacetInit): SpeechFacet {
  const { content, agentId, streamId, id, agentName, streamType } = init;
  return {
    id: id ?? friendlyId('speech'),
    type: 'speech',
    content,
    agentId,
    ...(agentName ? { agentName } : {}),
    streamId,
    ...(streamType ? { streamType } : {})
  };
}

export interface ThoughtFacetInit {
  content: string;
  agentId: string;
  streamId: string;
  id?: string;
  agentName?: string;
  streamType?: string;
}

export function createThoughtFacet(init: ThoughtFacetInit): ThoughtFacet {
  const { content, agentId, streamId, id, agentName, streamType } = init;
  return {
    id: id ?? friendlyId('thought'),
    type: 'thought',
    content,
    agentId,
    ...(agentName ? { agentName } : {}),
    streamId,
    ...(streamType ? { streamType } : {})
  };
}

export interface ActionFacetInit {
  toolName: string;
  parameters?: Record<string, any>;
  agentId: string;
  streamId: string;
  content?: string;
  id?: string;
  agentName?: string;
  streamType?: string;
}

export function createActionFacet(init: ActionFacetInit): ActionFacet {
  const {
    toolName,
    parameters = {},
    agentId,
    agentName,
    streamId,
    streamType,
    content = `@${toolName}`,
    id
  } = init;

  return {
    id: id ?? friendlyId('action'),
    type: 'action',
    content,
    state: {
      toolName,
      parameters
    },
    agentId,
    ...(agentName ? { agentName } : {}),
    streamId,
    ...(streamType ? { streamType } : {})
  };
}

export interface EventFacetInit {
  content: string;
  source: string;
  eventType: string;
  streamId: string;
  metadata?: any;
  id?: string;
  streamType?: string;
}

export function createEventFacet(init: EventFacetInit): EventFacet {
  const { content, source, eventType, metadata, streamId, streamType, id } = init;
  return {
    id: id ?? friendlyId('event'),
    type: 'event',
    content,
    state: {
      source,
      eventType,
      ...(metadata !== undefined ? { metadata } : {})
    },
    streamId,
    ...(streamType ? { streamType } : {})
  };
}

export interface StateFacetInit {
  content: string;
  entityType: StateFacet['entityType'];
  entityId: string;
  state?: Record<string, any>;
  scopes?: string[];
  id?: string;
}

export function createStateFacet(init: StateFacetInit): StateFacet {
  const { content, entityType, entityId, state = {}, scopes = [], id } = init;
  return {
    id: id ?? friendlyId('state'),
    type: 'state',
    content,
    state,
    entityType,
    entityId,
    scopes
  };
}

export interface AmbientFacetInit {
  content: string;
  streamId: string;
  streamType?: string;
  id?: string;
}

export function createAmbientFacet(init: AmbientFacetInit): AmbientFacet {
  const { content, streamId, streamType, id } = init;
  return {
    id: id ?? friendlyId('ambient'),
    type: 'ambient',
    content,
    streamId,
    ...(streamType ? { streamType } : {})
  };
}

export interface StreamChangeFacetInit {
  operation: StreamChangeFacet['state']['operation'];
  streamId: string;
  streamType?: string;
  id?: string;
}

export function createStreamChangeFacet(init: StreamChangeFacetInit): StreamChangeFacet {
  const { operation, streamId, streamType, id } = init;
  return {
    id: id ?? friendlyId('stream-change'),
    type: 'stream-change',
    state: {
      operation,
      streamId,
      ...(streamType ? { streamType } : {})
    },
    ephemeral: true
  };
}

/**
 * Creates a properly structured SpaceEvent
 * @param topic - The event topic
 * @param source - Either an Element instance or a string ID (will create a minimal ElementRef)
 * @param payload - Optional event payload
 * @returns A valid SpaceEvent
 * 
 * @example
 * // With an Element
 * const event = createSpaceEvent('user:action', myElement, { action: 'click' });
 * 
 * // With just an ID
 * const event = createSpaceEvent('test:event', 'test-element-id');
 */
export function createSpaceEvent(
  topic: string,
  source: Element | string | ElementRef,
  payload?: any
): SpaceEvent {
  let elementRef: ElementRef;
  
  if (typeof source === 'string') {
    // Create minimal ElementRef from string ID
    elementRef = {
      elementId: source,
      elementPath: ['root'],
      elementType: 'Element'
    };
  } else if ('elementId' in source && 'elementPath' in source) {
    // Already an ElementRef
    elementRef = source;
  } else {
    // It's an Element, extract the ref
    elementRef = {
      elementId: source.id,
      elementPath: source.getPath(),
      elementType: source.constructor.name
    };
  }
  
  return {
    topic,
    source: elementRef,
    payload,
    timestamp: Date.now()
  };
}

/**
 * Creates an ElementRef from various input types
 * @param elementOrId - Element instance, existing ElementRef, or string ID
 * @returns A valid ElementRef
 * 
 * @example
 * const ref = createElementRef(myElement);
 * const ref2 = createElementRef('my-element-id');
 * const ref3 = createElementRef(existingRef); // passes through
 */
export function createElementRef(elementOrId: Element | ElementRef | string): ElementRef {
  if (typeof elementOrId === 'string') {
    return {
      elementId: elementOrId,
      elementPath: ['root'],
      elementType: 'Element'
    };
  }
  
  if ('elementId' in elementOrId && 'elementPath' in elementOrId) {
    // Already an ElementRef
    return elementOrId;
  }
  
  // It's an Element
  return {
    elementId: elementOrId.id,
    elementPath: elementOrId.getPath(),
    elementType: elementOrId.constructor.name
  };
}

/**
 * Creates an agent activation facet
 * @param reason - Why the agent is being activated
 * @param options - Additional activation options including optional ID
 * @returns A valid agent activation facet
 * 
 * @example
 * const activation = createAgentActivation('user:message', {
 *   id: 'help-request-1',  // Optional stable ID
 *   priority: 'high',
 *   source: 'discord-chat',
 *   messageId: '12345'
 * });
 */
export function createAgentActivation(
  reason: string,
  options: {
    id?: string;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    sourceAgentId?: string;
    [key: string]: any;
  } = {}
): AgentActivationFacet {
  const { id, priority = 'normal', sourceAgentId, ...extraState } = options;
  
  return {
    id: id || friendlyId('activation'),
    type: 'agent-activation',
    state: {
      reason,
      priority,
      ...(sourceAgentId ? { sourceAgentId } : {}),
      ...extraState
    },
    ephemeral: true
  };
}


// VEIL Delta Helpers

export function addFacet(facet: Facet): VEILDelta {
  return {
    type: 'addFacet',
    facet
  };
}

export function removeFacet(id: string): VEILDelta {
  return {
    type: 'removeFacet',
    id
  };
}

export function changeFacet(id: string, changes: Partial<Facet>): VEILDelta {
  return {
    type: 'changeFacet',
    id,
    changes
  };
}

export const changeState = changeFacet;
export const updateState = changeFacet;
