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

export interface MemoryBlock {
  id: string;
  type: 'narrative' | 'fact' | 'pattern' | 'raw';
  content: string;
  metadata?: {
    summary?: boolean;
    originalFacets?: string[]; // IDs of facets this summarizes
    timestamp?: string;
    tags?: string[];
    relevanceScore?: number;
  };
  source?: Facet; // Original facet if type is 'raw'
}

export interface MemoryQuery {
  maxBlocks?: number;
  includeTypes?: MemoryBlock['type'][];
  tags?: string[];
  minRelevance?: number;
  timeRange?: {
    start?: string;
    end?: string;
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
