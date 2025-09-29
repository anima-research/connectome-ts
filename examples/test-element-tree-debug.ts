import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { VEILOperationReceptor } from '../src/spaces/migration-adapters';
import { 
  ElementRequestReceptor,
  ElementTreeTransform,
  ElementTreeMaintainer
} from '../src/spaces/element-tree-receptors';

// Custom transform to log when it runs
class LoggingTransform {
  private runCount = 0;
  
  process(state: any): any[] {
    this.runCount++;
    console.log(`[Transform] Run #${this.runCount}, facets: ${state.facets.size}`);
    
    if (this.runCount > 10) {
      console.log('[Transform] Facet types:', Array.from(state.facets.values()).map((f: any) => f.type).join(', '));
    }
    
    return [];
  }
}

async function main() {
  console.log('=== Debug Element Tree Test ===\n');
  
  // Setup
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add logging transform first
  const loggingTransform = new LoggingTransform();
  space.addTransform(loggingTransform);
  
  // Register receptors, transforms, and maintainers
  space.addReceptor(new VEILOperationReceptor());
  space.addReceptor(new ElementRequestReceptor());
  space.addTransform(new ElementTreeTransform());
  space.addMaintainer(new ElementTreeMaintainer(space));
  
  // Override processFrame to add logging
  const originalProcessFrame = (space as any).processFrame.bind(space);
  let frameCount = 0;
  (space as any).processFrame = async function() {
    frameCount++;
    if (frameCount <= 10 || frameCount % 100 === 0) {
      console.log(`\n[Space] Processing frame #${frameCount}`);
    }
    return originalProcessFrame();
  };
  
  console.log('1. Creating single element...\n');
  
  // Create a single element
  await space.emit({
    topic: 'element:create',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: {
      name: 'test-element'
    }
  });
  
  // Wait for initial processing
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log('\n2. Final state:');
  const state = veilState.getState();
  console.log(`Total frames: ${frameCount}`);
  console.log(`Total facets: ${state.facets.size}`);
  
  // Check if phase 2 limit was hit
  try {
    // Trigger one more frame to see if error is thrown
    await space.emit({
      topic: 'test:event',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: {}
    });
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (error: any) {
    console.log('\nPhase 2 error caught:', error.message);
  }
}

main().catch(console.error);
