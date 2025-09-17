/**
 * Persistence system exports
 */

export * from './types';
export * from './decorators';
export * from './serialization';
export * from './persistence-manager';
export * from './file-storage';
export * from './restoration';
export * from './transition-manager';

// Re-export commonly used items
export { persistent, persistable, Serializers } from './decorators';
export { PersistenceManager } from './persistence-manager';
export { ComponentRegistry } from './serialization';
export { restoreFromSnapshot } from './restoration';
export { TransitionManager } from './transition-manager';
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
