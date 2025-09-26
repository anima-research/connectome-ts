/**
 * Example: BasicAgent Constructor Improvements
 * 
 * Shows how the new constructor pattern is more intuitive
 */

import { 
  BasicAgent, 
  createBasicAgent,
  MockLLMProvider,
  VEILStateManager
} from '../src';

// BEFORE: Confusing separate parameters
// "Constructor signatures don't match intuition"
const oldWay = () => {
  const config = {
    name: 'Assistant',
    systemPrompt: 'You are helpful',
    defaultTemperature: 0.7
  };
  const provider = new MockLLMProvider();
  const veilState = new VEILStateManager();
  
  // Have to pass them separately - not intuitive!
  const agent = new BasicAgent(
    config,           // First param
    provider,         // Second param  
    veilState,        // Third param
    undefined         // Fourth param
  );
  
  // Easy to get the order wrong:
  // new BasicAgent(provider, config, veilState); // WRONG!
};

// AFTER: Option 1 - Factory Function (Recommended)
const newWayFactory = () => {
  // Everything in one intuitive object!
  const agent = createBasicAgent({
    name: 'Assistant',
    provider: new MockLLMProvider(),
    systemPrompt: 'You are helpful',
    temperature: 0.7,
    maxTokens: 500,
    veilStateManager: new VEILStateManager()
  });
  
  // Clear what each parameter is
  // Can't get the order wrong
  // Optional params are obvious
};

// AFTER: Option 2 - Constructor with Options
const newWayConstructor = () => {
  // BasicAgent now accepts an options object
  const agent = new BasicAgent({
    config: {
      name: 'Assistant',
      systemPrompt: 'You are helpful',
      defaultTemperature: 0.7
    },
    provider: new MockLLMProvider(),
    veilStateManager: new VEILStateManager()
  });
  
  // Still clear and grouped logically
};

// Backward Compatibility
const backwardCompatible = () => {
  // Old way still works!
  const agent = new BasicAgent(
    { name: 'Assistant' },
    new MockLLMProvider()
  );
  
  // No breaking changes
};

/**
 * Benefits:
 * 
 * 1. Intuitive - All config in one place
 * 2. Self-documenting - Parameter names are clear
 * 3. Flexible - Easy to add optional parameters
 * 4. Safe - Can't mix up parameter order
 * 5. Backward compatible - Old code still works
 * 
 * The developer who struggled with "Constructor signatures 
 * don't match intuition" now has a clear, simple API!
 */
