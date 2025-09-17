/**
 * Persistence system types and interfaces
 */

import { VEILState, OutgoingVEILFrame, IncomingVEILFrame, StreamRef } from '../veil/types';
import { ElementRef } from '../spaces/types';
import type { RenderedContext } from '../hud/types-v2';

/**
 * Serialization types
 */
export type SerializableValue = 
  | string 
  | number 
  | boolean 
  | null 
  | undefined
  | SerializableValue[]
  | { [key: string]: SerializableValue }
  | Date
  | Set<SerializableValue>
  | Map<string, SerializableValue>;

/**
 * Custom serializer function
 */
export interface Serializer<T> {
  serialize(value: T): SerializableValue;
  deserialize(value: SerializableValue): T;
}

/**
 * Metadata for persistent properties
 */
export interface PersistentPropertyMetadata {
  key: string;
  serializer?: Serializer<any>;
  version?: number;
}

/**
 * Component persistence metadata
 */
export interface ComponentPersistenceMetadata {
  className: string;
  version: number;
  properties: Map<string, PersistentPropertyMetadata>;
}

/**
 * Serialized component state
 */
export interface SerializedComponent {
  className: string;
  version: number;
  properties: Record<string, SerializableValue>;
}

/**
 * Serialized element
 */
export interface SerializedElement {
  id: string;
  name: string;
  type: string;
  active: boolean;
  subscriptions: string[];
  components: SerializedComponent[];
  children: SerializedElement[];
}

/**
 * Persistence snapshot
 */
export interface PersistenceSnapshot {
  version: number;
  timestamp: string;
  sequence: number;
  
  // Core state
  veilState: SerializedVEILState;
  elementTree: SerializedElement;
  
  // Optional compressed frame history
  compressedFrames?: CompressedFrameBatch[];
  
  // Metadata
  metadata?: Record<string, any>;
}

/**
 * Serialized VEIL state
 */
export interface SerializedVEILState {
  facets: Array<[string, any]>;  // Facet serialization
  scopes: string[];
  streams: Array<[string, any]>;
  currentStream?: any;
  currentSequence: number;
  frameHistory?: Array<any>;  // Serialized frame history
}

/**
 * Compressed frame batch for memory system
 */
export interface CompressedFrameBatch {
  startSequence: number;
  endSequence: number;
  compressed: string;  // Base64 encoded compressed data
  summary?: string;   // AI-generated summary
}

/**
 * Frame delta (incremental change)
 */
export interface FrameDelta {
  sequence: number;
  timestamp: string;
  frame: IncomingVEILFrame | OutgoingVEILFrame;
  elementOperations?: ElementOperation[];
  renderedContext?: RenderedContextSnapshot;
}

export interface RenderedContextSnapshot {
  sequence: number;
  recordedAt: string;
  context: RenderedContext;
  agentId?: string;
  agentName?: string;
  streamRef?: StreamRef;
  frameUUID?: string;
}

/**
 * Element tree operations
 */
export type ElementOperation = 
  | { type: 'add'; parent: ElementRef; element: SerializedElement }
  | { type: 'remove'; element: ElementRef }
  | { type: 'update'; element: ElementRef; changes: Partial<SerializedElement> }
  | { type: 'addComponent'; element: ElementRef; component: SerializedComponent }
  | { type: 'removeComponent'; element: ElementRef; componentIndex: number };

/**
 * Persistence configuration
 */
export interface PersistenceConfig {
  // Snapshot settings
  snapshotInterval?: number;  // Frames between snapshots (default: 100)
  maxSnapshots?: number;      // Max snapshots to keep (default: 10)
  
  // Delta settings  
  maxDeltasPerSnapshot?: number;  // Max deltas before forced snapshot (default: 500)
  compressDeltas?: boolean;       // Whether to compress deltas (default: true)
  
  // Storage settings
  storagePath?: string;      // Where to store persistence files
  storageAdapter?: StorageAdapter;  // Custom storage adapter
  
  // Memory system
  enableMemoryCompression?: boolean;  // Enable frame batch compression
  compressionBatchSize?: number;      // Frames per compression batch

  // Rendered context persistence
  persistRenderedContext?: boolean;   // Persist rendered context snapshots (default: true)
}

/**
 * Storage adapter interface
 */
export interface StorageAdapter {
  saveSnapshot(snapshot: PersistenceSnapshot): Promise<void>;
  loadSnapshot(id: string): Promise<PersistenceSnapshot | null>;
  listSnapshots(): Promise<string[]>;
  
  saveDelta(delta: FrameDelta): Promise<void>;
  loadDeltas(fromSequence: number, toSequence?: number): Promise<FrameDelta[]>;
  
  clear(): Promise<void>;
}

/**
 * Persistence events
 */
export interface PersistenceEvents {
  'persistence:snapshot-created': { snapshot: PersistenceSnapshot };
  'persistence:snapshot-loaded': { snapshot: PersistenceSnapshot };
  'persistence:delta-saved': { delta: FrameDelta };
  'persistence:restore-complete': { sequence: number };
  'persistence:error': { error: Error; operation: string };
}
