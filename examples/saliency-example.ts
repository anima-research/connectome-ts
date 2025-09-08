/**
 * Example showing how saliency hints work in practice
 */

import { IncomingVEILFrame, OutgoingVEILFrame } from '../src/veil/types';

// Scenario: Agent is in a Discord channel, someone shares a file, 
// has a conversation, then agent switches to another channel

export const saliencyExample: (IncomingVEILFrame | OutgoingVEILFrame)[] = [
  // Frame 1: Initial setup with stream info
  {
    sequence: 1,
    timestamp: "2024-01-15T10:00:00Z",
    focus: "discord:general",
    operations: [
      {
        type: "addStream",
        stream: {
          id: "discord:general",
          name: "General Chat"
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "channel-info",
          type: "state",
          content: "Channel: #general\n30 users online",
          saliency: {
            streams: ["discord:general"],
            reference: true  // Channel info is reference material
          }
        }
      }
    ]
  } as IncomingVEILFrame,

  // Frame 2: User shares a file
  {
    sequence: 2, 
    timestamp: "2024-01-15T10:01:00Z",
    focus: "discord:general",
    operations: [
      {
        type: "addFacet",
        facet: {
          id: "file-share-001",
          type: "event",
          content: "Alex shared ProjectDocs.pdf (2.3 MB)",
          attributes: { sender: "Alex" },
          saliency: {
            streams: ["discord:general"],
            transient: 0.7  // File share decays moderately fast
          }
        }
      }
    ]
  } as IncomingVEILFrame,

  // Frame 3: Conversation about the file
  {
    sequence: 3,
    timestamp: "2024-01-15T10:02:00Z", 
    focus: "discord:general",
    operations: [
      {
        type: "addFacet",
        facet: {
          id: "msg-001",
          type: "event",
          content: "Can you summarize the key points from this document?",
          attributes: { sender: "Alex" },
          saliency: {
            streams: ["discord:general"]
            // No transient flag - conversations are preserved
          }
        }
      },
      {
        type: "agentActivation"
      }
    ]
  } as IncomingVEILFrame,

  // Frame 4: Agent responds
  {
    sequence: 4,
    timestamp: "2024-01-15T10:02:30Z",
    operations: [
      {
        type: "speak",
        content: "I'll analyze the document for you. Let me download and review it."
      },
      {
        type: "toolCall",
        toolName: "download_file",
        parameters: { url: "ProjectDocs.pdf" }
      }
    ]
  } as OutgoingVEILFrame,

  // Frame 5: Agent creates analysis (important content)
  {
    sequence: 5,
    timestamp: "2024-01-15T10:03:00Z",
    operations: [
      {
        type: "speak",
        content: "Here are the key points from ProjectDocs.pdf:\n\n1. New architecture proposal for microservices\n2. Migration timeline: Q2 2024\n3. Resource requirements: 5 engineers, 3 months"
      }
    ]
  } as OutgoingVEILFrame,

  // Frame 6: Analysis is referenced and pinned
  {
    sequence: 6,
    timestamp: "2024-01-15T10:03:30Z",
    focus: "discord:general",
    operations: [
      {
        type: "addFacet",
        facet: {
          id: "analysis-summary",
          type: "state",
          content: "Project Architecture Summary:\n- Microservices migration\n- Q2 2024 timeline\n- 5 engineers needed",
          saliency: {
            streams: ["discord:general"],
            pinned: true,  // User pinned this
            linkedTo: ["msg-001"],  // Links to the original question
            reference: true
          }
        }
      }
    ]
  } as IncomingVEILFrame,

  // Frame 7: System-wide notification (cross-stream)
  {
    sequence: 7,
    timestamp: "2024-01-15T10:05:00Z",
    operations: [
      {
        type: "addFacet",
        facet: {
          id: "system-alert",
          type: "ambient",
          content: "Memory usage: 85% - Consider clearing old data",
          scope: ["system"],
          saliency: {
            crossStream: true,  // Relevant everywhere
            transient: 0.8  // System alerts decay fairly quickly
          }
        }
      }
    ]
  } as IncomingVEILFrame,

  // Frame 8: Switch to dev channel
  {
    sequence: 8,
    timestamp: "2024-01-15T10:10:00Z",
    focus: "discord:dev",
    operations: [
      {
        type: "addStream",
        stream: {
          id: "discord:dev", 
          name: "Development"
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "channel-switch",
          type: "event",
          content: "Switched to #dev channel",
          saliency: {
            streams: ["discord:dev"],
            transient: 0.9  // Channel switch notification is very transient
          }
        }
      }
    ]
  } as IncomingVEILFrame,

  // Frame 9: Activity in new channel
  {
    sequence: 9,
    timestamp: "2024-01-15T10:11:00Z",
    focus: "discord:dev",
    operations: [
      {
        type: "addFacet",
        facet: {
          id: "dev-msg-001",
          type: "event",
          content: "Build #1234 failed - undefined variable in config.ts:45",
          attributes: { sender: "BuildBot" },
          saliency: {
            streams: ["discord:dev"],
            reference: true  // Build errors are reference material
          }
        }
      }
    ]
  } as IncomingVEILFrame,

  // Frame 10: Return to general (1 hour later)
  {
    sequence: 10,
    timestamp: "2024-01-15T11:10:00Z",
    focus: "discord:general",
    operations: [
      {
        type: "addFacet",
        facet: {
          id: "return-general",
          type: "event", 
          content: "Returned to #general",
          saliency: {
            streams: ["discord:general"],
            transient: 0.9  // Return notification is very transient
          }
        }
      }
    ]
  } as IncomingVEILFrame
];

/**
 * Expected behavior when rendering at different times:
 * 
 * At 10:05 (in discord:general):
 * - High: Channel info, conversation, agent responses, pinned analysis
 * - Medium: File share (still fairly fresh despite 0.7 transient)
 * - Low: System alert (cross-stream but 0.8 transient)
 * 
 * At 10:11 (in discord:dev):
 * - High: Dev channel content, build error
 * - Medium: Pinned analysis (pinned + linked)
 * - Low: General channel conversation (out of focus), system alert (decaying)
 * - Very Low: File share (0.7 transient + out of focus)
 * 
 * At 11:10 (back in discord:general):
 * - High: Pinned analysis (pinned)
 * - Medium: Original conversation (low transient, linked)
 * - Low: Dev channel content (out of focus)
 * - Dropped: File share (decayed), system alert (decayed), channel switches (0.9 transient)
 */
