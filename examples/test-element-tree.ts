import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { VEILOperationReceptor } from '../src/spaces/migration-adapters';
import { 
  registerComponent,
  ElementRequestReceptor,
  ElementTreeTransform,
  ElementTreeMaintainer
} from '../src/spaces/element-tree-receptors';
import { ComponentRegistry } from '../src/persistence/component-registry';
import { Component } from '../src/spaces/component';
import { ConsoleInputReceptor, ConsoleOutputEffector } from '../src/components/console-receptors';

// Example component that logs messages
@registerComponent('logger')
class LoggerComponent extends Component {
  private messageCount = 0;
  
  constructor(private config: { prefix?: string } = {}) {
    super();
  }
  
  async initialize() {
    console.log(`[LoggerComponent] Initialized with prefix: ${this.config.prefix || 'LOG'}`);
  }
  
  logMessage(message: string) {
    this.messageCount++;
    console.log(`[${this.config.prefix || 'LOG'}] #${this.messageCount}: ${message}`);
  }
}

// Another example component
@registerComponent('counter')
class CounterComponent extends Component {
  private count = 0;
  
  increment() {
    this.count++;
    console.log(`[CounterComponent] Count is now: ${this.count}`);
  }
}

async function main() {
  console.log('=== Testing Declarative Element Tree ===\n');
  
  // Setup
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Register receptors, transforms, effectors, and maintainers
  space.addReceptor(new VEILOperationReceptor());
  space.addReceptor(new ElementRequestReceptor());
  space.addReceptor(new ConsoleInputReceptor());
  
  space.addTransform(new ElementTreeTransform());
  
  space.addEffector(new ConsoleOutputEffector());
  
  // Element tree operations happen in maintenance phase
  space.addMaintainer(new ElementTreeMaintainer(space));
  
  console.log('1. Creating elements declaratively...\n');
  
  // Create a container element with a logger component
  await space.emit({
    topic: 'element:create',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: {
      name: 'container',
      components: [
        { type: 'logger', config: { prefix: 'CONTAINER' } }
      ]
    }
  });
  
  // Allow frame to process
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Create a child element with both logger and counter
  await space.emit({
    topic: 'element:create',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: {
      parentId: 'container', // Will need to get actual ID
      name: 'child',
      components: [
        { type: 'logger', config: { prefix: 'CHILD' } },
        { type: 'counter' }
      ]
    }
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n2. Current element tree:');
  
  // Show element tree from VEIL
  const allFacets = veilState.getState().facets;
  const elementTreeFacets = Array.from(allFacets.values())
    .filter((f: any) => f.type === 'element-tree' && f.state?.active !== false);
    
  for (const facet of elementTreeFacets) {
    const state = (facet as any).state;
    console.log(`- ${state.name} (${state.elementId})`);
    console.log(`  Parent: ${state.parentId}`);
    console.log(`  Components: ${state.components.map((c: any) => c.type).join(', ')}`);
  }
  
  console.log('\n3. Adding component to existing element...\n');
  
  // Find container element ID
  const containerFacet = elementTreeFacets.find(f => (f.state as any).name === 'container');
  const containerId = containerFacet ? (containerFacet.state as any).elementId : null;
  
  if (containerId) {
    await space.emit({
      topic: 'component:add',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: {
        elementId: containerId,
        componentType: 'counter'
      }
    });
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('\n4. Final VEIL state summary:');
  const finalState = veilState.getState();
  console.log(`Total facets: ${finalState.facets.size}`);
  console.log(`Frames processed: ${finalState.currentSequence}`);
  
  // Show all facet types
  const facetTypes = new Map<string, number>();
  for (const facet of finalState.facets.values()) {
    facetTypes.set(facet.type, (facetTypes.get(facet.type) || 0) + 1);
  }
  
  console.log('\nFacet type counts:');
  for (const [type, count] of facetTypes) {
    console.log(`  ${type}: ${count}`);
  }
}

main().catch(console.error);
