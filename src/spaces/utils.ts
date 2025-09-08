/**
 * Generate a unique identifier
 */
export function generateId(): string {
  return `elem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Simple pattern matching for topic subscriptions
 * Supports exact matches and wildcard patterns ending with *
 */
export function matchesTopic(pattern: string, topic: string): boolean {
  if (pattern === '*') return true;
  if (pattern === topic) return true;
  
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return topic.startsWith(prefix);
  }
  
  return false;
}
