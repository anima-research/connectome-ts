import { 
  Facet, 
  VEILState, 
  IncomingVEILFrame, 
  OutgoingVEILFrame, 
  VEILOperation,
  StreamRef,
  FrameTransition
} from './types';
import { Space } from '../spaces/space';
import { Element } from '../spaces/element';
import { Component } from '../spaces/component';
import { isForkInvariant } from '../spaces/types';
import { getPersistenceMetadata } from '../persistence/decorators';

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
      agents: new Map(),
      currentStream: undefined,
      currentAgent: undefined,
      frameHistory: [],
      currentSequence: 0,
      removals: new Map()
    };
  }

  /**
   * Get the next sequence number for a new frame
   */
  getNextSequence(): number {
    return this.state.currentSequence + 1;
  }

  /**
   * Apply an incoming frame to the current state
   */
  applyIncomingFrame(frame: IncomingVEILFrame): void {
    // Validate sequence - must be exactly the next number
    const expectedSequence = this.state.currentSequence + 1;
    if (frame.sequence !== expectedSequence) {
      throw new Error(
        `Frame sequence error: expected ${expectedSequence}, got ${frame.sequence} ` +
        `(current: ${this.state.currentSequence})`
      );
    }

    // Update active stream if provided
    if (frame.activeStream !== undefined) {
      this.state.currentStream = frame.activeStream;
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
  recordOutgoingFrame(frame: OutgoingVEILFrame, agentInfo?: { agentId: string; agentName?: string }): void {
    // Validate sequence - must be exactly the next number
    const expectedSequence = this.state.currentSequence + 1;
    if (frame.sequence !== expectedSequence) {
      throw new Error(
        `Frame sequence error: expected ${expectedSequence}, got ${frame.sequence} ` +
        `(current: ${this.state.currentSequence})`
      );
    }
    
    const frameTimestamp = new Date().toISOString();
    
    // Set current agent if provided
    if (agentInfo?.agentId) {
      this.state.currentAgent = agentInfo.agentId;
    }
    
    // Validate operations
    const validOutgoingOps = ['speak', 'think', 'act'];
    const veilManagementOps = ['addFacet', 'removeFacet', 'changeFacet', 'addStream', 'removeStream', 'addScope', 'removeScope', 'addAgent', 'removeAgent', 'updateAgent'];
    
    for (const operation of frame.operations) {
      // Skip VEIL management operations - these are valid but not "outgoing"
      if (veilManagementOps.includes(operation.type)) {
        continue;
      }
      
      // Validate outgoing operations
      if (!validOutgoingOps.includes(operation.type)) {
        console.warn(`[VEIL] Warning: Unsupported outgoing operation type "${operation.type}". Valid outgoing operations are: ${validOutgoingOps.join(', ')}`);
        // Legacy operation types that should be updated
        if (['toolCall', 'innerThoughts', 'cycleRequest'].includes(operation.type as any)) {
          console.warn(`[VEIL] "${operation.type}" has been renamed:`);
          console.warn(`  - toolCall: Use 'act' operation`);
          console.warn(`  - innerThoughts: Use 'think' operation`);
          console.warn(`  - cycleRequest: Has been removed - use components/actions instead`);
        }
        continue; // Skip unsupported operations
      }
    }
    
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
            agentId: this.state.currentAgent,
            agentName: this.state.currentAgent ? this.state.agents.get(this.state.currentAgent)?.name : undefined,
            target: operation.target || this.state.currentStream?.streamId || 'default'
          }
        };
        this.state.facets.set(speechFacet.id, speechFacet);
      } else if (operation.type === 'act') {
        // Create an action facet
        const actionFacet: Facet = {
          id: `agent-action-${frame.sequence}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'action',
          displayName: operation.toolName,
          content: JSON.stringify(operation.parameters),
          attributes: {
            agentGenerated: true,
            agentId: this.state.currentAgent,
            agentName: this.state.currentAgent ? this.state.agents.get(this.state.currentAgent)?.name : undefined,
            toolName: operation.toolName,
            parameters: operation.parameters
          }
        };
        this.state.facets.set(actionFacet.id, actionFacet);
      } else if (operation.type === 'think') {
        // Create a thought facet
        const thoughtFacet: Facet = {
          id: `agent-thought-${frame.sequence}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'thought',
          content: operation.content,
          scope: ['agent-internal'],
          attributes: {
            agentGenerated: true,
            agentId: this.state.currentAgent,
            agentName: this.state.currentAgent ? this.state.agents.get(this.state.currentAgent)?.name : undefined,
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
      agents: new Map(this.state.agents),
      currentStream: this.state.currentStream,
      currentAgent: this.state.currentAgent,
      frameHistory: [...this.state.frameHistory],
      currentSequence: this.state.currentSequence,
      removals: new Map(this.state.removals)
    };
  }

  /**
   * Get active facets (filtered by scope)
   */
  getActiveFacets(): Map<string, Facet> {
    const active = new Map<string, Facet>();
    
    for (const [id, facet] of this.state.facets) {
      // Skip removed facets
      if (this.state.removals.has(id)) {
        continue;
      }
      
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
   * Clean up deleted facets from memory
   * This should be called periodically or before creating snapshots
   */
  cleanupDeletedFacets(): number {
    let cleaned = 0;
    for (const [id, mode] of this.state.removals) {
      if (mode === 'delete') {
        // Remove from facets map
        if (this.state.facets.delete(id)) {
          cleaned++;
        }
        // Remove from removals map
        this.state.removals.delete(id);
      }
    }
    return cleaned;
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
   * Restore state from a snapshot (used by persistence system)
   */
  setState(newState: VEILState): void {
    this.state = {
      facets: new Map(newState.facets),
      scopes: new Set(newState.scopes),
      streams: new Map(newState.streams),
      agents: new Map(newState.agents || []),
      currentStream: newState.currentStream,
      currentAgent: newState.currentAgent,
      frameHistory: [...newState.frameHistory],
      currentSequence: newState.currentSequence,
      removals: new Map(newState.removals || [])
    };
    this.notifyListeners();
  }

  /**
   * Get the current focus
   */
  getCurrentStream(): StreamRef | undefined {
    return this.state.currentStream;
  }

  /**
   * Get current streams
   */
  getStreams(): Map<string, import('./types').StreamInfo> {
    return new Map(this.state.streams);
  }

  private applyOperation(operation: VEILOperation, frameSequence?: number, timestamp?: string): void {
    // Validate operation type
    const validOperations = ['addFacet', 'changeState', 'addScope', 'deleteScope', 'addStream', 'updateStream', 'deleteStream', 'removeFacet', 'addAgent', 'removeAgent', 'updateAgent'];
    if (!validOperations.includes(operation.type)) {
      console.warn(`[VEIL] Warning: Unsupported operation type "${operation.type}". Valid operations are: ${validOperations.join(', ')}`);
      // Legacy operation types that should be updated
      if (['agentActivation', 'toolCall', 'innerThoughts', 'cycleRequest'].includes(operation.type as any)) {
        console.warn(`[VEIL] "${operation.type}" is no longer an operation. Use the new VEIL model:`);
        console.warn(`  - agentActivation: Use addFacet with type='agentActivation'`);
        console.warn(`  - toolCall: Use 'act' operation`);
        console.warn(`  - innerThoughts: Use 'think' operation`);
        console.warn(`  - cycleRequest: Has been removed - use components/actions instead`);
      }
      return;
    }
    
    switch (operation.type) {
      case 'addFacet':
        // Validate facet type
        const validFacetTypes = ['event', 'state', 'ambient', 'tool', 'speech', 'thought', 'action', 'defineAction', 'agentActivation'];
        if (!validFacetTypes.includes(operation.facet.type)) {
          console.warn(`[VEIL] Warning: Unsupported facet type "${operation.facet.type}". Valid facet types are: ${validFacetTypes.join(', ')}`);
          return;
        }
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
      
      // Note: agentActivation is now a facet, not an operation
      
      case 'addStream':
        this.state.streams.set(operation.stream.id, operation.stream);
        break;
      
      case 'updateStream':
        this.updateStream(operation.streamId, operation.updates);
        break;
      
      case 'deleteStream':
        this.state.streams.delete(operation.streamId);
        // If deleted stream had focus, clear focus
        if (this.state.currentStream?.streamId === operation.streamId) {
          this.state.currentStream = undefined;
        }
        break;
      
      case 'removeFacet':
        this.removeFacet(operation.facetId, operation.mode);
        break;
        
      case 'addAgent':
        this.state.agents.set(operation.agent.id, operation.agent);
        break;
        
      case 'removeAgent':
        this.state.agents.delete(operation.agentId);
        // If removed agent was current, clear current
        if (this.state.currentAgent === operation.agentId) {
          this.state.currentAgent = undefined;
        }
        break;
        
      case 'updateAgent':
        const agent = this.state.agents.get(operation.agentId);
        if (agent) {
          this.state.agents.set(operation.agentId, {
            ...agent,
            ...operation.updates,
            lastActiveAt: new Date().toISOString()
          });
        } else {
          console.warn(`[VEIL] Cannot update non-existent agent: ${operation.agentId}`);
        }
        break;
    }
  }

  private addFacet(facet: Facet, frameSequence?: number, timestamp?: string): void {
    // Clone the facet to avoid shared references
    const clonedFacet = { ...facet };
    if (facet.attributes && typeof facet.attributes === 'object') {
      clonedFacet.attributes = { ...facet.attributes };
    }
    
    // Deep clone children to avoid shared references
    if (facet.children) {
      clonedFacet.children = facet.children.map(child => this.cloneFacet(child));
    }
    
    this.state.facets.set(facet.id, clonedFacet);
  }
  
  private cloneFacet(facet: Facet): Facet {
    const cloned = { ...facet };
    if (facet.attributes && typeof facet.attributes === 'object') {
      cloned.attributes = { ...facet.attributes };
    }
    if (facet.children) {
      cloned.children = facet.children.map(child => this.cloneFacet(child));
    }
    return cloned;
  }

  private changeState(facetId: string, updates: { content?: string; attributes?: Record<string, any> }): void {
    const facet = this.state.facets.get(facetId);
    if (!facet) {
      // This can happen if an action is executed before the facet is initialized
      // Silently ignore for now as components will add their facets soon
      return;
    }

    // Check if facet is removed
    const removal = this.state.removals.get(facetId);
    if (removal === 'delete') {
      // Silently ignore changes to deleted facets
      return;
    }
    // Note: 'hide' mode still allows state changes, just affects rendering

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

  private removeFacet(facetId: string, mode: 'hide' | 'delete'): void {
    const facet = this.state.facets.get(facetId);
    if (!facet) {
      // Already removed or doesn't exist
      return;
    }
    
    // Track the removal
    this.state.removals.set(facetId, mode);
    
    // Cascade to children
    if (facet.children) {
      for (const child of facet.children) {
        this.removeFacet(child.id, mode);
      }
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

  /**
   * Delete recent frames with selective component reinitialization
   * Fork-invariant components survive, others are recreated
   */
  async deleteRecentFramesWithReinit(
    count: number,
    space: Space
  ): Promise<FrameDeletionResult> {
    if (count <= 0) {
      throw new Error('Count must be positive');
    }
    
    if (count > this.state.frameHistory.length) {
      throw new Error(`Cannot delete ${count} frames, only ${this.state.frameHistory.length} exist`);
    }
    
    // Phase 1: Analyze and categorize components
    const { invariant, stateful } = this.categorizeComponents(space);
    
    // Phase 2: Prepare deletion
    // Sort frames by sequence to ensure we delete the most recent ones
    const sortedFrames = [...this.state.frameHistory].sort((a, b) => b.sequence - a.sequence);
    const framesToDelete = sortedFrames.slice(0, count);
    const deletedRange = {
      from: Math.min(...framesToDelete.map(f => f.sequence)),
      to: Math.max(...framesToDelete.map(f => f.sequence))
    };
    const rollbackSequence = sortedFrames[count]?.sequence || 0;
    
    // Analyze what will be affected
    const analysis = this.analyzeAffectedState(framesToDelete);
    
    // Phase 3: Notify invariant components
    for (const { component } of invariant) {
      if ('onFrameFork' in component && typeof component.onFrameFork === 'function') {
        component.onFrameFork(deletedRange);
      }
    }
    
    // Phase 4: Capture component states at rollback point
    const componentSnapshots = await this.captureComponentStatesAtSequence(
      rollbackSequence,
      space,
      stateful
    );
    
    // Phase 5: Shutdown stateful components
    await this.shutdownComponents(stateful);
    
    // Phase 6: Execute frame deletion
    const deletionResult = this.executeFrameDeletion(count, rollbackSequence);
    deletionResult.affectedFacets = analysis.facets;
    deletionResult.warnings = analysis.warnings;
    
    // Phase 7: Skip component reinitialization - let frames rebuild naturally
    // Components will be rebuilt from remaining frame history when frames are replayed
    
    return deletionResult;
  }
  
  private categorizeComponents(space: Space): ComponentCategorization {
    const invariant: ComponentInfo[] = [];
    const stateful: ComponentInfo[] = [];
    
    const walk = (element: Element, path: string[] = []) => {
      const currentPath = [...path, element.id];
      
      element.components.forEach((component, index) => {
        const info: ComponentInfo = {
          component,
          element,
          path: currentPath,
          index
        };
        
        if (isForkInvariant(component)) {
          invariant.push(info);
        } else {
          stateful.push(info);
        }
      });
      
      element.children.forEach(child => walk(child, currentPath));
    };
    
    walk(space);
    return { invariant, stateful };
  }
  
  private analyzeAffectedState(frames: Array<IncomingVEILFrame | OutgoingVEILFrame>): {
    facets: Set<string>;
    warnings: string[];
  } {
    const affected = new Set<string>();
    const warnings: string[] = [];
    
    for (const frame of frames) {
      for (const op of frame.operations) {
        switch (op.type) {
          case 'addFacet':
            affected.add(op.facet.id);
            if (op.facet.children?.length) {
              warnings.push(
                `Facet ${op.facet.id} has ${op.facet.children.length} children that will also be removed`
              );
            }
            break;
            
          case 'changeState':
            if (!this.state.facets.has(op.facetId)) {
              warnings.push(
                `Change operation on non-existent facet ${op.facetId} (might have been added in deleted frames)`
              );
            }
            break;
            
          case 'removeFacet':
            warnings.push(`Remove operation for ${op.facetId} will be undone`);
            break;
        }
      }
    }
    
    return { facets: affected, warnings };
  }
  
  private async captureComponentStatesAtSequence(
    targetSequence: number,
    space: Space,
    componentsToCapture: ComponentInfo[]
  ): Promise<ComponentStateSnapshot[]> {
    const snapshots: ComponentStateSnapshot[] = [];
    
    for (const info of componentsToCapture) {
      const component = info.component;
      const metadata = getPersistenceMetadata(component);
      
      const snapshot: ComponentStateSnapshot = {
        elementPath: info.path,
        componentIndex: info.index,
        className: component.constructor.name,
        persistentProperties: {}
      };
      
      // Capture persistent properties
      if (metadata) {
        for (const [key, propMeta] of metadata.properties) {
          snapshot.persistentProperties[key] = (component as any)[key];
        }
      }
      
      snapshots.push(snapshot);
    }
    
    return snapshots;
  }
  
  private async shutdownComponents(components: ComponentInfo[]): Promise<void> {
    for (const { component } of components) {
      try {
        // Call shutdown lifecycle method if it exists
        if ('onShutdown' in component && typeof component.onShutdown === 'function') {
          await component.onShutdown();
        }
        
        // Force cleanup common resources
        this.cleanupComponentResources(component);
      } catch (error) {
        console.error(`Error shutting down ${component.constructor.name}:`, error);
      }
    }
  }
  
  private cleanupComponentResources(component: Component): void {
    const comp = component as any;
    
    // WebSocket connections
    if (comp.ws && typeof comp.ws.close === 'function') {
      comp.ws.close();
      comp.ws = null;
    }
    
    // Timers
    const timerProps = ['timeout', 'interval', 'reconnectTimeout', 'heartbeatInterval'];
    for (const prop of timerProps) {
      if (comp[prop]) {
        clearTimeout(comp[prop]);
        clearInterval(comp[prop]);
        comp[prop] = null;
      }
    }
    
    // Event listeners
    if (comp.listeners && typeof comp.listeners.clear === 'function') {
      comp.listeners.clear();
    }
    
    // Pending promises/callbacks
    if (comp.pendingPromises) {
      comp.pendingPromises = [];
    }
    if (comp.callbacks) {
      comp.callbacks = new Map();
    }
  }
  
  private executeFrameDeletion(count: number, rollbackSequence: number): FrameDeletionResult {
    // Sort frames by sequence to ensure we delete the most recent ones
    const sortedFrames = [...this.state.frameHistory].sort((a, b) => b.sequence - a.sequence);
    
    // Get the frames to delete (most recent N frames)
    const framesToDelete = sortedFrames.slice(0, count);
    const deletedSequences = new Set(framesToDelete.map(f => f.sequence));
    
    // Capture deleted frames info
    const deletedFrames = framesToDelete.map(f => ({
      sequence: f.sequence,
      type: 'operations' in f ? 
        (f.operations.some((op: any) => op.type === 'speak' || op.type === 'act') ? 'outgoing' : 'incoming') 
        : 'unknown',
      timestamp: f.timestamp,
      operationCount: f.operations.length
    }));
    
    // Remove frames from history by filtering out deleted sequences
    this.state.frameHistory = this.state.frameHistory.filter(f => !deletedSequences.has(f.sequence));
    
    // Reset sequence number
    this.state.currentSequence = rollbackSequence;
    
    // Rebuild state by replaying remaining frames
    const oldFacets = this.state.facets;
    const oldRemovals = this.state.removals;
    const oldStreams = this.state.streams;
    
    // Clear current state
    this.state.facets = new Map();
    this.state.removals = new Map();
    this.state.streams = new Map();
    this.state.currentStream = undefined;
    
    // Replay all remaining frames
    const tempHistory = [...this.state.frameHistory];
    this.state.frameHistory = [];
    this.state.currentSequence = 0;
    
    try {
      for (const frame of tempHistory) {
        // Temporarily adjust sequence for replay
        const originalSeq = frame.sequence;
        frame.sequence = this.state.currentSequence + 1;
        
        if ('operations' in frame) {
          const isIncoming = !frame.operations.some((op: any) => 
            op.type === 'speak' || op.type === 'act'
          );
          
          if (isIncoming) {
            this.applyIncomingFrame(frame as IncomingVEILFrame);
          } else {
            this.recordOutgoingFrame(frame as OutgoingVEILFrame);
          }
        }
        
        // Restore original sequence
        frame.sequence = originalSeq;
      }
      
      this.notifyListeners();
    } catch (error: any) {
      // Rollback failed - restore original state
      this.state.facets = oldFacets;
      this.state.removals = oldRemovals;
      this.state.streams = oldStreams;
      throw new Error(`Frame deletion failed during replay: ${error.message}`);
    }
    
    return {
      deletedFrames,
      affectedFacets: new Set(),
      revertedSequence: this.state.currentSequence,
      warnings: []
    };
  }
  
  private async reinitializeComponents(
    space: Space,
    snapshots: ComponentStateSnapshot[]
  ): Promise<void> {
    for (const snapshot of snapshots) {
      const element = this.findElementByPath(space, snapshot.elementPath);
      if (!element) {
        console.warn(`Cannot find element for path: ${snapshot.elementPath.join('/')}`);
        continue;
      }
      
      // Component should already exist, just restore state
      const component = element.components[snapshot.componentIndex];
      if (!component) {
        console.warn(`Component at index ${snapshot.componentIndex} not found`);
        continue;
      }
      
      // Restore persistent properties
      Object.assign(component, snapshot.persistentProperties);
      
      // Call recovery lifecycle
      if ('onRecovery' in component && typeof component.onRecovery === 'function') {
        await component.onRecovery(
          this.state.currentSequence + snapshots.length,
          this.state.currentSequence
        );
      }
    }
  }
  
  private findElementByPath(root: Element, path: string[]): Element | null {
    let current = root;
    
    // Skip root in path if present
    const searchPath = path[0] === root.id ? path.slice(1) : path;
    
    for (const id of searchPath) {
      const child = current.findChild(id);
      if (!child) return null;
      current = child;
    }
    
    return current;
  }
  
  private async triggerRecoveryFrame(space: Space, previousSequence: number): Promise<void> {
    // Emit recovery complete event
    space.emit({
      topic: 'system:recovery-complete',
      source: { elementId: 'system', elementPath: ['system'] },
      payload: {
        reason: 'frame-deletion',
        previousSequence,
        newSequence: this.state.currentSequence
      },
      timestamp: Date.now()
    });
    
    // Process a frame to let components react
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Type definitions for frame deletion
interface ComponentInfo {
  component: Component;
  element: Element;
  path: string[];
  index: number;
}

interface ComponentCategorization {
  invariant: ComponentInfo[];
  stateful: ComponentInfo[];
}

interface ComponentStateSnapshot {
  elementPath: string[];
  componentIndex: number;
  className: string;
  persistentProperties: Record<string, any>;
}

export interface FrameDeletionResult {
  deletedFrames: Array<{
    sequence: number;
    type: string;
    timestamp: string;
    operationCount: number;
  }>;
  affectedFacets: Set<string>;
  revertedSequence: number;
  warnings: string[];
}
