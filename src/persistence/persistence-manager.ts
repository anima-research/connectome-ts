/**
 * Main persistence manager for handling snapshots and deltas
 */

import { Element } from '../spaces/element';
import { Space } from '../spaces/space';
import { VEILStateManager } from '../veil/veil-state';
import { IncomingVEILFrame, OutgoingVEILFrame } from '../veil/types';
import { SpaceEvent } from '../spaces/types';
import {
  PersistenceConfig,
  PersistenceSnapshot,
  FrameDelta,
  ElementOperation,
  StorageAdapter,
  SerializedElement
} from './types';
import { serializeElement, serializeVEILState } from './serialization';
import { FileStorageAdapter } from './file-storage';

export class PersistenceManager {
  private config: Required<PersistenceConfig>;
  private storage: StorageAdapter;
  private space: Space;
  private veilState: VEILStateManager;
  
  // Tracking
  private lastSnapshotSequence: number = 0;
  private deltassSinceSnapshot: number = 0;
  private elementOperations: ElementOperation[] = [];
  
  constructor(
    space: Space,
    veilState: VEILStateManager,
    config?: PersistenceConfig
  ) {
    this.space = space;
    this.veilState = veilState;
    
    // Apply defaults
    this.config = {
      snapshotInterval: 100,
      maxSnapshots: 10,
      maxDeltasPerSnapshot: 500,
      compressDeltas: true,
      storagePath: './persistence',
      storageAdapter: config?.storageAdapter || new FileStorageAdapter(config?.storagePath || './persistence'),
      enableMemoryCompression: false,
      compressionBatchSize: 50,
      ...config
    };
    
    this.storage = this.config.storageAdapter;
    
    // Subscribe to events
    this.subscribeToEvents();
  }
  
  /**
   * Subscribe to relevant events
   */
  private subscribeToEvents() {
    // Frame events
    this.space.subscribe('frame:start');
    this.space.subscribe('frame:end');
    
    // Element events
    this.space.subscribe('element:mount');
    this.space.subscribe('element:unmount');
    
    // Handle events
    const originalHandleEvent = this.space.handleEvent.bind(this.space);
    this.space.handleEvent = async (event: SpaceEvent) => {
      await this.handleEvent(event);
      return originalHandleEvent(event);
    };
  }
  
  /**
   * Handle space events
   */
  private async handleEvent(event: SpaceEvent) {
    switch (event.topic) {
      case 'frame:end':
        await this.onFrameEnd();
        break;
        
      case 'element:mount':
        // For now, just track the reference - full element serialization happens during snapshot
        console.log('Element mounted:', (event.payload as any).element);
        break;
        
      case 'element:unmount':
        // For now, just track the reference
        console.log('Element unmounted:', (event.payload as any).element);
        break;
    }
  }
  
  /**
   * Track an element operation
   */
  private trackElementOperation(operation: ElementOperation) {
    this.elementOperations.push(operation);
  }
  
  /**
   * Handle frame end - save delta and check for snapshot
   */
  private async onFrameEnd() {
    // Get the current sequence from veilState
    const currentState = this.veilState.getState();
    const sequence = currentState.currentSequence;
    
    // Get the last frame from history
    const frameHistory = currentState.frameHistory;
    if (frameHistory.length === 0) {
      return; // No frames to persist yet
    }
    
    const frame = frameHistory[frameHistory.length - 1];
    
    // Create delta
    const delta: FrameDelta = {
      sequence,
      timestamp: frame.timestamp,
      frame,
      elementOperations: this.elementOperations.length > 0 ? [...this.elementOperations] : undefined
    };
    
    // Clear tracked operations
    this.elementOperations = [];
    
    // Save delta
    await this.storage.saveDelta(delta);
    this.deltassSinceSnapshot++;
    
    // Check if we need a snapshot
    if (this.shouldSnapshot(sequence)) {
      await this.createSnapshot();
    }
  }
  
