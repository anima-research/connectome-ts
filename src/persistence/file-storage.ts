/**
 * File-based storage adapter for persistence
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import {
  StorageAdapter,
  PersistenceSnapshot,
  FrameDelta
} from './types';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

export class FileStorageAdapter implements StorageAdapter {
  private basePath: string;
  private snapshotDir: string;
  private deltaDir: string;
  
  // Write locks to prevent concurrent writes to the same file
  private writeLocks: Map<string, Promise<void>> = new Map();
  
  constructor(basePath: string) {
    this.basePath = basePath;
    this.snapshotDir = path.join(basePath, 'snapshots');
    this.deltaDir = path.join(basePath, 'deltas');
    
    console.log('[FileStorageAdapter] Created with basePath:', this.basePath);
    console.log('[FileStorageAdapter] snapshotDir:', this.snapshotDir);
    console.log('[FileStorageAdapter] deltaDir:', this.deltaDir);
    
    // Ensure directories exist
    this.ensureDirectories();
  }
  
  private async ensureDirectories() {
    try {
      await mkdir(this.basePath, { recursive: true });
      await mkdir(this.snapshotDir, { recursive: true });
      await mkdir(this.deltaDir, { recursive: true });
    } catch (error) {
      // Directories might already exist
    }
  }
  
  /**
   * Save a snapshot
   */
  async saveSnapshot(snapshot: PersistenceSnapshot): Promise<void> {
    await this.ensureDirectories();
    
    const filename = `snapshot-${snapshot.sequence}-${Date.now()}.json`;
    const filepath = path.join(this.snapshotDir, filename);
    const tempPath = filepath + '.tmp';
    
    try {
      // Write to temporary file first
      await writeFile(tempPath, JSON.stringify(snapshot, null, 2));
      
      // Atomically rename temp file to final destination
      await promisify(fs.rename)(tempPath, filepath);
      
      // Clean up old snapshots
      await this.cleanupOldSnapshots();
    } catch (error) {
      // Clean up temp file if something went wrong
      try {
        await unlink(tempPath);
      } catch {}
      throw error;
    }
  }
  
  /**
   * Load a snapshot
   */
  async loadSnapshot(id: string): Promise<PersistenceSnapshot | null> {
    const filepath = path.join(this.snapshotDir, id);
    console.log(`[FileStorageAdapter] Attempting to load snapshot: ${id} from ${filepath}`);
    
    try {
      const data = await readFile(filepath, 'utf-8');
      console.log(`[FileStorageAdapter] Read ${data.length} bytes from snapshot file`);
      
      const snapshot = JSON.parse(data);
      
      // Validate snapshot structure
      if (!snapshot || typeof snapshot !== 'object') {
        console.error(`[FileStorageAdapter] Invalid snapshot ${id}: not an object`);
        return null;
      }
      
      console.log(`[FileStorageAdapter] Snapshot ${id} basic structure:`, {
        hasElementTree: !!snapshot.elementTree,
        hasVeilState: !!snapshot.veilState,
        sequence: snapshot.sequence,
        frameCount: snapshot.veilState?.frames?.length || 0
      });
      
      if (!snapshot.elementTree || typeof snapshot.elementTree !== 'object') {
        console.error(`[FileStorageAdapter] Invalid snapshot ${id}: missing or invalid elementTree`);
        return null;
      }
      
      if (!Array.isArray(snapshot.elementTree.children)) {
        console.error(`[FileStorageAdapter] Invalid snapshot ${id}: elementTree.children is not an array`);
        return null;
      }
      
      console.log(`[FileStorageAdapter] Successfully loaded snapshot ${id} with sequence ${snapshot.sequence}`);
      return snapshot;
    } catch (error) {
      console.error(`[FileStorageAdapter] Failed to load snapshot ${id}:`, error);
      return null;
    }
  }
  
  /**
   * List available snapshots
   */
  async listSnapshots(): Promise<string[]> {
    try {
      const files = await readdir(this.snapshotDir);
      const snapshotFiles = files.filter(f => f.startsWith('snapshot-') && f.endsWith('.json'));
      
      console.log(`[FileStorageAdapter] Found ${snapshotFiles.length} snapshot files in ${this.snapshotDir}:`);
      snapshotFiles.forEach(f => console.log(`  - ${f}`));
      
      const sorted = snapshotFiles.sort((a, b) => {
        // Extract sequence numbers and timestamps for proper numeric sorting
        // Handle both formats:
        // - snapshot-{sequence}-{timestamp}.json (from FileStorageAdapter)
        // - snapshot-{sequence}-{branch}-{timestamp}.json (from TransitionManager)
        
        // Try format with branch first
        let aMatch = a.match(/snapshot-(\d+)-(\w+)-(\d+)\.json/);
        let bMatch = b.match(/snapshot-(\d+)-(\w+)-(\d+)\.json/);
        
        let aSeq, aTime, bSeq, bTime;
        
        if (aMatch) {
          aSeq = parseInt(aMatch[1]);
          aTime = parseInt(aMatch[3]); // Note: timestamp is at index 3 when branch is present
        } else {
          // Try format without branch
          aMatch = a.match(/snapshot-(\d+)-(\d+)\.json/);
          if (aMatch) {
            aSeq = parseInt(aMatch[1]);
            aTime = parseInt(aMatch[2]);
          }
        }
        
        if (bMatch) {
          bSeq = parseInt(bMatch[1]);
          bTime = parseInt(bMatch[3]); // Note: timestamp is at index 3 when branch is present
        } else {
          // Try format without branch
          bMatch = b.match(/snapshot-(\d+)-(\d+)\.json/);
          if (bMatch) {
            bSeq = parseInt(bMatch[1]);
            bTime = parseInt(bMatch[2]);
          }
        }
        
        if (!aMatch || aTime === undefined) {
          console.warn(`[FileStorageAdapter] Snapshot filename doesn't match expected pattern: ${a}`);
          if (!bMatch || bTime === undefined) return a.localeCompare(b);
          return 1; // Put non-matching files at the end
        }
        if (!bMatch || bTime === undefined) {
          console.warn(`[FileStorageAdapter] Snapshot filename doesn't match expected pattern: ${b}`);
          return -1; // Put non-matching files at the end
        }
        
        // Sort by timestamp in ascending order (oldest to newest)
        // The host takes the last element, so the newest will be at the end
        // This allows for deletion of garbage frames, updates, etc.
        const result = aTime - bTime;
        console.log(`[FileStorageAdapter] Compare: ${a} (seq=${aSeq}, time=${aTime}) vs ${b} (seq=${bSeq}, time=${bTime}) => ${result}`);
        return result;
      });
      
      console.log(`[FileStorageAdapter] Sorted snapshots (oldest to newest):`);
      sorted.forEach((f, i) => {
        const match = f.match(/snapshot-(\d+)-(?:(\w+)-)?(\d+)\.json/);
        if (match) {
          const seq = match[1];
          const branch = match[2] || 'none';
          const timestamp = match[3];
          console.log(`  ${i}: ${f} (seq=${seq}, branch=${branch}, time=${timestamp})`);
        }
      });
      
      if (sorted.length > 0) {
        console.log(`[FileStorageAdapter] Latest snapshot will be: ${sorted[sorted.length - 1]}`);
      }
      
      return sorted;
    } catch (error) {
      console.error('[FileStorageAdapter] Error listing snapshots:', error);
      return [];
    }
  }
  
  /**
   * Save a delta
   */
  async saveDelta(delta: FrameDelta): Promise<void> {
    await this.ensureDirectories();
    
    const filename = `delta-${delta.sequence}.json`;
    const filepath = path.join(this.deltaDir, filename);
    
    // Compress if configured
    const data = this.config?.compressDeltas 
      ? await this.compressDelta(delta)
      : JSON.stringify(delta);
    
    await writeFile(filepath, data);
  }
  
  /**
   * Load deltas
   */
  async loadDeltas(fromSequence: number, toSequence?: number): Promise<FrameDelta[]> {
    try {
      const files = await readdir(this.deltaDir);
      const deltaFiles = files
        .filter(f => f.startsWith('delta-') && f.endsWith('.json'))
        .sort();
      
      const deltas: FrameDelta[] = [];
      
      for (const file of deltaFiles) {
        const match = file.match(/delta-(\d+)\.json/);
        if (!match) continue;
        
        const sequence = parseInt(match[1]);
        if (sequence < fromSequence) continue;
        if (toSequence && sequence > toSequence) break;
        
        const filepath = path.join(this.deltaDir, file);
        const data = await readFile(filepath, 'utf-8');
        
        const delta = this.config?.compressDeltas
          ? await this.decompressDelta(data)
          : JSON.parse(data);
          
        deltas.push(delta);
      }
      
      return deltas;
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Clear all stored data
   */
  async clear(): Promise<void> {
    // Clear snapshots
    try {
      const snapshots = await readdir(this.snapshotDir);
      for (const file of snapshots) {
        await unlink(path.join(this.snapshotDir, file));
      }
    } catch (error) {
      // Ignore errors
    }
    
    // Clear deltas
    try {
      const deltas = await readdir(this.deltaDir);
      for (const file of deltas) {
        await unlink(path.join(this.deltaDir, file));
      }
    } catch (error) {
      // Ignore errors
    }
  }
  
  /**
   * Clean up old snapshots
   */
  private async cleanupOldSnapshots() {
    // TODO: Implement cleanup based on maxSnapshots config
  }
  
  /**
   * Compress a delta
   */
  private async compressDelta(delta: FrameDelta): Promise<string> {
    // TODO: Implement compression (e.g., using zlib)
    return JSON.stringify(delta);
  }
  
  /**
   * Decompress a delta
   */
  private async decompressDelta(data: string): Promise<FrameDelta> {
    // TODO: Implement decompression
    return JSON.parse(data);
  }
  
  private config?: { compressDeltas?: boolean };
  
  /**
   * Write a file to a relative path
   */
  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.basePath, relativePath);
    
    // Wait for any existing write to this file to complete
    const existingWrite = this.writeLocks.get(fullPath);
    if (existingWrite) {
      console.log(`[FileStorageAdapter] Waiting for existing write to complete: ${relativePath}`);
      await existingWrite;
    }
    
    // Create a new write promise
    const writePromise = this.performWrite(fullPath, content);
    this.writeLocks.set(fullPath, writePromise);
    
    try {
      await writePromise;
    } finally {
      // Clean up the lock
      this.writeLocks.delete(fullPath);
    }
  }
  
  private async performWrite(fullPath: string, content: string): Promise<void> {
    const dir = path.dirname(fullPath);
    
    // Ensure directory exists
    await mkdir(dir, { recursive: true });
    
    // Write atomically by writing to a temp file first
    const tempPath = `${fullPath}.tmp`;
    await writeFile(tempPath, content);
    
    // Rename to final location (atomic on most filesystems)
    await promisify(fs.rename)(tempPath, fullPath);
  }
  
  /**
   * Read a file from a relative path
   */
  async readFile(relativePath: string): Promise<string> {
    const fullPath = path.join(this.basePath, relativePath);
    return readFile(fullPath, 'utf-8');
  }
  
  /**
   * List files in a directory
   */
  async listFiles(relativePath: string): Promise<string[]> {
    const fullPath = path.join(this.basePath, relativePath);
    console.log('[FileStorageAdapter] Listing files in:', fullPath);
    try {
      const files = await readdir(fullPath);
      console.log('[FileStorageAdapter] Found files:', files);
      return files;
    } catch (error) {
      console.log('[FileStorageAdapter] Error listing files:', error);
      return [];
    }
  }
  
  /**
   * Delete a file
   */
  async deleteFile(relativePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, relativePath);
    try {
      await unlink(fullPath);
      console.log('[FileStorageAdapter] Deleted file:', fullPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, that's okay
        console.log('[FileStorageAdapter] File not found (already deleted?):', fullPath);
        return;
      }
      console.error('[FileStorageAdapter] Error deleting file:', error);
      throw error;
    }
  }
}
