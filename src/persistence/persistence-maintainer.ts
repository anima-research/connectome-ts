import { ReadonlyVEILState, SpaceEvent, FacetDelta } from '../spaces/receptor-effector-types';
import { BaseMaintainer } from '../components/base-martem';
import { VEILStateManager } from '../veil/veil-state';
import { FileStorageAdapter } from './file-storage';
import { FrameDelta, PersistenceSnapshot, ElementOperation } from './types';
import { serializeVEILState } from './serialization';
import { Frame } from '../veil/types';

export interface PersistenceMaintainerConfig {
  storagePath: string;
  snapshotInterval?: number; // Default: every 100 frames
  maxDeltasPerFile?: number; // Default: 1000
}

/**
 * Maintainer that handles persistence of VEIL state
 * Runs in Phase 4 after all other processing is complete
 */
export class PersistenceMaintainer extends BaseMaintainer {
  private storage: FileStorageAdapter;
  private lastSnapshotSequence: number = 0;
  private elementOperations: ElementOperation[] = [];
  
  constructor(
    private veilState: VEILStateManager,
    private config: PersistenceMaintainerConfig
  ) {
    super();
    this.storage = new FileStorageAdapter(config.storagePath);
  }
  
  async process(frame: Frame, changes: FacetDelta[], state: ReadonlyVEILState): Promise<SpaceEvent[]> {
    // Save the frame delta
    this.saveDelta(frame, frame.sequence).catch(err => {
      console.error('[PersistenceMaintainer] Failed to save delta:', err);
    });
    
    // Check if we need a snapshot
    const snapshotInterval = this.config.snapshotInterval || 100;
    if (frame.sequence - this.lastSnapshotSequence >= snapshotInterval) {
      this.createSnapshot(frame.sequence).catch(err => {
        console.error('[PersistenceMaintainer] Failed to create snapshot:', err);
      });
      this.lastSnapshotSequence = frame.sequence;
    }
    
    // Clear element operations after snapshot
    if (this.elementOperations.length > 0 && frame.sequence % snapshotInterval === 0) {
      this.elementOperations = [];
    }
    
    return []; // No events to emit
  }
  
  private async saveDelta(frame: Frame, sequence: number): Promise<void> {
    const delta: FrameDelta = {
      sequence,
      timestamp: frame.timestamp,
      frame,
      elementOperations: [...this.elementOperations]
    };
    
    // Save using the storage adapter
    await this.storage.saveDelta(delta);
  }
  
  private async createSnapshot(sequence: number): Promise<void> {
    // Get the full state
    const state = this.veilState.getState();
    
    // Create snapshot
    const snapshot: PersistenceSnapshot = {
      version: 1,
      timestamp: new Date().toISOString(),
      sequence,
      veilState: serializeVEILState(state),
      elementTree: {
        id: 'root',
        name: 'root',
        type: 'Space',
        active: true,
        subscriptions: [],
        components: [],
        children: []
      }, // TODO: Serialize actual element tree when available
      metadata: {
        facetCount: state.facets.size,
        streamCount: state.streams.size,
        agentCount: state.agents.size
      }
    };
    
    // Save snapshot
    await this.storage.saveSnapshot(snapshot);
    
    this.lastSnapshotSequence = sequence;
    console.log(`[PersistenceMaintainer] Created snapshot at sequence ${sequence}`);
  }
}
