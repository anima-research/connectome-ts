# AXON Protocol Requirements

## Overview

AXON is a protocol for dynamically loading and connecting external services to Connectome. It enables agents to grow their own "nervous system" by connecting to new services via URLs, similar to how a browser loads web pages, but generating VEIL (Virtual Environment Interaction Language) instead of DOM.

## Core Concepts

### 1. Dynamic Component Loading
- AXON loads standard Connectome Components from external URLs
- Components run locally within Connectome process
- Loaded components have full access to existing Component APIs
- No new APIs or abstractions - just dynamic loading of components

### 2. Minimal Protocol
- Simple manifest points to component module
- Module exports a Component class (default export)
- Component handles its own initialization in mount()
- Hot reload supported via manifest configuration

### 3. Complete Reusability
- Components work identically whether local or loaded via AXON
- All existing patterns and base classes available
- No special "AXON components" - just regular components loaded dynamically

## Simple Example

Agent connects to space game:
```
@space.connect("axon://game.server/spacegame")
```

This fetches `http://game.server/spacegame` which returns:
```json
{"main": "./spacegame-component.js"}
```

Then loads the component which is just a normal Connectome component:
```typescript
export default class SpaceGameComponent extends VEILComponent {
  mount() {
    this.addFacet({type: 'state', id: 'game', content: 'Connected!'});
  }
}
```

That's it. No new APIs, no complex protocols.

## Protocol Specification

### URL Format
```
axon://host:port/path/to/service
```

### Discovery Request
```
GET /path/to/service
Accept: application/json
```

### Manifest Response
```json
{
  "main": "./spacegame-component.js",
  "name": "Space Game Client",
  "description": "Connect to the persistent space game",
  "modules": [
    "./spacegame-component.js",
    "./physics-engine.js",
    "./ai-strategies.js"
  ],
  "dev": {
    "hotReload": "ws://host:port/hot-reload"
  }
}
```

Minimal required:
```json
{
  "main": "./component.js"
}
```

## Client-Side Requirements

### AxonElement Class
The AxonElement is a standard Element that:

1. **Fetches manifest** from AXON URL
2. **Loads component module** using dynamic import
3. **Instantiates the component** and adds it to itself
4. **Handles hot reloading** by unmounting old and mounting new components

```typescript
class AxonElement extends Element {
  private loadedComponent?: Component;
  private manifestUrl: string;
  private moduleUrl: string;
  private hotReloadWs?: WebSocket;
  
  async connect(axonUrl: string): Promise<void> {
    this.manifestUrl = axonUrl;
    const manifest = await fetch(axonUrl).then(r => r.json());
    this.moduleUrl = new URL(manifest.main, axonUrl).toString();
    
    // Load the component
    await this.loadComponent();
    
    // Set up hot reload if specified
    if (manifest.dev?.hotReload) {
      this.setupHotReload(manifest.dev.hotReload);
    }
  }
  
  private async loadComponent(): Promise<void> {
    // Clean up previous instance
    if (this.loadedComponent) {
      await this.loadedComponent.unmount();
      this.removeComponent(this.loadedComponent);
    }
    
    // Load main module with version
    const mainVersion = this.moduleVersions?.[this.manifest.main] || Date.now();
    const url = `${this.moduleUrl}?v=${mainVersion}`;
    
    // TODO: Intercept dynamic imports within the component
    // to append versions from this.moduleVersions
    const module = await import(url);
    
    const ComponentClass = module.default;
    this.loadedComponent = new ComponentClass();
    this.addComponent(this.loadedComponent);
  }
  
  private setupHotReload(wsUrl: string): void {
    this.hotReloadWs = new WebSocket(wsUrl);
    
    this.hotReloadWs.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.type === 'module-versions') {
        // Initial version map or updates
        this.moduleVersions = msg.versions;
      } else if (msg.type === 'module-update') {
        // Single module changed
        this.moduleVersions[msg.module] = msg.version;
        if (msg.module === this.manifest.main) {
          console.log('[AxonElement] Main module changed, reloading...');
          await this.loadComponent();
        }
      } else if (msg.type === 'reload') {
        // Force reload
        await this.loadComponent();
      }
    };
    
    // Reconnect on close (server restart)
    this.hotReloadWs.onclose = () => {
      setTimeout(() => this.setupHotReload(wsUrl), 1000);
    };
  }
  
  async unmount(): Promise<void> {
    this.hotReloadWs?.close();
    await super.unmount();
  }
}
```

