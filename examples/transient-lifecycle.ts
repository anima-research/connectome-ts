/**
 * Example showing the lifecycle difference between transient and non-transient content
 */

// Timeline showing how different content ages over 30 minutes
// Current focus: "discord:general" throughout

const timeline = [
  {
    time: "T+0 min",
    facets: [
      {
        id: "user-message",
        content: "Has anyone seen the bug in the login system?",
        saliency: { streams: ["discord:general"] },
        saliencyScore: 2.0,
        inContext: true
      },
      {
        id: "file-share",
        content: "Uploaded debug-logs.txt (5.2 MB)",
        saliency: { streams: ["discord:general"], transient: true },
        saliencyScore: 2.0,
        inContext: true
      },
      {
        id: "system-status",
        content: "CPU: 45%, Memory: 2.1GB free",
        saliency: { crossStream: true, transient: true, expires: "T+10min" },
        saliencyScore: 0.8,
        inContext: true
      }
    ]
  },

  {
    time: "T+5 min",
    facets: [
      {
        id: "user-message",
        saliencyScore: 1.8,  // Slight natural decay
        inContext: true
      },
      {
        id: "file-share",
        saliencyScore: 1.0,  // 50% decay for transient
        inContext: true
      },
      {
        id: "system-status",
        saliencyScore: 0.4,  // Transient + nearing expiry
        inContext: true
      }
    ]
  },

  {
    time: "T+10 min",
    facets: [
      {
        id: "user-message",
        saliencyScore: 1.5,  // Still relevant
        inContext: true
      },
      {
        id: "file-share",
        saliencyScore: 0.5,  // 75% decay
        inContext: true  // Barely
      },
      {
        id: "system-status",
        saliencyScore: 0.0,  // Expired!
        inContext: false
      }
    ]
  },

  {
    time: "T+20 min",
    facets: [
      {
        id: "user-message",
        saliencyScore: 1.2,  // Conversation still matters
        inContext: true
      },
      {
        id: "file-share",
        saliencyScore: 0.1,  // Almost gone
        inContext: false  // Dropped from context
      }
    ]
  },

  {
    time: "T+30 min",
    contextSummary: "Only the user's question about the login bug remains in context. The file upload and system status have aged out."
  }
];

/**
 * Transient vs Expires:
 * 
 * TRANSIENT:
 * - Smooth decay over time
 * - No specific cutoff
 * - Good for: notifications, status updates, file uploads
 * - Decay rate controlled by HUD configuration
 * 
 * EXPIRES:
 * - Binary: full score until expiry, then zero
 * - Specific cutoff time
 * - Good for: time-sensitive info, temporary codes, alerts
 * - Absolute guarantee of removal after expiry
 * 
 * COMBINATION (transient + expires):
 * - Decays smoothly until expiry
 * - Then hard cutoff at expiry time
 * - Good for: important temporary info that should fade but definitely be gone by deadline
 */

// Real-world examples:

const transientExamples = {
  "join-notification": {
    content: "Alice joined the channel",
    saliency: { transient: true },
    rationale: "Nice to know briefly, but not important to preserve"
  },
  
  "progress-update": {
    content: "Processing... 67% complete",
    saliency: { transient: true },
    rationale: "Will be superseded by completion or next update"
  },
  
  "typing-indicator": {
    content: "Bob is typing...",
    saliency: { transient: true, expires: "T+30s" },
    rationale: "Extremely ephemeral, combine both hints"
  }
};

const expiringExamples = {
  "meeting-reminder": {
    content: "Team standup in 15 minutes",
    saliency: { expires: "T+15min", pinned: true },
    rationale: "Critical until the meeting starts, then irrelevant"
  },
  
  "auth-token": {
    content: "Temporary access token: ABC123",
    saliency: { expires: "T+1hour", reference: true },
    rationale: "Must be removed after expiry for security"
  },
  
  "limited-offer": {
    content: "Deploy window open until 5 PM",
    saliency: { expires: "17:00:00", crossStream: true },
    rationale: "Time-bounded opportunity"
  }
};

const persistentExamples = {
  "bug-report": {
    content: "Login fails with 'undefined user' error",
    saliency: { reference: true },
    rationale: "Important issue to track and discuss"
  },
  
  "decision": {
    content: "Team agreed: Ship feature flag disabled by default",
    saliency: { pinned: true, crossStream: true },
    rationale: "Important decision that affects everyone"
  },
  
  "conversation": {
    content: "What's our rollback plan if this fails?",
    saliency: { streams: ["discord:dev"] },
    rationale: "Normal conversation, preserved for context"
  }
};
