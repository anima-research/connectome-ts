# Box Dispenser with Host Architecture

## Overview

The Box Dispenser has been updated to use the Host architecture pattern, providing:
- ✅ Automatic persistence and restoration
- ✅ Debug UI for observability 
- ✅ Dependency injection for LLM providers
- ✅ Clean separation of concerns
- ✅ Component reference resolution

## Running the Dispenser

### Quick Start

```bash
cd connectome-ts
npm install
npm run example:dispenser
```

This will:
1. Start the dispenser with persistence enabled
2. Launch debug UI on http://localhost:4000
3. Enable console chat for interaction

### Command Line Options

```bash
# Start fresh (clear saved state)
npm run example:dispenser:reset

# Use manual LLM mode via debug UI
npm run example:dispenser:debug

# Custom options
ts-node examples/dispenser-with-host.ts [options]
  --reset          Start fresh (clear persisted state)
  --debug-port=N   Set debug UI port (default: 4000)
  --debug-llm      Use manual LLM mode via debug UI
  --no-console     Disable console chat interface
  --auto-dispense  Auto-dispense a box on startup
  --help           Show help message
```

## Interacting with the Dispenser

### Available Actions

- `@dispenser.dispense()` - Create a new box
- `@dispenser.setSize("small"|"medium"|"large")` - Change box size
- `@dispenser.setColor("red"|"blue"|"green"|"rainbow")` - Change box color
- `@box-1.open()` - Open the first box
- `@box-1.close()` - Close the first box
- `@box-1.shake()` - Shake the first box

### Using the Debug UI

Open http://localhost:4000 to see:
- Real-time VEIL frames
- Facet states
- Agent responses
- Event flow

In debug LLM mode, you can manually complete agent responses through the UI.

## Architecture Changes

### Before (Direct Component Creation)

```typescript
const dispenser = createBoxDispenser(new MockLLMProvider());
space.addChild(dispenser);
```

### After (Host Architecture)

```typescript
// Application defines structure
class DispenserApplication implements ConnectomeApplication {
  createSpace() { /* ... */ }
  initialize() { /* setup components */ }
  getComponentRegistry() { /* for restoration */ }
}

// Host manages lifecycle
const host = new ConnectomeHost(config);
await host.start(new DispenserApplication(appConfig));
```

## Key Benefits

1. **Persistence**: State automatically saved and restored between sessions
2. **Debug UI**: Built-in observability without extra setup
3. **Dependency Injection**: Components get references resolved automatically
4. **Separation**: Business logic separated from infrastructure
5. **Testing**: Easy to test with different LLM providers

## Component Updates

### ContentGeneratorComponent

Now uses reference injection:
```typescript
export class ContentGeneratorComponent extends Component {
  @reference('llm.content') private llmProvider?: LLMProvider;
  // Falls back to mock content if no provider
}
```

### Provider Configuration

Host manages providers:
```typescript
providers: {
  'llm.agent': agentLLMProvider,
  'llm.content': contentLLMProvider
}
```

## Files Structure

- `dispenser-app.ts` - Application definition (business logic)
- `dispenser-with-host.ts` - Host runner (infrastructure)
- `box-dispenser.ts` - Component implementations
- `content-generator.ts` - Now supports reference injection

## Regression Testing

The dispenser serves as a comprehensive test for:
- Dynamic element creation (boxes)
- Component interactions
- State management and transitions
- Action registration and handling
- Persistence and restoration
- Reference resolution

Run the test suite to ensure everything works:
```bash
npm run test:dispenser  # Old direct test
npm run example:dispenser  # New host-based version
```

Both should work, demonstrating backward compatibility.