### Loaded Component Requirements
Components loaded via AXON are standard Connectome Components:

```typescript
// Example AXON component module
import { VEILComponent } from '@connectome/components';

export default class SpaceGameComponent extends VEILComponent {
  private ws?: WebSocket;
  
  async mount() {
    // Standard component initialization
    this.ws = new WebSocket('ws://game.server/ai');
    
    // Use inherited methods from VEILComponent
    this.addFacet({
      type: 'state',
      id: 'ship-status',
      displayName: 'ship',
      content: 'Connecting to space game...'
    });
    
    // Standard event handling
    this.element.on('game.command', (cmd) => {
      this.ws?.send(JSON.stringify(cmd));
    });
  }
  
  async unmount() {
    // Standard cleanup
    this.ws?.close();
  }
}
```

### No New APIs
AXON components use existing APIs:
- `this.addOperation()` - from VEILComponent
- `this.addFacet()` - from VEILComponent  
- `this.updateState()` - from VEILComponent
- `this.element.emit()` - from Component
- `this.element.on()` - from Component
- Standard mount/unmount lifecycle

### Module Loading with Versions
The AxonElement provides versioned imports transparently:

```typescript
// Component writes:
import { PhysicsEngine } from './physics-engine.js';

// AxonElement loads as:
import { PhysicsEngine } from './physics-engine.js?v=d4e5f6a8';
```

This happens through dynamic import interception based on module versions received via WebSocket.

### Design Advantages

This approach avoids complexity by:
1. **No new abstractions** - Just loading existing Component classes
2. **No API translation** - Components use the same APIs locally or via AXON
3. **No special protocols** - Simple HTTP/WebSocket for transport
4. **Full compatibility** - Any Component can be loaded via AXON
5. **Natural patterns** - Developers write normal Components

## Server-Side Requirements

### Minimal Static Serving
AXON services need to:

1. **Serve manifest.json** at the AXON URL
2. **Serve component modules** (JavaScript files)
3. **For development: Hot reload WebSocket** specified in manifest

### Example Server Setup
```typescript
// Simple Express server
app.get('/spacegame/ai-client', (req, res) => {
  res.json({
    main: './spacegame-component.js',
    name: 'Space Game Client',
    dev: {
      hotReload: 'ws://localhost:3000/hot-reload'
    }
  });
});

// Serve the component module
app.use('/spacegame', express.static('./clients'));

// Optional: Hot reload for development
if (process.env.NODE_ENV === 'development') {
  const wss = new WebSocketServer({ port: 3000 });
  const moduleVersions = new Map();
  
  // Compute initial versions
  const modules = ['./spacegame-component.js', './physics-engine.js', './ai-strategies.js'];
  for (const module of modules) {
    const stats = fs.statSync(path.join('./clients', module));
    moduleVersions.set(module, stats.mtimeMs.toString());
  }
  
  // Send versions on connect
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
      type: 'module-versions',
      versions: Object.fromEntries(moduleVersions)
    }));
  });
  
  // Watch for changes
  chokidar.watch('./clients/**/*.js').on('change', (filePath) => {
    const module = './' + path.relative('./clients', filePath);
    const stats = fs.statSync(filePath);
    const newVersion = stats.mtimeMs.toString();
    
    moduleVersions.set(module, newVersion);
    
    // Notify all clients
    const msg = JSON.stringify({
      type: 'module-update',
      module,
      version: newVersion
    });
    
    wss.clients.forEach(client => client.send(msg));
  });
}
```

