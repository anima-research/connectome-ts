# Transform Ordering in Phase 2

This document explains how transforms are ordered during Phase 2 execution.

## The Problem

Transforms run in Phase 2 to modify VEIL state. Sometimes **order matters** - for example:
- `CompressionTransform` needs to run before `ContextTransform`
- Why? `ContextTransform` reads from the compression engine's cache
- If `ContextTransform` runs first, it won't see any compressed frames

## The Solution: Optional Priority

Connectome uses a **hybrid ordering system**:

### 1. Transforms WITH Priority (Explicit)

Set a `priority` number (lower = runs earlier):

```typescript
class CompressionTransform extends BaseTransform {
  priority = 10;  // Runs early
  // ...
}

class ContextTransform extends BaseTransform {
  priority = 100;  // Runs after compression
  // ...
}
```

**Execution order:** All prioritized transforms run first, sorted by priority value.

### 2. Transforms WITHOUT Priority (Implicit)

Don't set priority:

```typescript
class MyCustomTransform extends BaseTransform {
  // No priority set
  // ...
}
```

**Execution order:** Registration order (first registered = first executed).

### 3. Mixed Scenario

```typescript
// All these transforms registered in this order:
space.addTransform(customTransformA);      // No priority, runs 3rd (first unprioritized)
space.addTransform(compressionTransform);   // priority=10, runs 1st
space.addTransform(customTransformB);      // No priority, runs 4th (second unprioritized)
space.addTransform(contextTransform);      // priority=100, runs 2nd
space.addTransform(customTransformC);      // No priority, runs 5th (third unprioritized)

// Actual execution order:
// 1. compressionTransform (priority=10)
// 2. contextTransform (priority=100)
// 3. customTransformA (no priority, registered first)
// 4. customTransformB (no priority, registered second)
// 5. customTransformC (no priority, registered third)
```

## Priority Guidelines

Use these standard priority values:

```typescript
// Infrastructure transforms (compression, caching, indexing)
priority = 10;

// Derived state transforms (calculations, aggregations)
priority = 50;

// Rendering/presentation transforms (context generation, formatting)
priority = 100;

// Cleanup transforms (removing ephemeral data, GC)
priority = 200;
```

## When to Use Priority

✅ **Use priority when:**
- Transform depends on another transform's output
- Transform mutates shared state (like compression engine)
- Transform affects how other transforms work
- Order is critical to correctness

❌ **Skip priority when:**
- Transform is independent
- Order doesn't matter
- You want simple registration-order behavior

## Implementation Details

The sorting logic in `Space.addTransform()`:

```typescript
addTransform(transform: Transform): void {
  this.transforms.push(transform);
  
  this.transforms.sort((a, b) => {
    const aPriority = a.priority;
    const bPriority = b.priority;
    
    // Both have priority: sort by value (lower first)
    if (aPriority !== undefined && bPriority !== undefined) {
      return aPriority - bPriority;
    }
    
    // Only a has priority: a comes first
    if (aPriority !== undefined) return -1;
    
    // Only b has priority: b comes first
    if (bPriority !== undefined) return 1;
    
    // Neither has priority: maintain registration order (stable sort)
    return 0;
  });
}
```

This is a **stable sort** - transforms without priority maintain their registration order.

## Examples

### Example 1: Critical Ordering (Use Priority)

```typescript
// Compression MUST run before context rendering
const compression = new CompressionTransform({ engine });
compression.priority = 10;  // Explicit priority

const context = new ContextTransform(veilState, engine);
context.priority = 100;     // Explicit priority

space.addTransform(context);      // Register in any order
space.addTransform(compression);  // Order doesn't matter!
// Result: compression runs first due to lower priority
```

### Example 2: Independent Transforms (Skip Priority)

```typescript
// These transforms don't interact
const stateCleanup = new StateCleanupTransform();
const logAggregator = new LogAggregatorTransform();
const metricCalculator = new MetricCalculatorTransform();

// No priority needed - registration order is fine
space.addTransform(stateCleanup);
space.addTransform(logAggregator);
space.addTransform(metricCalculator);
// Result: runs in this order
```

### Example 3: Mixed (Some Priority, Some Not)

```typescript
// Core infrastructure needs priority
const compression = new CompressionTransform({ engine });
compression.priority = 10;

const context = new ContextTransform(veilState, engine);
context.priority = 100;

// Custom transforms don't need priority
const myTransformA = new MyTransformA();
const myTransformB = new MyTransformB();

// Register in any order
space.addTransform(myTransformA);
space.addTransform(compression);
space.addTransform(myTransformB);
space.addTransform(context);

// Execution order:
// 1. compression (10)
// 2. context (100)
// 3. myTransformA (no priority, registered first)
// 4. myTransformB (no priority, registered second)
```

## Best Practices

1. **Document dependencies** in transform class comments:
   ```typescript
   /**
    * ContextTransform - Renders context for agent activations
    * 
    * DEPENDENCIES: Expects CompressionTransform to run first (priority < 100)
    */
   class ContextTransform extends BaseTransform {
     priority = 100;
     // ...
   }
   ```

2. **Use standard priorities** (10, 50, 100, 200) for consistency

3. **Test ordering** - verify critical transforms run in correct order

4. **Keep transforms independent** when possible - less coupling = fewer ordering issues

5. **Consider architectural isolation** - communicate through facets instead of shared mutable state

## Evolution Path: From Priorities to Constraint Solver

**Current (Phase 1): Numeric Priorities**

Priorities work today but have limitations:
- Magic numbers (what does `priority = 50` mean?)
- Fragile in open ecosystems (number collisions)
- No automatic dependency detection

```typescript
class CompressionTransform extends BaseTransform {
  priority = 10;  // Infrastructure
}
```

**Future (Phase 2): Declarative Constraints**

Replace priorities with semantic dependencies:

```typescript
class CompressionTransform extends BaseTransform {
  provides = ['compressed-frames'];
  requires = ['state-changes-finalized']; // optional
}

class ContextTransform extends BaseTransform {
  requires = ['compressed-frames'];  // Auto-orders after CompressionTransform
}

class MyCustomTransform extends BaseTransform {
  // No constraints = flexible placement
}
```

**Constraint Solver Benefits:**

1. **Open Ecosystem Friendly**: New transforms declare needs, system figures out order
2. **Error Detection**: Catches circular dependencies and impossible constraints
3. **Self-Documenting**: `requires = ['compression']` is clearer than `priority = 50`
4. **Automatic Ordering**: Topological sort handles complex dependency graphs

**Implementation Strategy:**

The constraint solver will use topological sort to determine execution order:

```typescript
// In Space.runPhase2()
const sortedTransforms = this.solveTransformOrder(this.transforms);
// Returns transforms in dependency order

// Errors:
// - Circular dependency: A requires B, B requires A
// - Missing provider: Transform requires something no one provides
// - Ambiguous ordering: Multiple valid orders (use registration order as tiebreaker)
```

**Migration Path:**

For now, document intent alongside priorities:

```typescript
class CompressionTransform extends BaseTransform {
  priority = 10;
  // TODO [constraint-solver]: Replace with provides = ['compressed-frames']
  
  // Infrastructure: runs early to populate cache
  // Used by: ContextTransform
}
```

This allows:
- ✅ Priorities work today
- ✅ Intent is documented
- ✅ Future migration is clear
- ✅ Backwards compatibility when constraint solver is implemented

For now, optional priority + registration order provides good balance of:
- Simplicity (most transforms don't need priority)
- Control (critical ordering is explicit)
- Flexibility (non-breaking, opt-in)

