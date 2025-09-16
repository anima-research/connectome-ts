import { Element } from '../spaces/element';
import { Component } from '../spaces/component';
import { SpaceEvent } from '../spaces/types';

interface AxonManifest {
  main: string;
  name?: string;
  description?: string;
  modules?: string[];
  dev?: {
    hotReload?: string;
  };
}

interface ModuleVersions {
  [module: string]: string;
}

interface ParsedAxonUrl {
  protocol: string;
  host: string;
  path: string;
  params: Record<string, string>;
}

/**
 * AxonElement - Dynamically loads components from external URLs
 * 
 * Enables agents to connect to external services by loading
 * component modules that generate VEIL and handle events.
 */
export class AxonElement extends Element {
  // AxonElement can't declare static actions since they're loaded dynamically
  // Instead, loaded components will register their own actions
  private loadedComponent?: Component;
  private manifest?: AxonManifest;
  private manifestUrl?: string;
  private moduleUrl?: string;
  private moduleVersions: ModuleVersions = {};
  private hotReloadWs?: WebSocket;
  private parsedUrl?: ParsedAxonUrl;
  
  constructor(config: { id: string }) {
    super(config.id, config.id);  // Pass id as both name and id
  }
  
  /**
   * Parse AXON URL into components
   */
  static parseUrl(url: string): ParsedAxonUrl {
    const match = url.match(/^axon:\/\/([^/?]+)(\/[^?]*)?\??(.*)$/);
    if (!match) {
      throw new Error(`Invalid AXON URL: ${url}`);
    }
    
    const [, host, path = '/', queryString] = match;
    const params: Record<string, string> = {};
    
    if (queryString) {
      const searchParams = new URLSearchParams(queryString);
      searchParams.forEach((value, key) => {
        params[key] = value;
      });
    }
    
    return { protocol: 'axon', host, path, params };
  }
  
  /**
   * Connect to an AXON service
   * @param axonUrl - The AXON URL (e.g., "axon://game.server/spacegame?token=xyz")
   */
  async connect(axonUrl: string): Promise<void> {
    try {
      // Parse the URL
      this.parsedUrl = AxonElement.parseUrl(axonUrl);
      
      // Build HTTP URL without parameters
      const httpUrl = `http://${this.parsedUrl.host}${this.parsedUrl.path}`;
      this.manifestUrl = httpUrl;
      
      // Fetch manifest
      console.log(`[AxonElement] Fetching manifest from ${httpUrl}`);
      const response = await fetch(httpUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
      }
      
      this.manifest = await response.json();
      console.log(`[AxonElement] Loaded manifest:`, this.manifest);
      
      // Resolve module URL relative to manifest
      if (!this.manifest || !this.manifest.main) {
        throw new Error('Manifest missing required "main" field');
      }
      this.moduleUrl = new URL(this.manifest.main, httpUrl).toString();
      
      // Load the component
      await this.loadComponent();
      
      // Set up hot reload if specified
      if (this.manifest && this.manifest.dev?.hotReload) {
        this.setupHotReload(this.manifest.dev.hotReload);
      }
    } catch (error) {
      console.error(`[AxonElement] Failed to connect:`, error);
      throw error;
    }
  }
  
