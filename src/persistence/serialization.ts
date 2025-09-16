/**
 * Serialization system for components and elements
 */

import { Component } from '../spaces/component';
import { Element } from '../spaces/element';
import { VEILState, Facet } from '../veil/types';
import { 
  SerializableValue, 
  SerializedComponent, 
  SerializedElement,
  SerializedVEILState,
  ComponentPersistenceMetadata
} from './types';
import { getPersistenceMetadata } from './decorators';

/**
 * Serialize a component instance
 */
export function serializeComponent(component: Component): SerializedComponent | null {
  const metadata = getPersistenceMetadata(component);
  if (!metadata) {
    return null;  // Component not marked as persistable
  }
  
  const properties: Record<string, SerializableValue> = {};
  
  // Serialize each persistent property
  for (const [key, propMetadata] of metadata.properties) {
    const value = (component as any)[key];
    
    if (value === undefined) {
      continue;
    }
    
    try {
      if (propMetadata.serializer) {
        properties[key] = propMetadata.serializer.serialize(value);
      } else {
        properties[key] = serializeValue(value);
      }
    } catch (error) {
      console.warn(`Failed to serialize property ${key} on ${metadata.className}:`, error);
    }
  }
  
  return {
    className: metadata.className,
    version: metadata.version,
    properties
  };
}

/**
 * Serialize a value to a JSON-safe format
 */
export function serializeValue(value: any): SerializableValue {
  if (value === null || value === undefined) {
    return value;
  }
  
  // Primitives
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  
  // Date
  if (value instanceof Date) {
    return { _type: 'Date', value: value.toISOString() };
  }
  
  // Set
  if (value instanceof Set) {
    return { _type: 'Set', value: Array.from(value).map(serializeValue) };
  }
  
  // Map
  if (value instanceof Map) {
    return { 
      _type: 'Map', 
      value: Array.from(value.entries()).map(([k, v]) => [k, serializeValue(v)])
    };
  }
  
  // Array
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  
  // Plain object
  if (value.constructor === Object) {
    const result: Record<string, SerializableValue> = {};
    for (const key in value) {
      if (value.hasOwnProperty(key)) {
        result[key] = serializeValue(value[key]);
      }
    }
    return result;
  }
  
  // Other objects - try to extract meaningful data
  if (typeof value === 'object') {
    console.warn(`Cannot serialize object of type ${value.constructor.name}, using toString()`);
    return value.toString();
  }
  
  return null;
}

/**
 * Deserialize a value from JSON-safe format
 */
export function deserializeValue(value: SerializableValue): any {
  if (value === null || value === undefined) {
    return value;
  }
  
  // Check for special types
  if (typeof value === 'object' && value !== null && '_type' in value) {
    const typed = value as any;
    switch (typed._type) {
      case 'Date':
        return new Date(typed.value);
      case 'Set':
        return new Set(typed.value.map(deserializeValue));
      case 'Map':
        return new Map(typed.value.map(([k, v]: [string, any]) => [k, deserializeValue(v)]));
    }
  }
  
  // Array
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }
  
  // Object
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, any> = {};
    for (const key in value) {
      if (value.hasOwnProperty(key)) {
        result[key] = deserializeValue((value as any)[key]);
      }
    }
    return result;
  }
  
  return value;
}

/**
 * Serialize an element and its tree
 */
export function serializeElement(element: Element): SerializedElement {
  const components: SerializedComponent[] = [];
  
  // Serialize components
  for (const component of element.components) {
    const serialized = serializeComponent(component);
    if (serialized) {
      components.push(serialized);
    }
  }
  
  // Serialize children recursively
  const children = element.children.map(child => serializeElement(child));
  
  return {
    id: element.id,
    name: element.name,
    type: element.constructor.name,
    active: element.active,
    subscriptions: [...element.subscriptions],
    components,
    children
  };
}

/**
 * Serialize VEIL state
 */
