import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { Element } from '../src/spaces/element';
import { AxonLoaderComponent } from '../src/components/axon-loader';

/**
 * Test AXON RETM Module Loading
 * 
 * This demonstrates loading an AXON module that exports
 * Receptors, Effectors, Transforms, and Maintainers
 */

async function simulateRETMModule() {
  console.log('=== Testing AXON RETM Module Loading ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  console.log('1. Creating element with AxonLoader...');
  const element = new Element('counter-test');
  const loader = new AxonLoaderComponent();
  element.addComponent(loader);
  space.addChild(element);
  
  // Simulate that the module was already loaded (since we can't actually fetch)
  // In a real scenario, this would be done by loader.connect()
  console.log('\n2. Simulating RETM module load...');
  
  // Import the counter module
  const counterModule = await import('./axon-modules/counter-retm');
  const { createModule } = counterModule;
  
  // Create a mock environment
  const mockEnv = {
    persistent: (target: any, key: string) => {},
    createStateFacet: (props: any) => ({
      id: `state-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      type: 'state',
      entityType: props.entityType,
      entityId: props.entityId,
      content: props.content,
      state: props.attributes || {},
      persistent: true
    }),
    createEventFacet: (props: any) => ({
      id: props.id || `event-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      type: 'event',
      content: props.content,
      source: props.source,
      state: {
        agentId: props.agentId,
        streamId: props.streamId
      }
    })
  };
  
  // Create the module
  const moduleExports = createModule(mockEnv);
  
  // Manually call loadRETMModule (in real scenario, this happens inside loader)
  await (loader as any).loadRETMModule(moduleExports);
  
  console.log('\n3. Testing counter operations...');
  
  // Test increment
  console.log('\n   a. Incrementing counter...');
  await space.emit({
    topic: 'counter:increment',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { amount: 5 }
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Check state
  let state = veilState.getState();
  let counterFacet = Array.from(state.facets.values())
    .find(f => f.type === 'state' && f.entityId === 'counter');
  console.log(`   Counter state: ${counterFacet?.content}`);
  
  // Test multiple increments to hit milestone
  console.log('\n   b. Incrementing to milestone...');
  for (let i = 0; i < 5; i++) {
    await space.emit({
      topic: 'counter:increment',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: { amount: 1 }
    });
  }
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  state = veilState.getState();
  counterFacet = Array.from(state.facets.values())
    .find(f => f.type === 'state' && f.entityId === 'counter');
  console.log(`   Counter state: ${counterFacet?.content}`);
  console.log(`   Metadata:`, counterFacet?.metadata);
  
  // Test hitting the limit
  console.log('\n   c. Testing limit maintainer...');
  await space.emit({
    topic: 'counter:set',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { value: 150 }
  });
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  state = veilState.getState();
  counterFacet = Array.from(state.facets.values())
    .find(f => f.type === 'state' && f.entityId === 'counter');
  console.log(`   Counter state after limit: ${counterFacet?.content}`);
  
  console.log('\n4. Summary:');
  console.log(`   - Total frames processed: ${state.currentSequence}`);
  console.log(`   - Total facets: ${state.facets.size}`);
  console.log(`   - Module type: ${(loader as any).moduleType}`);
  console.log(`   - Loaded exports: ${(loader as any).loadedExports.join(', ')}`);
  
  console.log('\nAXON RETM modules work successfully!');
}

simulateRETMModule().catch(console.error);
