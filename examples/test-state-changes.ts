/**
 * Test state changes with narrative events
 * 
 * In the new architecture, state changes should be accompanied by
 * narrative event facets that describe what happened.
 */

import {
  VEILStateManager,
  FrameTrackingHUD,
  createStateFacet,
  createEventFacet,
  createAmbientFacet,
  Frame,
  createDefaultTransition,
  addFacet,
  changeFacet,
  InternalStateFacet
} from '../src';

console.log('=== Testing State Changes with Events ===\n');

// Create VEIL state and HUD
const veilState = new VEILStateManager();
const hud = new FrameTrackingHUD();

// Frame 1: Set the scene with ambient description
console.log('1. Setting the scene...\n');
const frame1: Frame = {
  sequence: 1,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [
    addFacet(createAmbientFacet({
      content: 'You stand in a dusty antique shop. Shelves line the walls, filled with curiosities from bygone eras.',
      streamId: 'game',
      streamType: 'game'
    })),
    addFacet(createStateFacet({
      id: 'box-1',  // Use this as the facet ID
      content: 'Mysterious Box',
      entityType: 'component',
      entityId: 'box-1',
      state: {
        isOpen: false,
        contents: ['key', 'note', 'coin'],
        condition: 'pristine',
        description: 'An ornate wooden box with brass hinges'
      }
    }))
  ],
  transition: createDefaultTransition(1, new Date().toISOString())
};
veilState.applyFrame(frame1);

// Frame 2: Player action
console.log('2. Player examines the box...\n');
const frame2: Frame = {
  sequence: 2,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [
    addFacet(createEventFacet({
      content: 'You examine the mysterious box closely. Its intricate carvings seem to tell a story.',
      source: 'player',
      eventType: 'action',
      streamId: 'game',
      streamType: 'game'
    }))
  ],
  transition: createDefaultTransition(2, new Date().toISOString())
};
veilState.applyFrame(frame2);

// Frame 3: Open the box (state change with narrative)
console.log('3. Opening the box...\n');
const frame3: Frame = {
  sequence: 3,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [
    addFacet(createEventFacet({
      content: 'You carefully lift the lid. The hinges creak softly as the box opens, revealing its contents.',
      source: 'system',
      eventType: 'state-change',
      streamId: 'game',
      streamType: 'game'
    })),
    changeFacet('box-1', {
      state: {
        isOpen: true,
        condition: 'opened'
      }
    })
  ],
  transition: createDefaultTransition(3, new Date().toISOString())
};
veilState.applyFrame(frame3);

// Frame 4: Describe contents (ambient after state change)
console.log('4. Box contents revealed...\n');
const frame4: Frame = {
  sequence: 4,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [
    addFacet(createAmbientFacet({
      content: 'Inside the box: a tarnished brass key, a folded note yellowed with age, and an old coin.',
      streamId: 'game',
      streamType: 'game'
    }))
  ],
  transition: createDefaultTransition(4, new Date().toISOString())
};
veilState.applyFrame(frame4);

// Frame 5: Take the key
console.log('5. Taking the key...\n');
const frame5: Frame = {
  sequence: 5,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [
    addFacet(createEventFacet({
      content: 'You take the brass key. It feels heavy in your hand, its surface worn smooth by countless fingers.',
      source: 'player',
      eventType: 'action',
      streamId: 'game',
      streamType: 'game'
    })),
    changeFacet('box-1', {
      state: {
        contents: ['note', 'coin']  // key removed
      }
    })
  ],
  transition: createDefaultTransition(5, new Date().toISOString())
};
veilState.applyFrame(frame5);

// Frame 6: Add the key to inventory
console.log('6. Key added to inventory...\n');
const frame6: Frame = {
  sequence: 6,
  timestamp: new Date().toISOString(),
  events: [],
  deltas: [
    addFacet(createStateFacet({
      id: 'key-1',  // Use this as the facet ID
      content: 'Brass Key',
      entityType: 'component',
      entityId: 'key-1',
      state: {
        description: 'A heavy brass key with intricate teeth',
        location: 'inventory'
      }
    }))
  ],
  transition: createDefaultTransition(6, new Date().toISOString())
};
veilState.applyFrame(frame6);

// Now render the context
console.log('\n=== Rendering Full Context ===\n');
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

// Show current state
console.log('\n\n=== Current Game State ===\n');
// Find facets by iterating (since we gave them entity IDs, not facet IDs)
let boxFacet: any = null;
let keyFacet: any = null;
for (const [id, facet] of state.facets) {
  if (facet.type === 'state' && 'state' in facet) {
    const stateFacet = facet as any;
    if (stateFacet.entityId === 'box-1') boxFacet = stateFacet;
    if (stateFacet.entityId === 'key-1') keyFacet = stateFacet;
  }
}
if (boxFacet) {
  console.log('Box:', JSON.stringify(boxFacet.state, null, 2));
}
if (keyFacet) {
  console.log('\nKey:', JSON.stringify(keyFacet.state, null, 2));
}

// Test internal state facets
console.log('\n\n=== Internal State Pattern ===\n');

// For non-visible state, use InternalStateFacet instead
// These are specifically designed for component/system state that shouldn't render
const doorInternalState: InternalStateFacet = {
  id: 'door-internal-1',
  type: 'internal-state',
  componentId: 'door-component',
  state: {
    isOpen: false,
    isLocked: true,
    material: 'oak',
    hp: 50
  }
};

console.log('Internal door state (not in conversation):', doorInternalState.state);
console.log('Has content aspect?', 'content' in doorInternalState);
console.log('\nNote: InternalStateFacet does not have ContentAspect, so it won\'t be rendered in the HUD.');
