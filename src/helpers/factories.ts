/**
 * Factory functions for creating common Connectome objects
 * These helpers reduce boilerplate and guide developers to create valid structures
 */

import type { 
  SpaceEvent, 
  ElementRef
} from '../spaces/types';
import type {
  VEILOperation,
  Facet,
  FacetType,
  BaseFacet,
  AgentActivationFacet,
  AddFacetOperation,
  RemoveFacetOperation,
  ChangeStateOperation,
  ChangeFacetOperation,
  AddStreamOperation,
  SpeakOperation
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
    priority?: 'low' | 'normal' | 'high';
    source?: string;
    [key: string]: any;
  } = {}
): AgentActivationFacet {
  const { id, priority = 'normal', source = 'manual', ...attributes } = options;
  
  return {
    id: id || friendlyId('activation'),
    type: 'agentActivation',
    content: reason,
    attributes: {
      reason,
      priority,
      source,
      ...attributes
    }
  };
}


// VEIL Operation Helpers

/**
 * Creates an addFacet operation with optional stable ID
 * @param content - The facet content
 * @param type - The facet type (default: 'ambient')
 * @param attributesOrId - Either attributes object OR a string ID
 * @param attributes - Attributes if third param was an ID
 * 
 * @example
 * // Auto-generated ID
 * this.addOperation(addFacet('My note', 'ambient', { priority: 'high' }));
 * 
 * // Stable ID
 * this.addOperation(addFacet('My note', 'ambient', 'my-note-id', { priority: 'high' }));
 */
export function addFacet(
  content: string,
  type: FacetType = 'ambient',
  attributesOrId?: Record<string, any> | string,
  attributes?: Record<string, any>
): AddFacetOperation {
  let id: string;
  let attrs: Record<string, any>;
  
  // Handle overloaded parameters
  if (typeof attributesOrId === 'string') {
    id = attributesOrId;
    attrs = attributes || {};
  } else {
    id = friendlyId(type);
    attrs = attributesOrId || {};
  }
  
  const facet: any = {
    id,
    type,
    content,
    attributes: attrs
  };
  
  // Add required fields for specific facet types
  if (type === 'ambient') {
    facet.scope = facet.scope || [];
  }
  
  return {
    type: 'addFacet',
    facet
  };
}

/**
 * Creates a removeFacet operation
 * @example
 * this.addOperation(removeFacet('note-123', 'hide'));
 */
export function removeFacet(
  facetId: string,
  mode: 'hide' | 'delete' = 'hide'
): RemoveFacetOperation {
  return {
    type: 'removeFacet',
    facetId,
    mode
  };
}

/**
 * Creates a changeState operation (updates existing state facets)
 * @example
 * this.addOperation(changeState('status-facet', { 
 *   content: 'Updated status',
 *   attributes: { timestamp: Date.now() }
 * }));
 */
export function changeState(
  facetId: string,
  updates: {
    content?: string;
    attributes?: Record<string, any>;
  }
): ChangeStateOperation {
  return {
    type: 'changeState',
    facetId,
    updates
  };
}

/**
 * Alias for changeState to match component method naming
 * @deprecated Use changeState for consistency with VEIL operations
 */
export const updateState = changeState;

/**
 * Creates a changeFacet operation (for event facets)
 * @example
 * this.addOperation(changeFacet('discord-msg-123', {
 *   content: 'Edited message',
 *   attributes: { edited: true }
 * }));
 */
export function changeFacet(
  facetId: string,
  updates: {
    content?: string;
    attributes?: Record<string, any>;
  }
): ChangeFacetOperation {
  return {
    type: 'changeFacet',
    facetId,
    updates
  };
}

/**
 * Creates an addStream operation
 * @example
 * this.addOperation(addStream('discord:general', 'General Chat', {
 *   channelId: '123',
 *   guildId: '456'
 * }));
 */
export function addStream(
  streamId: string,
  name?: string,
  metadata: Record<string, any> = {}
): AddStreamOperation {
  return {
    type: 'addStream',
    stream: {
      id: streamId,
      name,
      metadata
    }
  };
}

/**
 * Creates an agent speak operation
 * @example
 * this.addOperation(speak('Hello, world!', 'discord-channel-123'));
 */
export function speak(
  content: string,
  target?: string
): SpeakOperation {
  return {
    type: 'speak',
    content,
    target
  };
}
