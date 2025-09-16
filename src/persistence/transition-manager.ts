/**
 * Transition-based persistence manager
 * Saves frame transitions as deltas and periodic snapshots for efficient restoration
 */

import { Space } from '../spaces/space';
import { Element } from '../spaces/element';
import { VEILStateManager } from '../veil/veil-state';
import { SpaceEvent, FrameEndEvent, ElementRef } from '../spaces/types';
import { IncomingVEILFrame } from '../veil/types';
import {
  FrameTransition,
  TransitionNode,
  TransitionSnapshot,
  TransitionApplicator,
  SnapshotProvider,
  ElementOperation,
  ComponentOperation,
  ComponentChange
} from './transition-types';
import { FileStorageAdapter } from './file-storage';
import { serializeElement, serializeVEILState } from './serialization';
import { restoreElementTree, restoreVEILState } from './restoration';
import { ComponentRegistry } from './component-registry';

interface TransitionManagerConfig {
  snapshotInterval?: number;  // Frames between snapshots (default: 100)
  storagePath?: string;
  enableBranching?: boolean;  // Enable timeline branching (default: false)
}

export class TransitionManager {
  private space: Space;
  private veilState: VEILStateManager;
  private config: Required<TransitionManagerConfig>;
  private storage: FileStorageAdapter;
  
  // Tracking
  private lastSnapshotSequence: number = 0;
  private transitionsSinceSnapshot: number = 0;
  private currentBranch: string = 'main';
  
  constructor(
    space: Space,
    veilState: VEILStateManager,
    config?: TransitionManagerConfig
  ) {
    this.space = space;
    this.veilState = veilState;
    
    this.config = {
      snapshotInterval: 100,
      storagePath: './persistence',
      enableBranching: false,
      ...config
    };
    
    console.log('[TransitionManager] Creating storage with path:', this.config.storagePath);
    this.storage = new FileStorageAdapter(this.config.storagePath);
    
    // Subscribe to frame:end events
    this.subscribeToEvents();
  }
  
  private subscribeToEvents() {
    // Intercept handleEvent to capture transitions
    const originalHandleEvent = this.space.handleEvent.bind(this.space);
    this.space.handleEvent = async (event: SpaceEvent) => {
      if (event.topic === 'frame:end') {
        await this.onFrameEnd(event as FrameEndEvent);
      }
      return originalHandleEvent(event);
    };
  }
  
  /**
   * Handle frame end - save transition
   */
  private async onFrameEnd(event: FrameEndEvent) {
    // Get the transition from the current frame
    const frame = (this.space as any).currentFrame;
    if (!frame?.transition) return;
    
    const transition = frame.transition;
    
    // Create transition node
    const node: TransitionNode = {
      sequence: transition.sequence,
      parentSequence: transition.sequence - 1,  // Linear for now
      branchName: this.currentBranch,
      transition
    };
    
    // Save transition
    await this.saveTransition(node);
    
    this.transitionsSinceSnapshot++;
    
    // Check if we need a snapshot
    if (this.shouldSnapshot(transition.sequence)) {
      await this.createSnapshot(transition.sequence);
    }
  }
  
  /**
   * Save a transition node
   */
  private async saveTransition(node: TransitionNode) {
    const filename = `transition-${node.sequence}-${this.currentBranch}.json`;
    await this.storage.writeFile(
      `transitions/${filename}`,
      JSON.stringify(node, null, 2)
    );
  }
  
  /**
   * Check if we should create a snapshot
   */
  private shouldSnapshot(sequence: number): boolean {
    return sequence - this.lastSnapshotSequence >= this.config.snapshotInterval;
  }
  
  /**
   * Create a snapshot
   */
  async createSnapshot(sequence?: number): Promise<TransitionSnapshot> {
    const currentSequence = sequence || this.veilState.getState().currentSequence;
    
    const snapshot: TransitionSnapshot = {
      sequence: currentSequence,
      timestamp: new Date().toISOString(),
      branchName: this.currentBranch,
      elementTree: serializeElement(this.space),
      componentStates: this.serializeAllComponents(),
      veilState: serializeVEILState(this.veilState.getState())
    };
    
    // Save snapshot
    const filename = `snapshot-${currentSequence}-${this.currentBranch}.json`;
    await this.storage.writeFile(
      `snapshots/${filename}`,
      JSON.stringify(snapshot, null, 2)
    );
    
    this.lastSnapshotSequence = currentSequence;
    this.transitionsSinceSnapshot = 0;
    
    console.log(`Created snapshot at sequence ${currentSequence}`);
    return snapshot;
  }
  
