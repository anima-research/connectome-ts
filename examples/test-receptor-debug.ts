import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { ConsoleInputReceptor } from '../src/components/console-receptors';
import { Receptor, ReadonlyVEILState, Facet } from '../src';
import { SpaceEvent } from '../src/spaces/types';

// Debug wrapper for ConsoleInputReceptor
class DebugConsoleInputReceptor implements Receptor {
  topics = ['console:input'];
  private innerReceptor = new ConsoleInputReceptor();
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    console.log('[DebugReceptor] Received event:', event.topic);
    console.log('[DebugReceptor] Event payload:', event.payload);
    
    const facets = this.innerReceptor.transform(event, state);
    
    console.log(`[DebugReceptor] Returning ${facets.length} facets:`);
    for (const facet of facets) {
      console.log(`  - ${facet.type} (id: ${facet.id}, ephemeral: ${'ephemeral' in facet ? facet.ephemeral : false})`);
    }
    
    return facets;
  }
}

async function main() {
  console.log('=== Receptor Debug Test ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Use debug receptor
  space.addReceptor(new DebugConsoleInputReceptor());
  
  console.log('1. Emitting console input...\n');
  
  await space.emit({
    topic: 'console:input',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { input: 'test message' }
  });
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n2. Checking VEIL state after Phase 1:');
  
  const state = veilState.getState();
  console.log(`Total facets: ${state.facets.size}`);
  
  for (const [id, facet] of state.facets) {
    console.log(`- ${facet.type}: ${id}`);
    if ('ephemeral' in facet) {
      console.log(`  ephemeral: ${facet.ephemeral}`);
    }
  }
  
  console.log(`\nTotal frames processed: ${state.currentSequence}`);
}

main().catch(console.error);
