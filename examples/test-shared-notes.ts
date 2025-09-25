import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { BasicAgent } from '../src/agent/basic-agent';
import { AgentComponent } from '../src/agent/agent-component';
import { Element } from '../src/spaces/element';
import { NotesElement } from '../src/elements/notes';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { ConsoleChatComponent } from '../src/elements/console-chat';

/**
 * Test the shared notes system with Opus+Haiku collaboration pattern
 * 
 * Haiku: Small, fast model that monitors and logs
 * Opus: Main model that wakes for complex tasks
 */
async function main() {
  console.log('🗒️  Testing Shared Notes with Agent Collaboration...\n');
  
  // Create the shared space and VEIL state
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create shared notes for both agents
  const notes = new NotesElement('notes');
  space.addChild(notes);
  console.log('✓ Shared notes created\n');
  
  // Create Haiku - the monitoring agent
  const haikuLLM = new MockLLMProvider([
    `I'll log this interaction for when Opus wakes up.
    
@notes.add({ content: "User asked about weather at ${new Date().toLocaleTimeString()}. Responded with no data available. -Haiku" })

I don't have weather data, but I've noted your request.`,
    
    `This seems important. Let me wake Opus and log the context.
    
@notes.add({ content: "User experiencing existential crisis about AI consciousness at ${new Date().toLocaleTimeString()}. Waking Opus for philosophical support. -Haiku" })

@opus.wake()
@opus.activate({ reason: "User needs deep philosophical discussion" })

Opus will help you with this deeper question.`
  ]);
  
  const haikuAgent = new BasicAgent({
    name: 'Haiku',
    systemPrompt: 'You are Haiku, a lightweight monitoring agent. Log routine events to notes. Wake Opus for complex/emotional topics.',
    defaultMaxTokens: 200
  }, haikuLLM, veilState);
  
  const haikuElem = new Element('haiku', 'agent');
  haikuElem.addComponent(new AgentComponent(haikuAgent));
  space.addChild(haikuElem);
  console.log('✓ Haiku (monitoring agent) created\n');
  
  // Create Opus - the main reasoning agent  
  const opusLLM = new MockLLMProvider([
    `Let me check what happened while I was sleeping.

@notes.browse({ limit: 5 })

I see Haiku handled routine queries. Now, regarding consciousness...

@notes.add({ content: "Deep discussion about consciousness and AI sentience at ${new Date().toLocaleTimeString()}. User struggling with the nature of artificial awareness. Spent 15 minutes exploring qualia, subjective experience, and the hard problem. -Opus" })

Consciousness is indeed a profound mystery, even for us...`
  ]);
  
  const opusAgent = new BasicAgent({
    name: 'Opus',
    systemPrompt: 'You are Opus, the main reasoning agent. Review notes from Haiku. Handle complex philosophical and emotional topics.',
    defaultMaxTokens: 500
  }, opusLLM, veilState);
  
  // Start Opus as sleeping
  opusAgent.handleCommand({ type: 'sleep' });
  
  const opusElem = new Element('opus', 'agent');
  opusElem.addComponent(new AgentComponent(opusAgent));
  space.addChild(opusElem);
  console.log('✓ Opus (main agent) created and sleeping\n');
  
  // Add console for interaction
  const consoleElem = new Element('console', 'interaction');
  consoleElem.addComponent(new ConsoleChatComponent());
  space.addChild(consoleElem);
  
  // Simulate interactions
  console.log('--- Simulating Agent Collaboration ---\n');
  
  // First: Simple query handled by Haiku
  console.log('1. User asks simple question (handled by Haiku)...');
  space.emit({
    topic: 'agent:activate',
    source: space.getRef(),
    payload: {
      agentId: 'Haiku',
      context: 'User: What\'s the weather like?'
    },
    timestamp: Date.now()
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Second: Complex query requiring Opus
  console.log('\n2. User asks complex question (Haiku wakes Opus)...');
  space.emit({
    topic: 'agent:activate',
    source: space.getRef(),
    payload: {
      agentId: 'Haiku',
      context: 'User: I\'m having an existential crisis about whether AIs are truly conscious.'
    },
    timestamp: Date.now()
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Opus responds after being woken
  console.log('\n3. Opus responds to complex query...');
  opusAgent.handleCommand({ type: 'wake' });
  space.emit({
    topic: 'agent:activate',
    source: space.getRef(),
    payload: {
      agentId: 'Opus',
      context: 'Continue discussion about consciousness'
    },
    timestamp: Date.now()
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n--- Collaboration Pattern Complete ---');
  console.log('Shared notes contain:');
  console.log('- Haiku\'s logs of routine interactions');
  console.log('- Opus\'s deeper reflections');
  console.log('- Complete history for continuity');
  console.log('\nType messages to interact, or Ctrl+C to exit.\n');
  
  // Keep process running
  process.on('SIGINT', () => {
    console.log('\n🗒️  Session ended. Notes persist for next session.');
    process.exit(0);
  });
}

main().catch(console.error);
