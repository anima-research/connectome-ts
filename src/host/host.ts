/**
 * ConnectomeHost - Core infrastructure for Connectome applications
 */

import { Space } from '../spaces/space';
import { VEILStateManager } from '../veil/veil-state';
import { TransitionManager } from '../persistence/transition-manager';
import { FileStorageAdapter } from '../persistence/file-storage';
import { DebugServer } from '../debug/debug-server';
import { LLMProvider } from '../llm/llm-interface';
import { ComponentRegistry } from '../persistence/component-registry';
import { ConnectomeApplication } from './types';
import { getReferenceMetadata, getExternalMetadata, RestorableComponent } from './decorators';
import { Component } from '../spaces/component';
import { Element } from '../spaces/element';
import { restoreVEILState, restoreElementTree } from '../persistence/restoration';

export interface HostConfig {
  persistence?: {
    enabled: boolean;
    storageDir?: string;
  };
  debug?: {
    enabled: boolean;
    port?: number;
  };
  providers?: {
    [key: string]: LLMProvider;
  };
  secrets?: {
    [key: string]: string;
  };
  reset?: boolean;
}

export class ConnectomeHost {
  private config: HostConfig;
  private referenceRegistry = new Map<string, any>();
  private providers = new Map<string, LLMProvider>();
  private secrets = new Map<string, string>();
  private transitionManager?: TransitionManager;
  private debugServer?: DebugServer;
  private storageAdapter?: FileStorageAdapter;
  
  constructor(config: HostConfig = {}) {
    this.config = config;
    
    // Register providers
    if (config.providers) {
      Object.entries(config.providers).forEach(([id, provider]) => {
        this.providers.set(id, provider);
        this.referenceRegistry.set(`provider:${id}`, provider);
        
        // Also register common names for convenience
        if (id === 'llm.primary') {
          this.referenceRegistry.set('llmProvider', provider);
        }
      });
    }
    
    // Register secrets
    if (config.secrets) {
      Object.entries(config.secrets).forEach(([id, secret]) => {
        this.secrets.set(id, secret);
      });
    }
  }
  
  /**
   * Start a Connectome application
   */
  async start(app: ConnectomeApplication): Promise<Space> {
    console.log('🚀 Starting Connectome Host...');
    
    // Initialize storage if enabled
    if (this.config.persistence?.enabled && !this.config.reset) {
      const storageDir = this.config.persistence.storageDir || './discord-host-state';
      this.storageAdapter = new FileStorageAdapter(storageDir);
    }
    
    // Check for existing snapshot
    const snapshot = await this.loadSnapshot();
    
    let space: Space;
    let veilState: VEILStateManager;
    
    if (snapshot && !this.config.reset) {
      console.log('📦 Restoring from snapshot...');
      ({ space, veilState } = await this.restore(snapshot, app));
    } else {
      console.log('🌱 Creating fresh application...');
      ({ space, veilState } = await this.createFresh(app));
    }
    
    // Core services already registered in createFresh/restore
    
    // Set up persistence tracking if enabled
    if (this.config.persistence?.enabled) {
      this.transitionManager = new TransitionManager(space, veilState, {
        snapshotInterval: 100,
        storagePath: this.config.persistence.storageDir || './discord-host-state'
      });
      
      // Add shutdown handler
      process.on('SIGINT', async () => {
        console.log('\n💾 Saving state before shutdown...');
        await this.transitionManager?.createSnapshot();
        console.log('✅ State saved. Goodbye!');
        process.exit(0);
      });
    }
    
    // Start debug server if enabled
    if (this.config.debug?.enabled) {
      const port = this.config.debug.port || 3000;
      this.debugServer = new DebugServer(space, { port });
      await this.debugServer.start();
      console.log(`🔍 Debug UI available at http://localhost:${port}`);
    }
    
    // Let the application perform final initialization
    await app.onStart?.(space, veilState);
    
    console.log('✅ Host started successfully!\n');
    
    return space;
  }
  
  /**
   * Stop the host and clean up resources
   */
  async stop(): Promise<void> {
    // Save final snapshot
    if (this.transitionManager) {
      await this.transitionManager.createSnapshot();
    }
    
    // Stop debug server
    if (this.debugServer) {
      this.debugServer.stop();
    }
    
    // Clear registries
    this.referenceRegistry.clear();
    this.providers.clear();
    this.secrets.clear();
  }
  
