# Frame Context Architecture

## Overview

VEIL operations (adding/updating facets, changing state) are only allowed during frame processing. This ensures proper ordering and consistency of state changes.

## Design Decision

Instead of tracking "frame context" through complex inheritance patterns or requiring `super.handleEvent()` calls, we use a simple rule:

**VEIL operations are only allowed when `Space.getCurrentFrame()` returns a valid frame.**

## Implementation

```typescript
// In VEILComponent.addOperation()
const frame = space.getCurrentFrame();
if (!frame) {
  throw new Error(
    `VEIL operations are only allowed during frame processing. ` +
    `Move this operation from onMount() to onFirstFrame() or an event handler.`
  );
}
```

## Component Lifecycle

1. **onMount()**: Called when component is attached to element
   - Set up subscriptions
   - Register actions
   - Initialize internal state
   - ❌ Cannot perform VEIL operations

2. **onFirstFrame()**: Called on first frame after mounting
   - ✅ Can perform VEIL operations
   - Initialize facets
   - Set initial VEIL state

3. **handleEvent()**: Called during event processing
   - ✅ Can perform VEIL operations (events are processed during frames)
   - Handle subscribed events
   - Update state in response to events

4. **Action handlers**: Called via element:action events
   - ✅ Can perform VEIL operations (actions are events)
   - Perform element-specific operations
   - Update state based on parameters

## Example

```typescript
class MyComponent extends VEILComponent {
  onMount() {
    // ❌ This would throw an error:
    // this.addFacet({ ... });
    
    // ✅ This is fine:
    this.subscribe('some:event');
    this.registerAction('doSomething', async () => this.handleAction());
  }
  
  onFirstFrame() {
    // ✅ This is the right place for initial facets:
    this.addFacet({
      id: 'my-state',
      type: 'state',
      content: 'Initial state'
    });
  }
  
  async handleEvent(event: SpaceEvent) {
    // No need to call super.handleEvent()!
    
    if (event.topic === 'some:event') {
      // ✅ This works - we're in a frame:
      this.updateState('my-state', {
        content: 'Updated state'
      });
    }
  }
}
```

## Benefits

1. **No inheritance gotchas**: No need to remember to call `super.handleEvent()`
2. **Clear semantics**: Frame processing = state changes allowed
3. **Simple implementation**: Just check if there's a current frame
4. **Fail-fast**: Clear error messages when operations happen at wrong time
5. **Natural timing**: Components initialize their state when the system is ready

## Migration Guide

If you have components that initialize facets in `onMount()`:

```typescript
// Before:
onMount() {
  this.addFacet({ ... });  // This now throws an error
}

// After:
onFirstFrame() {
  this.addFacet({ ... });  // This works!
}
```

The error message will guide you:
```
VEIL operations are only allowed during frame processing.
Move this operation from onMount() to onFirstFrame() or an event handler.
```
