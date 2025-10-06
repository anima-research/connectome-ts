#!/usr/bin/env tsx
/**
 * Frame Snapshot Inspector
 * 
 * Connects to running dispenser test and inspects frame snapshots
 * via the Debug API.
 */

import readline from 'readline';

// Debug API client (simple fetch-based)
class DebugClient {
  constructor(private baseUrl: string = 'http://localhost:3100') {}
  
  async getFrames(limit?: number): Promise<any> {
    const url = limit 
      ? `${this.baseUrl}/frames?limit=${limit}`
      : `${this.baseUrl}/frames`;
    const response = await fetch(url);
    return response.json();
  }
  
  async getFrame(frameId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/frame/${frameId}`);
    return response.json();
  }
  
  async getState(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/state`);
    return response.json();
  }
}

async function inspectSnapshots() {
  const client = new DebugClient();
  
  console.log('📸 Frame Snapshot Inspector');
  console.log('===========================\n');
  
  try {
    // Get recent frames
    console.log('Fetching frames...\n');
    const framesResponse = await client.getFrames(10);
    const frames = framesResponse.frames || [];
    
    console.log(`Found ${frames.length} frames\n`);
    
    // Inspect each frame's snapshot
    for (const frameInfo of frames) {
      const frameDetail = await client.getFrame(frameInfo.uuid || frameInfo.id);
      const frame = frameDetail.frame;
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Frame ${frame.sequence} (${frame.uuid})`);
      console.log(`${'='.repeat(60)}`);
      
      // Check for rendered snapshot
      if (frame.renderedSnapshot) {
        const snapshot = frame.renderedSnapshot;
        console.log(`\n✅ HAS SNAPSHOT`);
        console.log(`   Chunks: ${snapshot.chunks?.length || 0}`);
        console.log(`   Total tokens: ${snapshot.totalTokens}`);
        console.log(`   Content length: ${snapshot.totalContent?.length || 0} chars`);
        console.log(`   Captured at: ${new Date(snapshot.capturedAt || 0).toISOString()}`);
        
        // Show chunks
        if (snapshot.chunks && snapshot.chunks.length > 0) {
          console.log(`\n   Chunks:`);
          for (let i = 0; i < snapshot.chunks.length; i++) {
            const chunk = snapshot.chunks[i];
            console.log(`     [${i}] ${chunk.chunkType || 'untyped'}`);
            console.log(`         Tokens: ${chunk.tokens}`);
            console.log(`         Facets: ${chunk.facetIds?.join(', ') || 'none'}`);
            const preview = chunk.content.substring(0, 60).replace(/\n/g, '\\n');
            console.log(`         Content: "${preview}${chunk.content.length > 60 ? '...' : ''}"`);
          }
        }
        
        // Show full content (first 200 chars)
        console.log(`\n   Full Content:`);
        const preview = snapshot.totalContent.substring(0, 200).replace(/\n/g, '\n   ');
        console.log(`   ${preview}${snapshot.totalContent.length > 200 ? '...' : ''}`);
        
        // Facet attribution summary
        const facetIds = new Set<string>();
        for (const chunk of snapshot.chunks || []) {
          if (chunk.facetIds) {
            for (const id of chunk.facetIds) {
              facetIds.add(id);
            }
          }
        }
        console.log(`\n   Referenced facets: ${facetIds.size}`);
        if (facetIds.size > 0) {
          console.log(`   Facet IDs: ${Array.from(facetIds).join(', ')}`);
        }
      } else {
        console.log(`\n❌ NO SNAPSHOT`);
      }
      
      // Show frame metadata
      console.log(`\n   Frame metadata:`);
      console.log(`     Events: ${frame.events?.length || 0}`);
      console.log(`     Deltas: ${frame.deltas?.length || 0}`);
      console.log(`     Timestamp: ${frame.timestamp}`);
    }
    
    // Summary statistics
    console.log(`\n\n${'='.repeat(60)}`);
    console.log('SUMMARY');
    console.log(`${'='.repeat(60)}\n`);
    
    const framesWithSnapshots = frames.filter((f: any) => {
      return f.renderedSnapshot !== undefined && f.renderedSnapshot !== null;
    });
    
    console.log(`Total frames: ${frames.length}`);
    console.log(`Frames with snapshots: ${framesWithSnapshots.length}`);
    console.log(`Snapshot coverage: ${(framesWithSnapshots.length / frames.length * 100).toFixed(1)}%`);
    
    if (framesWithSnapshots.length > 0) {
      const totalChunks = framesWithSnapshots.reduce(
        (sum: number, f: any) => sum + (f.renderedSnapshot.chunks?.length || 0),
        0
      );
      const avgChunks = totalChunks / framesWithSnapshots.length;
      
      console.log(`Total chunks: ${totalChunks}`);
      console.log(`Average chunks per frame: ${avgChunks.toFixed(1)}`);
      
      const totalTokens = framesWithSnapshots.reduce(
        (sum: number, f: any) => sum + (f.renderedSnapshot.totalTokens || 0),
        0
      );
      
      console.log(`Total tokens in snapshots: ${totalTokens}`);
      console.log(`Average tokens per frame: ${(totalTokens / framesWithSnapshots.length).toFixed(1)}`);
    }
    
  } catch (error: any) {
    console.error('\n❌ Error inspecting snapshots:', error.message);
    console.error('\nMake sure the dispenser test is running with debug enabled:');
    console.error('  npx tsx examples/test-dispenser-snapshots.ts');
  }
}

// Run inspection
inspectSnapshots();
