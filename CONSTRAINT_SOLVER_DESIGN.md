# Transform Constraint Solver Design

## Motivation

Numeric priorities are a pragmatic stopgap but have limitations:
- **Magic numbers**: What does `priority = 50` mean?
- **Fragile**: Number collisions in open ecosystems
- **No dependency detection**: Can't automatically order transforms

## Target API

### Declarative Constraints

```typescript
class CompressionTransform extends BaseTransform {
  provides = ['compressed-frames'];
  requires = ['state-changes-finalized']; // optional
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    // ...
  }
}

class ContextTransform extends BaseTransform {
  requires = ['compressed-frames'];  // Automatically ordered after CompressionTransform
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    // ...
  }
}

class IndependentTransform extends BaseTransform {
  // No constraints = flexible placement (uses registration order as tiebreaker)
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    // ...
  }
}
```

## Implementation

### 1. Type Extensions

```typescript
// src/spaces/receptor-effector-types.ts
export interface Transform extends Component {
  priority?: number;  // Keep for backwards compatibility
  
  // New constraint fields
  provides?: string[];   // Capabilities this transform provides
  requires?: string[];   // Capabilities this transform needs
  
  facetFilters?: FacetFilter[];
  process(state: ReadonlyVEILState): VEILDelta[];
}
```

### 2. Constraint Solver

```typescript
// src/spaces/constraint-solver.ts

interface TransformNode {
  transform: Transform;
  provides: Set<string>;
  requires: Set<string>;
  registrationOrder: number;
}

export class TransformConstraintSolver {
  /**
   * Sort transforms using topological sort based on constraints
   * Falls back to registration order for transforms without constraints
   * 
   * @throws Error if circular dependencies or missing providers detected
   */
  solve(transforms: Transform[]): Transform[] {
    // Build dependency graph
    const nodes = this.buildGraph(transforms);
    
    // Detect errors
    this.detectCircularDependencies(nodes);
    this.detectMissingProviders(nodes);
    
    // Topological sort
    return this.topologicalSort(nodes);
  }
  
  private buildGraph(transforms: Transform[]): TransformNode[] {
    return transforms.map((t, index) => ({
      transform: t,
      provides: new Set(t.provides || []),
      requires: new Set(t.requires || []),
      registrationOrder: index
    }));
  }
  
  private detectCircularDependencies(nodes: TransformNode[]): void {
    // DFS cycle detection
    const visited = new Set<TransformNode>();
    const recursionStack = new Set<TransformNode>();
    
    for (const node of nodes) {
      if (this.hasCycle(node, nodes, visited, recursionStack)) {
        throw new Error(
          `Circular dependency detected involving: ${node.transform.constructor.name}`
        );
      }
    }
  }
  
  private detectMissingProviders(nodes: TransformNode[]): void {
    const allProvides = new Set<string>();
    for (const node of nodes) {
      for (const capability of node.provides) {
        allProvides.add(capability);
      }
    }
    
    for (const node of nodes) {
      for (const required of node.requires) {
        if (!allProvides.has(required)) {
          throw new Error(
            `Transform ${node.transform.constructor.name} requires '${required}' ` +
            `but no transform provides it`
          );
        }
      }
    }
  }
  
  private topologicalSort(nodes: TransformNode[]): Transform[] {
    const sorted: Transform[] = [];
    const visited = new Set<TransformNode>();
    
    // Build adjacency info
    const dependsOn = new Map<TransformNode, Set<TransformNode>>();
    for (const node of nodes) {
      const deps = new Set<TransformNode>();
      for (const required of node.requires) {
        // Find node that provides this
        const provider = nodes.find(n => n.provides.has(required));
        if (provider && provider !== node) {
          deps.add(provider);
        }
      }
      dependsOn.set(node, deps);
    }
    
    // DFS visit
    const visit = (node: TransformNode) => {
      if (visited.has(node)) return;
      visited.add(node);
      
      // Visit dependencies first
      const deps = dependsOn.get(node) || new Set();
      const sortedDeps = Array.from(deps).sort((a, b) => 
        a.registrationOrder - b.registrationOrder
      );
      for (const dep of sortedDeps) {
        visit(dep);
      }
      
      sorted.push(node.transform);
    };
    
    // Visit all nodes in registration order (for unconstrained transforms)
    const sortedNodes = nodes.slice().sort((a, b) => 
      a.registrationOrder - b.registrationOrder
    );
    for (const node of sortedNodes) {
      visit(node);
    }
    
    return sorted;
  }
  
  private hasCycle(
    node: TransformNode,
    allNodes: TransformNode[],
    visited: Set<TransformNode>,
    recStack: Set<TransformNode>
  ): boolean {
    if (recStack.has(node)) return true;
    if (visited.has(node)) return false;
    
    visited.add(node);
    recStack.add(node);
    
    // Check all nodes this depends on
    for (const required of node.requires) {
      const provider = allNodes.find(n => n.provides.has(required));
      if (provider && this.hasCycle(provider, allNodes, visited, recStack)) {
        return true;
      }
    }
    
    recStack.delete(node);
    return false;
  }
}
```

