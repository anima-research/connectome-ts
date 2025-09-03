/**
 * Example showing how stream operations make the agent aware of available communication contexts
 */

import { IncomingVEILFrame } from '../src/veil/types';

export const streamAwarenessExample: IncomingVEILFrame[] = [
  // Frame 1: Agent starts with Discord general channel
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
          id: "available-streams",
          type: "state",
          displayName: "Available Streams",
          content: "Current streams: discord:general",
          saliency: {
            crossStream: true,  // Agent should always know available streams
            reference: true
          }
        }
      }
    ]
  },

  // Frame 2: User opens a DM channel
  {
    sequence: 2,
    timestamp: "2024-01-15T10:05:00Z",
    operations: [
      {
        type: "addStream",
        stream: {
          id: "discord:dm:alice",
          name: "DM with Alice"
        }
      },
      {
        type: "changeState",
        facetId: "available-streams",
        updates: {
          content: "Current streams: discord:general, discord:dm:alice"
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "stream-added-event",
          type: "event",
          content: "New DM channel opened with Alice",
          saliency: {
            crossStream: true,
            transient: true
          }
        }
      }
    ]
  },

  // Frame 3: Terminal session starts
  {
    sequence: 3,
    timestamp: "2024-01-15T10:10:00Z",
    operations: [
      {
        type: "addStream",
        stream: {
          id: "shell:term1",
          name: "Terminal 1",
          metadata: {
            cwd: "/home/user/project",
            shell: "bash"
          }
        }
      },
      {
        type: "changeState",
        facetId: "available-streams",
        updates: {
          content: "Current streams: discord:general, discord:dm:alice, shell:term1"
        }
      }
    ]
  },

  // Frame 4: Agent can now make routing decisions
  {
    sequence: 4,
    timestamp: "2024-01-15T10:15:00Z",
    focus: "discord:general",
    operations: [
      {
        type: "addFacet",
        facet: {
          id: "msg-routing-question",
          type: "event",
          content: "Can you run 'npm test' for me?",
          attributes: { sender: "Bob" }
        }
      },
      {
        type: "agentActivation"
      }
    ]
  },
  // Expected: Agent knows shell:term1 exists and can route the command there

  // Frame 5: Channel renamed
  {
    sequence: 5,
    timestamp: "2024-01-15T10:20:00Z",
    operations: [
      {
        type: "updateStream",
        streamId: "discord:general",
        updates: {
          name: "General Discussion (30 users)"
        }
      }
    ]
  },

  // Frame 6: DM closed
  {
    sequence: 6,
    timestamp: "2024-01-15T10:30:00Z",
    operations: [
      {
        type: "deleteStream",
        streamId: "discord:dm:alice"
      },
      {
        type: "changeState",
        facetId: "available-streams",
        updates: {
          content: "Current streams: discord:general, shell:term1"
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "stream-closed-event",
          type: "event",
          content: "DM with Alice closed",
          saliency: {
            crossStream: true,
            transient: true,
            expires: "2024-01-15T10:35:00Z"
          }
        }
      }
    ]
  }
];

/**
 * Why explicit stream operations matter:
 * 
 * 1. **Visibility**: Agent knows all available communication contexts
 * 2. **Routing**: Can make intelligent decisions about where to send responses
 * 3. **Context**: Understands the nature of each stream (from ID patterns and metadata)
 * 4. **Lifecycle**: Aware when streams appear/disappear
 * 
 * Without explicit operations, the agent would only know about streams 
 * when they're focused, missing the bigger picture of available contexts.
 */
