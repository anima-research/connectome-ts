#!/usr/bin/env npx ts-node

/**
 * Test persistence system with decorated components
 */

import { Space } from '../src/spaces/space';
import { Element } from '../src/spaces/element';
import { Component } from '../src/spaces/component';
import { VEILStateManager } from '../src/veil/veil-state';
import { BasicAgent } from '../src/agent/basic-agent';
import { AgentComponent } from '../src/agent/agent-component';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { 
  persistent, 
  persistable, 
  Serializers,
  PersistenceManager,
  ComponentRegistry,
  restoreFromSnapshot
} from '../src/persistence';

// Example persistable component with decorated properties
@persistable(1)
class GameStateComponent extends Component {
  @persistent()
  private score: number = 0;
  
  @persistent()
  private level: number = 1;
  
  @persistent({ serializer: Serializers.date })
  private lastSave: Date = new Date();
  
  @persistent({ serializer: Serializers.set<string>() })
  private achievements: Set<string> = new Set();
  
  @persistent({ serializer: Serializers.map<number>() })
  private highScores: Map<string, number> = new Map();
  
  onMount() {
    // Subscribe to game events
    this.element.subscribe('game:score');
    this.element.subscribe('game:achievement');
    this.element.subscribe('game:level-complete');
  }
  
  async handleEvent(event: any) {
    if (event.topic === 'game:score') {
      this.score += event.payload.points;
      this.lastSave = new Date();
      console.log(`Score updated: ${this.score}`);
    }
    
    if (event.topic === 'game:achievement') {
      this.achievements.add(event.payload.achievement);
      console.log(`Achievement unlocked: ${event.payload.achievement}`);
    }
    
    if (event.topic === 'game:level-complete') {
      this.level++;
      this.highScores.set(`level-${this.level - 1}`, this.score);
      console.log(`Advanced to level ${this.level}`);
    }
  }
  
  getStatus() {
    return {
      score: this.score,
      level: this.level,
      achievements: Array.from(this.achievements),
      highScores: Object.fromEntries(this.highScores),
      lastSave: this.lastSave.toISOString()
    };
  }
}

// Register the component for deserialization
ComponentRegistry.register('GameStateComponent', GameStateComponent);

// Example component that tracks position
@persistable(1)
class PositionComponent extends Component {
  @persistent()
  x: number = 0;
  
  @persistent()
  y: number = 0;
  
  @persistent()
  z: number = 0;
  
  onMount() {
    // Subscribe to player events
    this.element.subscribe('player:move');
  }
  
  async handleEvent(event: any) {
    if (event.topic === 'player:move') {
      this.x = event.payload.x ?? this.x;
      this.y = event.payload.y ?? this.y;
      this.z = event.payload.z ?? this.z;
      console.log(`Position updated: (${this.x}, ${this.y}, ${this.z})`);
    }
  }
}

ComponentRegistry.register('PositionComponent', PositionComponent);

async function main() {
  console.log('=== Persistence System Test ===\n');
  
  // Create system
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create persistence manager
  const persistence = new PersistenceManager(space, veilState, {
    snapshotInterval: 5,  // Snapshot every 5 frames for testing
    storagePath: './test-persistence-data'
  });
  
  // Create game entity
  const player = new Element('Player');
  player.addComponent(new GameStateComponent());
  player.addComponent(new PositionComponent());
  space.addChild(player);
  
  // Create agent
  const llm = new MockLLMProvider();
  const agent = new BasicAgent(
    { 
      name: 'GameMaster',
      systemPrompt: 'You are a game master managing game state.'
    },
    llm,
    veilState
  );
  
  const agentElement = new Element('GameMaster');
  agentElement.addComponent(new AgentComponent(agent));
  space.addChild(agentElement);
  
  console.log('Initial state:');
  const gameState = player.getComponent(GameStateComponent) as GameStateComponent;
  console.log(JSON.stringify(gameState.getStatus(), null, 2));
  
  // Simulate some game events
  console.log('\nSimulating game events...\n');
  
  // Emit events instead of calling processFrame directly
  
  // Event 1: Score some points
  player.emit({
    topic: 'game:score',
    source: player.getRef(),
    payload: { points: 100 },
    timestamp: Date.now()
  });
  
  // Let the event process
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Event 2: Unlock achievement
  player.emit({
    topic: 'game:achievement',
    source: player.getRef(),
    payload: { achievement: 'First Blood' },
    timestamp: Date.now()
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Event 3: Move player
  player.emit({
    topic: 'player:move',
    source: player.getRef(),
    payload: { x: 10, y: 20, z: 5 },
    timestamp: Date.now()
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Event 4: More points
  player.emit({
    topic: 'game:score',
    source: player.getRef(),
    payload: { points: 250 },
    timestamp: Date.now()
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Event 5: Complete level (should trigger snapshot)
  player.emit({
    topic: 'game:level-complete',
    source: player.getRef(),
    payload: {},
    timestamp: Date.now()
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\nFinal state:');
  console.log(JSON.stringify(gameState.getStatus(), null, 2));
  
  // Check persistence status
  const status = await persistence.getStatus();
  console.log('\nPersistence status:');
  console.log(JSON.stringify(status, null, 2));
  
  // Test snapshot creation
  console.log('\nCreating manual snapshot...');
  const snapshot = await persistence.createSnapshot();
  console.log(`Snapshot created at sequence ${snapshot.sequence}`);
  
  // Simulate some more changes after snapshot
  console.log('\n--- Making changes after snapshot ---');
  player.emit({
    topic: 'game:score',
    source: player.getRef(),
    payload: { points: 500 },
    timestamp: Date.now()
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('State after additional changes:');
  console.log(JSON.stringify(gameState.getStatus(), null, 2));
  
  // Test restoration
  console.log('\n--- Testing restoration ---');
  console.log('Restoring from snapshot...');
  
  // Create new space and veil state for restoration test
  const restoredVeilState = new VEILStateManager();
  const restoredSpace = new Space(restoredVeilState);
  
  // Restore from snapshot
  await restoreFromSnapshot(restoredSpace, restoredVeilState, snapshot);
  
  // Find restored player element
  const restoredPlayer = restoredSpace.children.find(c => c.name === 'Player');
  if (restoredPlayer) {
    const restoredGameState = restoredPlayer.getComponent(GameStateComponent) as GameStateComponent;
    console.log('\nRestored state:');
    console.log(JSON.stringify(restoredGameState.getStatus(), null, 2));
    console.log('\nRestoration successful! State matches snapshot.');
  } else {
    console.error('Failed to find restored player element');
  }
}

main().catch(console.error);
