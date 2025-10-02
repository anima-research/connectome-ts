/**
 * Example AXON Module using RETM Pattern
 * 
 * A simple counter that demonstrates:
 * - Receptor: Handles increment/decrement commands
 * - Effector: Logs when count reaches milestones
 * - Transform: Adds metadata to counter state
 * - Maintainer: Resets counter if it gets too high
 */

export function createModule(env: any) {
  const { 
    persistent, 
    createStateFacet, 
    createEventFacet 
  } = env;
  
  // Receptor: Processes counter commands
  class CounterCommandReceptor {
    topics = ['counter:increment', 'counter:decrement', 'counter:set'];
    
    transform(event: any, state: any) {
      const { topic, payload, source } = event;
      const deltas = [];
      
      // Find existing counter state
      let currentCount = 0;
      let counterId = null;
      
      for (const [id, facet] of state.facets) {
        if (facet.type === 'state' && facet.entityId === 'counter') {
          currentCount = facet.state.count || 0;
          counterId = id;
          break;
        }
      }
      
      // Calculate new count
      let newCount = currentCount;
      switch (topic) {
        case 'counter:increment':
          newCount = currentCount + (payload.amount || 1);
          break;
        case 'counter:decrement':
          newCount = currentCount - (payload.amount || 1);
          break;
        case 'counter:set':
          newCount = payload.value || 0;
          break;
      }
      
      // Create or update counter state
      if (counterId) {
        deltas.push({
          type: 'rewriteFacet',
          id: counterId,
          changes: {
            state: { count: newCount },
            content: `Counter: ${newCount}`
          }
        });
      } else {
        deltas.push({
          type: 'addFacet',
          facet: createStateFacet({
            entityType: 'component',
            entityId: 'counter',
            content: `Counter: ${newCount}`,
            attributes: { count: newCount }
          })
        });
      }
      
      // Add event facet for the command
      deltas.push({
        type: 'addFacet',
        facet: createEventFacet({
          content: `Counter ${topic.split(':')[1]} to ${newCount}`,
          source,
          agentId: 'system',
          streamId: 'counter'
        })
      });
      
      return deltas;
    }
  }
  
  // Effector: Reacts to counter milestones
  class CounterMilestoneEffector {
    facetFilters = [{ type: 'state', entityId: 'counter' }];
    
    async process(changes: any[], state: any) {
      const events = [];
      const externalActions = [];
      
      for (const change of changes) {
        if (change.type === 'changed' || change.type === 'added') {
          const count = change.facet.state?.count || 0;
          
          // Check for milestones
          if (count > 0 && count % 10 === 0) {
            console.log(`🎉 Counter milestone reached: ${count}!`);
            
            externalActions.push({
              type: 'console-log',
              description: `Milestone ${count} reached`,
              message: `🎉 Counter milestone reached: ${count}!`
            });
            
            // Emit celebration event
            events.push({
              topic: 'counter:milestone',
              source: { elementId: 'counter-effector', elementPath: [] },
              timestamp: Date.now(),
              payload: { count, milestone: true }
            });
          }
        }
      }
      
      return { events, externalActions };
    }
  }
  
  // Transform: Adds metadata to counter state
  class CounterMetadataTransform {
    process(state: any) {
      const deltas = [];
      
      for (const [id, facet] of state.facets) {
        if (facet.type === 'state' && facet.entityId === 'counter') {
          const count = facet.state?.count || 0;
          
          // Add metadata about the count
          const metadata = {
            ...facet.metadata,
            isEven: count % 2 === 0,
            isPositive: count > 0,
            magnitude: Math.abs(count)
          };
          
          // Only update if metadata changed
          if (JSON.stringify(metadata) !== JSON.stringify(facet.metadata)) {
            deltas.push({
              type: 'rewriteFacet',
              id,
              changes: { metadata }
            });
          }
        }
      }
      
      return deltas;
    }
  }
  
  // Maintainer: Resets counter if too high
  class CounterLimitMaintainer {
    private maxCount = 100;
    
    maintain(state: any) {
      const events = [];
      
      for (const [id, facet] of state.facets) {
        if (facet.type === 'state' && facet.entityId === 'counter') {
          const count = facet.state?.count || 0;
          
          if (count > this.maxCount) {
            console.log(`⚠️  Counter ${count} exceeds limit ${this.maxCount}, resetting...`);
            
            events.push({
              topic: 'counter:set',
              source: { elementId: 'counter-maintainer', elementPath: [] },
              timestamp: Date.now(),
              payload: { value: 0, reason: 'limit-exceeded' }
            });
          }
        }
      }
      
      return events;
    }
  }
  
  // Export all RETM components
  return {
    receptors: {
      CounterCommandReceptor
    },
    effectors: {
      CounterMilestoneEffector
    },
    transforms: {
      CounterMetadataTransform
    },
    maintainers: {
      CounterLimitMaintainer
    }
  };
}

// Manifest for this module
export const manifest = {
  name: 'counter-retm',
  version: '1.0.0',
  description: 'Example counter using RETM pattern',
  main: 'counter-retm.ts',
  exports: {
    receptors: ['CounterCommandReceptor'],
    effectors: ['CounterMilestoneEffector'],
    transforms: ['CounterMetadataTransform'],
    maintainers: ['CounterLimitMaintainer']
  },
  metadata: {
    CounterCommandReceptor: {
      description: 'Processes counter increment/decrement commands',
      topics: ['counter:increment', 'counter:decrement', 'counter:set']
    },
    CounterMilestoneEffector: {
      description: 'Celebrates counter milestones',
      facetFilters: [{ type: 'state', entityId: 'counter' }]
    },
    CounterMetadataTransform: {
      description: 'Adds metadata to counter state'
    },
    CounterLimitMaintainer: {
      description: 'Resets counter if it exceeds limit'
    }
  }
};

