# Component-Centric Architecture

## Overview

Connectome now follows a **component-centric architecture** where:
- **Elements** are simple containers (structure)
- **Components** contain all logic and behavior
- **No need to extend Element** for most use cases

This pattern is inspired by successful frameworks like Unity, React, and Vue.

## Key Changes (Breaking)

### 1. Action Declaration Moved to Components

**Before:**
```typescript
class BoxDispenser extends Element {
  static actions = {
    dispense: 'Press the button'
  };
}
```

**After:**
```typescript
class BoxDispenserComponent extends InteractiveComponent {
  static actions = {
    dispense: 'Press the button'
  };
}
```

### 2. Use Factory Functions Instead of Element Subclasses

**Before:**
```typescript
class Box extends Element {
  constructor(config: BoxConfig) {
    super(boxId, boxId);
    this.addComponent(new BoxStateComponent(config));
  }
}

const box = new Box(config);
```

**After:**
```typescript
function createBox(config: BoxConfig): Element {
  const box = new Element(boxId, boxId);
  box.addComponent(new BoxStateComponent(config));
  box.addComponent(new BoxInteractionComponent());
  return box;
}

const box = createBox(config);
```

### 3. Auto-Registration Scans Components

The agent now looks for `static actions` on components, not elements.

## Patterns

### Simple Elements

For simple elements, create them inline:

```typescript
const button = new Element('button', 'Button');
button.addComponent(new ButtonComponent());
space.addChild(button);
```

### Complex Elements

Use factory functions for complex setups:

```typescript
function createControlPanel(): Element {
  const panel = new Element('panel', 'Control Panel');
  panel.addComponent(new DisplayComponent());
  panel.addComponent(new ControlsComponent());
  panel.addComponent(new NetworkComponent());
  return panel;
}
```

### Component Actions

Components declare their actions statically:

```typescript
class CounterComponent extends InteractiveComponent {
  static actions = {
    increment: 'Increase counter',
    reset: { 
      description: 'Reset to zero',
      params: { confirm: { type: 'boolean' } }
    }
  };
  
  onMount() {
    this.registerAction('increment', async () => {
      // Handle increment
    });
  }
}
```

### Component Communication

Components on the same element can find each other:

```typescript
class DisplayComponent extends Component {
  onMount() {
    // Find sibling component
    const controls = this.element.getComponent(ControlsComponent);
    if (controls) {
      // Collaborate with controls
    }
  }
}
```

## Benefits

1. **Cleaner Architecture** - Clear separation between structure and behavior
2. **Better Reusability** - Components can be mixed and matched
3. **Easier Testing** - Test components in isolation
4. **Less Boilerplate** - No Element subclass boilerplate
5. **More Flexible** - Compose behaviors by adding components

## When to Extend Element

Only extend Element for special cases:

1. **Space** - Root element with frame processing
2. **AxonElement** - Dynamic component loading
3. Custom elements needing special event routing (rare)

Otherwise, **always use components**!

## Migration Guide

To migrate existing code:

1. Move `static actions` from Element to Component
2. Replace Element subclasses with factory functions
3. Move all logic into components
4. Update imports from class names to factory functions

Example migration:

```typescript
// Old
import { BoxDispenser } from './box-dispenser';
const dispenser = new BoxDispenser(llmProvider);

// New
import { createBoxDispenser } from './box-dispenser';
const dispenser = createBoxDispenser(llmProvider);
```

## Examples

See these examples for the new patterns:
- `examples/component-centric-pattern.ts` - Overview of patterns
- `examples/test-box-dispenser.ts` - Complex multi-component example
- `examples/test-component-actions.ts` - Simple action test
