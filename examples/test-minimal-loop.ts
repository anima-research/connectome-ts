import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { VEILOperationReceptor } from '../src/spaces/migration-adapters';
import { ElementTreeTransform } from '../src/spaces/element-tree-receptors';

async function main() {
  console.log('=== Minimal Loop Test ===\n');
  
  // Setup with VEILOperationReceptor and ElementTreeTransform
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  console.log('Adding VEILOperationReceptor...');
  space.addReceptor(new VEILOperationReceptor());
  
  console.log('Adding ElementTreeTransform...');
  space.addTransform(new ElementTreeTransform());
  
  // Override processFrame to add logging
  const originalProcessFrame = (space as any).processFrame.bind(space);
  let frameCount = 0;
  (space as any).processFrame = async function() {
    frameCount++;
    if (frameCount <= 5) {
      console.log(`Processing frame #${frameCount}`);
    }
    return originalProcessFrame();
  };
  
  console.log('1. Emitting element:mount event...\n');
  
  // Emit an element:mount event (which triggers ElementTreeMaintainer in real usage)
  await space.emit({
    topic: 'element:mount',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { element: { elementId: 'test-elem', elementPath: ['test'], elementType: 'Element' } }
  });
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log(`\nTotal frames processed: ${frameCount}`);
  
  if (frameCount > 10) {
    console.error('ERROR: Too many frames for a simple event!');
  } else {
    console.log('SUCCESS: Frame count is reasonable.');
  }
}

main().catch(console.error);
