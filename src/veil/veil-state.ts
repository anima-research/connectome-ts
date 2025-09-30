import { 
  Facet, 
  VEILState, 
  VEILOperation,
  StreamRef,
  FrameTransition,
  Frame
} from './types';
import { FacetDelta } from '../spaces/receptor-effector-types';
import { Space } from '../spaces/space';
import { Element } from '../spaces/element';
import { Component } from '../spaces/component';
import { isForkInvariant } from '../spaces/types';
import { getPersistenceMetadata } from '../persistence/decorators';

/**
 * Manages the current VEIL state by applying frame deltas
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
   * Apply a frame and return the changes
   */
  applyFrame(frame: Frame, skipEphemeralCleanup: boolean = false): FacetDelta[] {
    // Validate sequence - must be exactly the next number
    const expectedSequence = this.state.currentSequence + 1;
    if (frame.sequence !== expectedSequence) {
      throw new Error(
        `Frame sequence error: expected ${expectedSequence}, got ${frame.sequence} ` +
        `(current: ${this.state.currentSequence})`
      );
    }

    const changes: FacetDelta[] = [];

    // Update active stream if provided
    if (frame.activeStream !== undefined) {
      this.state.currentStream = frame.activeStream;
    }

    // Process each operation and track changes
    for (const delta of frame.deltas) {
      const change = this.applyDelta(delta, frame.sequence, frame.timestamp);
      if (change) {
        changes.push(change);
      }
    }

    // Update state
    this.state.frameHistory.push(frame);
    this.state.currentSequence = frame.sequence;
    
    // Remove ephemeral facets at end of frame (unless skipped)
    if (!skipEphemeralCleanup) {
      const ephemeralFacets: Array<[string, Facet]> = [];
      for (const [id, facet] of this.state.facets) {
        if ('ephemeral' in facet && facet.ephemeral === true) {
          ephemeralFacets.push([id, facet]);
        }
      }
      
      // Remove ephemeral facets
      for (const [id, facet] of ephemeralFacets) {
        this.state.facets.delete(id);
        // Also track this as a removal for the frame
        changes.push({
          type: 'removed',
          facet
        });
      }
    }

    // Notify listeners
    this.notifyListeners();
    
    return changes;
  }
  
  /**
   * Apply deltas directly to state without creating a frame
   * Used for Phase 2 iterations where changes should be immediately visible
   * but we don't want to create intermediate frames in history
   */
  applyDeltasDirect(deltas: VEILOperation[]): FacetDelta[] {
    const changes: FacetDelta[] = [];
    
    for (const delta of deltas) {
      const change = this.applyDelta(delta);
      if (change) {
        changes.push(change);
      }
    }
    
    // Do NOT notify listeners - that happens after full frame completes
    // Do NOT update sequence or frame history
    
    return changes;
  }
  
  /**
   * Finalize a frame by adding it to history and updating sequence
   * Used when deltas have already been applied via applyDeltasDirect
   */
  finalizeFrame(frame: Frame, skipEphemeralCleanup: boolean = false): void {
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
    
    // Update state
    this.state.frameHistory.push(frame);
    this.state.currentSequence = frame.sequence;
    
    // Remove ephemeral facets at end of frame (unless skipped)
    if (!skipEphemeralCleanup) {
      const ephemeralFacets: Array<[string, Facet]> = [];
      for (const [id, facet] of this.state.facets) {
        if ('ephemeral' in facet && facet.ephemeral === true) {
          ephemeralFacets.push([id, facet]);
        }
      }
      
      // Remove ephemeral facets
      for (const [id, facet] of ephemeralFacets) {
        this.state.facets.delete(id);
      }
    }
    
    // Notify listeners
    this.notifyListeners();
  }
  
  /**
   * Clean up ephemeral facets - call this at the end of full frame processing
   */
  cleanupEphemeralFacets(): FacetDelta[] {
    const changes: FacetDelta[] = [];
    const ephemeralFacets: Array<[string, Facet]> = [];
    
    for (const [id, facet] of this.state.facets) {
      if ('ephemeral' in facet && facet.ephemeral === true) {
        ephemeralFacets.push([id, facet]);
      }
    }
    
    // Remove ephemeral facets
    for (const [id, facet] of ephemeralFacets) {
      this.state.facets.delete(id);
      changes.push({
        type: 'removed',
        facet
      });
    }
    
    if (changes.length > 0) {
      this.notifyListeners();
    }
    
    return changes;
  }
  
  applyDelta(operation: VEILOperation, frameSequence?: number, timestamp?: string): FacetDelta | null {
    switch (operation.type) {
      case 'addFacet': {
        const cloned = this.cloneFacet(operation.facet);
        this.state.facets.set(cloned.id, cloned);
        return { type: 'added', facet: cloned };
      }
      case 'changeFacet': {
        const existing = this.state.facets.get(operation.id);
        if (!existing || !operation.changes) {
          return null;
        }

        const updated = this.cloneFacet(existing);

        // Handle content if present
        if ('content' in operation.changes && operation.changes.content !== undefined) {
          (updated as any).content = operation.changes.content;
        }

        // Handle state if present
        if ('state' in operation.changes && operation.changes.state) {
          const previousState = this.isPlainObject((updated as any).state)
            ? (updated as any).state
            : {};
          (updated as any).state = this.deepMergeObjects(
            previousState,
            operation.changes.state as Record<string, any>
          );
        }

        // Handle other object-like fields that should merge deeply
        for (const [key, value] of Object.entries(operation.changes)) {
          if (key === 'state' || key === 'content' || value === undefined) {
            continue;
          }

          const existingValue = (updated as any)[key];
          if (this.isPlainObject(existingValue) && this.isPlainObject(value)) {
            (updated as any)[key] = this.deepMergeObjects(existingValue, value as Record<string, any>);
          }
        }

        // Handle aspect fields
        const aspectKeys = ['agentId', 'agentName', 'streamId', 'streamType', 'scopes'];
        for (const key of aspectKeys) {
          if (key in operation.changes && (operation.changes as any)[key] !== undefined) {
            (updated as any)[key] = (operation.changes as any)[key];
          }
        }

        // Don't clone again - we already preserved what we need
        this.state.facets.set(operation.id, updated);
        return { type: 'changed', facet: updated, oldFacet: existing };
      }
      case 'removeFacet': {
        const existing = this.state.facets.get(operation.id);
        if (!existing) {
          return null;
        }
        this.state.facets.delete(operation.id);
        return { type: 'removed', facet: existing };
      }
      default:
        return null;
    }
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
   * @deprecated Use getState() instead
   * Alias for backward compatibility
   */
  getCurrentState(): Readonly<VEILState> {
    console.warn('getCurrentState() is deprecated. Use getState() instead.');
    return this.getState();
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

  private cloneFacet<T extends Facet>(facet: T): T {
    return JSON.parse(JSON.stringify(facet)) as T;
  }

  private deepMergeObjects<T extends Record<string, any>>(
    target: Record<string, any> | undefined,
    source: Record<string, any>
  ): T {
    const base: Record<string, any> = this.isPlainObject(target) ? { ...target } : {};

    for (const [key, incoming] of Object.entries(source)) {
      if (incoming === undefined) {
        continue;
      }

      if (Array.isArray(incoming)) {
        base[key] = this.cloneArray(incoming);
        continue;
      }

      if (this.isPlainObject(incoming)) {
        const existingValue = this.isPlainObject(base[key]) ? base[key] : undefined;
        base[key] = this.deepMergeObjects(existingValue, incoming);
        continue;
      }

      base[key] = incoming;
    }

    return base as T;
  }

  private cloneArray(values: any[]): any[] {
    return values.map(item => {
      if (this.isPlainObject(item)) {
        return this.deepMergeObjects(undefined, item as Record<string, any>);
      }
      if (Array.isArray(item)) {
        return this.cloneArray(item);
      }
      return item;
    });
  }

  private isPlainObject(value: unknown): value is Record<string, any> {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
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
  
  private analyzeAffectedState(frames: Frame[]): {
    facets: Set<string>;
    warnings: string[];
  } {
    const affected = new Set<string>();
    const warnings: string[] = [];
    
    for (const frame of frames) {
      for (const op of frame.deltas) {
        switch (op.type) {
          case 'addFacet':
            affected.add(op.facet.id);
            if (op.facet.children?.length) {
              warnings.push(
                `Facet ${op.facet.id} has ${op.facet.children.length} children that will also be removed`
              );
            }
            break;
            
          case 'changeFacet':
            if (!this.state.facets.has(op.id)) {
              warnings.push(
                `Change operation on non-existent facet ${op.id} (might have been added in deleted frames)`
              );
            }
            break;
            
          case 'removeFacet':
            warnings.push(`Remove operation for ${op.id} will be undone`);
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
      type: 'deltas' in f ? 
        (f.deltas.some((op: any) => op.type === 'speak' || op.type === 'act') ? 'outgoing' : 'incoming') 
        : 'unknown',
      timestamp: f.timestamp,
      operationCount: f.deltas.length
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
        
        if ('deltas' in frame) {
          const isIncoming = !frame.deltas.some((op: any) => 
            op.type === 'speak' || op.type === 'act'
          );
          
          if (isIncoming) {
            this.applyFrame(frame);
          } else {
            this.applyFrame(frame);
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
