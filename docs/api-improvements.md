# Connectome API Improvements

This document summarizes the API improvements made to simplify Connectome development, especially for AXON component developers.

## Implemented Improvements

### 1. Auto-wire Agent-Space Connection ✅

**Before:**
```typescript
space.setAgent(agent);
(agent as any).setSpace(space, space.id); // Easy to forget!
```

**After:**
```typescript
space.setAgent(agent); // Automatically wires bidirectional connection
```

### 2. Built-in Action Handling for Elements ✅

**Before:**
```typescript
// Complex manual action routing
class ActionHandler extends Component {
  onMount() {
    this.element.subscribe('element:action');
  }
  
  async handleEvent(event) {
    if (event.topic === 'element:action') {
      const payload = event.payload;
      const elementPath = payload.path?.slice(0, -1).join('.');
      const action = payload.path?.[payload.path.length - 1];
      // Manual routing logic...
    }
  }
}
```

**After:**
```typescript
class MyElement extends Element {
  async handleAction(action: string, parameters?: any): Promise<any> {
    if (action === 'ping') {
      // Direct handler
    }
  }
}
// Element automatically subscribes to element:action and routes to handleAction
```

### 3. Component Convenience Methods ✅

**Before:**
```typescript
class MyComponent extends Component {
  onMount() {
    this.element.subscribe('my.event');
  }
  
  doSomething() {
    this.element.emit({
      topic: 'my.event',
      source: this.element.getRef(),
      payload: { data: 'test' },
      timestamp: Date.now()
    });
  }
}
```

**After:**
```typescript
class MyComponent extends Component {
  onMount() {
    this.subscribe('my.event'); // Direct method
  }
  
  doSomething() {
    this.emit({
      topic: 'my.event',
      payload: { data: 'test' },
      timestamp: Date.now()
    }); // Source automatically added
  }
}
```

Additional convenience methods:
- `this.subscribe(topic)` - Subscribe to events
- `this.emit(event)` - Emit events (auto-adds source)
- `this.findChild(id)` - Find child elements
- `this.elementId` - Get parent element ID
- `this.getRef()` - Get element reference

### 4. Smart Tool Registration ✅

**Before:**
```typescript
agent.registerTool({
  name: 'test.ping',
  description: 'Send a ping to the test component',
  parameters: {},
  elementPath: ['test'],
  emitEvent: {
    topic: 'element:action',
    payloadTemplate: {}
  }
});
```

**After:**
```typescript
agent.registerTool('test.ping'); // Infers all defaults!
```

## Usage Example

Here's how clean AXON component development is now:

```typescript
// Define an element with action handling
class GameElement extends AxonElement {
  async handleAction(action: string, params?: any) {
    switch (action) {
      case 'move':
        return this.handleMove(params.direction);
      case 'attack':
        return this.handleAttack(params.target);
    }
  }
}

// Register tools simply
agent.registerTool('game.move');
agent.registerTool('game.attack');

// Components use convenience methods
class GameComponent extends Component {
  onMount() {
    this.subscribe('player.moved');
    this.subscribe('enemy.spawned');
  }
  
  async handleEvent(event: SpaceEvent) {
    if (event.topic === 'player.moved') {
      this.emit({
        topic: 'game.update',
        payload: { position: event.payload.position }
      });
    }
  }
}
```

## Future Enhancements

### Decorator Support (Planned)

```typescript
class BoxDispenser extends InteractiveComponent {
  @action async dispense() { /* ... */ }
  @action async setSize(size: string) { /* ... */ }
}

class GameComponent extends Component {
  @subscribe('player.moved')
  async onPlayerMoved(event: SpaceEvent) { /* ... */ }
}
```

## Benefits

1. **Less Boilerplate** - Dramatically reduced code for common patterns
2. **Fewer Gotchas** - Auto-wiring prevents common mistakes
3. **Cleaner Code** - Focus on business logic, not plumbing
4. **Better Defaults** - Smart inference of common configurations
5. **Intuitive API** - Methods are where developers expect them

## Migration Guide

Existing code continues to work. To adopt improvements:

1. Remove manual `setSpace` calls after `space.setAgent()`
2. Replace complex action handlers with `handleAction` methods
3. Use convenience methods in components (`this.emit`, `this.subscribe`)
4. Simplify tool registration to just the tool name when possible

The improvements are backward compatible - old patterns still work while new patterns provide a cleaner alternative.
