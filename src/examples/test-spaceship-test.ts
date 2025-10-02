// Complete VEIL frames for the starship scenario
// This file shows all VEIL frames that produce the rendered context

import { Frame, createDefaultTransition } from '../veil/types';

const BRIDGE_STREAM_ID = 'starship:bridge';
const BRIDGE_STREAM_TYPE = 'starship';
const CAPTAIN_AGENT_ID = 'captain';
const CAPTAIN_AGENT_NAME = 'Captain Reyes';

export const starshipScenarioFrames: (Frame | Frame)[] = [
  // Frame 1: Initial state setup
  {
    sequence: 1,
    timestamp: '2024-01-15T10:30:00Z',
    activeStream: {
      streamId: BRIDGE_STREAM_ID,
      streamType: BRIDGE_STREAM_TYPE,
      metadata: { location: 'bridge' }
    },
    events: [],
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'stream-change-bridge',
          type: 'stream-change',
          state: {
            operation: 'add',
            streamId: BRIDGE_STREAM_ID,
            streamType: BRIDGE_STREAM_TYPE
          },
          ephemeral: true
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'available-channels',
          type: 'state',
          content: 'Active channels: Bridge',
          state: {
            channels: ['Bridge']
          },
          entityType: 'component',
          entityId: 'communications',
          scopes: [],
          saliency: {
            crossStream: true,
            reference: true
          }
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'ship-status-001',
          type: 'state',
          content: 'USS Endeavor - In orbit around Kepler-442b',
          state: {
            alertLevel: 'green',
            shields: '100%',
            power: 'nominal'
          },
          entityType: 'component',
          entityId: 'ship-status',
          scopes: [],
          saliency: {
            crossStream: true
          }
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'bridge-crew-001',
          type: 'state',
          content: 'Commander Chen at helm, Lt. Rodriguez at sensors',
          state: {
            crew: [
              { role: 'Helm', name: 'Commander Chen' },
              { role: 'Sensors', name: 'Lt. Rodriguez' }
            ]
          },
          entityType: 'component',
          entityId: 'bridge-crew',
          scopes: []
        }
      }
    ],
    transition: createDefaultTransition(1, '2024-01-15T10:30:00Z')
  },

  // Frame 2: Sensor event detection
  {
    sequence: 2,
    timestamp: '2024-01-15T10:31:15Z',
    events: [],
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'sensor-event-001',
          type: 'event',
          content: 'Anomalous energy signature detected on planet surface, sector 7-G',
          state: {
            source: 'Lt. Rodriguez',
            eventType: 'sensor-alert',
            metadata: { priority: 'medium' }
          },
          streamId: BRIDGE_STREAM_ID,
          saliency: {
            streams: [BRIDGE_STREAM_ID],
            reference: true
          }
        }
      }
    ],
    transition: createDefaultTransition(2, '2024-01-15T10:31:15Z')
  },

  // Frame 3: Alert level change and tool registration
  {
    sequence: 3,
    timestamp: '2024-01-15T10:31:20Z',
    events: [],
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'scan-tool',
          type: 'action-definition',
          state: {
            actionName: 'perform_deep_scan',
            parameters: ['target_sector', 'scan_type'],
            description: 'Perform a deep diagnostic scan of the specified sector.',
            handler: 'SensorElement.handleDeepScan'
          }
        }
      },
      {
        type: 'rewriteFacet',
        id: 'ship-status-001',
        changes: {
          state: {
            alertLevel: 'yellow'
          }
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'agent-activation-initial',
          type: 'agent-activation',
          state: {
            reason: 'User initiated conversation',
            priority: 'high',
            sourceAgentId: 'user'
          },
          ephemeral: true
        }
      }
    ],
    transition: createDefaultTransition(3, '2024-01-15T10:31:20Z')
  },

  // Frame 4: Agent's first response (outgoing)
  {
    sequence: 4,
    timestamp: '2024-01-15T10:31:25Z',
    events: [],
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'captain-speech-001',
          type: 'speech',
          content: `Interesting. That energy signature wasn't there during our initial orbital scan.`,
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'captain-speech-002',
          type: 'speech',
          content: 'Lieutenant Rodriguez, can you get me more details on that anomaly? Run a deep scan on sector 7-G, focusing on electromagnetic and subspace frequencies.',
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'captain-action-001',
          type: 'action',
          content: JSON.stringify({
            target_sector: '7-G',
            scan_type: 'electromagnetic,subspace'
          }),
          state: {
            toolName: 'perform_deep_scan',
            parameters: {
              target_sector: '7-G',
              scan_type: 'electromagnetic,subspace'
            }
          },
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'captain-speech-003',
          type: 'speech',
          content: 'Commander Chen, maintain our current orbit but be ready to break away if needed.',
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      }
    ],
    transition: createDefaultTransition(4, '2024-01-15T10:31:25Z')
  },

  // Frame 5: Scan results
  {
    sequence: 5,
    timestamp: '2024-01-15T10:31:45Z',
    events: [],
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'scan-results-001',
          type: 'event',
          content: `Deep scan complete:\n- Electromagnetic: Structured patterns detected, possible technology\n- Subspace: Minimal distortion, no active fields\n- Energy output: 2.3 terawatts, pulsing at 0.7Hz intervals\n- Composition: Unable to determine, interference present`,
          state: {
            source: 'sensors',
            eventType: 'scan-results',
            metadata: {
              frequency: '0.7Hz',
              energyOutput: '2.3 terawatts'
            }
          },
          streamId: BRIDGE_STREAM_ID
        }
      }
    ],
    transition: createDefaultTransition(5, '2024-01-15T10:31:45Z')
  },

  // Frame 6: Transmission detection
  {
    sequence: 6,
    timestamp: '2024-01-15T10:31:50Z',
    events: [],
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'transmission-event-001',
          type: 'event',
          content: `Captain, I'm picking up a faint transmission on a carrier wave matching that pulse frequency. It's... it's mathematical sequences. Prime numbers.`,
          state: {
            source: 'Commander Chen',
            eventType: 'transmission-detected',
            metadata: {
              pattern: 'prime-numbers'
            }
          },
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'mission-objectives',
          type: 'ambient',
          content: `Primary Directive: Investigate signs of intelligent life\nSecondary: Maintain crew and ship safety\nCurrent Mission Duration: 342 days`,
          streamId: BRIDGE_STREAM_ID,
          saliency: {
            crossStream: true,
            reference: true
          }
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'agent-activation-continue',
          type: 'agent-activation',
          state: {
            reason: 'Conversation continuation',
            priority: 'normal',
            sourceAgentId: 'system'
          },
          ephemeral: true
        }
      }
    ],
    transition: createDefaultTransition(6, '2024-01-15T10:31:50Z')
  },

  // Frame 7: Agent's second response with inner thoughts
  {
    sequence: 7,
    timestamp: '2024-01-15T10:31:55Z',
    events: [],
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'captain-thought-001',
          type: 'thought',
          content: 'Prime numbers? That is a clear sign of intelligence. This changes everything.',
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'captain-speech-004',
          type: 'speech',
          content: 'All stop. Lt. Rodriguez, record everything. Commander Chen, can you isolate and clean up that transmission?',
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'captain-action-002',
          type: 'action',
          content: JSON.stringify({
            frequency: '0.7Hz',
            pattern: 'prime_sequence'
          }),
          state: {
            toolName: 'analyze_transmission',
            parameters: {
              frequency: '0.7Hz',
              pattern: 'prime_sequence'
            }
          },
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'captain-speech-005',
          type: 'speech',
          content: 'And open a ship-wide channel.',
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'captain-action-003',
          type: 'action',
          content: JSON.stringify({
            channel: 'ship_wide',
            message: 'All hands, this is the Captain. We may have just made first contact. All departments prepare for extended station keeping. Science teams to the bridge.'
          }),
          state: {
            toolName: 'ship_comms',
            parameters: {
              channel: 'ship_wide',
              message: 'All hands, this is the Captain. We may have just made first contact. All departments prepare for extended station keeping. Science teams to the bridge.'
            }
          },
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      }
    ],
    transition: createDefaultTransition(7, '2024-01-15T10:31:55Z')
  },

  // Frame 8: Tool responses and crew activity
  {
    sequence: 8,
    timestamp: '2024-01-15T10:32:10Z',
    events: [],
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'transmission-analysis-001',
          type: 'state',
          content: 'Decoding mathematical sequence... analysis ongoing.',
          state: {
            status: 'processing',
            progress: 'identifying prime number sequence'
          },
          entityType: 'component',
          entityId: 'transmission-analysis',
          scopes: []
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'ship-comms-status',
          type: 'state',
          content: 'Ship-wide announcement delivered. Science teams acknowledging.',
          state: {
            status: 'delivered',
            acknowledgements: ['Science teams']
          },
          entityType: 'component',
          entityId: 'communications-status',
          scopes: []
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'crew-event-001',
          type: 'event',
          content: 'Arriving on bridge with xenobiology team.',
          state: {
            source: 'Dr. Yuki Tanaka',
            eventType: 'crew-report',
            metadata: {
              team: 'xenobiology'
            }
          },
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'crew-event-002',
          type: 'event',
          content: 'Power reserves optimal, ready for extended operations.',
          state: {
            source: 'Chief Engineer Morrison',
            eventType: 'crew-report',
            metadata: {
              system: 'power'
            }
          },
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'agent-activation-status-update',
          type: 'agent-activation',
          state: {
            reason: 'Status updates received',
            priority: 'normal',
            sourceAgentId: 'system'
          },
          ephemeral: true
        }
      }
    ],
    transition: createDefaultTransition(8, '2024-01-15T10:32:10Z')
  },

  // Frame 9: Agent reflection
  {
    sequence: 9,
    timestamp: '2024-01-15T10:32:15Z',
    events: [],
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'captain-thought-002',
          type: 'thought',
          content: "This is what we've been searching for. After nearly a year in deep space, we might have found intelligent life. Need to proceed carefully.",
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'captain-speech-006',
          type: 'speech',
          content: 'Dr. Tanaka, good timing. Look at this pattern - prime numbers broadcast at regular intervals. What is your assessment?',
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      }
    ],
    transition: createDefaultTransition(9, '2024-01-15T10:32:15Z')
  },

  // Frame 9.5: Personal log decision
  {
    sequence: 9.5,
    timestamp: '2024-01-15T10:32:20Z',
    events: [],
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'captain-thought-003',
          type: 'thought',
          content: 'I should record this in my personal log. This could be a historic moment.',
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'captain-action-004',
          type: 'action',
          content: JSON.stringify({
            classification: "Captain's Eyes Only"
          }),
          state: {
            toolName: 'open_personal_log',
            parameters: {
              classification: "Captain's Eyes Only"
            }
          },
          agentId: CAPTAIN_AGENT_ID,
          agentName: CAPTAIN_AGENT_NAME,
          streamId: BRIDGE_STREAM_ID
        }
      }
    ],
    transition: createDefaultTransition(9.5, '2024-01-15T10:32:20Z')
  }
];
