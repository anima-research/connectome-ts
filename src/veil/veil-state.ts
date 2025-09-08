import { 
  Facet, 
  VEILState, 
  IncomingVEILFrame, 
  OutgoingVEILFrame, 
  VEILOperation 
} from './types';

/**
 * Manages the current VEIL state by applying frame operations
 */
export class VEILStateManager {
  private state: VEILState;
  private listeners: Array<(state: VEILState) => void> = [];

  constructor() {
    this.state = {
      facets: new Map(),
      scopes: new Set(),
      streams: new Map(),
      currentFocus: undefined,
      frameHistory: [],
      currentSequence: 0
    };
  }

  /**
   * Apply an incoming frame to the current state
   */
  applyIncomingFrame(frame: IncomingVEILFrame): void {
    // Validate sequence
    if (frame.sequence <= this.state.currentSequence) {
      console.warn(`Frame ${frame.sequence} out of order (current: ${this.state.currentSequence})`);
    }

    // Update focus if provided
    if (frame.focus !== undefined) {
      this.state.currentFocus = frame.focus;
    }

    // Process each operation
    for (const operation of frame.operations) {
      this.applyOperation(operation, frame.sequence, frame.timestamp);
    }

    // Update state
    this.state.frameHistory.push(frame);
    this.state.currentSequence = frame.sequence;

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Record an outgoing frame (from agent) and create facets for agent actions
   */
  recordOutgoingFrame(frame: OutgoingVEILFrame): void {
    const frameTimestamp = new Date().toISOString();
    
    // Process agent operations to create facets
    for (const operation of frame.operations) {
      if (operation.type === 'speak') {
        // Create a speech facet
        const speechFacet: Facet = {
          id: `agent-speak-${frame.sequence}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'speech',
          content: operation.content,
          attributes: {
            agentGenerated: true,
            target: operation.target || this.state.currentFocus || 'default'
          }
        };
        this.state.facets.set(speechFacet.id, speechFacet);
      } else if (operation.type === 'toolCall') {
        // Create an action facet
        const actionFacet: Facet = {
          id: `agent-action-${frame.sequence}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'action',
          displayName: operation.toolName,
          content: JSON.stringify(operation.parameters),
          attributes: {
            agentGenerated: true,
            toolName: operation.toolName,
            parameters: operation.parameters
          }
        };
        this.state.facets.set(actionFacet.id, actionFacet);
      } else if (operation.type === 'innerThoughts') {
        // Create a thought facet
        const thoughtFacet: Facet = {
          id: `agent-thought-${frame.sequence}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'thought',
          content: operation.content,
          scope: ['agent-internal'],
          attributes: {
            agentGenerated: true,
            private: true
          }
        };
        this.state.facets.set(thoughtFacet.id, thoughtFacet);
      }
    }

    this.state.frameHistory.push(frame);
    this.state.currentSequence = frame.sequence;
    this.notifyListeners();
  }

  /**
   * Get current state snapshot
   */
  getState(): Readonly<VEILState> {
    return {
      facets: new Map(this.state.facets),
      scopes: new Set(this.state.scopes),
      streams: new Map(this.state.streams),
      currentFocus: this.state.currentFocus,
      frameHistory: [...this.state.frameHistory],
      currentSequence: this.state.currentSequence
    };
  }

  /**
   * Get active facets (filtered by scope)
   */
  getActiveFacets(): Map<string, Facet> {
    const active = new Map<string, Facet>();
    
    for (const [id, facet] of this.state.facets) {
      // Check if facet is in scope
      if (!facet.scope || facet.scope.length === 0) {
        // No scope requirements - always active
        active.set(id, facet);
      } else if (facet.scope.some(s => this.state.scopes.has(s))) {
        // At least one required scope is active
        active.set(id, facet);
      }
    }

    return active;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: VEILState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Get the current focus
   */
  getCurrentFocus(): string | undefined {
    return this.state.currentFocus;
  }

  /**
   * Get current streams
   */
  getStreams(): Map<string, import('./types').StreamInfo> {
    return new Map(this.state.streams);
  }

  private applyOperation(operation: VEILOperation, frameSequence?: number, timestamp?: string): void {
    switch (operation.type) {
      case 'addFacet':
        this.addFacet(operation.facet, frameSequence, timestamp);
        break;
      
      case 'changeState':
        this.changeState(operation.facetId, operation.updates);
        break;
      
      case 'addScope':
        this.state.scopes.add(operation.scope);
        break;
      
      case 'deleteScope':
        this.state.scopes.delete(operation.scope);
        break;
      
      case 'agentActivation':
        // This is handled by AgentLoop, not state
        break;
      
      case 'addStream':
        this.state.streams.set(operation.stream.id, operation.stream);
        break;
      
      case 'updateStream':
        this.updateStream(operation.streamId, operation.updates);
        break;
      
      case 'deleteStream':
        this.state.streams.delete(operation.streamId);
        // If deleted stream had focus, clear focus
        if (this.state.currentFocus === operation.streamId) {
          this.state.currentFocus = undefined;
        }
        break;
    }
  }

  private addFacet(facet: Facet, frameSequence?: number, timestamp?: string): void {
    this.state.facets.set(facet.id, facet);
    
    // Recursively add children
    if (facet.children) {
      for (const child of facet.children) {
        this.addFacet(child, frameSequence, timestamp);
      }
    }
  }

  private changeState(facetId: string, updates: { content?: string; attributes?: Record<string, any> }): void {
    const facet = this.state.facets.get(facetId);
    if (!facet) {
      console.warn(`Cannot change state of non-existent facet: ${facetId}`);
      return;
    }

    if (facet.type !== 'state') {
      console.warn(`Cannot change state of non-state facet: ${facetId} (type: ${facet.type})`);
      return;
    }

    // Apply updates
    if (updates.content !== undefined) {
      facet.content = updates.content;
    }
    
    if (updates.attributes) {
      facet.attributes = {
        ...facet.attributes,
        ...updates.attributes
      };
    }
  }

  private updateStream(streamId: string, updates: Partial<Omit<import('./types').StreamInfo, 'id'>>): void {
    const stream = this.state.streams.get(streamId);
    if (!stream) {
      console.warn(`Cannot update non-existent stream: ${streamId}`);
      return;
    }

    // Apply updates
    if (updates.name !== undefined) {
      stream.name = updates.name;
    }
    if (updates.metadata !== undefined) {
      stream.metadata = {
        ...stream.metadata,
        ...updates.metadata
      };
    }
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
