/**
 * Test state transition rendering with automatic event generation
 */

import {
  VEILStateManager,
  FrameTrackingHUD,
  Space,
  createStateFacet,
  Frame,
  createDefaultTransition,
  addFacet,
  changeFacet,
  ReadonlyVEILState,
  Facet
} from '../src';

import { StateTransitionTransform } from '../src/transforms/state-transition-transform';

console.log('=== Testing Automatic State Transition Events ===\n');

// Helper to create readonly state
function makeReadonlyState(state: any): ReadonlyVEILState {
  const facets = state.facets as Map<string, Facet>;
  return {
    facets: facets as ReadonlyMap<string, Facet>,
    scopes: state.scopes as ReadonlySet<string>,
    streams: state.streams as ReadonlyMap<string, any>,
    agents: state.agents as ReadonlyMap<string, any>,
    currentStream: state.currentStream,
    currentAgent: state.currentAgent,
    frameHistory: [...state.frameHistory],
    currentSequence: state.currentSequence,
    removals: new Map(state.removals),
    getFacetsByType: (type: string) => Array.from(facets.values()).filter(f => f.type === type),
    getFacetsByAspect: (aspect: keyof Facet, value: any) => 
      Array.from(facets.values()).filter(f => (f as any)[aspect] === value),
    hasFacet: (id: string) => facets.has(id)
  };
}

// Set up the space with our transform
const veilState = new VEILStateManager();
const space = new Space(veilState);
const hud = new FrameTrackingHUD();

// Register the state transition transform
const stateTransform = new StateTransitionTransform();
space.addTransform(stateTransform);

// Frame 1: Create initial state with renderers
console.log('1. Creating treasure box...\n');
const boxFacet = createStateFacet({
  id: 'treasure-box',
  content: 'Ancient Treasure Box',
  entityType: 'component',
  entityId: 'treasure-box',
  state: {
    isOpen: false,
    goldPieces: 100
  },
  // Renderers are now part of the facet!
  attributeRenderers: {
    isOpen: (value: boolean) => value ? '(open)' : '(closed)',
    goldPieces: (value: number) => `(${value} gold pieces)`
  },
  transitionRenderers: {
    isOpen: (newValue: boolean, oldValue: boolean) => {
      if (!oldValue && newValue) {
        return 'The treasure box creaks open, revealing glittering gold!';
      } else if (oldValue && !newValue) {
        return 'The box snaps shut with a metallic click.';
      }
      return null;
    },
    goldPieces: (newValue: number, oldValue: number) => {
      const diff = newValue - oldValue;
      if (diff < 0) {
        return `You take ${-diff} gold pieces from the box.`;
      } else if (diff > 0) {
        return `${diff} gold pieces magically appear in the box!`;
      }
      return null;
    }
  }
});

// We need to manually trigger frame processing since we're not using events
// Frame 1: Create initial state
veilState.applyFrame({
  sequence: 1,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [addFacet(boxFacet)],
  transition: createDefaultTransition(1, new Date().toISOString())
});

// Frame 2: Open the box (should generate transition event)
console.log('2. Opening the box...\n');
const frame2Deltas = veilState.applyFrame({
  sequence: 2,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [
    changeFacet('treasure-box', {
      state: { isOpen: true }
    })
  ],
  transition: createDefaultTransition(2, new Date().toISOString())
});

// Run transforms manually to generate transition events
const transformDeltas2 = stateTransform.process(makeReadonlyState(veilState.getState()));
console.log(`  Transform generated ${transformDeltas2.length} deltas`);
// Don't apply - in real usage, transforms run in Phase 2 of the same frame

// Frame 3: Take some gold (should generate transition event)
console.log('3. Taking gold...\n');
veilState.applyFrame({
  sequence: 3,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [
    changeFacet('treasure-box', {
      state: { goldPieces: 75 }
    })
  ],
  transition: createDefaultTransition(3, new Date().toISOString())
});

// Run transforms
const transformDeltas3 = stateTransform.process(makeReadonlyState(veilState.getState()));
console.log(`  Transform generated ${transformDeltas3.length} deltas`);
// Store for later display
const allTransformDeltas = [...transformDeltas3];

// Frame 4: Close the box
console.log('4. Closing the box...\n');
veilState.applyFrame({
  sequence: 4,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [
    changeFacet('treasure-box', {
      state: { isOpen: false }
    })
  ],
  transition: createDefaultTransition(4, new Date().toISOString())
});

// Run transforms
const transformDeltas4 = stateTransform.process(makeReadonlyState(veilState.getState()));
console.log(`  Transform generated ${transformDeltas4.length} deltas`);
allTransformDeltas.push(...transformDeltas4);

// Now render the context
console.log('\n=== Rendering Context ===\n');
const state = veilState.getState();
const context = hud.render(
  state.frameHistory,
  state.facets,
  undefined,
  {
    maxTokens: 4000
  }
);

// Show each message
context.messages.forEach((msg, i) => {
  console.log(`\n--- Message ${i + 1} (${msg.role}) ---`);
  console.log(msg.content);
});

// Show how many facets we have
console.log('\n\n=== Facet Analysis ===\n');
const facetTypes = new Map<string, number>();
for (const facet of state.facets.values()) {
  facetTypes.set(facet.type, (facetTypes.get(facet.type) || 0) + 1);
}
console.log('Facet counts by type:');
for (const [type, count] of facetTypes) {
  console.log(`  ${type}: ${count}`);
}

// Look at the generated events from transforms
console.log('\n\n=== Generated Transition Events ===\n');
if (allTransformDeltas.length === 0) {
  console.log('No transition events generated!');
} else {
  allTransformDeltas.forEach((delta, i) => {
    if (delta.type === 'addFacet' && delta.facet.type === 'event') {
      const eventFacet = delta.facet as any;
      console.log(`Event ${i + 1}: "${eventFacet.content}"`);
      if (eventFacet.metadata?.changes) {
        console.log(`  Changes:`, eventFacet.metadata.changes);
      }
    }
  });
}

// Show final state
console.log('\n\n=== Final State ===\n');
const stateFacet = state.facets.get('treasure-box');
if (stateFacet) {
  console.log('Box state:', {
    type: stateFacet.type,
    hasTransitionRenderers: 'transitionRenderers' in stateFacet,
    hasAttributeRenderers: 'attributeRenderers' in stateFacet,
    state: (stateFacet as any).state
  });
}
