import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { VEILOperationReceptor } from '../src/spaces/migration-adapters';
import { 
  ElementRequestReceptor,
  ElementTreeTransform,
  ElementTreeMaintainer
} from '../src/spaces/element-tree-receptors';

async function main() {
  console.log('=== Simple Element Tree Test ===\n');
  
  // Setup
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Register receptors, transforms, and maintainers
  space.addReceptor(new VEILOperationReceptor());
  space.addReceptor(new ElementRequestReceptor());
  space.addTransform(new ElementTreeTransform());
  space.addMaintainer(new ElementTreeMaintainer(space));
  
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
  
  // Wait for frame processing
  console.log('Waiting for frame processing...');
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n2. Checking state:');
  const state = veilState.getState();
  console.log(`Total facets: ${state.facets.size}`);
  console.log(`Frames processed: ${state.currentSequence}`);
  
  // Show all facets
  console.log('\nAll facets:');
  for (const [id, facet] of state.facets) {
    console.log(`- ${facet.type} (${id})`);
    if (facet.type === 'element-request') {
      console.log(`  ephemeral: ${(facet as any).ephemeral}`);
      console.log(`  state:`, (facet as any).state);
    }
  }
  
  // Wait a bit more to see if more frames are generated
  console.log('\n3. Waiting 2 more seconds...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const finalState = veilState.getState();
  console.log(`\nFinal frames processed: ${finalState.currentSequence}`);
  
  if (finalState.currentSequence > 10) {
    console.error('ERROR: Too many frames processed! Likely a runaway loop.');
  } else {
    console.log('SUCCESS: Frame count is reasonable.');
  }
}

main().catch(console.error);
