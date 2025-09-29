import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { VEILOperationReceptor } from '../src/spaces/migration-adapters';
import { 
  ElementRequestReceptor,
  ElementTreeTransform,
  ElementTreeMaintainer
} from '../src/spaces/element-tree-receptors';

async function main() {
  console.log('=== Verbose Element Tree Test ===\n');
  
  // Setup
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add debug logging to see what's happening
  const originalEmit = space.emit.bind(space);
  (space as any).emit = function(event: any) {
    console.log(`[Space.emit] topic: ${event.topic}, source: ${event.source?.elementId}`);
    return originalEmit(event);
  };
  
  // Register receptors, transforms, and maintainers
  const veilReceptor = new VEILOperationReceptor();
  const elementReceptor = new ElementRequestReceptor();
  const elementTransform = new ElementTreeTransform();
  const elementMaintainer = new ElementTreeMaintainer(space);
  
  space.addReceptor(veilReceptor);
  space.addReceptor(elementReceptor);
  space.addTransform(elementTransform);
  space.addMaintainer(elementMaintainer);
  
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
  
  console.log('\nWaiting for frame processing...');
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n2. Checking state after first frame:');
  let state = veilState.getState();
  console.log(`Total facets: ${state.facets.size}`);
  console.log(`Frames processed: ${state.currentSequence}`);
  
  // Show all facets
  console.log('\nAll facets:');
  for (const [id, facet] of state.facets) {
    console.log(`- ${facet.type} (${id.substring(0, 20)}...)`);
    if ('ephemeral' in facet) {
      console.log(`  ephemeral: ${facet.ephemeral}`);
    }
  }
  
  // Wait for any additional frames from Phase 4
  console.log('\n3. Waiting for Phase 4 events...');
  await new Promise(resolve => setTimeout(resolve, 500));
  
  state = veilState.getState();
  console.log(`\nFinal state:`)
  console.log(`Total facets: ${state.facets.size}`);
  console.log(`Frames processed: ${state.currentSequence}`);
  
  // Show element tree facets
  console.log('\nElement tree facets:');
  for (const [id, facet] of state.facets) {
    if (facet.type === 'element-tree') {
      console.log(`- ${id}`);
      console.log(`  state:`, (facet as any).state);
    }
  }
}

main().catch(console.error);
