/**
 * Restoration system for bringing persisted state back to life
 */

import { VEILStateManager } from '../veil/veil-state';
import { VEILState, Facet, StreamInfo } from '../veil/types';
import { Space } from '../spaces/space';
import { Element } from '../spaces/element';
import { Component } from '../spaces/component';
import {
  SerializedVEILState,
  SerializedElement,
  SerializedComponent,
  PersistenceSnapshot
} from './types';
import { deserializeValue } from './serialization';
import { ComponentRegistry } from './component-registry';

/**
 * Restore VEIL state from serialized format
 */
export async function restoreVEILState(
  veilManager: VEILStateManager,
  serialized: SerializedVEILState
): Promise<void> {
  // Create a new state object
  const newState: VEILState = {
    facets: new Map(),
    scopes: new Set(serialized.scopes),
    streams: new Map(),
    currentStream: serialized.currentStream ? 
      deserializeValue(serialized.currentStream) : undefined,
    frameHistory: serialized.frameHistory ? 
      serialized.frameHistory.map(f => deserializeValue(f)) : [],
    currentSequence: serialized.currentSequence,
    removals: new Map(serialized.removals || []),
    agents: new Map(),
    currentAgent: undefined
  };
  
  // Restore facets
  for (const [id, facetData] of serialized.facets) {
    const facet = deserializeFacet(facetData);
    if (facet) {
      newState.facets.set(id, facet);
    }
  }
  
  // Restore streams
  for (const [id, streamData] of serialized.streams) {
    const stream = deserializeValue(streamData) as StreamInfo;
    newState.streams.set(id, stream);
  }
  
  // Apply the restored state
  veilManager.setState(newState);
}

/**
 * Deserialize a facet
 */
function deserializeFacet(data: any): Facet | null {
  try {
    const base: any = {
      id: data.id,
      type: data.type,
      displayName: data.displayName,
      scope: data.scope,
      saliency: data.saliency
    };
    
    // Restore optional properties
    if (data.content) {
      base.content = data.content;
    }
    
    if (data.attributes) {
      base.attributes = deserializeValue(data.attributes);
    }
    
    if (data.children) {
      base.children = data.children.map((child: any) => deserializeFacet(child)).filter(Boolean);
    }
    
    // Handle type-specific fields
    switch (data.type) {
      case 'state':
        if (data.initialValue !== undefined) {
          base.initialValue = deserializeValue(data.initialValue);
        }
        if (data.transitionRenderers) {
          base.transitionRenderers = data.transitionRenderers;
        }
        break;
        
      case 'tool':
        if (data.toolName) base.toolName = data.toolName;
        if (data.parameters) base.parameters = deserializeValue(data.parameters);
        break;
        
      case 'action':
        if (data.actionTarget) base.actionTarget = data.actionTarget;
        if (data.actionName) base.actionName = data.actionName;
        if (data.parameters) base.parameters = deserializeValue(data.parameters);
        break;
    }
    
    return base as Facet;
  } catch (error) {
    console.error('Failed to deserialize facet:', error);
    return null;
  }
}

/**
 * Restore element tree from serialized format
 */
export async function restoreElementTree(
  space: Space,
  serialized: SerializedElement
): Promise<void> {
  // Clear existing children (but not the space itself)
  const existingChildren = [...space.children];
  for (const child of existingChildren) {
    space.removeChild(child);
  }
  
  // Restore children recursively
  for (const childData of serialized.children) {
    const child = await restoreElement(childData);
    if (child) {
      space.addChild(child);
    }
  }
}

/**
 * Restore a single element and its subtree
 */
async function restoreElement(data: SerializedElement): Promise<Element | null> {
  try {
    // Create element - for now only basic Element type is supported
    // Custom element types would need to be refactored as Components
    const element = new Element(data.name, data.id);
    
    // Restore active state
    if (!data.active) {
      element.active = false;
    }
    
    // Restore subscriptions
    for (const topic of data.subscriptions) {
      element.subscribe(topic);
    }
    
    // Restore components and wait for them to fully initialize
    const componentPromises: Promise<any>[] = [];
    for (const componentData of data.components) {
      const component = await restoreComponent(componentData);
      if (component) {
        // Use addComponentAsync to properly mount and wait for initialization
        componentPromises.push(element.addComponentAsync(component));
      }
    }
    
    // Wait for all components to finish mounting
    await Promise.all(componentPromises);
    
    // Restore children recursively
    for (const childData of data.children) {
      const child = await restoreElement(childData);
      if (child) {
        element.addChild(child);
      }
    }
    
    return element;
  } catch (error) {
    console.error('Failed to restore element:', data.name, error);
    return null;
  }
}

/**
 * Restore a component from serialized data
 */
async function restoreComponent(data: SerializedComponent): Promise<Component | null> {
  // Create component instance
  const component = ComponentRegistry.create(data.className);
  if (!component) {
    // Make this a fatal error - components must be registered for restoration
    throw new Error(`Component class not found in registry: ${data.className}. Please ensure it's registered in the application's getComponentRegistry() method.`);
  }
  
  // Restore persistent properties
  if (data.properties) {
    Object.assign(component, data.properties);
  }
  
  return component;
}

/**
 * Full restoration from a persistence snapshot
 */
export async function restoreFromSnapshot(
  space: Space,
  veilManager: VEILStateManager,
  snapshot: PersistenceSnapshot
): Promise<void> {
  console.log(`Restoring from snapshot version ${snapshot.version} at sequence ${snapshot.sequence}`);
  
  // Step 1: Restore VEIL state
  await restoreVEILState(veilManager, snapshot.veilState);
  
  // Step 2: Restore element tree
  await restoreElementTree(space, snapshot.elementTree);
  
  // Step 3: TODO - Restore compressed frame batches if present
  if (snapshot.compressedFrames) {
    console.log('Compressed frame restoration not yet implemented');
  }
  
  console.log('Restoration complete');
}
