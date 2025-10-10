// Complete VEIL frames for the starship scenario
// This file shows all VEIL frames that produce the rendered context

import { Frame } from '../src/veil/types';

export const starshipScenarioFrames: (Frame | Frame)[] = [
  // Frame 1: Initial state setup
  {
    sequence: 1,
    timestamp: "2024-01-15T10:30:00Z",
    activeStream: {
      streamId: "starship:bridge",
      streamType: "starship", 
      metadata: { location: "bridge" }
    },
    deltas: [
      {
        type: "addStream",
        stream: {
          id: "starship:bridge",
          name: "Main Bridge",
          metadata: {
            location: "Deck 1",
            personnel: 8
          }
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "available-channels",
          type: "state",
          displayName: "Communication Channels",
          content: "Active channels: Bridge",
          saliency: {
            crossStream: true,
            reference: true
          }
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "ship-status-001",
          type: "state",
          displayName: "Ship Status",
          content: "USS Endeavor - In orbit around Kepler-442b",
          attributes: {
            alertLevel: "green",
            shields: "100%",
            power: "nominal"
          },
          saliency: {
            crossStream: true  // Ship status relevant everywhere
          }
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "bridge-crew-001",
          type: "state",
          displayName: "Bridge Crew",
          content: "Commander Chen at helm, Lt. Rodriguez at sensors",
          children: [
            {
              id: "helm-status",
              type: "state",
              content: "Orbital trajectory stable"
            }
          ]
        }
      }
    ]
  },

  // Frame 2: Sensor event detection
  {
    sequence: 2,
    timestamp: "2024-01-15T10:31:15Z",
    deltas: [
      {
        type: "addFacet",
        facet: {
          id: "sensor-event-001",
          type: "event",
          displayName: "Sensor Alert",
          content: "Anomalous energy signature detected on planet surface, sector 7-G",
          attributes: {
            priority: "medium",
            source: "Lt. Rodriguez"
          },
          saliency: {
            streams: ["starship:bridge"],
            reference: true  // Important discovery
          }
        }
      }
    ]
  },

  // Frame 3: Alert level change and tool registration
  {
    sequence: 3,
    timestamp: "2024-01-15T10:31:20Z",
    deltas: [
      {
        type: "addFacet",
        facet: {
          id: "scan-tool",
          type: 'action-definition',
          displayName: "Deep Scan",
          definition: {
            name: "perform_deep_scan",
            parameters: ["target_sector", "scan_type"],
            callback: "SensorElement.handleDeepScan"
          }
        }
      },
      {
        type: "RewriteFacet",
        id: "ship-status-001",
        changes: {
          attributes: {
            alertLevel: "yellow"
          }
        }
      },
      {
        type: 'agent-activation',
        config: {
          temperature: 0.7,
          maxTokens: 500
        }
      }
    ]
  },

  // Frame 4: Agent's first response (outgoing)
  {
    sequence: 4,
    timestamp: "2024-01-15T10:31:25Z",
    deltas: [
      {
        type: "speak",
        content: "Interesting. That energy signature wasn't there during our initial orbital scan."
      },
      {
        type: "speak",
        content: "Lieutenant Rodriguez, can you get me more details on that anomaly? Run a deep scan on sector 7-G, focusing on electromagnetic and subspace frequencies."
      },
      {
        type: "act",
        toolName: "perform_deep_scan",
        parameters: {
          target_sector: "7-G",
          scan_type: "electromagnetic,subspace"
        }
      },
      {
        type: "speak",
        content: "Commander Chen, maintain our current orbit but be ready to break away if needed."
      }
    ]
  } as Frame,

  // Frame 5: Scan results
  {
    sequence: 5,
    timestamp: "2024-01-15T10:31:45Z",
    deltas: [
      {
        type: "addFacet",
        facet: {
          id: "scan-results-001",
          type: "event",
          displayName: "Scan Results",
          content: "Deep scan complete:\n- Electromagnetic: Structured patterns detected, possible technology\n- Subspace: Minimal distortion, no active fields\n- Energy output: 2.3 terawatts, pulsing at 0.7Hz intervals\n- Composition: Unable to determine, interference present",
          attributes: {
            source: "sensors"
          }
        }
      }
    ]
  },

  // Frame 6: Transmission detection
  {
    sequence: 6,
    timestamp: "2024-01-15T10:31:50Z",
    deltas: [
      {
        type: "addFacet",
        facet: {
          id: "transmission-event-001",
          type: "event",
          displayName: "Transmission Detected",
          content: "Captain, I'm picking up a faint transmission on a carrier wave matching that pulse frequency. It's... it's mathematical sequences. Prime numbers.",
          attributes: {
            source: "Commander Chen"
          }
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "mission-objectives",
          type: "ambient",
          displayName: "Mission Objectives",
          content: "Primary Directive: Investigate signs of intelligent life\nSecondary: Maintain crew and ship safety\nCurrent Mission Duration: 342 days",
          scope: [],  // No scope requirements - always active
          saliency: {
            crossStream: true,  // Mission relevant everywhere
            reference: true
          }
        }
      },
      {
        type: 'agent-activation'
      }
    ]
  },

  // Frame 7: Agent's second response with inner thoughts
  {
    sequence: 7,
    timestamp: "2024-01-15T10:31:55Z",
    deltas: [
      {
        type: "think",
        content: "Prime numbers? That's a clear sign of intelligence. This changes everything."
      },
      {
        type: "speak",
        content: "All stop. Lt. Rodriguez, record everything. Commander Chen, can you isolate and clean up that transmission?"
      },
      {
        type: "act",
        toolName: "analyze_transmission",
        parameters: {
          frequency: "0.7Hz",
          pattern: "prime_sequence"
        }
      },
      {
        type: "speak",
        content: "And open a ship-wide channel."
      },
      {
        type: "act",
        toolName: "ship_comms",
        parameters: {
          channel: "ship_wide",
          message: "All hands, this is the Captain. We may have just made first contact. All departments prepare for extended station keeping. Science teams to the bridge."
        }
      }
    ]
  } as Frame,

  // Frame 8: Tool responses and crew activity
  {
    sequence: 8,
    timestamp: "2024-01-15T10:32:10Z",
    deltas: [
      {
        type: "addFacet",
        facet: {
          id: "transmission-analysis-001",
          type: "state",
          displayName: "Transmission Analysis",
          content: "Decoding mathematical sequence...\nIdentified: Prime numbers 2 through 127\nAdditional patterns detected, analysis ongoing",
          attributes: {
            status: "processing"
          }
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "ship-comms-status",
          type: "state",
          displayName: "Ship Communications",
          content: "Ship-wide announcement delivered\nScience teams acknowledging",
          attributes: {
            status: "delivered"
          }
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "crew-activity-container",
          type: "state",
          displayName: "Crew Activity",
          children: [
            {
              id: "crew-event-001",
              type: "event",
              displayName: "Crew Report",
              content: "Arriving on bridge with xenobiology team",
              attributes: {
                source: "Dr. Yuki Tanaka"
              }
            },
            {
              id: "crew-event-002", 
              type: "event",
              content: "Power reserves optimal, ready for extended operations",
              attributes: {
                source: "Chief Engineer Morrison"
              }
            }
          ]
        }
      },
      {
        type: 'agent-activation'
      }
    ]
  },

  // Frame 9: Agent's reflection and cycle request
  {
    sequence: 9,
    timestamp: "2024-01-15T10:32:15Z",
    deltas: [
      {
        type: "think",
        content: "This is what we've been searching for. After nearly a year in deep space, we might have found intelligent life. Need to proceed carefully - this could be automated, ancient, or active. The crew is excited but I need to keep them focused."
      },
      {
        type: "speak",
        content: "Dr. Tanaka, good timing. Look at this pattern - prime numbers broadcast at regular intervals. What's your assessment?"
      },
      {
        type: "cycleRequest",
        reason: "awaiting_crew_analysis",
        delayMs: 2000
      }
    ]
  } as Frame,

  // Frame 10: Agent decides to open personal log (outgoing)
  {
    sequence: 10,
    timestamp: "2024-01-15T10:32:20Z",
    deltas: [
      {
        type: "think",
        content: "I should record this in my personal log. This could be a historic moment."
      },
      {
        type: "act",
        toolName: "open_personal_log",
        parameters: {
          classification: "Captain's Eyes Only"
        }
      }
    ]
  } as Frame,

  // Frame 11: System creates log stream in response
  {
    sequence: 11,
    timestamp: "2024-01-15T10:32:21Z",
    deltas: [
      {
        type: "addStream",
        stream: {
          id: "starship:captain-log",
          name: "Captain's Personal Log",
          metadata: {
            private: true,
            classification: "Captain's Eyes Only"
          }
        }
      },
      {
        type: "RewriteFacet",
        id: "available-channels",
        changes: {
          content: "Active channels: Bridge, Captain's Log"
        }
      }
    ]
  },

  // Frame 12: Agent makes log entry (outgoing)
  {
    sequence: 12,
    timestamp: "2024-01-15T10:32:25Z",
    deltas: [
      {
        type: "speak",
        content: "Captain's Log, Stardate 51234.5. We've detected what appears to be an artificial signal - prime numbers. This could be the discovery we've been searching for.",
        target: "starship:captain-log"  // Explicitly targeting the log
      }
    ]
  } as Frame,

  // Frame 13: Tool definitions for the additional tools used
  {
    sequence: 13,
    timestamp: "2024-01-15T10:32:00Z",  // Retroactively adding tool definitions
    deltas: [
      {
        type: "addFacet",
        facet: {
          id: "analyze-transmission-tool",
          type: 'action-definition',
          displayName: "Analyze Transmission",
          definition: {
            name: "analyze_transmission",
            parameters: ["frequency", "pattern"],
            callback: "CommsElement.analyzeTransmission"
          }
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "ship-comms-tool",
          type: 'action-definition',
          displayName: "Ship Communications",
          definition: {
            name: "ship_comms",
            parameters: ["channel", "message"],
            callback: "CommsElement.sendMessage"
          }
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "request-cycle-tool",
          type: 'action-definition',
          displayName: "Request Cycle",
          definition: {
            name: "request_cycle",
            parameters: ["reason", "delay_ms"],
            callback: "AgentLoop.requestCycle"
          }
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "open-personal-log-tool",
          type: 'action-definition',
          displayName: "Open Personal Log",
          definition: {
            name: "open_personal_log",
            parameters: ["classification"],
            callback: "LogElement.openPersonalLog"
          }
        }
      }
    ]
  }
];
