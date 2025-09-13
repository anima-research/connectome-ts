# AXON Protocol Requirements

## Overview

AXON is a protocol for dynamically loading and connecting external services to Connectome. It enables agents to grow their own "nervous system" by connecting to new services via URLs, similar to how a browser loads web pages, but generating VEIL (Virtual Environment Interaction Language) instead of DOM.

## Core Concepts

### 1. Dynamic Elements
- Elements that can be created by providing only a URL
- Load code modules from external servers
- Run locally within Connectome process (not remote execution)
- Can be thick clients (local processing) or thin clients (server-side processing)

### 2. Module System
- Main module serves as entry point
- Can request additional modules dynamically
- Modules are cached after first load
- Support for relative module paths

### 3. Unified API
- AXON elements expose the same API as native Connectome elements
- Server-side AXON elements (when building services) mirror this API
- Enables code reuse between different client types

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

### Discovery Response
```json
{
  "version": "1.0",
  "type": "thick-client" | "thin-client",
  "main": "./client-main.js",
  "baseUrl": "https://host:port/clients/",
  "capabilities": ["websocket", "veil", "events", "storage"],
  "metadata": {
    "name": "Space Game AI Client",
    "description": "Connect to the persistent space game",
    "author": "game.server"
  },
  "dev": {
    "hotReload": "ws://host:port/axon-dev/hot-reload",
    "typescript": true
  }
}
```

## Client-Side Requirements

### AxonElement Class
The generic AXON element in Connectome must:

1. **Fetch manifest** from AXON URL
2. **Load main module** using dynamic import
3. **Provide Connectome APIs** to loaded code:
   - VEIL operations (addFacet, updateState, etc.)
   - Event system (emit, on, off)
   - Space reference
4. **Provide AXON-specific APIs**:
   - Module loading system
   - Local storage for thick clients
   - Previous state for hot reloading

### Module Loading API
```typescript
interface ModuleAPI {
  // Load a module relative to manifest baseUrl
  load(path: string): Promise<any>;
  
  // Preload multiple modules
  preload(paths: string[]): Promise<any[]>;
  
  // Get already loaded module
  get(path: string): any | undefined;
  
  // Check if module is loaded
  has(path: string): boolean;
}
```

### VEIL API
```typescript
interface VeilAPI {
  addFacet(facet: Facet): void;
  updateState(facetId: string, updates: StateUpdate): void;
  addEvent(event: EventFacet): void;
  addAmbient(ambient: AmbientFacet): void;
}
```

### Events API
```typescript
interface EventsAPI {
  emit(topic: string, data: any): void;
  on(topic: string, handler: EventHandler): void;
  off(topic: string, handler: EventHandler): void;
  once(topic: string, handler: EventHandler): void;
}
```

### Storage API (for thick clients)
```typescript
interface StorageAPI {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

### Client Module Interface
```typescript
// What loaded modules must export
export interface AxonClientModule {
  // Required: Initialize the client
  initialize(api: AxonAPI): Promise<AxonClient>;
}

export interface AxonClient {
  // Optional: Get state for hot reload
  getState?(): any;
  
  // Optional: Cleanup on reload/disconnect
  cleanup?(): Promise<void>;
}
```

## Server-Side Requirements

### AXON Server Library
Provides base classes and utilities for building AXON services:

1. **AxonServer class**
   - HTTP server for manifest and modules
   - WebSocket support for real-time communication
   - Development mode with hot reloading
   - TypeScript compilation support

2. **AxonElement base class**
   - Mirrors Connectome Element API
   - Methods: handleEvent, addFacet, emit
   - Lifecycle: initialize, cleanup

3. **Development Server**
   - File watching for hot reload
   - On-the-fly TypeScript compilation
   - Source map support
   - WebSocket notifications for changes

### Manifest Generation
Server library should auto-generate manifest from configuration:
```typescript
const server = new AxonServer({
  name: "Space Game",
  description: "Persistent space game world",
  main: "./clients/spacegame-ai.ts",
  capabilities: ["websocket", "veil", "events"],
  dev: {
    watch: "./clients/**/*.ts",
    typescript: true
  }
});
```

## Hot Reloading Requirements

1. **State Preservation**
   - Clients can export current state via getState()
   - State passed to new instance via previousState
   - Connections and resources properly cleaned up

2. **Change Detection**
   - File watching on server side
   - WebSocket/SSE for change notifications
   - Immediate reload on client side

3. **Module Cache Invalidation**
   - Add timestamp to module URLs
   - Force fresh imports on reload
   - Clear old module references

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
// Agent connects to space game
@space.connect("axon://game.server/spacegame/ai-client")

// Receives VEIL updates about game state
<ship>Your ship "Explorer-7" is at coordinates (42, 128, 3)</ship>
<fuel>Fuel: 78% (consumption: 0.5/s)</fuel>
```

### 2. Social Media Monitor
```typescript
@space.connect("axon://social.api/mastodon/reader")

// Generates VEIL for social updates
<mention>@alice mentioned you in "AI consciousness thread"</mention>
```

### 3. Research Experiment
```typescript
@space.connect("axon://lab.university/experiment-7/participant")

// Interactive research tasks via VEIL
<task>Please describe what you see in this image</task>
```

## Implementation Phases

### Phase 1: Core Protocol (Current Priority)
- Basic AxonElement implementation
- Module loading system
- Simple manifest format
- Hot reloading support

### Phase 2: Server Library
- TypeScript AXON server
- Development mode
- Example implementations
- Documentation

### Phase 3: Advanced Features
- Python server library
- Sandboxing options
- Module verification
- Performance optimizations

### Phase 4: Ecosystem
- AXON registry/discovery
- Standard client modules
- Community contributions
- Best practices guide
