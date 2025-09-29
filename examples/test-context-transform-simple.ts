import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { ConsoleInputReceptor } from '../src/components/console-receptors';
import { ContextTransform } from '../src/hud/context-transform';
import { AgentActivationFacet, RenderedContextFacet } from '../src';

async function main() {
  console.log('=== Simple Context Transform Test ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Only add the necessary components
  space.addReceptor(new ConsoleInputReceptor());
  space.addTransform(new ContextTransform(veilState));
  
  console.log('1. Emitting console input...\n');
  
  await space.emit({
    topic: 'console:input',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { input: 'test message' }
  });
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('2. Checking facets:');
  
  const state = veilState.getState();
  let eventFacets = 0;
  let activationFacets = 0;
  let contextFacets = 0;
  
  for (const [id, facet] of state.facets) {
    if (facet.type === 'event') {
      eventFacets++;
      console.log(`- Event facet: ${id}`);
    } else if (facet.type === 'agent-activation') {
      activationFacets++;
      console.log(`- Activation facet: ${id} (ephemeral: ${facet.ephemeral})`);
      const activation = facet as AgentActivationFacet;
      console.log(`  Reason: ${activation.state.reason}`);
    } else if (facet.type === 'rendered-context') {
      contextFacets++;
      console.log(`- Context facet: ${id}`);
      const context = facet as RenderedContextFacet;
      console.log(`  Activation ID: ${context.state.activationId}`);
    }
  }
  
  console.log('\n3. Summary:');
  console.log(`- Event facets: ${eventFacets}`);
  console.log(`- Activation facets: ${activationFacets} (should be 0 after cleanup)`);
  console.log(`- Context facets: ${contextFacets} (should be 1 if working)`);
  console.log(`- Total frames: ${state.currentSequence}`);
  
  // Check if transforms ran
  console.log('\n4. Debugging:');
  if (contextFacets === 0) {
    console.log('ERROR: No context facets created!');
    console.log('Possible causes:');
    console.log('- ContextTransform not running');
    console.log('- No activation facet when transform runs');
    console.log('- Transform logic issue');
  } else {
    console.log('SUCCESS: Context transform is working!');
  }
}

main().catch(console.error);
