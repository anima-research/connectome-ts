/**
 * Priority-based grouping utilities for MARTEM components
 * Components with lower priority numbers execute first
 */

const DEFAULT_PRIORITY = 50;

/**
 * Group components by priority for ordered execution
 * @param components Array of components with optional priority
 * @returns Map of priority -> components, sorted by priority (ascending)
 */
export function groupByPriority<T extends { priority?: number }>(
  components: T[]
): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  
  for (const component of components) {
    const priority = component.priority ?? DEFAULT_PRIORITY;
    const group = groups.get(priority) || [];
    group.push(component);
    groups.set(priority, group);
  }
  
  // Sort by priority (ascending - lower numbers run first)
  return new Map([...groups.entries()].sort((a, b) => a[0] - b[0]));
}
