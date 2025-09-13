# AXON Protocol Test

This directory contains a working example of the AXON protocol - Connectome's system for dynamically loading components from external services.

## What is AXON?

AXON allows Connectome to load components dynamically from HTTP URLs, similar to how a web browser loads JavaScript modules. This enables:

- Dynamic extension of agent capabilities
- Hot reloading during development
- Modular component architecture
- External service integration

## Running the Test

1. Start the AXON test server:
```bash
cd examples/axon-test
npx ts-node server.ts
```

2. In another terminal, run the test client:
```bash
npx ts-node examples/test-axon.ts
```

## How it Works

### Server Side

The test server (`server.ts`) provides:
- HTTP endpoint serving the AXON manifest at `/axon-test`
- Dynamic TypeScript compilation of components
- WebSocket for hot reload notifications
- Module version tracking

### Client Side

The test client demonstrates:
1. Creating an `AxonElement` that loads components from `axon://localhost:8080/axon-test`
2. Agent interaction with the dynamically loaded component via `@test.ping()` actions
3. Event routing between Connectome and AXON-loaded components
4. Hot reload support

### Component Loading Flow

1. `AxonElement` fetches the manifest from the AXON server
2. The manifest specifies which component module to load
3. The component is fetched, evaluated, and instantiated
4. The component integrates with Connectome's event system
5. Agents can interact with the component through registered actions

### Key Features Demonstrated

- **Dynamic Loading**: Components are loaded from HTTP URLs at runtime
- **Hot Reloading**: Changes to component source trigger automatic reloads
- **Event Integration**: AXON components participate in Connectome's event system
- **Agent Actions**: Agents can trigger actions on dynamically loaded components
- **Module Versioning**: Cache busting ensures fresh modules after changes

## Architecture

```
┌─────────────────┐     HTTP      ┌──────────────┐
│                 │────────────────│ AXON Server  │
│  AxonElement    │                │              │
│                 │   WebSocket    │  - Manifest  │
│                 │────────────────│  - Modules   │
└─────────────────┘                │  - Hot Reload│
        │                          └──────────────┘
        │
        └── Loads & Manages ──→ Component Instance
                                       │
                                       └── Subscribes to Events
                                       └── Emits Events
                                       └── Handles Agent Actions
```

## Files

- `server.ts` - Example AXON server implementation
- `test-component.ts` - Example component that gets loaded dynamically
- `README.md` - This file

## Next Steps

This test implementation can be extended to:
- Load multiple components from a single AXON service
- Support component dependencies
- Add authentication and security
- Enable cross-component communication
- Build real-world integrations (game servers, APIs, etc.)