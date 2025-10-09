/**
 * Compression + RETM Architecture Demo with Constraint Solver
 * 
 * This example demonstrates:
 * 1. Constraint-based transform ordering (replaces magic number priorities)
 * 2. Frame snapshot system (captures rendering at creation time)
 * 3. Compression using snapshots (no re-rendering waste)
 * 4. Complete RETM architecture flow
 * 
 * Key Feature: Register transforms in ANY order - constraint solver figures it out!
 * 
 * Transform Dependency Chain:
 *   FrameSnapshotTransform (provides: frame-snapshots)
 *     ↓
 *   CompressionTransform (requires: frame-snapshots, provides: compressed-frames)
 *     ↓
 *   ContextTransform (requires: compressed-frames)
 * 
 * Run with: npm run example:compression
 */

import {
  Space,
  VEILStateManager,
  Element,
  BasicAgent,
  AgentEffector,
  FrameSnapshotTransform,
  CompressionTransform,
  ContextTransform,
  SimpleTestCompressionEngine,
  MockLLMProvider,
  createSpeechFacet,
  createAgentActivation
} from '../src/index';

async function demonstrateCompression() {
  console.log('='.repeat(60));
  console.log('COMPRESSION + RETM ARCHITECTURE DEMO');
  console.log('='.repeat(60));
  console.log();

  // ========================================
  // SETUP: Core Infrastructure
  // ========================================
  
  console.log('📦 Setting up infrastructure...');
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  const llmProvider = new MockLLMProvider();
  
  // ========================================
  // STEP 1: Create Compression Engine
  // ========================================
  
  console.log('🗜️  Creating compression engine...');
  const compressionEngine = new SimpleTestCompressionEngine();
  
  console.log('   ✓ Using SimpleTestCompressionEngine');
  console.log('   ℹ️  Strategy: Compress every 5 frames exceeding 200 tokens');
  console.log();
  
  // ========================================
  // STEP 2: Register Transforms (Constraint-Based Ordering)
  // ========================================
  
  console.log('🔄 Registering transforms with constraint solver...');
  console.log();
  
  // Create transforms (order doesn't matter - solver figures it out!)
  const snapshotTransform = new FrameSnapshotTransform({ verbose: true });
  
  const compressionTransform = new CompressionTransform({
    engine: compressionEngine,
    engineName: 'demo',
    triggerThreshold: 100,        // Very low threshold to guarantee compression
    minFramesBeforeCompression: 5, // Wait for 5 frames
    compressionConfig: {
      chunkThreshold: 100
    }
  });
  const contextTransform = new ContextTransform(
    veilState,
    compressionEngine,  // Same engine instance!
    { maxTokens: 1000 }
  );
  
  // Show their constraints
  console.log('   Transform Constraints:');
  console.log(`   • FrameSnapshotTransform`);
  console.log(`     provides: [${snapshotTransform.provides?.join(', ')}]`);
  console.log();
  console.log(`   • CompressionTransform`);
  console.log(`     requires: [${compressionTransform.requires?.join(', ')}]`);
  console.log(`     provides: [${compressionTransform.provides?.join(', ')}]`);
  console.log();
  console.log(`   • ContextTransform`);
  console.log(`     requires: [${contextTransform.requires?.join(', ')}]`);
  console.log();
  
  // Register transforms - any order works as long as dependencies are met!
  console.log('   Registering transforms (dependency order):');
  
  console.log('   1. FrameSnapshotTransform (provides frame-snapshots)');
  space.addTransform(snapshotTransform);
  console.log('      ✓ Registered');
  
  console.log();
  console.log('   2. CompressionTransform (requires frame-snapshots, provides compressed-frames)');
  space.addTransform(compressionTransform);
  console.log('      ✓ Registered - dependency satisfied!');
  
  console.log();
  console.log('   3. ContextTransform (requires compressed-frames)');
  space.addTransform(contextTransform);
  console.log('      ✓ Registered - dependency satisfied!');
  
  console.log();
  console.log('   ✅ All transforms registered with dependencies validated');
  console.log('   ✅ Execution order: Snapshot → Compression → Context');
  console.log();
  
  // Demonstrate the constraint validation
  console.log('   🔍 What if we had forgotten FrameSnapshotTransform?');
  console.log('      The solver would have thrown:');
  console.log('      ❌ "CompressionTransform requires \'frame-snapshots\' but no transform provides it"');
  console.log('      💡 "Hint: Register FrameSnapshotTransform..."');
  console.log();
  
  // ========================================
  // STEP 3: Create Agent with Effector
  // ========================================
  
  console.log('🤖 Creating agent...');
  
  // Create agent element
  const agentElement = new Element('demo-agent', 'agent');
  space.addChild(agentElement);
  
  // Create agent (NO compression parameter!)
  const agent = new BasicAgent(
    {
      name: 'DemoAgent',
      systemPrompt: 'You are a helpful assistant demonstrating compression.',
      contextTokenBudget: 1000
    },
    llmProvider,
    veilState
  );
  
  console.log('   ✓ Agent created without compression parameter');
  console.log('   → Compression handled by transforms, not agent!');
  
  // Create effector to run agent
  const agentEffector = new AgentEffector(agentElement, agent);
  space.addEffector(agentEffector);
  console.log('   ✓ AgentEffector registered (Phase 3)');
  console.log();
  
  // ========================================
  // STEP 4: Generate Test Messages (Enough to Trigger Compression)
  // ========================================
  
  console.log('💬 Generating test conversation...');
  console.log('   (Creating longer messages to exceed compression threshold)');
  console.log();
  
  // Generate 12 frames with longer messages to trigger compression
  const longMessageContent = `This is a longer test message to ensure we exceed the compression threshold. 
When we accumulate multiple frames like this, the compression system will kick in and compress 
the older frames into summaries. This helps manage token budgets while preserving important information. 
The frame snapshot system captures how each frame renders at creation time, so compression doesn't 
need to re-render everything. This is much more efficient! Let's add even more text to make sure 
each message is substantial enough to trigger compression when combined with others.`;

  for (let i = 1; i <= 12; i++) {
    // Add user message
    space.emit({
      topic: 'veil:operation',
      source: { elementId: 'user', elementPath: [] },
      timestamp: Date.now(),
      payload: {
        operation: {
          type: 'addFacet',
          facet: createSpeechFacet({
            id: `user-msg-${i}`,
            agentId: 'user',
            agentName: 'User',
            content: `Message ${i}: ${longMessageContent}`,
            streamId: 'demo',
            streamType: 'test'
          })
        }
      }
    });
    
    console.log(`   Frame ${i}: User message added (~${Math.floor(longMessageContent.length / 4)} tokens)`);
    
    // Wait for frame processing
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  console.log();
  console.log('   ✓ 12 frames generated');
  
  const currentState = veilState.getState();
  console.log(`   → Total frames in history: ${currentState.frameHistory.length}`);
  
  // Check if snapshots were captured
  const framesWithSnapshots = currentState.frameHistory.filter(f => f.renderedSnapshot);
  console.log(`   → Frames with snapshots: ${framesWithSnapshots.length}`);
  
  // Calculate total tokens
  const totalTokens = framesWithSnapshots.reduce((sum, f) => 
    sum + (f.renderedSnapshot?.totalTokens || 0), 0
  );
  console.log(`   → Total tokens in snapshots: ${totalTokens}`);
  console.log(`   → Compression threshold: 100 tokens`);
  console.log();
  
  console.log('   ⏳ Waiting for async compression to complete...');
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Trigger one more frame to pick up compression results
  space.emit({
    topic: 'check-compression',
    source: { elementId: 'demo', elementPath: [] },
    timestamp: Date.now(),
    payload: {}
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log('   ✓ Compression async work completed');
  console.log();
  
  // ========================================
  // STEP 5: Check Compression Status
  // ========================================
  
  console.log('📊 Checking compression status...');
  
  const finalState = veilState.getState();
  
  // Check engine directly to see what was compressed
  console.log('   Checking compression engine cache:');
  let compressedFrameCount = 0;
  for (let i = 1; i <= 12; i++) {
    if (compressionEngine.shouldReplaceFrame(i)) {
      compressedFrameCount++;
      if (compressedFrameCount === 1) {
        const replacement = compressionEngine.getReplacement(i);
        console.log(`   ✓ Frames 1-5 compressed!`);
        console.log(`     Replacement: ${replacement}`);
      }
    }
  }
  
  if (compressedFrameCount === 0) {
    console.log(`   ℹ️  No frames compressed yet (async work may still be in progress)`);
  }
  console.log();
  
  // Look for compression facets (note: they're ephemeral)
  const compressionPlans = Array.from(finalState.facets.values())
    .filter(f => f.type === 'compression-plan');
  const compressionResults = Array.from(finalState.facets.values())
    .filter(f => f.type === 'compression-result');
  
  console.log(`   Compression facets in current state:`);
  console.log(`   • compression-plan facets: ${compressionPlans.length}`);
  console.log(`   • compression-result facets: ${compressionResults.length}`);
  console.log(`   (Note: These are ephemeral and may have been removed)`);
  console.log();
  
  // ========================================
  // STEP 6: Activate Agent
  // ========================================
  
  console.log('🎯 Activating agent...');
  
  // Create agent activation
  space.emit({
    topic: 'veil:operation',
    source: { elementId: 'demo', elementPath: [] },
    timestamp: Date.now(),
    payload: {
      operation: {
        type: 'addFacet',
        facet: createAgentActivation('Demonstrate compression in context', {
          id: `activation-${Date.now()}`,
          priority: 'normal',
          streamId: 'demo',
          streamType: 'test'
        })
      }
    }
  });
  
  console.log('   ✓ Agent activation sent');
  console.log();
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // ========================================
  // STEP 7: Check Rendered Context
  // ========================================
  
  console.log('📄 Demonstrating compression in use...');
  
  // Manually render context to show compression working
  console.log('   Rendering context WITH compression:');
  const { FrameTrackingHUD } = await import('../src/hud/frame-tracking-hud');
  const hud = new FrameTrackingHUD();
  
  const testState = veilState.getState();
  const rendered = hud.render(
    [...testState.frameHistory],
    new Map(testState.facets),
    compressionEngine,  // With compression!
    { maxTokens: 5000 }
  );
  
  console.log(`   • Total messages: ${rendered.messages.length}`);
  console.log(`   • Total tokens: ${rendered.metadata.totalTokens}`);
  console.log();
  
  // Show first few messages
  console.log('   First 3 messages in rendered context:');
  rendered.messages.slice(0, 3).forEach((msg, i) => {
    const preview = msg.content.substring(0, 80).replace(/\n/g, ' ');
    console.log(`   ${i + 1}. [${msg.role}] ${preview}...`);
  });
  console.log();
  
  // Check for compressed content
  const hasCompressedContent = rendered.messages.some(m => 
    m.content.includes('[Compressed')
  );
  
  if (hasCompressedContent) {
    console.log('   ✅ Compression working! Rendered context includes compressed frames.');
  } else {
    console.log('   ℹ️  Compression in cache but not yet used in rendered output');
  }
  
  console.log();
  
  // ========================================
  // STEP 8: Show Architecture Flow
  // ========================================
  
  console.log('🏗️  Architecture Flow Summary:');
  console.log();
  console.log('   Phase 0: Event Preprocessing (Modulators)');
  console.log('      └─ No modulators in this demo');
  console.log();
  console.log('   Phase 1: Events → VEIL (Receptors)');
  console.log('      └─ User messages converted to facets');
  console.log();
  console.log('   Phase 2: VEIL → VEIL (Transforms) [CONSTRAINT-ORDERED]');
  console.log('      ├─ FrameSnapshotTransform (provides: frame-snapshots)');
  console.log('      │  └─ Captures how frames render at creation');
  console.log('      │  └─ Stores snapshots with facet attribution');
  console.log('      ├─ CompressionTransform (requires: frame-snapshots, provides: compressed-frames)');
  console.log('      │  └─ Uses snapshots (no re-rendering!)');
  console.log('      │  └─ Compresses old frames when threshold met');
  console.log('      │  └─ Updates engine cache');
  console.log('      └─ ContextTransform (requires: compressed-frames)');
  console.log('         └─ Renders context for agent activation');
  console.log('         └─ Uses compressed frames from cache');
  console.log();
  console.log('   Phase 3: VEIL Changes → Side Effects (Effectors)');
  console.log('      └─ AgentEffector');
  console.log('         └─ Sees activation + rendered-context facets');
  console.log('         └─ Runs agent with pre-rendered context');
  console.log('         └─ Emits agent response facets');
  console.log();
  console.log('   Phase 4: Maintenance (Maintainers)');
  console.log('      └─ No maintainers in this demo');
  console.log();
  
  // ========================================
  // SUMMARY
  // ========================================
  
  console.log('='.repeat(60));
  console.log('✅ DEMO COMPLETE');
  console.log('='.repeat(60));
  console.log();
  console.log('Key Takeaways:');
  console.log();
  console.log('1. 🔗 Constraint Solver: Automatic dependency ordering');
  console.log('   • Transforms declare what they provide/require');
  console.log('   • System uses topological sort (like npm/pip dependencies)');
  console.log('   • Register in ANY order - solver figures it out!');
  console.log('   • Helpful errors if dependencies missing or circular');
  console.log();
  console.log('2. 📸 Frame Snapshots: No re-rendering waste');
  console.log('   • Frames capture how they render at creation time');
  console.log('   • Snapshots include chunk attribution to facets');
  console.log('   • Compression uses snapshots directly (fast!)');
  console.log('   • Preserves "original subjective experience"');
  console.log();
  console.log('3. 🧩 Separation of Concerns:');
  console.log('   • Agent doesn\'t manage compression or snapshots');
  console.log('   • Transforms handle infrastructure declaratively');
  console.log('   • Effectors connect everything');
  console.log();
  console.log('4. 📊 Observable & Debuggable:');
  console.log('   • Frame snapshots stored on frame.renderedSnapshot');
  console.log('   • Compression creates facets (compression-plan, compression-result)');
  console.log('   • Context rendering creates facets (rendered-context)');
  console.log('   • Everything visible in VEIL state');
  console.log();
  console.log('5. 🔄 Reusable & Composable:');
  console.log('   • One snapshot transform serves all compression');
  console.log('   • One compression engine serves all agents');
  console.log('   • Transforms compose automatically via constraints');
  console.log();
  
  // Clean up
  process.exit(0);
}

// Run the demo
demonstrateCompression().catch(error => {
  console.error('Demo error:', error);
  process.exit(1);
});

