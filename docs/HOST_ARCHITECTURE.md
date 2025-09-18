# Connectome Host Architecture

The Host architecture provides a clean separation of concerns between infrastructure and application logic, making it easy to build maintainable Connectome applications.

## Quick Start

### Running the Discord Bot

```bash
# Start Discord bot (restores from saved state if available)
npm run host:discord

# Start Discord bot with fresh state (ignores saved state)
npm run host:discord:reset
```

## Architecture Overview

The Host system consists of three main parts:

### 1. ConnectomeHost
The Host manages all infrastructure concerns:
- Persistence and restoration
- Debug server
- LLM providers
- Secrets management
- Dependency injection

### 2. ConnectomeApplication Interface
Applications implement this interface to define their business logic:
```typescript
interface ConnectomeApplication {
  createSpace(): Promise<{ space: Space; veilState: VEILStateManager }>;
  initialize(space: Space, veilState: VEILStateManager): Promise<void>;
  getComponentRegistry(): ComponentRegistry;
  onStart?(space: Space, veilState: VEILStateManager): Promise<void>;
  onRestore?(space: Space, veilState: VEILStateManager): Promise<void>;
}
```

### 3. Reference System
Components declare their dependencies using decorators:
```typescript
class MyComponent extends Component {
  @reference('veilState') private veilState?: VEILStateManager;
  @reference('llmProvider') private llmProvider?: LLMProvider;
  @external('secret:api.key') private apiKey?: string;
  
  async onReferencesResolved(): Promise<void> {
    // Called after all references are injected
    // Components can self-restore here
  }
}
```

## Benefits

### No Order Sensitivity
The Host automatically resolves dependencies in the correct order. Components don't need to worry about initialization sequence.

### Automatic Restoration
Components self-restore when their references are resolved. No manual wiring required.

### Security
Sensitive data like API keys are injected at runtime, not persisted.

### Clean Separation
Infrastructure concerns (persistence, debug, providers) are separated from business logic.

## Example: Discord Bot

```typescript
// 1. Create the application
class DiscordApplication implements ConnectomeApplication {
  async createSpace() {
    const veilState = new VEILStateManager();
    const space = new Space(veilState);
    return { space, veilState };
  }
  
  async initialize(space, veilState) {
    // Create Discord elements and components
    const discordElem = new Element('discord');
    discordElem.addComponent(new DiscordAxonComponent());
    space.addChild(discordElem);
    
    // Create agent element
    const agentElem = new Element('agent');
    agentElem.addComponent(new AgentComponent());
    space.addChild(agentElem);
  }
  
  getComponentRegistry() {
    const registry = ComponentRegistry.getInstance();
    registry.register('DiscordAxonComponent', DiscordAxonComponent);
    registry.register('AgentComponent', AgentComponent);
    return registry;
  }
}

// 2. Configure and start the Host
const host = new ConnectomeHost({
  persistence: { enabled: true, storageDir: './state' },
  debug: { enabled: true, port: 3000 },
  providers: { 'llm.primary': new AnthropicProvider(...) },
  secrets: { 'discord.token': process.env.DISCORD_TOKEN }
});

// 3. Start the application
await host.start(new DiscordApplication());
```

## Component Development

### Using References

```typescript
@persistable(1)
export class AgentComponent extends Component implements RestorableComponent {
  // Persistent state
  @persistent() private agentConfig?: AgentConfig;
  
  // Injected dependencies
  @reference('veilState') private veilState?: VEILStateManager;
  @reference('llmProvider') private llmProvider?: LLMProvider;
  
  async onReferencesResolved(): Promise<void> {
    // Recreate agent with injected dependencies
    if (this.agentConfig && !this.agent) {
      this.agent = new BasicAgent(
        this.agentConfig,
        this.llmProvider,
        this.veilState
      );
    }
  }
}
```

### External Resources

```typescript
export class DiscordAxonComponent extends Component {
  // External secret (not persisted)
  @external('secret:discord.token') protected botToken?: string;
  
  // Persistent state
  @persistent() protected guildId: string = '';
  
  async onReferencesResolved(): Promise<void> {
    // Bot token has been injected
    if (this.botToken) {
      console.log('Discord token available, ready to connect');
    }
  }
}
```

## Persistence

The Host automatically handles persistence:

1. **Snapshots**: Created periodically and on shutdown
2. **Restoration**: Automatic on startup (unless --reset flag is used)
3. **State Directory**: Configurable per application

### Frame Deletion

To delete recent frames (e.g., for recovery):
```typescript
await host.deleteFrames(10); // Delete last 10 frames
```

## Debug Interface

The Host automatically starts a debug server at http://localhost:3000 (configurable) providing:
- Real-time VEIL state visualization
- Frame history
- Component tree
- JSON inspector

## Migration Guide

To migrate an existing Connectome application to use the Host:

1. **Extract Application Logic**: Create a class implementing `ConnectomeApplication`
2. **Update Components**: Add `@reference` decorators for dependencies
3. **Remove Manual Wiring**: Let the Host handle dependency injection
4. **Configure Host**: Set up providers, secrets, and persistence
5. **Test**: Use `--reset` flag to test fresh starts

## Best Practices

1. **Keep Applications Simple**: Focus on business logic, let Host handle infrastructure
2. **Use References**: Declare dependencies explicitly with decorators
3. **Implement onReferencesResolved**: Handle restoration in this lifecycle hook
4. **Register Components**: Ensure all restorable components are in the registry
5. **Use External for Secrets**: Never persist sensitive data

## Troubleshooting

### Component Not Restoring
- Check that component is registered in `getComponentRegistry()`
- Verify `@reference` decorators are correct
- Ensure `onReferencesResolved()` is implemented

### Missing Dependencies
- Verify reference IDs match what Host provides
- Check that providers are registered in Host config
- Ensure secrets are in environment/config

### Persistence Issues
- Check storage directory permissions
- Verify `@persistent` decorators on state
- Look for errors in console during snapshot creation
