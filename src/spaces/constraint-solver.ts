/**
 * Transform Constraint Solver
 * 
 * Automatically orders transforms based on declared provides/requires constraints.
 * Uses topological sort to handle dependency graphs, with helpful error messages.
 */

import { Transform } from './receptor-effector-types';

interface TransformNode {
  transform: Transform;
  provides: Set<string>;
  requires: Set<string>;
  registrationOrder: number;
}

interface MissingDependency {
  capability: string;
  requiredBy: Transform;
}

export class TransformConstraintSolver {
  /**
   * Sort transforms using topological sort based on constraints.
   * Falls back to registration order for transforms without constraints.
   * 
   * @param transforms - Transforms to sort
   * @returns Sorted transforms in execution order
   * @throws Error if circular dependencies or missing providers detected
   */
  solve(transforms: Transform[]): Transform[] {
    if (transforms.length === 0) {
      return [];
    }
    
    // Build dependency graph
    const nodes = this.buildGraph(transforms);
    
    // Validate graph
    this.detectCircularDependencies(nodes);
    const missing = this.findMissingProviders(nodes);
    
    if (missing.length > 0) {
      throw new Error(this.formatMissingDependenciesError(missing));
    }
    
    // Topological sort
    return this.topologicalSort(nodes);
  }
  
  /**
   * Build graph nodes from transforms
   */
  private buildGraph(transforms: Transform[]): TransformNode[] {
    return transforms.map((t, index) => ({
      transform: t,
      provides: new Set(t.provides || []),
      requires: new Set(t.requires || []),
      registrationOrder: index
    }));
  }
  
  /**
   * Detect circular dependencies using DFS
   */
  private detectCircularDependencies(nodes: TransformNode[]): void {
    const visited = new Set<TransformNode>();
    const recursionStack = new Set<TransformNode>();
    
    for (const node of nodes) {
      if (this.hasCycle(node, nodes, visited, recursionStack)) {
        throw new Error(
          `Circular dependency detected involving transform: ${node.transform.constructor.name}\n` +
          `This usually means Transform A requires something Transform B provides, ` +
          `and Transform B requires something Transform A provides.`
        );
      }
    }
  }
  
  /**
   * Check for cycles using DFS
   */
  private hasCycle(
    node: TransformNode,
    allNodes: TransformNode[],
    visited: Set<TransformNode>,
    recursionStack: Set<TransformNode>
  ): boolean {
    if (recursionStack.has(node)) {
      return true;  // Found a cycle
    }
    if (visited.has(node)) {
      return false;  // Already checked
    }
    
    visited.add(node);
    recursionStack.add(node);
    
    // Check all nodes this depends on
    for (const required of node.requires) {
      const provider = allNodes.find(n => n.provides.has(required));
      if (provider && this.hasCycle(provider, allNodes, visited, recursionStack)) {
        return true;
      }
    }
    
    recursionStack.delete(node);
    return false;
  }
  
  /**
   * Find all missing providers
   */
  private findMissingProviders(nodes: TransformNode[]): MissingDependency[] {
    const missing: MissingDependency[] = [];
    
    // Build set of all provided capabilities
    const allProvides = new Set<string>();
    for (const node of nodes) {
      for (const capability of node.provides) {
        allProvides.add(capability);
      }
    }
    
    // Check each requirement
    for (const node of nodes) {
      for (const required of node.requires) {
        if (!allProvides.has(required)) {
          missing.push({
            capability: required,
            requiredBy: node.transform
          });
        }
      }
    }
    
    return missing;
  }
  
  /**
   * Format helpful error message for missing dependencies
   */
  private formatMissingDependenciesError(missing: MissingDependency[]): string {
    const lines = [
      'Transform dependency validation failed:',
      ''
    ];
    
    for (const { capability, requiredBy } of missing) {
      const transformName = requiredBy.constructor.name;
      lines.push(
        `  ❌ ${transformName} requires '${capability}' but no transform provides it.`
      );
      
      // Add helpful suggestions based on known capabilities
      const suggestion = this.suggestProvider(capability);
      if (suggestion) {
        lines.push(`     Hint: ${suggestion}`);
      }
      lines.push('');
    }
    
    lines.push('Registered transforms:');
    for (const { capability, requiredBy } of missing) {
      // Just show the one that failed for clarity
      const node = { transform: requiredBy };
      lines.push(`  - ${requiredBy.constructor.name}`);
      if ((requiredBy as any).provides?.length) {
        lines.push(`    provides: [${(requiredBy as any).provides.join(', ')}]`);
      }
      if ((requiredBy as any).requires?.length) {
        lines.push(`    requires: [${(requiredBy as any).requires.join(', ')}]`);
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Suggest a provider for a capability
   */
  private suggestProvider(capability: string): string | null {
    const knownProviders: Record<string, string> = {
      'frame-snapshots': 'Register FrameSnapshotTransform: space.addTransform(new FrameSnapshotTransform())',
      'compressed-frames': 'Register CompressionTransform: space.addTransform(new CompressionTransform({ engine }))',
      'rendered-context': 'Register ContextTransform: space.addTransform(new ContextTransform(veilState, engine))'
    };
    
    return knownProviders[capability] || null;
  }
  
  /**
   * Topologically sort transforms based on dependencies
   */
  private topologicalSort(nodes: TransformNode[]): Transform[] {
    const sorted: Transform[] = [];
    const visited = new Set<TransformNode>();
    
    // Build adjacency map (what each node depends on)
    const dependsOn = new Map<TransformNode, Set<TransformNode>>();
    for (const node of nodes) {
      const deps = new Set<TransformNode>();
      for (const required of node.requires) {
        // Find the node that provides this capability
        const provider = nodes.find(n => n.provides.has(required));
        if (provider && provider !== node) {
          deps.add(provider);
        }
      }
      dependsOn.set(node, deps);
    }
    
    // DFS visit function
    const visit = (node: TransformNode) => {
      if (visited.has(node)) {
        return;
      }
      visited.add(node);
      
      // Visit all dependencies first (in registration order for stability)
      const deps = dependsOn.get(node) || new Set();
      const sortedDeps = Array.from(deps).sort((a, b) => 
        a.registrationOrder - b.registrationOrder
      );
      
      for (const dep of sortedDeps) {
        visit(dep);
      }
      
      // Then add this transform
      sorted.push(node.transform);
    };
    
    // Visit all nodes in registration order (ensures unconstrained transforms maintain order)
    const sortedNodes = nodes.slice().sort((a, b) => 
      a.registrationOrder - b.registrationOrder
    );
    
    for (const node of sortedNodes) {
      visit(node);
    }
    
    return sorted;
  }
  
  /**
   * Check if any transform uses constraints
   */
  static hasConstraints(transforms: Transform[]): boolean {
    return transforms.some(t => 
      (t.provides && t.provides.length > 0) || 
      (t.requires && t.requires.length > 0)
    );
  }
}