  /**
   * Serialize all component states
   */
  private serializeAllComponents(): any {
    // TODO: Implement component state serialization
    // This would walk the element tree and serialize all persistent component properties
    return {};
  }
  
  /**
   * Restore from a specific sequence
   */
  async restore(targetSequence?: number, branch: string = 'main'): Promise<void> {
    // Find the nearest snapshot
    console.log('[TransitionManager] Looking for snapshots in snapshots/ directory');
    const snapshots = await this.storage.listFiles('snapshots/');
    console.log('[TransitionManager] Found files:', snapshots);
    const branchSnapshots = snapshots
      .filter(f => f.includes(`-${branch}.json`))
      .sort();
    console.log('[TransitionManager] Branch snapshots:', branchSnapshots);
    
    if (branchSnapshots.length === 0) {
      throw new Error(`No snapshots found for branch ${branch}`);
    }
    
    // Find the best snapshot to start from
    let snapshotFile = branchSnapshots[branchSnapshots.length - 1];  // Latest by default
    if (targetSequence !== undefined) {
      // Find the latest snapshot before target
      for (const file of branchSnapshots.reverse()) {
        const match = file.match(/snapshot-(\d+)-/);
        if (match && parseInt(match[1]) <= targetSequence) {
          snapshotFile = file;
          break;
        }
      }
    }
    
    // Load and apply snapshot
    const snapshotData = await this.storage.readFile(`snapshots/${snapshotFile}`);
    const snapshot = JSON.parse(snapshotData) as TransitionSnapshot;
    
    console.log(`Restoring from snapshot at sequence ${snapshot.sequence}`);
    await this.applySnapshot(snapshot);
    
    // Apply transitions from snapshot to target
    const transitions = await this.loadTransitions(
      snapshot.sequence + 1,
      targetSequence,
      branch
    );
    
    for (const transition of transitions) {
      await this.applyTransition(transition);
    }
    
    console.log(`Restored to sequence ${targetSequence || transitions[transitions.length - 1]?.sequence || snapshot.sequence}`);
  }
  
  /**
   * Load transitions in a range
   */
  private async loadTransitions(
    fromSequence: number,
    toSequence?: number,
    branch: string = 'main'
  ): Promise<TransitionNode[]> {
    const files = await this.storage.listFiles('transitions/');
    const transitions: TransitionNode[] = [];
    
    for (const file of files) {
      const match = file.match(/transition-(\d+)-(.+)\.json/);
      if (!match || match[2] !== branch) continue;
      
      const sequence = parseInt(match[1]);
      if (sequence < fromSequence) continue;
      if (toSequence !== undefined && sequence > toSequence) continue;
      
      const data = await this.storage.readFile(`transitions/${file}`);
      transitions.push(JSON.parse(data));
    }
    
    return transitions.sort((a, b) => a.sequence - b.sequence);
  }
  
  /**
   * Apply a snapshot
   */
  private async applySnapshot(snapshot: TransitionSnapshot) {
    console.log(`Applying snapshot from sequence ${snapshot.sequence}`);
    
    // Clear current state
    // Remove all children from space except built-in ones
    const children = [...this.space.children];
    for (const child of children) {
      if (child.name !== 'root') {
        this.space.removeChild(child);
      }
    }
    
    // Restore VEIL state
    if (snapshot.veilState) {
      await restoreVEILState(this.veilState, snapshot.veilState);
    }
    
    // Restore element tree
    if (snapshot.elementTree) {
      await restoreElementTree(this.space, snapshot.elementTree);
    }
    
    // Component states are restored as part of element tree restoration
    console.log('Snapshot applied successfully');
  }
  
