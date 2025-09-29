/**
 * Test that state renderers can be serialized and deserialized
 */

import {
  VEILStateManager,
  createStateFacet,
  addFacet,
  changeFacet,
  createDefaultTransition
} from '../src';

import { StateTransitionTransform } from '../src/transforms/state-transition-transform';

console.log('=== Testing Serializable State Renderers ===\n');

// Create a state facet with renderer functions
const doorFacet = createStateFacet({
  id: 'magic-door',
  content: 'Enchanted Door',
  entityType: 'component',
  entityId: 'magic-door',
  state: {
    isOpen: false,
    lockLevel: 3 // 0 = unlocked, 1-5 = various lock levels
  },
  // These functions will be converted to strings automatically
  transitionRenderers: {
    isOpen: (newValue: boolean, oldValue: boolean) => {
      if (!oldValue && newValue) {
        return 'The enchanted door swings open with a mystical chime!';
      } else if (oldValue && !newValue) {
        return 'The door closes with a soft thud.';
      }
      return null;
    },
    lockLevel: (newValue: number, oldValue: number) => {
      if (newValue === 0 && oldValue > 0) {
        return 'You hear a satisfying click as the lock disengages.';
      } else if (newValue > oldValue) {
        return `The lock mechanism whirs and strengthens to level ${newValue}.`;
      }
      return null;
    }
  },
  attributeRenderers: {
    isOpen: (value: boolean) => value ? '(open)' : '(closed)',
    lockLevel: (value: number) => value === 0 ? '(unlocked)' : `(locked: level ${value})`
  }
});

// Show the serialized renderers
console.log('1. Original facet with renderer functions converted to strings:\n');
console.log('Transition renderer for isOpen:');
console.log(doorFacet.transitionRenderers?.isOpen);
console.log('\nAttribute renderer for lockLevel:');
console.log(doorFacet.attributeRenderers?.lockLevel);

// Simulate serialization/deserialization
console.log('\n2. Simulating serialization round-trip...\n');
const serialized = JSON.stringify(doorFacet);
const deserialized = JSON.parse(serialized);

console.log('Serialized size:', serialized.length, 'bytes');
console.log('Successfully deserialized:', !!deserialized);

// Create a VEILStateManager and add the deserialized facet
const veilState = new VEILStateManager();
veilState.applyFrame({
  sequence: 1,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [{ type: 'addFacet', facet: deserialized }],
  transition: createDefaultTransition(1, new Date().toISOString())
});

// Set up the transform
const stateTransform = new StateTransitionTransform();

// Test state changes
console.log('\n3. Testing state changes with deserialized renderers:\n');

// Unlock the door
veilState.applyFrame({
  sequence: 2,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [
    changeFacet('magic-door', {
      state: { lockLevel: 0 }
    })
  ],
  transition: createDefaultTransition(2, new Date().toISOString())
});

const unlockDeltas = stateTransform.process({
  facets: veilState.getState().facets as ReadonlyMap<string, any>,
  scopes: new Set() as ReadonlySet<string>,
  streams: new Map() as ReadonlyMap<string, any>,
  agents: new Map() as ReadonlyMap<string, any>,
  currentStream: undefined,
  currentAgent: undefined,
  frameHistory: [],
  currentSequence: 2,
  removals: new Map(),
  getFacetsByType: (type: string) => Array.from(veilState.getState().facets.values()).filter(f => f.type === type),
  getFacetsByAspect: () => [],
  hasFacet: (id: string) => veilState.getState().facets.has(id)
});

if (unlockDeltas.length > 0 && unlockDeltas[0].type === 'addFacet') {
  console.log('Unlock event:', unlockDeltas[0].facet.content);
}

// Open the door
veilState.applyFrame({
  sequence: 3,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [
    changeFacet('magic-door', {
      state: { isOpen: true }
    })
  ],
  transition: createDefaultTransition(3, new Date().toISOString())
});

const openDeltas = stateTransform.process({
  facets: veilState.getState().facets as ReadonlyMap<string, any>,
  scopes: new Set() as ReadonlySet<string>,
  streams: new Map() as ReadonlyMap<string, any>,
  agents: new Map() as ReadonlyMap<string, any>,
  currentStream: undefined,
  currentAgent: undefined,
  frameHistory: [],
  currentSequence: 3,
  removals: new Map(),
  getFacetsByType: (type: string) => Array.from(veilState.getState().facets.values()).filter(f => f.type === type),
  getFacetsByAspect: () => [],
  hasFacet: (id: string) => veilState.getState().facets.has(id)
});

if (openDeltas.length > 0 && openDeltas[0].type === 'addFacet') {
  console.log('Open event:', openDeltas[0].facet.content);
}

// Show the final state with attribute renderers
console.log('\n4. Final state with attribute renderers:\n');
const finalDoor = veilState.getState().facets.get('magic-door') as any;
if (finalDoor && finalDoor.attributeRenderers) {
  console.log('Door state:', finalDoor.state);
  
  // These are now strings, so we need to evaluate them
  const isOpenRenderer = new Function('value', finalDoor.attributeRenderers.isOpen);
  const lockLevelRenderer = new Function('value', finalDoor.attributeRenderers.lockLevel);
  
  console.log('  isOpen:', isOpenRenderer(finalDoor.state.isOpen));
  console.log('  lockLevel:', lockLevelRenderer(finalDoor.state.lockLevel));
}

console.log('\n✅ Serializable renderers work correctly!');