  /**
   * Check if we should create a snapshot
   */
  private shouldSnapshot(sequence: number): boolean {
    // Force snapshot if too many deltas
    if (this.deltassSinceSnapshot >= this.config.maxDeltasPerSnapshot) {
      return true;
    }
    
    // Regular interval snapshot
    if (sequence - this.lastSnapshotSequence >= this.config.snapshotInterval) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Create a persistence snapshot
   */
  async createSnapshot(): Promise<PersistenceSnapshot> {
    const veilState = this.veilState.getState();
    
    const snapshot: PersistenceSnapshot = {
      version: 1,
      timestamp: new Date().toISOString(),
      sequence: veilState.currentSequence,
      veilState: serializeVEILState(veilState),
      elementTree: serializeElement(this.space),
      metadata: {
        spaceId: this.space.id,
        spaceName: this.space.name
      }
    };
    
    // TODO: Add compressed frame batches if memory compression is enabled
    
    await this.storage.saveSnapshot(snapshot);
    
    // Update tracking
    this.lastSnapshotSequence = snapshot.sequence;
    this.deltassSinceSnapshot = 0;
    
    // Emit event
    this.space.emit({
      topic: 'persistence:snapshot-created',
      source: this.space.getRef(),
      payload: { snapshot },
      timestamp: Date.now()
    });
    
    return snapshot;
  }
  
  /**
   * Restore from persistence
   */
  async restore(snapshotId?: string): Promise<void> {
    try {
      // Get latest snapshot if not specified
      if (!snapshotId) {
        const snapshots = await this.storage.listSnapshots();
        if (snapshots.length === 0) {
          throw new Error('No snapshots available');
        }
        snapshotId = snapshots[snapshots.length - 1];
      }
      
      // Load snapshot
      const snapshot = await this.storage.loadSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }
      
      // Restore VEIL state
      await this.restoreVEILState(snapshot);
      
      // Restore element tree
      await this.restoreElementTree(snapshot);
      
      // Apply deltas since snapshot
      const deltas = await this.storage.loadDeltas(snapshot.sequence + 1);
      for (const delta of deltas) {
        await this.applyDelta(delta);
      }
      
      // Update tracking
      this.lastSnapshotSequence = this.veilState.getState().currentSequence;
      
      // Emit event
      this.space.emit({
        topic: 'persistence:restore-complete',
        source: this.space.getRef(),
        payload: { sequence: this.veilState.getState().currentSequence },
        timestamp: Date.now()
      });
      
    } catch (error) {
      this.space.emit({
        topic: 'persistence:error',
        source: this.space.getRef(),
        payload: { error: error as Error, operation: 'restore' },
        timestamp: Date.now()
      });
      throw error;
    }
  }
  
  /**
   * Restore VEIL state from snapshot
   */
  private async restoreVEILState(snapshot: PersistenceSnapshot) {
    // This is a simplified version - full implementation would need
    // to properly deserialize facets and reconstruct the state
    
    // For now, we'll need to add a method to VEILStateManager to
    // restore from a serialized state
    console.warn('VEIL state restoration not yet implemented');
  }
  
  /**
   * Restore element tree from snapshot  
   */
  private async restoreElementTree(snapshot: PersistenceSnapshot) {
    // This is a simplified version - full implementation would need
    // to properly reconstruct the element tree with components
    
    console.warn('Element tree restoration not yet implemented');
  }
  
  /**
   * Apply a delta to the current state
   */
  private async applyDelta(delta: FrameDelta) {
    // Apply frame
    if ('activeStream' in delta.frame) {
      // Incoming frame
      await this.veilState.applyIncomingFrame(delta.frame as IncomingVEILFrame);
    } else {
      // Outgoing frame
      this.veilState.recordOutgoingFrame(delta.frame as OutgoingVEILFrame);
    }
    
    // Apply element operations
    if (delta.elementOperations) {
      for (const op of delta.elementOperations) {
        await this.applyElementOperation(op);
      }
    }
  }
  
  /**
   * Apply an element operation
   */
  private async applyElementOperation(op: ElementOperation) {
    // This would need to be implemented to actually modify the element tree
    console.warn('Element operation application not yet implemented:', op.type);
  }
  
  /**
   * Get persistence status
   */
  async getStatus() {
    const snapshots = await this.storage.listSnapshots();
    const currentSequence = this.veilState.getState().currentSequence;
    
    return {
      snapshots: snapshots.length,
      lastSnapshot: this.lastSnapshotSequence,
      currentSequence,
      deltassSinceSnapshot: this.deltassSinceSnapshot,
      nextSnapshotAt: this.lastSnapshotSequence + this.config.snapshotInterval
    };
  }
}
