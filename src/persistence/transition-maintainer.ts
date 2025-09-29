import { Maintainer, ReadonlyVEILState, SpaceEvent } from '../spaces/receptor-effector-types';
import { TransitionNode } from './transition-types';
import { VEILStateManager } from '../veil/veil-state';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface TransitionConfig {
  storagePath: string;
  snapshotInterval?: number; // Default: every 50 transitions
}

/**
 * Maintainer that tracks frame transitions for time-travel debugging
 * Runs in Phase 4 after all other processing is complete
 */
export class TransitionMaintainer implements Maintainer {
  private currentBranch: string = 'main';
  private transitionsSinceSnapshot: number = 0;
  
  constructor(
    private veilState: VEILStateManager,
    private config: TransitionConfig
  ) {
    this.initializeStorage();
  }
  
  maintain(state: ReadonlyVEILState): SpaceEvent[] {
    // Get the last frame which contains the transition
    const frameHistory = state.frameHistory;
    if (frameHistory.length === 0) {
      return [];
    }
    
    const lastFrame = frameHistory[frameHistory.length - 1];
    if (!lastFrame.transition) {
      return [];
    }
    
    const transition = lastFrame.transition;
    
    // Create transition node
    const node: TransitionNode = {
      sequence: transition.sequence,
      parentSequence: transition.sequence - 1,  // Linear for now
      branchName: this.currentBranch,
      transition
    };
    
    // Save transition
    this.saveTransition(node).catch(err => {
      console.error('[TransitionMaintainer] Failed to save transition:', err);
    });
    
    this.transitionsSinceSnapshot++;
    
    // Check if we need a snapshot
    const snapshotInterval = this.config.snapshotInterval || 50;
    if (this.transitionsSinceSnapshot >= snapshotInterval) {
      this.createSnapshot(transition.sequence).catch(err => {
        console.error('[TransitionMaintainer] Failed to create snapshot:', err);
      });
    }
    
    return []; // No events to emit
  }
  
  private async initializeStorage(): Promise<void> {
    try {
      // Ensure storage directories exist
      await fs.mkdir(this.config.storagePath, { recursive: true });
      await fs.mkdir(path.join(this.config.storagePath, 'transitions', this.currentBranch), { recursive: true });
      await fs.mkdir(path.join(this.config.storagePath, 'snapshots', this.currentBranch), { recursive: true });
      
      // Load or create manifest
      const manifestPath = path.join(this.config.storagePath, 'manifest.json');
      try {
        const manifestData = await fs.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestData);
        this.currentBranch = manifest.currentBranch || 'main';
      } catch {
        // Create initial manifest
        await fs.writeFile(manifestPath, JSON.stringify({
          version: '1.0',
          currentBranch: this.currentBranch,
          branches: {
            [this.currentBranch]: {
              created: new Date().toISOString(),
              parentBranch: null,
              branchPoint: 0
            }
          }
        }, null, 2));
      }
    } catch (err) {
      console.error('[TransitionMaintainer] Failed to initialize storage:', err);
    }
  }
  
  private async saveTransition(node: TransitionNode): Promise<void> {
    const filePath = path.join(this.config.storagePath, 'transitions', this.currentBranch, `${node.sequence}.json`);
    await fs.writeFile(filePath, JSON.stringify(node, null, 2));
  }
  
  private async createSnapshot(sequence: number): Promise<void> {
    // Get current state
    const state = this.veilState.getState();
    
    // Save snapshot
    const snapshotPath = path.join(this.config.storagePath, 'snapshots', this.currentBranch, `${sequence}.json`);
    await fs.writeFile(snapshotPath, JSON.stringify({
      sequence,
      timestamp: new Date().toISOString(),
      facetCount: state.facets.size,
      streamCount: state.streams.size,
      agentCount: state.agents.size,
      // We don't save full state here - that's PersistenceMaintainer's job
      // This is just for transition tracking
    }, null, 2));
    
    this.transitionsSinceSnapshot = 0;
    console.log(`[TransitionMaintainer] Created snapshot at sequence ${sequence}`);
  }
}