### 3. Integration into Space

```typescript
// src/spaces/space.ts

import { TransformConstraintSolver } from './constraint-solver';

export class Space extends Element {
  private constraintSolver = new TransformConstraintSolver();
  
  addTransform(transform: Transform): void {
    this.transforms.push(transform);
    
    // Try constraint solver first, fall back to priority
    if (this.anyTransformHasConstraints()) {
      try {
        this.transforms = this.constraintSolver.solve(this.transforms);
      } catch (error) {
        console.error('[Space] Constraint solver error:', error);
        // Fall back to priority-based sorting
        this.sortTransformsByPriority();
      }
    } else {
      // No constraints used, use priority-based sorting
      this.sortTransformsByPriority();
    }
  }
  
  private anyTransformHasConstraints(): boolean {
    return this.transforms.some(t => t.provides || t.requires);
  }
  
  private sortTransformsByPriority(): void {
    // Existing priority-based sort logic
    this.transforms.sort((a, b) => {
      // ... existing code ...
    });
  }
}
```

## Migration Strategy

### Phase 1: Add Fields (Backwards Compatible)

```typescript
// Add optional fields to Transform interface
export interface Transform extends Component {
  priority?: number;
  provides?: string[];  // NEW
  requires?: string[];  // NEW
  // ...
}
```

### Phase 2: Update Core Transforms

```typescript
// Update built-in transforms
class CompressionTransform extends BaseTransform {
  provides = ['compressed-frames'];
  // Keep priority for backwards compatibility
  priority = 10;
}
```

### Phase 3: Enable Constraint Solver

```typescript
// Space automatically uses constraint solver when any transform has constraints
// Falls back to priority if no constraints present or if solver errors
```

### Phase 4: Deprecate Priorities

```typescript
// Add deprecation warning
if (transform.priority !== undefined && !transform.provides && !transform.requires) {
  console.warn(
    `Transform ${transform.constructor.name} uses deprecated priority field. ` +
    `Consider using provides/requires constraints instead.`
  );
}
```

## Standard Capability Names

Define conventional capability names to encourage consistency:

```typescript
// src/spaces/transform-capabilities.ts

export const TransformCapabilities = {
  // Infrastructure
  COMPRESSED_FRAMES: 'compressed-frames',
  STATE_CHANGES: 'state-changes',
  INDEXES: 'indexes',
  
  // Derivation
  DERIVED_STATE: 'derived-state',
  METRICS: 'metrics',
  AGGREGATIONS: 'aggregations',
  
  // Rendering
  RENDERED_CONTEXT: 'rendered-context',
  FORMATTED_OUTPUT: 'formatted-output',
  
  // Cleanup
  EPHEMERAL_CLEANUP: 'ephemeral-cleanup',
  GC: 'garbage-collection'
} as const;

// Usage:
class CompressionTransform extends BaseTransform {
  provides = [TransformCapabilities.COMPRESSED_FRAMES];
}
```

## Benefits

1. **Open Ecosystem**: New transforms declare needs, system figures out order
2. **Error Detection**: Catches circular dependencies and impossible constraints  
3. **Self-Documenting**: Semantic names clarify intent
4. **Automatic Ordering**: Topological sort handles complex graphs
5. **Backwards Compatible**: Priority still works if no constraints used
6. **Gradual Migration**: Can mix priorities and constraints during transition

## Testing

```typescript
// Test circular dependencies
it('detects circular dependencies', () => {
  const transformA = { requires: ['b'], provides: ['a'] };
  const transformB = { requires: ['a'], provides: ['b'] };
  
  expect(() => solver.solve([transformA, transformB]))
    .toThrow('Circular dependency');
});

// Test missing providers
it('detects missing providers', () => {
  const transform = { requires: ['nonexistent'] };
  
  expect(() => solver.solve([transform]))
    .toThrow("requires 'nonexistent' but no transform provides it");
});

// Test correct ordering
it('orders transforms by dependencies', () => {
  const compression = { provides: ['compressed-frames'] };
  const context = { requires: ['compressed-frames'] };
  
  const sorted = solver.solve([context, compression]);
  
  expect(sorted).toEqual([compression, context]);
});
```

## Future Enhancements

- **Conditional Constraints**: `requires = ['compressed-frames?']` (optional)
- **Version Constraints**: `requires = ['compressed-frames@v2']`
- **Conflict Detection**: `conflicts = ['old-compression']`
- **Capability Introspection**: `space.getTransformsProviding('compressed-frames')`
