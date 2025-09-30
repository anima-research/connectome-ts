import { Receptor, Effector, Transform, FacetDelta, EffectorResult, ReadonlyVEILState, Maintainer } from './receptor-effector-types';
import { BaseReceptor, BaseTransform, BaseMaintainer } from '../components/base-martem';
import { SpaceEvent, ElementRef } from './types';
import { Facet, VEILDelta, ElementTreeFacet, ElementRequestFacet, Frame } from '../veil/types';
import { Element } from './element';
import { Component } from './component';
import { createEventFacet, createInternalStateFacet, changeFacet } from '../helpers/factories';
import { ComponentRegistry } from '../persistence/component-registry';

/**
 * Decorator for auto-registering components
 */
export function registerComponent(typeName: string) {
  return function<T extends { new(...args: any[]): Component }>(constructor: T) {
    ComponentRegistry.register(typeName, constructor);
    return constructor;
  };
}

/**
 * Receptor: Handles element creation requests
 * This allows declarative element creation via events
 */
export class ElementRequestReceptor extends BaseReceptor {
  topics = ['element:create', 'element:destroy', 'component:add', 'component:remove'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const facets: Facet[] = [];
    
    switch (event.topic) {
      case 'element:create': {
        const payload = event.payload as { 
          parentId?: string;
          elementType?: string;
          name: string;
          components?: Array<{ type: string; config?: any }>;
        };
        
        // Create a request facet that the effector will process
        facets.push({
          id: `element-request-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          type: 'element-request',
          state: {
            parentId: payload.parentId || 'root',
            elementType: payload.elementType || 'Element',
            name: payload.name,
            components: payload.components
          },
          ephemeral: true // Request is processed once
        });
        break;
      }
      
      case 'element:destroy': {
        const payload = event.payload as { elementId: string };
        // Mark element tree facet as inactive
        facets.push(createEventFacet({
          content: `Request to destroy element '${payload.elementId}'`,
          source: 'element-tree',
          eventType: 'element-destroy-request',
          metadata: { elementId: payload.elementId },
          streamId: 'system'
        }));
        break;
      }
      
      case 'component:add': {
        const payload = event.payload as { 
          elementId: string;
          componentType: string;
          config?: any;
        };
        facets.push(createEventFacet({
          content: `Request to add component '${payload.componentType}' to element '${payload.elementId}'`,
          source: 'element-tree',
          eventType: 'component-add-request',
          metadata: payload,
          streamId: 'system'
        }));
        break;
      }
    }
    
    return facets;
  }
}

/**
 * Transform: Maintains element tree state facets
 */
export class ElementTreeTransform extends BaseTransform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    
    // Find element events that need to update tree facets
    for (const [id, facet] of state.facets) {
      if (facet.type === 'event' && facet.state?.eventType === 'element-unmount') {
        const elementId = facet.state.metadata?.elementId;
        if (elementId) {
          const treeFacetId = `element-tree-${elementId}`;
          const treeFacet = state.facets.get(treeFacetId);
          if (treeFacet?.state?.active) {
            deltas.push(changeFacet(treeFacetId, {
              state: { active: false }
            }));
          }
        }
      }
      
      if (facet.type === 'event' && facet.state?.eventType === 'component-add') {
        const { elementId, componentType, config } = facet.state.metadata || {};
        if (elementId && componentType) {
          const treeFacetId = `element-tree-${elementId}`;
          const treeFacet = state.facets.get(treeFacetId);
          if (treeFacet?.state) {
            const components = [...(treeFacet.state.components || [])];
            components.push({
              type: componentType,
              index: components.length,
              config
            });
            deltas.push(changeFacet(treeFacetId, {
              state: { components }
            }));
          }
        }
      }
    }
    
    return deltas;
  }
}

/**
 * Maintainer: Manages element tree operations in Phase 4
 * Handles creation, destruction, and component management
 */
export class ElementTreeMaintainer extends BaseMaintainer {
  private elementCache = new Map<string, Element>();
  
  // Track operations for this frame
  private pendingOperations: Array<{
    type: 'create' | 'destroy' | 'restore' | 'add-component';
    facet?: Facet;
    elementId?: string;
    request?: any;
  }> = [];
  
  constructor(private space: Element) {
    super();
    // Register the space itself
    this.elementCache.set('root', space);
    this.elementCache.set(space.id, space);
  }
  
  async process(frame: Frame, changes: FacetDelta[], state: ReadonlyVEILState): Promise<SpaceEvent[]> {
    const events: SpaceEvent[] = [];
    
    // Collect all element operations from this frame
    this.collectOperations(state);
    
    // Process deletions first (bottom-up)
    this.processDeletions(events);
    
    // Process creations and restorations (top-down)
    this.processCreations(events);
    
    // Process component additions
    this.processComponentAdditions(state, events);
    
    // Clear pending operations
    this.pendingOperations = [];
    
    return events;
  }
  
  private collectOperations(state: ReadonlyVEILState) {
    // Clear previous operations
    this.pendingOperations = [];
    
    // Look for element-request facets from this frame
    for (const [id, facet] of state.facets) {
      if (facet.type === 'element-request') {
        this.pendingOperations.push({
          type: 'create',
          facet
        });
      }
      
      // Look for destroy requests
      if (facet.type === 'event' && facet.state?.eventType === 'element-destroy-request') {
        this.pendingOperations.push({
          type: 'destroy',
          elementId: facet.state.metadata?.elementId
        });
      }
      
      // Look for component add requests
      if (facet.type === 'event' && facet.state?.eventType === 'component-add-request') {
        this.pendingOperations.push({
          type: 'add-component',
          facet
        });
      }
    }
    
    // Look for element-tree facets that need syncing (restoration)
    for (const [id, facet] of state.facets) {
      if (facet.type === 'element-tree') {
        const elementState = facet.state as any;
        if (!this.elementCache.has(elementState.elementId) && elementState.active) {
          this.pendingOperations.push({
            type: 'restore',
            facet
          });
        }
      }
    }
  }
  
  private processDeletions(events: SpaceEvent[]) {
    // Get all deletion operations
    const deletions = this.pendingOperations.filter(op => op.type === 'destroy');
    
    // Sort to process children before parents
    const sorted = this.sortDeletionsByHierarchy(deletions);
    
    for (const deletion of sorted) {
      this.deleteElement(deletion.elementId!, events);
    }
  }
  
  private processCreations(events: SpaceEvent[]) {
    // Process restorations first (they have existing IDs)
    const restorations = this.pendingOperations.filter(op => op.type === 'restore');
    
    // Sort by parent-child relationship
    const sorted = this.sortByHierarchy(restorations);
    
    for (const restoration of sorted) {
      this.restoreElement(restoration.facet!, events);
    }
    
    // Then process new creations
    const creations = this.pendingOperations.filter(op => op.type === 'create');
    
    for (const creation of creations) {
      this.createElement(creation.facet!, events);
    }
  }
  
  private processComponentAdditions(state: ReadonlyVEILState, events: SpaceEvent[]) {
    const additions = this.pendingOperations.filter(op => op.type === 'add-component');
    
    for (const addition of additions) {
      this.addComponent(addition.facet!, state, events);
    }
  }
  
  private createElement(facet: Facet, events: SpaceEvent[]): void {
    const { parentId, elementType, name, components } = facet.state as any;
    
    // Find parent
    const parent = this.elementCache.get(parentId || 'root');
    if (!parent) {
      console.error(`Parent element ${parentId} not found`);
      return;
    }
    
    // Create element
    const elementId = `${name}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const element = new Element(name, elementId);
    this.elementCache.set(elementId, element);
    
    // Mount element - this will emit element:mount event (queued for next frame)
    parent.addChild(element);
    
    // Create persistent element-tree facet
    events.push({
      topic: 'veil:operation',
      source: element.getRef(),
      timestamp: Date.now(),
      payload: {
        operation: {
          type: 'addFacet',
          facet: {
            id: `element-tree-${elementId}`,
            type: 'element-tree',
            state: {
              elementId,
              elementType,
              parentId: parent.id,
              name,
              active: true,
              components: []
            }
          }
        }
      }
    });
    
    // Remove the processed element-request facet
    events.push({
      topic: 'veil:operation',
      source: element.getRef(),
      timestamp: Date.now(),
      payload: {
        operation: {
          type: 'removeFacet',
          id: facet.id
        }
      }
    });
    
    // Add components if specified
    if (components) {
      const componentStates: any[] = [];
      for (const compDef of components) {
        const component = ComponentRegistry.create(compDef.type, compDef.config);
        if (component) {
          element.addComponent(component);
          componentStates.push({
            type: compDef.type,
            index: element.components.length - 1,
            config: compDef.config
          });
        }
      }
      
      // Update element-tree facet with all components at once
      if (componentStates.length > 0) {
        events.push({
          topic: 'veil:operation',
          source: element.getRef(),
          timestamp: Date.now(),
          payload: {
            operation: {
              type: 'changeFacet',
              id: `element-tree-${elementId}`,
              changes: {
                state: { components: componentStates }
              }
            }
          }
        });
      }
    }
  }
  
  private restoreElement(facet: Facet, events: SpaceEvent[]): void {
    const { elementId, elementType, parentId, name, components } = facet.state as any;
    
    // Skip if element already exists
    if (this.elementCache.has(elementId)) {
      return;
    }
    
    // Find parent
    const parent = parentId ? this.elementCache.get(parentId) : null;
    if (!parent) {
      console.error(`Parent element ${parentId} not found for ${elementId}`);
      return;
    }
    
    // Create element with existing ID
    const element = new Element(name, elementId);
    this.elementCache.set(elementId, element);
    
    // Mount element - events will be queued for next frame
    parent.addChild(element);
    
    // Add components
    for (const compDef of components || []) {
      const component = ComponentRegistry.create(compDef.type, compDef.config);
      if (component) {
        element.addComponent(component);
      }
    }
  }
  
  private deleteElement(elementId: string, events: SpaceEvent[]): void {
    const element = this.elementCache.get(elementId);
    if (!element) return;
    
    // Recursively delete children first
    for (const child of [...element.children]) {
      this.deleteElement(child.id, events);
    }
    
    // Remove from parent - events will be queued for next frame
    element.parent?.removeChild(element);
    
    // Remove from cache
    this.elementCache.delete(elementId);
    
    // Mark element-tree facet as inactive
    events.push({
      topic: 'veil:operation',
      source: this.space.getRef(),
      timestamp: Date.now(),
      payload: {
        operation: {
          type: 'changeFacet',
          id: `element-tree-${elementId}`,
          changes: {
            state: { active: false }
          }
        }
      }
    });
  }
  
  private addComponent(facet: Facet, state: ReadonlyVEILState, events: SpaceEvent[]): void {
    const { elementId, componentType, config } = facet.state?.metadata || {};
    if (!elementId || !componentType) return;
    
    const element = this.elementCache.get(elementId);
    if (!element) return;
    
    const component = ComponentRegistry.create(componentType, config);
    if (!component) return;
    
    element.addComponent(component);
    
    // Update element-tree facet
    const treeFacetId = `element-tree-${elementId}`;
    const treeFacet = state.facets.get(treeFacetId);
    if (treeFacet?.state) {
      const components = [...(treeFacet.state.components || [])];
      components.push({
        type: componentType,
        index: element.components.length - 1,
        config
      });
      
      events.push({
        topic: 'veil:operation',
        source: element.getRef(),
        timestamp: Date.now(),
        payload: {
          operation: {
            type: 'changeFacet',
            id: treeFacetId,
            changes: {
              state: { components }
            }
          }
        }
      });
    }
  }
  
  // Helper methods for sorting
  private sortDeletionsByHierarchy(deletions: any[]): any[] {
    // For now, just return as-is
    // TODO: Implement proper sorting based on parent-child relationships
    return deletions;
  }
  
  private sortByHierarchy(operations: any[]): any[] {
    // For now, just return as-is
    // TODO: Implement proper sorting based on parent-child relationships
    return operations;
  }
  
  private isAncestor(possibleAncestor: Element, element: Element): boolean {
    let current = element.parent;
    while (current) {
      if (current === possibleAncestor) return true;
      current = current.parent;
    }
    return false;
  }
}