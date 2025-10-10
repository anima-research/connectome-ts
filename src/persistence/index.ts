/**
 * Persistence system exports
 */

export * from './types';
export * from './decorators';
export * from './serialization';
export * from './persistence-manager';
export * from './persistence-maintainer';
export * from './file-storage';
export * from './restoration';
export * from './transition-manager';
export * from './transition-maintainer';

// Re-export commonly used items
export { persistent, persistable, Serializers } from './decorators';
export { PersistenceManager } from './persistence-manager';
export { PersistenceMaintainer } from './persistence-maintainer';
export { ComponentRegistry } from './serialization';
export { restoreFromSnapshot } from './restoration';
export { TransitionManager } from './transition-manager';
export { TransitionMaintainer } from './transition-maintainer';
export {
  ElementOperation as TransitionElementOperation,
  ComponentOperation as TransitionComponentOperation,
  ComponentChange as TransitionComponentChange,
  TransitionNode,
  TransitionSnapshot,
  TransitionApplicator,
  SnapshotProvider,
  FrameTransition as PersistenceFrameTransition
} from './transition-types';