export function serializeVEILState(state: VEILState): SerializedVEILState {
  // Serialize facets
  const facets: Array<[string, any]> = [];
  for (const [id, facet] of state.facets) {
    facets.push([id, serializeFacet(facet)]);
  }
  
  // Serialize streams
  const streams: Array<[string, any]> = [];
  for (const [id, stream] of state.streams) {
    streams.push([id, serializeValue(stream)]);
  }
  
  return {
    facets,
    scopes: Array.from(state.scopes),
    streams,
    currentStream: state.currentStream ? serializeValue(state.currentStream) : undefined,
    currentSequence: state.currentSequence,
    frameHistory: state.frameHistory.map(frame => serializeValue(frame))
  };
}

/**
 * Serialize a facet
 */
function serializeFacet(facet: Facet): any {
  // Base properties
  const serialized: any = {
    id: facet.id,
    type: facet.type,
    displayName: facet.displayName,
    scope: facet.scope,
    saliency: facet.saliency
  };
  
  // Add content if present
  if ('content' in facet && facet.content) {
    serialized.content = facet.content;
  }
  
  // Add attributes if present
  if (facet.attributes) {
    serialized.attributes = serializeValue(facet.attributes);
  }
  
  // Add children if present
  if (facet.children) {
    serialized.children = facet.children.map(child => serializeFacet(child));
  }
  
  // Handle type-specific fields
  switch (facet.type) {
    case 'state':
      const stateFacet = facet as any; // StateFacet
      if (stateFacet.initialValue !== undefined) {
        serialized.initialValue = serializeValue(stateFacet.initialValue);
      }
      if (stateFacet.transitionRenderers) {
        serialized.transitionRenderers = stateFacet.transitionRenderers;
      }
      break;
      
    case 'tool':
      const toolFacet = facet as any; // ToolFacet
      if (toolFacet.toolName) {
        serialized.toolName = toolFacet.toolName;
      }
      if (toolFacet.parameters) {
        serialized.parameters = serializeValue(toolFacet.parameters);
      }
      break;
      
    case 'action':
      const actionFacet = facet as any; // ActionFacet
      if (actionFacet.actionTarget) {
        serialized.actionTarget = actionFacet.actionTarget;
      }
      if (actionFacet.actionName) {
        serialized.actionName = actionFacet.actionName;
      }
      if (actionFacet.parameters) {
        serialized.parameters = serializeValue(actionFacet.parameters);
      }
      break;
  }
  
  return serialized;
}

/**
 * Component registry for deserialization
 */
export class ComponentRegistry {
  private static constructors = new Map<string, new (...args: any[]) => Component>();
  
  /**
   * Register a component constructor
   */
  static register(className: string, constructor: new (...args: any[]) => Component) {
    this.constructors.set(className, constructor);
  }
  
  /**
   * Get a component constructor
   */
  static getConstructor(className: string): (new (...args: any[]) => Component) | undefined {
    return this.constructors.get(className);
  }
  
  /**
   * Create a component instance from serialized data
   */
  static createInstance(data: SerializedComponent): Component | null {
    const Constructor = this.getConstructor(data.className);
    if (!Constructor) {
      console.warn(`No constructor registered for component class: ${data.className}`);
      return null;
    }
    
    try {
      // Create instance with no-args constructor
      const instance = new Constructor();
      
      // Restore persistent properties
      const metadata = getPersistenceMetadata(instance);
      if (metadata) {
        for (const [key, propMetadata] of metadata.properties) {
          if (key in data.properties) {
            const value = data.properties[key];
            if (propMetadata.serializer) {
              (instance as any)[key] = propMetadata.serializer.deserialize(value);
            } else {
              (instance as any)[key] = deserializeValue(value);
            }
          }
        }
      }
      
      return instance;
    } catch (error) {
      console.error(`Failed to create component instance for ${data.className}:`, error);
      return null;
    }
  }
}
