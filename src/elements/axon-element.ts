import { Element } from '../spaces/element';
import { Component } from '../spaces/component';
import { SpaceEvent } from '../spaces/types';
import { createAxonEnvironment } from '../axon/environment';
import { IAxonManifest, IAxonComponentConstructor } from '../axon/interfaces';

// Use the interface from axon/interfaces
type AxonManifest = IAxonManifest;

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
  private loadedDependencies: Map<string, any> = new Map();
  
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
   * Load dependencies for the component
   */
  private async loadDependencies(env: any): Promise<void> {
    if (!this.manifest?.dependencies) return;
    
    for (const dep of this.manifest.dependencies) {
      console.log(`[AxonElement] Loading dependency: ${dep.name} from ${dep.manifest}`);
      
      // Build the full URL for the dependency manifest
      const depManifestUrl = new URL(dep.manifest, this.manifestUrl!).toString();
      
      // Fetch dependency manifest
      const depManifestResponse = await fetch(depManifestUrl);
      if (!depManifestResponse.ok) {
        throw new Error(`Failed to fetch dependency manifest: ${depManifestUrl}`);
      }
      
      const depManifest = await depManifestResponse.json() as IAxonManifest;
      
      // Fetch dependency module
      const depModuleUrl = new URL(depManifest.main, depManifestUrl).toString();
      const depModuleResponse = await fetch(`${depModuleUrl}?v=${Date.now()}`);
      if (!depModuleResponse.ok) {
        throw new Error(`Failed to fetch dependency module: ${depModuleUrl}`);
      }
      
      const depModuleCode = await depModuleResponse.text();
      
      // Load the dependency module
      const depModuleFunc = new Function('exports', 'module', 'env', `
        ${depModuleCode}
        
        // Handle different export styles
        if (typeof createModule !== 'undefined') {
          module.exports = createModule(env);
        } else if (typeof exports.createModule === 'function') {
          module.exports = exports.createModule(env);
        } else if (typeof module.exports === 'function') {
          // Module directly exports a function
          module.exports = module.exports(env);
        }
      `);
      
      const depExports: any = {};
      const depModule = { exports: depExports };
      
      depModuleFunc(depExports, depModule, env);
      
      // Store the loaded dependency
      this.loadedDependencies.set(dep.name, depModule.exports);
      console.log(`[AxonElement] Loaded dependency: ${dep.name}`);
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
      
      // Create the AXON environment
      const env = createAxonEnvironment();
      
      // Load dependencies first
      await this.loadDependencies(env);
      
      // Add loaded dependencies to the environment
      const enhancedEnv = {
        ...env,
        ...Object.fromEntries(this.loadedDependencies)
      };
      
      // Create a function that evaluates the module
      // The module should export a createModule function
      const moduleFunc = new Function('exports', 'module', 'env', `
        ${moduleCode}
        
        // Handle different export styles
        if (typeof createModule !== 'undefined') {
          module.exports = createModule(env);
        } else if (typeof exports.createModule === 'function') {
          module.exports = exports.createModule(env);
        } else if (typeof module.exports === 'function') {
          // Module directly exports a function
          module.exports = module.exports(env);
        }
      `);
      
      const moduleExports: any = {};
      const module = { exports: moduleExports };
      
      // Execute the module with the enhanced environment
      moduleFunc(moduleExports, module, enhancedEnv);
      
      // Get the component class
      const ComponentClass = module.exports as IAxonComponentConstructor;
      
      if (!ComponentClass || typeof ComponentClass !== 'function') {
        throw new Error('Module does not export a valid component class');
      }
      
      // Create an instance of the component
      this.loadedComponent = new ComponentClass() as Component;
      if (this.loadedComponent) {
        this.addComponent(this.loadedComponent);
        console.log(`[AxonElement] Component loaded and mounted`);
        
        // Handle connection parameters
        if (this.parsedUrl?.params) {
          // Set parameters based on manifest config
          if (this.manifest.config) {
            for (const [key, value] of Object.entries(this.parsedUrl.params)) {
              if (key in this.manifest.config) {
                // Set the property directly
                (this.loadedComponent as any)[key] = value;
              }
            }
          }
          
          // Also try legacy setConnectionParams method
          if ('setConnectionParams' in this.loadedComponent) {
            console.log(`[AxonElement] Passing parameters to component:`, this.parsedUrl.params);
            (this.loadedComponent as any).setConnectionParams({
              host: this.parsedUrl.host,
              path: this.parsedUrl.path,
              ...this.parsedUrl.params
            });
          }
        }
        
        // Handle persistent properties from URL params
        if (ComponentClass.persistentProperties) {
          for (const prop of ComponentClass.persistentProperties) {
            if (prop.propertyKey in (this.parsedUrl?.params || {})) {
              (this.loadedComponent as any)[prop.propertyKey] = this.parsedUrl.params[prop.propertyKey];
            }
          }
        }
        
        // Register actions if the component declares them
        const actions = ComponentClass.actions;
        if (actions) {
          console.log(`[AxonElement] Component declares actions:`, Object.keys(actions));
          for (const [actionName, actionDef] of Object.entries(actions)) {
            const description = typeof actionDef === 'string' ? actionDef : actionDef.description;
            console.log(`[AxonElement] Action: ${this.id}.${actionName} - ${description}`);
          }
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