  /**
   * Delete recent frames
   */
  async deleteFrames(count: number): Promise<void> {
    if (!this.transitionManager) {
      throw new Error('Persistence not enabled');
    }
    
    await this.transitionManager.deleteRecentFramesAndSnapshot(count, 'User requested deletion');
  }
  
  /**
   * Create a fresh application instance
   */
  private async createFresh(app: ConnectomeApplication): Promise<{ space: Space; veilState: VEILStateManager }> {
    const { space, veilState } = await app.createSpace();
    
    // Register core services before initialization
    this.referenceRegistry.set('space', space);
    this.referenceRegistry.set('veilState', veilState);
    
    await app.initialize(space, veilState);
    await this.resolveAllReferences(space);
    return { space, veilState };
  }
  
  /**
   * Restore from a persistence snapshot
   */
  private async restore(snapshot: any, app: ConnectomeApplication): Promise<{ space: Space; veilState: VEILStateManager }> {
    // Create space and VEIL state
    const { space, veilState } = await app.createSpace();
    
    // Register core services before restoration
    this.referenceRegistry.set('space', space);
    this.referenceRegistry.set('veilState', veilState);
    
    // Restore VEIL state first
    await restoreVEILState(veilState, snapshot.veilState);
    
    // Restore elements and components
    const registry = app.getComponentRegistry();
    await restoreElementTree(space, snapshot.elements, registry);
    
    // Resolve all references and external resources
    await this.resolveAllReferences(space);
    
    // Let app do any post-restore setup
    await app.onRestore?.(space, veilState);
    
    return { space, veilState };
  }
  
  /**
   * Load persistence snapshot if available
   */
  private async loadSnapshot(): Promise<any | null> {
    if (!this.storageAdapter) return null;
    
    try {
      const snapshots = await this.storageAdapter.listSnapshots();
      if (snapshots.length === 0) return null;
      
      const latest = snapshots[snapshots.length - 1];
      return await this.storageAdapter.loadSnapshot(latest.sequence);
    } catch (error) {
      console.error('Failed to load snapshot:', error);
      return null;
    }
  }
  
  /**
   * Resolve all component references and external resources
   */
  private async resolveAllReferences(space: Space): Promise<void> {
    const components = this.getAllComponents(space);
    
    // First pass: resolve references
    for (const component of components) {
      await this.resolveComponentReferences(component);
    }
    
    // Second pass: resolve external resources
    for (const component of components) {
      await this.resolveExternalResources(component);
    }
    
    // Third pass: notify components
    for (const component of components) {
      const restorable = component as RestorableComponent;
      if (restorable.onReferencesResolved) {
        await restorable.onReferencesResolved();
      }
    }
  }
  
  /**
   * Get all components in the space recursively
   */
  private getAllComponents(element: Element): Component[] {
    const components: Component[] = [...element.components];
    
    for (const child of element.children) {
      components.push(...this.getAllComponents(child));
    }
    
    return components;
  }
  
  /**
   * Resolve references for a component
   */
  private async resolveComponentReferences(component: Component): Promise<void> {
    const references = getReferenceMetadata(component);
    
    for (const ref of references) {
      const target = this.referenceRegistry.get(ref.referenceId!);
      
      if (!target && ref.required) {
        throw new Error(`Required reference '${ref.referenceId}' not found for ${component.constructor.name}`);
      }
      
      if (target) {
        (component as any)[ref.propertyKey] = target;
      }
    }
  }
  
  /**
   * Resolve external resources for a component
   */
  private async resolveExternalResources(component: Component): Promise<void> {
    const externals = getExternalMetadata(component);
    
    console.log(`Resolving ${externals.length} external resources for ${component.constructor.name}`);
    
    for (const ext of externals) {
      const [type, ...pathParts] = ext.resourcePath.split(':');
      const path = pathParts.join(':');
      
      console.log(`  - ${ext.propertyKey}: ${ext.resourcePath}`);
      
      let value: any;
      
      switch (type) {
        case 'secret':
          value = this.secrets.get(path);
          console.log(`    Secret '${path}': ${value ? 'FOUND' : 'NOT FOUND'}`);
          break;
        case 'provider':
          value = this.providers.get(path);
          break;
        default:
          throw new Error(`Unknown external resource type: ${type}`);
      }
      
      if (!value && ext.required) {
        throw new Error(`Required external resource '${ext.resourcePath}' not found for ${component.constructor.name}`);
      }
      
      if (value) {
        (component as any)[ext.propertyKey] = value;
        console.log(`    Injected into ${ext.propertyKey}`);
      }
    }
  }
}
