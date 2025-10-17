/**
 * Frame Bucket Store - Content-addressed frame storage
 * 
 * Frames are immutable once created, so we can store them in buckets
 * and reference them by hash. This drastically reduces snapshot size
 * since we don't duplicate frame history in every snapshot.
 */

import * as crypto from 'crypto';
import { Frame } from '../veil/types';
import * as fs from 'fs/promises';
import { dirname } from 'path';
import * as path from 'path';

export interface FrameBucket {
  hash: string;
  startSequence: number;
  endSequence: number;
  frameCount: number;
  frames: Frame[];
}

export interface FrameBucketRef {
  hash: string;
  startSequence: number;
  endSequence: number;
  frameCount: number;
}

export interface FrameBucketStoreConfig {
  storageDir: string;
  bucketSize?: number;  // Frames per bucket (default: 100)
}

export class FrameBucketStore {
  private storageDir: string;
  private bucketSize: number;
  private bucketCache = new Map<string, FrameBucket>();
  private maxCacheSize = 10;  // Keep last 10 buckets in memory
  
  constructor(config: FrameBucketStoreConfig) {
    this.storageDir = path.join(config.storageDir, 'frame-buckets');
    this.bucketSize = config.bucketSize || 100;
  }
  
  async initialize(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
  }
  
  /**
   * Create buckets from frame history
   * Returns references to buckets (with hashes)
   */
  async createBuckets(frames: Frame[]): Promise<FrameBucketRef[]> {
    const refs: FrameBucketRef[] = [];
    
    // Group frames into buckets
    for (let i = 0; i < frames.length; i += this.bucketSize) {
      const bucketFrames = frames.slice(i, i + this.bucketSize);
      if (bucketFrames.length === 0) continue;
      
      const bucket: FrameBucket = {
        hash: '',  // Will be computed
        startSequence: bucketFrames[0].sequence,
        endSequence: bucketFrames[bucketFrames.length - 1].sequence,
        frameCount: bucketFrames.length,
        frames: bucketFrames
      };
      
      // Compute content hash
      bucket.hash = this.hashBucket(bucket);
      
      // Save bucket to disk (only if not already exists)
      const bucketPath = this.getBucketPath(bucket.hash);
      try {
        await fs.access(bucketPath);
        // Bucket already exists, don't overwrite
      } catch {
        // Bucket doesn't exist, save it
        // Ensure subdirectory exists first
        const bucketDir = path.dirname(bucketPath);
        await fs.mkdir(bucketDir, { recursive: true });
        
        await fs.writeFile(
          bucketPath,
          JSON.stringify({
            hash: bucket.hash,
            startSequence: bucket.startSequence,
            endSequence: bucket.endSequence,
            frameCount: bucket.frameCount,
            frames: bucket.frames
          }, null, 2)
        );
      }
      
      // Add to cache
      this.addToCache(bucket);
      
      // Create reference (without frames)
      refs.push({
        hash: bucket.hash,
        startSequence: bucket.startSequence,
        endSequence: bucket.endSequence,
        frameCount: bucket.frameCount
      });
    }
    
    return refs;
  }
  
  /**
   * Load frames from bucket references
   * Returns full frame array (loads from disk as needed)
   */
  async loadFrames(refs: FrameBucketRef[]): Promise<Frame[]> {
    const allFrames: Frame[] = [];
    
    for (const ref of refs) {
      // Check cache first
      let bucket = this.bucketCache.get(ref.hash);
      
      if (!bucket) {
        // Load from disk
        const bucketPath = this.getBucketPath(ref.hash);
        try {
          const data = await fs.readFile(bucketPath, 'utf-8');
          bucket = JSON.parse(data) as FrameBucket;
          this.addToCache(bucket);
        } catch (error) {
          console.warn(`Failed to load bucket ${ref.hash}:`, error);
          continue;
        }
      }
      
      allFrames.push(...bucket.frames);
    }
    
    return allFrames;
  }
  
  /**
   * Get frames in a specific range (loads only needed buckets)
   */
  async getFrameRange(refs: FrameBucketRef[], startSeq: number, endSeq: number): Promise<Frame[]> {
    const relevantRefs = refs.filter(ref => 
      !(ref.endSequence < startSeq || ref.startSequence > endSeq)
    );
    
    const frames = await this.loadFrames(relevantRefs);
    return frames.filter(f => f.sequence >= startSeq && f.sequence <= endSeq);
  }
  
  /**
   * Compute SHA-256 hash of bucket content (for deduplication)
   */
  private hashBucket(bucket: FrameBucket): string {
    // Hash the frames array (deterministic JSON)
    const content = JSON.stringify(bucket.frames);
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  
  private getBucketPath(hash: string): string {
    // Use first 2 chars for directory sharding (like git objects)
    const dir = hash.substring(0, 2);
    const file = hash.substring(2);
    return path.join(this.storageDir, dir, `${file}.json`);
  }
  
  private async addToCache(bucket: FrameBucket): Promise<void> {
    // LRU eviction if cache is full
    if (this.bucketCache.size >= this.maxCacheSize) {
      const firstKey = this.bucketCache.keys().next().value;
      if (firstKey) {
        this.bucketCache.delete(firstKey);
      }
    }
    
    this.bucketCache.set(bucket.hash, bucket);
  }
  
  /**
   * Get statistics about stored buckets
   */
  async getStats(): Promise<{
    totalBuckets: number;
    totalFrames: number;
    storageSize: number;
    cacheSize: number;
  }> {
    // Walk the storage directory
    let totalBuckets = 0;
    let totalFrames = 0;
    let storageSize = 0;
    
    try {
      const dirs = await fs.readdir(this.storageDir);
      for (const dir of dirs) {
        const dirPath = path.join(this.storageDir, dir);
        const stats = await fs.stat(dirPath);
        if (!stats.isDirectory()) continue;
        
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const fileStats = await fs.stat(filePath);
          storageSize += fileStats.size;
          totalBuckets++;
          
          // Optionally read to count frames
          // For now, estimate: each bucket has bucketSize frames
          totalFrames += this.bucketSize;
        }
      }
    } catch (error) {
      // Storage dir might not exist yet
    }
    
    return {
      totalBuckets,
      totalFrames,
      storageSize,
      cacheSize: this.bucketCache.size
    };
  }
}

