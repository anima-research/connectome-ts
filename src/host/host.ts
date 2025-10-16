/**
 * ConnectomeHost - Core infrastructure for Connectome applications
 */

import { Space } from '../spaces/space';
import { VEILStateManager } from '../veil/veil-state';
import { TransitionManager } from '../persistence/transition-manager';
import { PersistenceMaintainer } from '../persistence/persistence-maintainer';
import { FileStorageAdapter } from '../persistence/file-storage';
import { DebugServer } from '../debug/debug-server';
import { LLMProvider } from '../llm/llm-interface';
import { ComponentRegistry } from '../persistence/component-registry';
import { ConnectomeApplication } from './types';
import { getReferenceMetadata, getExternalMetadata, RestorableComponent } from './decorators';
import { Component } from '../spaces/component';
import { Element } from '../spaces/element';
import { SpaceEvent } from '../spaces/types';
import { restoreVEILState, restoreElementTree } from '../persistence/restoration';

export interface HostConfig {
  persistence?: {
    enabled: boolean;
    storageDir?: string;
    snapshotInterval?: number;  // Frames between snapshots (default: 100)
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
  private storageAdapter?: any;  // FileStorageAdapter instance
  private debugServer?: DebugServer;
  
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
        console.log(`[Host] Registered secret: ${id} = ${secret ? '***' + secret.slice(-4) : 'undefined'}`);
      });
    }
  }
  
  /**
   * Start a Connectome application
   */
  async start(app: ConnectomeApplication): Promise<Space> {
    console.log('🚀 Starting Connectome Host...');
    
    // Handle storage initialization and reset
    if (this.config.persistence?.enabled) {
      const storageDir = this.config.persistence.storageDir || './connectome-state';
      this.storageAdapter = new FileStorageAdapter(storageDir);
      
      // Clear storage on --reset to start completely fresh
      if (this.config.reset) {
        console.log('🗑️  Clearing persistence storage (--reset flag)...');
        await this.storageAdapter.clear();
        console.log('✅ Storage cleared - starting fresh lifecycle');
      }
    }
    
    let space: Space;
    let veilState: VEILStateManager;
    
    try {
      // Check for existing snapshot
      const snapshot = await this.loadSnapshot();
      
      if (snapshot && !this.config.reset) {
        console.log('📦 Restoring from snapshot...');
        ({ space, veilState } = await this.restore(snapshot, app));
      } else {
        console.log('🌱 Creating fresh application...');
        ({ space, veilState } = await this.createFresh(app));
      }
    } catch (error) {
      // If persistence is enabled and loading failed, this is a fatal error
      if (this.config.persistence?.enabled && !this.config.reset) {
        console.error('❌ Failed to load persisted state:', error);
        console.error('💥 Persistence loading failed - exiting to prevent data loss');
        throw error;
      }
      // If persistence is not enabled, we can continue with fresh state
      console.log('🌱 Creating fresh application...');
      ({ space, veilState } = await this.createFresh(app));
    }
    
    // Core services already registered in createFresh/restore
    
    // Set up persistence tracking if enabled
    if (this.config.persistence?.enabled) {
      // Create storage adapter (reused for loading deltas)
      this.storageAdapter = new (await import('../persistence/file-storage')).FileStorageAdapter(
        this.config.persistence.storageDir || './connectome-state'
      );
      
      // Mount persistence maintainer (auto-registration handles the rest!)
      const persistenceMaintainer = new PersistenceMaintainer(veilState, space, {
        storagePath: this.config.persistence.storageDir || './connectome-state',
        snapshotInterval: this.config.persistence.snapshotInterval || 100
      });
      // Just mount - auto-registration happens automatically
      await space.addComponentAsync(persistenceMaintainer);
      
      // TODO: TransitionManager disabled - using PersistenceMaintainer instead
      // this.transitionManager = new TransitionManager(space, veilState, {
      //   snapshotInterval: this.config.persistence.snapshotInterval || 100,
      //   storagePath: this.config.persistence.storageDir || './connectome-state'
      // });
      
      // Note: Shutdown handler should be added by the application, not here
      // to avoid duplicate handlers
    }
    
    // Start debug server if enabled
    if (this.config.debug?.enabled) {
      const port = this.config.debug.port || 3015;
      this.debugServer = new DebugServer(space, { port });
      await this.debugServer.start();
      console.log(`🔍 Debug UI available at http://localhost:${port}`);
    }
    
    // Set up dynamic component handler
    this.setupDynamicComponentHandler(space);
    
    // Let the application perform final initialization
    await app.onStart?.(space, veilState);
    
    console.log('✅ Host started successfully!\n');
    
    return space;
  }
  
  /**
   * Stop the host and clean up resources
   */
  async stop(): Promise<void> {
    // Save final snapshot (the write lock in TransitionManager will prevent duplicates)
    console.log('\n💾 Saving state before shutdown...');
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
    const { space, veilState } = await app.createSpace(this.referenceRegistry);
    
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
    // Create space and VEIL state, preserving lifecycleId and spaceId from snapshot
    const { space, veilState } = await app.createSpace(this.referenceRegistry, snapshot.lifecycleId, snapshot.spaceId);
    
    // Register core services before restoration
    this.referenceRegistry.set('space', space);
    this.referenceRegistry.set('veilState', veilState);
    
    // Set up dynamic component handler BEFORE restoring elements
    // This ensures it's ready to handle events from AxonLoader
    this.setupDynamicComponentHandler(space);
    
    // Enter restoration mode - suppress event processing
    space.setRestorationMode(true);
    
    // Restore VEIL state from snapshot
    await restoreVEILState(veilState, snapshot.veilState);
    
    // Restore elements and components from snapshot
    const registry = app.getComponentRegistry();
    await restoreElementTree(space, snapshot.elementTree);
    
    const afterTreeState = veilState.getState();
    console.log(`[Host] After element tree restore: currentSeq=${afterTreeState.currentSequence}, frameCount=${afterTreeState.frameHistory.length}`);
    
    // Check state immediately before persistence check
    const beforePersistCheck = veilState.getState();
    console.log(`[Host] Before persistence check: currentSeq=${beforePersistCheck.currentSequence}`);
    
    // Load and replay deltas since the snapshot (filtered by lifecycleId)
    // Deltas are replayed synchronously in order, no event processing
    if (this.config.persistence?.enabled && this.storageAdapter) {
      const beforeLoadDeltas = veilState.getState();
      console.log(`[Host] Right before loadDeltas: currentSeq=${beforeLoadDeltas.currentSequence}`);
      
      const deltas = await this.storageAdapter.loadDeltas(
        snapshot.sequence + 1, 
        undefined, 
        snapshot.lifecycleId
      );
      
      if (deltas.length > 0) {
        const preReplayState = veilState.getState();
        const maxFrameInHistory = preReplayState.frameHistory.length > 0
          ? Math.max(...preReplayState.frameHistory.map((f: any) => f.sequence))
          : 0;
        console.log(`📼 Replaying ${deltas.length} deltas since snapshot (sequence ${snapshot.sequence})...`);
        console.log(`[Host] Before replay: currentSeq=${preReplayState.currentSequence}, maxFrame=${maxFrameInHistory}, frameCount=${preReplayState.frameHistory.length}`);
        
        // Replay each delta frame synchronously to VEIL
        // This updates facets and frameHistory, but doesn't trigger events
        for (const delta of deltas) {
          console.log(`[Host] Applying delta ${delta.sequence}, frame ${delta.frame.sequence}, current: ${veilState.getState().currentSequence}`);
          // applyFrame updates VEIL state synchronously
          const changes = veilState.applyFrame(delta.frame);
          console.log(`[Host] Applied ${changes.length} changes: ${changes.map(c => `${c.type}:${(c as any).facet?.type || 'unknown'}`).join(', ')}`);
          // Changes are returned but not processed - no receptors/effectors run
        }
        
        const finalSequence = veilState.getState().currentSequence;
        console.log(`✅ Replayed deltas, now at sequence ${finalSequence}`);
      }
    }
    
    // Reconstruct element tree from all element-tree facets in VEIL
    // This includes both snapshot elements and any created in deltas
    await this.reconstructElementsFromVEIL(space, veilState);
    
    // Exit restoration mode - allow normal event processing to resume
    space.setRestorationMode(false);
    
    console.log('✅ All components restored and mounted');
    
    // Now resolve all references and external resources after components are ready
    await this.resolveAllReferences(space);
    
    // Check for any dynamically loaded components that need resources resolved
    // This handles components loaded by AxonLoader during restoration
    await this.resolveDynamicComponents(space);
    
    // Let app do any post-restore setup
    await app.onRestore?.(space, veilState);
    
    // Complete mounting for all restored components now that external services are ready
    console.log('🔧 Completing component mounting after restoration...');
    await space.completeMountForRestoration();
    
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
      
      console.log(`[Host] Found ${snapshots.length} snapshots, selecting newest:`);
      console.log(`[Host] Loading snapshot: ${snapshots[snapshots.length - 1]}`);
      
      const latest = snapshots[snapshots.length - 1];
      const snapshot = await this.storageAdapter.loadSnapshot(latest);
      
      // If we have snapshots but they're invalid, we should fail
      if (!snapshot) {
        throw new Error(`Failed to load snapshot ${latest}: Invalid snapshot structure`);
      }
      
      return snapshot;
    } catch (error) {
      console.error('Failed to load snapshot:', error);
      
      // Re-throw the error to prevent falling back to fresh application
      throw error;
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
  
  /**
   * Resolve resources for any dynamically loaded components
   */
  private async resolveDynamicComponents(space: Space): Promise<void> {
    console.log('[Host] Checking for dynamically loaded components needing resources...');
    // Find all components that might need external resources
    const checkElement = async (element: Element) => {
      console.log(`[Host] Checking element: ${element.name} (${element.id}) with ${element.components.length} components`);
      for (const component of element.components) {
        console.log(`[Host]   - Component: ${component.constructor.name}`);
        
        // Special handling for AxonLoader - check if it has a loaded component
        if (component.constructor.name === 'AxonLoaderComponent') {
          const axonLoader = component as any;
          if (axonLoader.loadedComponent) {
            console.log(`[Host]     AxonLoader has loaded component: ${axonLoader.loadedComponent.constructor.name}`);
            // Also check the loaded component
            const loadedExternals = getExternalMetadata(axonLoader.loadedComponent);
            if (loadedExternals.length > 0) {
              console.log(`[Host]     Loaded component has ${loadedExternals.length} external resources`);
              let needsResolution = false;
              for (const ext of loadedExternals) {
                if (!(axonLoader.loadedComponent as any)[ext.propertyKey]) {
                  needsResolution = true;
                  console.log(`[Host]       Missing: ${ext.propertyKey} (${ext.resourcePath})`);
                }
              }
              
              if (needsResolution) {
                console.log(`🔌 Resolving resources for dynamically loaded: ${axonLoader.loadedComponent.constructor.name}`);
                await this.resolveComponentReferences(axonLoader.loadedComponent);
                await this.resolveExternalResources(axonLoader.loadedComponent);
                
                // Call onReferencesResolved if it exists
                if ('onReferencesResolved' in axonLoader.loadedComponent && 
                    typeof axonLoader.loadedComponent.onReferencesResolved === 'function') {
                  axonLoader.loadedComponent.onReferencesResolved();
                }
              }
            }
          } else {
            console.log(`[Host]     AxonLoader has not loaded any component yet`);
          }
        }
        // Check if this component has external resources that haven't been resolved
        const externals = getExternalMetadata(component);
        if (externals.length > 0) {
          console.log(`[Host]     Has ${externals.length} external resources`);
          // Check if any required externals are missing
          let needsResolution = false;
          for (const ext of externals) {
            if (!(component as any)[ext.propertyKey]) {
              needsResolution = true;
              break;
            }
          }
          
          if (needsResolution) {
            console.log(`🔌 Found component needing resource resolution: ${component.constructor.name}`);
            await this.resolveComponentReferences(component);
            await this.resolveExternalResources(component);
            
            // Call onReferencesResolved if it exists
            if ('onReferencesResolved' in component && typeof component.onReferencesResolved === 'function') {
              component.onReferencesResolved();
            }
          }
        }
      }
      
      // Recursively check children
      for (const child of element.children) {
        await checkElement(child);
      }
    };
    
    // Start from space root
    await checkElement(space);
  }
  
  /**
   * Set up handler for dynamically loaded components
   */
  private setupDynamicComponentHandler(space: Space): void {
    // Check if a host handler already exists (from persistence)
    let hostElement = space.children.find(child => child.name === '_host_handler');
    
    if (hostElement) {
      console.log('[Host] Found existing host handler from persistence');
      console.log(`[Host] Host handler has ${hostElement.components.length} components`);
      // Ensure it's subscribed to the right events
      space.subscribe('axon:component-loaded');
      hostElement.subscribe('axon:component-loaded');
      
      // Re-add the handler component if it's missing
      if (hostElement.components.length === 0) {
        console.log('[Host] Host handler has no components, adding handler component');
        const host = this;
        hostElement.addComponent(new class extends Component {
          onMount(): void {
            console.log('[Host Handler] Mounted and ready to handle dynamic component events (restored)');
          }
          
          async handleEvent(event: SpaceEvent): Promise<void> {
            console.log(`[Host Handler] Received event: ${event.topic}`);
            if (event.topic === 'axon:component-loaded') {
              const payload = event.payload as { component: Component; componentClass: string };
              const component = payload.component;
              if (component) {
                console.log(`🔌 Resolving references for dynamically loaded component: ${payload.componentClass}`);
                await host.resolveComponentReferences(component);
                await host.resolveExternalResources(component);
                
                // Call onReferencesResolved if it exists
                if ('onReferencesResolved' in component && typeof component.onReferencesResolved === 'function') {
                  component.onReferencesResolved();
                }
              }
            }
          }
        });
      }
      
      return;
    }
    
    // Create new host handler
    console.log('[Host] Creating new host handler');
    const host = this;
    hostElement = new Element('_host_handler');
    hostElement.addComponent(new class extends Component {
      onMount(): void {
        console.log('[Host Handler] Mounted and ready to handle dynamic component events');
      }
      
      async handleEvent(event: SpaceEvent): Promise<void> {
        console.log(`[Host Handler] Received event: ${event.topic}`);
        if (event.topic === 'axon:component-loaded') {
          const payload = event.payload as { component: Component; componentClass: string };
          const component = payload.component;
          if (component) {
            console.log(`🔌 Resolving references for dynamically loaded component: ${payload.componentClass}`);
            await host.resolveComponentReferences(component);
            await host.resolveExternalResources(component);
            
            // Call onReferencesResolved if it exists
            if ('onReferencesResolved' in component && typeof component.onReferencesResolved === 'function') {
              component.onReferencesResolved();
            }
          }
        }
      }
    });
    space.addChild(hostElement);
    
    // Subscribe to axon component loaded events at both space and element level
    space.subscribe('axon:component-loaded');
    hostElement.subscribe('axon:component-loaded');
    
    console.log('[Host] Dynamic component handler setup complete');
  }
  
  /**
   * Reconstruct element tree from element-tree facets in VEIL
   * Called after replaying deltas to materialize elements created in deltas
   */
  private async reconstructElementsFromVEIL(space: Space, veilState: VEILStateManager): Promise<void> {
    const { Element } = await import('../spaces/element');
    const state = veilState.getState();
    
    // Find all active element-tree facets
    const elementFacets = Array.from(state.facets.values())
      .filter(f => f.type === 'element-tree' && (f as any).state?.active) as any[];
    
    const elementCache = new Map<string, any>();
    elementCache.set('root', space);
    elementCache.set(space.id, space);
    
    // Add existing elements to cache
    for (const child of space.children) {
      elementCache.set(child.id, child);
    }
    
    // Sort: parents before children
    elementFacets.sort((a, b) => {
      const aIsRoot = a.state?.parentId === 'root' || a.state?.parentId === space.id;
      const bIsRoot = b.state?.parentId === 'root' || b.state?.parentId === space.id;
      if (aIsRoot && !bIsRoot) return -1;
      if (!aIsRoot && bIsRoot) return 1;
      return 0;
    });
    
    // Create elements from facets
    for (const facet of elementFacets) {
      const { elementId, name, parentId } = facet.state;
      
      // Skip if already exists (from snapshot elementTree)
      if (elementCache.has(elementId)) {
        console.log(`[Host] Element ${elementId} already exists, skipping reconstruction`);
        continue;
      }
      
      // Find parent
      const parent = elementCache.get(parentId);
      if (!parent) {
        console.warn(`[Host] Parent ${parentId} not found for element ${elementId}`);
        continue;
      }
      
      // Create and add element
      const element = new Element(name, elementId);
      elementCache.set(elementId, element);
      parent.addChild(element);
      
      console.log(`[Host] Reconstructed element: ${name} (${elementId})`);
    }
  }
}