  /**
   * Load or reload the component module
   */
  private async loadComponent(): Promise<void> {
    // Clean up previous instance
    if (this.loadedComponent) {
      console.log(`[AxonElement] Unmounting previous component`);
      try {
        // Call onUnmount through the internal method
        (this.loadedComponent as any)._detach();
      } catch (error) {
        console.error(`[AxonElement] Error unmounting component:`, error);
      }
      this.removeComponent(this.loadedComponent);
    }
    
    // Get version for cache busting
    const mainModule = this.manifest!.main;
    const version = this.moduleVersions[mainModule] || Date.now().toString();
    const url = `${this.moduleUrl}?v=${version}`;
    
    console.log(`[AxonElement] Loading component from ${url}`);
    
    try {
      // Fetch the module code
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch module: ${response.status} ${response.statusText}`);
      }
      
      const moduleCode = await response.text();
      
      // Create a module from the code
      // Note: In production, this should use a proper module loader or sandbox
      const moduleExports: any = {};
      const moduleFunction = new Function('exports', 'require', 'module', moduleCode);
      const fakeModule = { exports: moduleExports };
      
      // Basic require function that handles our base components
      const requireFunc = (id: string) => {
        if (id === '../../src/components/base-components' || id === '@connectome/components') {
          // Return our actual base components
          const { VEILComponent } = require('../../src/components/base-components');
          return { VEILComponent };
        }
        throw new Error(`Cannot require module: ${id}`);
      };
      
      moduleFunction(moduleExports, requireFunc, fakeModule);
      
      // Get the component class
      const ComponentClass = fakeModule.exports.default || fakeModule.exports.Component || moduleExports.default;
      if (!ComponentClass) {
        throw new Error('Module must export a Component class as default or named "Component"');
      }
      
      // Create and add the component
      this.loadedComponent = new ComponentClass();
      if (this.loadedComponent) {
        this.addComponent(this.loadedComponent);
        console.log(`[AxonElement] Component loaded and mounted`);
        
        // Pass parameters to component if it has setConnectionParams method
        if (this.parsedUrl && 'setConnectionParams' in this.loadedComponent) {
          console.log(`[AxonElement] Passing parameters to component:`, this.parsedUrl.params);
          (this.loadedComponent as any).setConnectionParams({
            host: this.parsedUrl.host,
            path: this.parsedUrl.path,
            ...this.parsedUrl.params
          });
        }
        
        // Notify space that we might have new actions (for auto-registration)
        // Subscribe to element:action if the component has actions
        const comp = this.loadedComponent as any;
        if (comp.actions && comp.actions.size > 0) {
          this.subscribe('element:action');
          
          // Trigger re-registration if agent supports auto-registration
          const space = this.isSpace ? this : this.findSpace();
          if (space && 'agent' in space && (space as any).agent && 
              'registerElementAutomatically' in (space as any).agent) {
            ((space as any).agent as any).registerElementAutomatically(this);
          }
        }
      } else {
        throw new Error('Failed to instantiate component');
      }
    } catch (error) {
      console.error(`[AxonElement] Failed to load component:`, error);
      throw error;
    }
  }
  
  /**
   * Set up hot reload WebSocket connection
   */
  private setupHotReload(wsUrl: string): void {
    console.log(`[AxonElement] Setting up hot reload: ${wsUrl}`);
    
    try {
      this.hotReloadWs = new WebSocket(wsUrl);
      
      this.hotReloadWs.onopen = () => {
        console.log(`[AxonElement] Hot reload connected`);
      };
      
      this.hotReloadWs.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.type === 'module-versions') {
            // Initial version map or full update
            console.log(`[AxonElement] Received module versions:`, msg.versions);
            this.moduleVersions = msg.versions;
            
          } else if (msg.type === 'module-update') {
            // Single module changed
            console.log(`[AxonElement] Module updated: ${msg.module} v${msg.version}`);
            this.moduleVersions[msg.module] = msg.version;
            
            // Reload if main module changed
            if (msg.module === this.manifest?.main) {
              console.log(`[AxonElement] Main module changed, reloading...`);
              await this.loadComponent();
            }
            
          } else if (msg.type === 'reload') {
            // Force reload
            console.log(`[AxonElement] Force reload requested`);
            await this.loadComponent();
          }
        } catch (error) {
          console.error(`[AxonElement] Error handling hot reload message:`, error);
        }
      };
      
      this.hotReloadWs.onerror = (error) => {
        console.error(`[AxonElement] Hot reload error:`, error);
      };
      
      // Reconnect on close (server restart)
      this.hotReloadWs.onclose = () => {
        console.log(`[AxonElement] Hot reload disconnected, reconnecting...`);
        setTimeout(() => {
          if (this.manifest?.dev?.hotReload) {
            this.setupHotReload(this.manifest.dev.hotReload);
          }
        }, 1000);
      };
    } catch (error) {
      console.error(`[AxonElement] Failed to set up hot reload:`, error);
    }
  }
  
  /**
   * Override handleEvent to clean up on unmount
   */
  async handleEvent(event: SpaceEvent): Promise<void> {
    await super.handleEvent(event);
    
    // Clean up when element is unmounted
    if (event.topic === 'element:unmount' && (event.payload as any)?.element?.id === this.id) {
      this.cleanup();
    }
  }
  
  /**
   * Clean up resources
   */
  private cleanup(): void {
    console.log(`[AxonElement] Cleaning up`);
    
    // Close WebSocket
    if (this.hotReloadWs) {
      this.hotReloadWs.close();
      this.hotReloadWs = undefined;
    }
    
    // Remove loaded component
    if (this.loadedComponent) {
      this.removeComponent(this.loadedComponent);
      this.loadedComponent = undefined;
    }
  }
  
  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    this.cleanup();
  }
}
