/**
 * Memory System Types
 * 
 * The Memory System is responsible for:
 * - Summarizing historical events into narrative memories
 * - Extracting key facts from facets
 * - Storing and retrieving memories
 * - Providing relevant context blocks to the HUD
 */

import { Facet } from '../veil/types';

export interface MemoryBlock<TType extends string = string> {
  id: string;
  type: TType;
  content: string;
  metadata?: Record<string, any>;
  source?: Facet; // Original facet if this is a direct conversion
}

export interface MemoryQuery {
  maxBlocks?: number;
  filter?: {
    types?: string[];
    metadata?: Record<string, any>;
    contentPattern?: string;
  };
}

export interface MemoryResult {
  blocks: MemoryBlock[];
  totalMemories: number;
}

export interface MemorySystem {
  /**
   * Process new facets and potentially create memories
   */
  ingest(facets: Map<string, Facet>): Promise<void>;
  
  /**
   * Query memories based on current context
   */
  query(request: MemoryQuery): Promise<MemoryResult>;
  
  /**
   * Get all current memory blocks (raw + processed)
   */
  getAllBlocks(): Promise<MemoryBlock[]>;
  
  /**
   * Clear old memories based on retention policy
   */
  prune(): Promise<void>;
}
