import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { ConsoleInputReceptor } from '../src/components/console-receptors';
import { Transform, ReadonlyVEILState, VEILDelta } from '../src';
import { ContextTransform } from '../src/hud/context-transform';

// Debug wrapper for ContextTransform
class DebugContextTransform implements Transform {
  private innerTransform: ContextTransform;
  
  constructor(veilStateManager: VEILStateManager) {
    this.innerTransform = new ContextTransform(veilStateManager);
  }
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    console.log('\n[DebugTransform] Running ContextTransform...');
    console.log(`[DebugTransform] Total facets in state: ${state.facets.size}`);
    
    // Log all facets
    let activationCount = 0;
    for (const [id, facet] of state.facets) {
      console.log(`[DebugTransform] - ${facet.type}: ${id}`);
      if (facet.type === 'agent-activation') {
        activationCount++;
        console.log(`[DebugTransform]   Found activation! ephemeral: ${facet.ephemeral}`);
      }
    }
    
    console.log(`[DebugTransform] Total activations found: ${activationCount}`);
    
    // Call the inner transform
    const deltas = this.innerTransform.process(state);
    
    console.log(`[DebugTransform] Returning ${deltas.length} deltas`);
    for (const delta of deltas) {
      if (delta.type === 'addFacet') {
        console.log(`[DebugTransform] - Will add: ${delta.facet.type} (id: ${delta.facet.id})`);
      }
    }
    
    return deltas;
  }
}

async function main() {
  console.log('=== Context Transform Debug Test ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add components
  space.addReceptor(new ConsoleInputReceptor());
  space.addTransform(new DebugContextTransform(veilState));
  
  console.log('1. Emitting console input...\n');
  
  await space.emit({
    topic: 'console:input',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { input: 'test message' }
  });
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n2. Final state check:');
  
  const state = veilState.getState();
  let contextCount = 0;
  
  for (const [id, facet] of state.facets) {
    if (facet.type === 'rendered-context') {
      contextCount++;
      console.log(`Found rendered-context: ${id}`);
    }
  }
  
  console.log(`\nTotal rendered-context facets: ${contextCount}`);
  console.log(`Total frames: ${state.currentSequence}`);
}

main().catch(console.error);