  /**
   * Apply a single transition
   */
  private async applyTransition(node: TransitionNode) {
    const transition = node.transition;
    
    // Apply element operations
    for (const op of transition.elementOps) {
      await this.applyElementOperation(op);
    }
    
    // Apply component operations
    for (const op of transition.componentOps) {
      await this.applyComponentOperation(op);
    }
    
    // Apply component changes
    for (const change of transition.componentChanges) {
      await this.applyComponentChange(change);
    }
    
    // Apply VEIL operations by creating a frame
    if (transition.veilOps.length > 0) {
      const frame = {
        sequence: transition.sequence,
        timestamp: transition.timestamp,
        operations: transition.veilOps
      };
      this.veilState.applyIncomingFrame(frame);
    }
    
    console.log(`Applied transition ${transition.sequence}`);
  }
  
  /**
   * Apply an element operation
   */
  private async applyElementOperation(op: ElementOperation) {
    switch (op.type) {
      case 'add-element':
        // Find parent
        const parent = this.findElementByRef(op.parentRef) || this.space;
        
        // Create element
        const element = new Element(op.element.name, op.element.type);
        
        // Add to parent
        parent.addChild(element);
        break;
        
      case 'remove-element':
        const elementToRemove = this.findElementByRef(op.elementRef);
        if (elementToRemove && elementToRemove.parent) {
          elementToRemove.parent.removeChild(elementToRemove);
        }
        break;
        
      case 'move-element':
        const elementToMove = this.findElementByRef(op.elementRef);
        const newParent = this.findElementByRef(op.newParentRef);
        if (elementToMove && newParent) {
          elementToMove.parent?.removeChild(elementToMove);
          newParent.addChild(elementToMove);
        }
        break;
        
      case 'update-element':
        const elementToUpdate = this.findElementByRef(op.elementRef);
        if (elementToUpdate && op.changes.active !== undefined) {
          elementToUpdate.active = op.changes.active;
        }
        break;
    }
  }
  
  /**
   * Apply a component operation
   */
  private async applyComponentOperation(op: ComponentOperation) {
    switch (op.type) {
      case 'add-component':
        const element = this.findElementByRef(op.elementRef);
        if (element) {
          const component = ComponentRegistry.create(op.componentClass);
          if (component) {
            element.addComponent(component);
            // Restore initial state if provided
            if (op.initialState) {
              Object.assign(component, op.initialState);
            }
          } else {
            console.warn(`Component not found in registry: ${op.componentClass}`);
          }
        }
        break;
        
      case 'remove-component':
        const el = this.findElementByRef(op.elementRef);
        if (el) {
          const component = el.components[op.componentIndex];
          if (component) {
            el.removeComponent(component);
          }
        }
        break;
    }
  }
  
  /**
   * Apply a component property change
   */
  private async applyComponentChange(change: ComponentChange) {
    const element = this.findElementByRef(change.elementRef);
    if (!element) return;
    
    const component = element.components[change.componentIndex];
    if (!component) return;
    
    // Set the property value
    (component as any)[change.property] = change.newValue;
  }
  
  /**
   * Find element by reference
   */
  private findElementByRef(ref: ElementRef): Element | null {
    return this.findElementByPath(this.space, ref.elementPath);
  }
  
  /**
   * Find element by path
   */
  private findElementByPath(root: Element, path: string[]): Element | null {
    if (path.length === 0) return root;
    
    const [first, ...rest] = path;
    if (root.name === first) {
      return this.findElementByPath(root, rest);
    }
    
    for (const child of root.children) {
      const found = this.findElementByPath(child, path);
      if (found) return found;
    }
    
    return null;
  }
  
  /**
   * Create a new branch from current state
   */
  async branch(branchName: string): Promise<void> {
    if (!this.config.enableBranching) {
      throw new Error('Branching is not enabled');
    }
    
    const currentSequence = this.veilState.getState().currentSequence;
    
    // Create a snapshot at branch point
    const snapshot = await this.createSnapshot(currentSequence);
    snapshot.branchName = branchName;
    
    // Save as new branch snapshot
    const filename = `snapshot-${currentSequence}-${branchName}.json`;
    await this.storage.writeFile(
      `snapshots/${filename}`,
      JSON.stringify(snapshot, null, 2)
    );
    
    this.currentBranch = branchName;
    console.log(`Created branch ${branchName} at sequence ${currentSequence}`);
  }
  
  /**
   * Switch to a different branch
   */
  async checkout(branchName: string, sequence?: number): Promise<void> {
    if (!this.config.enableBranching) {
      throw new Error('Branching is not enabled');
    }
    
    await this.restore(sequence, branchName);
    this.currentBranch = branchName;
  }
}
