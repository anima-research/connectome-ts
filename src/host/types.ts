/**
 * Types for the Host system
 */

import { Space } from '../spaces/space';
import { VEILStateManager } from '../veil/veil-state';
import { ComponentRegistry } from '../persistence/component-registry';

/**
 * Interface that applications must implement
 */
export interface ConnectomeApplication {
  /**
   * Create the Space and VEILStateManager
   * Called for both fresh starts and restoration
   * @param hostRegistry - The host's reference registry (optional for backwards compatibility)
   */
  createSpace(hostRegistry?: Map<string, any>): Promise<{ space: Space; veilState: VEILStateManager }>;
  
  /**
   * Initialize the space with elements and components
   * Only called for fresh starts
   */
  initialize(space: Space, veilState: VEILStateManager): Promise<void>;
  
  /**
   * Get the component registry for restoration
   */
  getComponentRegistry(): typeof ComponentRegistry;
  
  /**
   * Called after successful startup (fresh or restored)
   */
  onStart?(space: Space, veilState: VEILStateManager): Promise<void>;
  
  /**
   * Called after restoration completes
   * Use this for any post-restore setup
   */
  onRestore?(space: Space, veilState: VEILStateManager): Promise<void>;
}
