/**
 * Example showing how saliency hints affect scoring in practice
 */

// Scenario: Various facets with different saliency hints
// Current time: 2024-01-15T10:30:00Z
// Current focus: "discord:general"

const facetsWithScoring = [
  {
    facet: {
      id: "pinned-announcement",
      content: "Team meeting at 2 PM",
      saliency: {
        pinned: true,
        streams: ["discord:general"]
      }
    },
    score: 10.0,  // Pinned = maximum score
    reason: "Pinned content always included"
  },

  {
    facet: {
      id: "recent-question",
      content: "Can someone review my PR?",
      saliency: {
        streams: ["discord:general"]
      }
    },
    score: 2.0,  // Base score * focus boost
    reason: "In focused stream, recent event"
  },

  {
    facet: {
      id: "answer-to-question",
      content: "I'll review it now",
      saliency: {
        responseToFacet: "recent-question",
        streams: ["discord:general"]
      }
    },
    score: 2.4,  // 2.0 * 1.2 (response boost)
    reason: "Response to another facet + in focus"
  },

  {
    facet: {
      id: "system-alert",
      content: "Memory usage: 85%",
      saliency: {
        crossStream: true,
        transient: true
      }
    },
    score: 0.72,  // 0.8 (crossStream) * 0.9 (slight decay)
    reason: "Cross-stream but transient, slightly aged"
  },

  {
    facet: {
      id: "expired-notification",
      content: "Build completed",
      saliency: {
        expires: "2024-01-15T10:25:00Z",  // 5 minutes ago
        streams: ["discord:dev"]
      }
    },
    score: 0.0,  // Expired
    reason: "Past expiration time"
  },

  {
    facet: {
      id: "out-of-focus-message",
      content: "Database backup complete",
      saliency: {
        streams: ["discord:dev"]
      }
    },
    score: 0.3,  // Base score * out-of-focus penalty
    reason: "Not in focused stream"
  },

  {
    facet: {
      id: "transient-upload",
      content: "File uploaded: report.pdf",
      saliency: {
        transient: true,
        streams: ["discord:general"]
      }
    },
    score: 1.0,  // 2.0 * 0.5 (transient decay)
    reason: "Transient content in focus, 50% decayed"
  },

  {
    facet: {
      id: "reference-doc",
      content: "API Documentation: login endpoint accepts POST...",
      saliency: {
        reference: true,
        referencedByFacets: ["impl-001", "impl-002", "review-001"],
        streams: ["discord:dev"]
      }
    },
    score: 0.81,  // 0.3 * 1.5 * (1 + 0.2*3)
    reason: "Reference material, multiply referenced, out of focus"
  }
];

// Example of how HUD selects content with 500 token limit:
const selectedForContext = [
  "pinned-announcement",     // Score: 10.0   Tokens: 20
  "answer-to-question",      // Score: 2.4    Tokens: 15  
  "recent-question",         // Score: 2.0    Tokens: 25
  "transient-upload",        // Score: 1.0    Tokens: 30
  "reference-doc",           // Score: 0.81   Tokens: 150
  "system-alert",            // Score: 0.72   Tokens: 40
  // Total: 280 tokens
  // Stopped here - next item would exceed limit
];

const dropped = [
  "out-of-focus-message",    // Score: 0.3
  "expired-notification",    // Score: 0.0
];

/**
 * Key Insights:
 * 
 * 1. Pinned content dominates (score 10.0)
 * 2. Focus provides 2x boost for in-stream content
 * 3. Transient decays quickly (50% in this example)
 * 4. Expired content is completely excluded
 * 5. References accumulate importance through links
 * 6. Cross-stream maintains visibility even when not focused
 * 
 * The HUD fills context by score until token limit is reached.
 */