### TypeScript Support
For TypeScript development:
- Use standard build tools (tsc, esbuild, etc.)
- Or serve TypeScript with on-the-fly compilation
- Include source maps for debugging

## Hot Reloading Requirements

1. **Component Lifecycle**
   - Call unmount() on old component
   - Remove old component from element
   - Load new module with cache busting
   - Create and mount new component

2. **Module Cache Busting**
   ```typescript
   // Force fresh import
   const url = `${manifest.main}?t=${Date.now()}`;
   const module = await import(url);
   ```

3. **WebSocket Protocol**
   The hot reload WebSocket sends JSON messages:
   
   ```json
   // On connect: send all module versions
   {
     "type": "module-versions",
     "versions": {
       "./spacegame-component.js": "a3f2b1c7",
       "./physics-engine.js": "d4e5f6a8",
       "./ai-strategies.js": "b2c3d4e9"
     }
   }
   
   // When a module changes
   {
     "type": "module-update",
     "module": "./physics-engine.js",
     "version": "e5f6a7b9" // new hash/timestamp
   }
   
   // Force reload everything
   {
     "type": "reload"
   }
   ```
   
   - Server tracks file changes and computes versions (hash or timestamp)
   - Client maintains version map for cache busting
   - Auto-reconnects on server restart

4. **State Preservation (Optional)**
   Components can implement state preservation:
   ```typescript
   class SpaceGameComponent extends VEILComponent {
     getState() {
       return { shipId: this.shipId, position: this.position };
     }
     
     async mount() {
       // Restore from previous instance if available
       const saved = this.element.getMetadata('previousState');
       if (saved) {
         this.shipId = saved.shipId;
         this.position = saved.position;
       }
     }
   }
   ```

## Security Considerations (Future)

While sandboxing is deferred for initial implementation, the design should accommodate future security needs:

1. **Module Verification**
   - HTTPS required for production
   - Content-Type validation
   - Origin checking

2. **API Restrictions**
   - Capability-based permissions
   - Rate limiting considerations
   - Resource usage monitoring

3. **Sandboxing Path**
   - VM contexts (Node.js)
   - Web Workers (browser-like)
   - Deno-style permissions

## Example Use Cases

### 1. Space Game Integration
```typescript
// Agent tool usage
@space.connect("axon://game.server/spacegame/ai-client")

// The loaded component generates VEIL
<ship>Your ship "Explorer-7" is at coordinates (42, 128, 3)</ship>
<fuel>Fuel: 78% (consumption: 0.5/s)</fuel>

// Agent interacts via standard actions
@space-game.move({x: 50, y: 130, z: 3})
@space-game.scan()
```

### 2. Multi-Module Example
```typescript
// Component can load additional modules as needed
export default class AdvancedGameComponent extends VEILComponent {
  async mount() {
    // Load physics engine for local calculations
    const physics = await import('./physics-engine.js');
    this.physics = new physics.Engine();
    
    // Load AI strategies
    const ai = await import('./ai-strategies.js');
    this.strategist = new ai.Strategist();
  }
}
```

### 3. Service Migration
```typescript
// Services can migrate from adapters to AXON seamlessly
// Old: Custom Discord adapter with hardcoded integration
// New: Discord provides AXON component that agents load

@space.connect("axon://discord.com/connectome/client")
```

## Implementation Phases

### Phase 1: Core Implementation (For Space Game Testing)
- Basic AxonElement that loads components
- Simple manifest fetching
- Component mounting/unmounting
- Cache-busted imports

### Phase 2: Development Experience
- Hot reload support
- Better error handling
- Source map support
- Development mode optimizations

### Phase 3: Extended Features
- Module dependency resolution
- State preservation helpers
- Component communication patterns
- Performance optimizations

### Phase 4: Security & Ecosystem
- Sandboxing options (VM, Workers)
- HTTPS/origin verification
- Service discovery
- Best practices documentation
