import { Component } from '../spaces/component';
import { SpaceEvent } from '../spaces/types';
import { Space } from '../spaces/space';
import { IncomingVEILFrame, VEILOperation, Facet } from '../veil/types';

/**
 * Base component for producing VEIL operations
 */
export abstract class VEILComponent extends Component {
  /**
   * Add an operation to the current frame
   */
  protected addOperation(operation: VEILOperation): void {
    const space = this.element?.space as Space | undefined;
    if (!space) {
      // Element not yet attached to space - defer operation
      if (!this._deferredOperations) {
        this._deferredOperations = [];
      }
      this._deferredOperations.push(operation);
      return;
    }
    
    const frame = space.getCurrentFrame ? space.getCurrentFrame() : undefined;
    if (frame) {
      frame.operations.push(operation);
    }
  }
  
  private _deferredOperations?: VEILOperation[];
  
  /**
   * Process any deferred operations when element is added to space
   */
  protected processDeferredOperations(): void {
    if (this._deferredOperations && this.element?.space) {
      const space = this.element.space as Space;
      const frame = space.getCurrentFrame ? space.getCurrentFrame() : undefined;
      if (frame) {
        for (const op of this._deferredOperations) {
          frame.operations.push(op);
        }
      }
      this._deferredOperations = undefined;
    }
  }
  
  /**
   * Add a facet to the current frame
   */
  protected addFacet(facetDef: {
    id: string;
    type: 'event' | 'state' | 'ambient';
    content?: string;
    displayName?: string;
    scope?: string[];
    attributes?: Record<string, any>;
  }): void {
    // Create proper facet based on type
    let facet: Facet;
    
    switch (facetDef.type) {
      case 'event':
        facet = {
          id: facetDef.id,
          type: 'event',
          content: facetDef.content,
          displayName: facetDef.displayName,
          attributes: facetDef.attributes || {}
        };
        break;
      case 'state':
        facet = {
          id: facetDef.id,
          type: 'state',
          content: facetDef.content,
          displayName: facetDef.displayName,
          attributes: facetDef.attributes || {}
        };
        break;
      case 'ambient':
        facet = {
          id: facetDef.id,
          type: 'ambient',
          content: facetDef.content,
          displayName: facetDef.displayName,
          scope: facetDef.scope || [],
          attributes: facetDef.attributes || {}
        };
        break;
    }
    
    this.addOperation({
      type: 'addFacet',
      facet
    });
  }
  
  /**
   * Update a state facet
   */
  protected updateState(facetId: string, updates: {
    content?: string;
    attributes?: Record<string, any>;
  }): void {
    this.addOperation({
      type: 'changeState',
      facetId,
      updates
    });
  }
}

/**
 * Base component for handling interactions
 */
export abstract class InteractiveComponent extends VEILComponent {
  protected actions: Map<string, (params?: any) => Promise<void>> = new Map();
  
  /**
   * Register an action handler
   */
  protected registerAction(name: string, handler: (params?: any) => Promise<void>): void {
    this.actions.set(name, handler);
  }
  
  /**
   * Handle incoming events - check for action events
   */
  async handleEvent(event: SpaceEvent): Promise<void> {
    // Check if this is an action event for us
    if (event.topic === 'element:action') {
      const payload = event.payload as any;
      
      // Check if this action is meant for this element
      // The payload contains path (array) where the last element is the action name
      const fullPath = payload.path?.join('.') || '';
      const elementPath = payload.path?.slice(0, -1).join('.') || '';
      const action = payload.action || payload.path?.[payload.path.length - 1];
      const parameters = payload.parameters;
      
      // Check if this action is for us:
      // The path is like ['dispenser', 'setSize'] or ['box-1', 'open']
      // We check if the element part matches our ID
      if (elementPath === this.element.id) {
        // Look for a handler for just the action name
        const handler = this.actions.get(action);
        if (handler) {
          await handler(parameters);
        }
      }
    }
  }
}

/**
 * Base component for managing state
 */
export abstract class StateComponent<T = any> extends VEILComponent {
  protected state: T;
  protected stateId: string;
  
  constructor(initialState: T, stateId: string) {
    super();
    this.state = initialState;
    this.stateId = stateId;
  }
  
  /**
   * Update state and emit VEIL operation
   */
  protected setState(updates: Partial<T>): void {
    this.state = { ...this.state, ...updates };
    this.emitStateUpdate();
  }
  
  /**
   * Get current state
   */
  getState(): T {
    return this.state;
  }
  
  /**
   * Emit state update to VEIL
   */
  protected abstract emitStateUpdate(): void;
}

/**
 * Helper to create a component with minimal boilerplate
 */
export function createComponent<T extends Component>(
  setup: (component: T) => void
): T {
  const ComponentClass = class extends Component {
    constructor() {
      super();
      setup(this as any);
    }
  };
  return new ComponentClass() as T;
}
