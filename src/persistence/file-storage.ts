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
    try {
      const filepath = path.join(this.snapshotDir, id);
      const data = await readFile(filepath, 'utf-8');
      const snapshot = JSON.parse(data);
      
      // Validate snapshot structure
      if (!snapshot || typeof snapshot !== 'object') {
        console.error('Invalid snapshot: not an object');
        return null;
      }
      
      if (!snapshot.elements || typeof snapshot.elements !== 'object') {
        console.error('Invalid snapshot: missing or invalid elements');
        return null;
      }
      
      if (!Array.isArray(snapshot.elements.children)) {
        console.error('Invalid snapshot: elements.children is not an array');
        return null;
      }
      
      return snapshot;
    } catch (error) {
      console.error('Failed to load snapshot:', error);
      return null;
    }
  }
  
  /**
   * List available snapshots
   */
  async listSnapshots(): Promise<string[]> {
    try {
      const files = await readdir(this.snapshotDir);
      return files
        .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
        .sort();
    } catch (error) {
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
    const dir = path.dirname(fullPath);
    
    // Ensure directory exists
    await mkdir(dir, { recursive: true });
    
    await writeFile(fullPath, content);
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
