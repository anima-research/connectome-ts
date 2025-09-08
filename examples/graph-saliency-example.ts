/**
 * Example showing graph-based saliency with temporal proximity
 */

import { Facet } from '../src/veil/types';

// Scenario: A bug report discussion with linked facets
const conversationGraph: Facet[] = [
  {
    id: "bug-report",
    type: "event",
    content: "Login fails with 'Cannot read property user of undefined'",
    saliency: {
      streams: ["discord:dev"],
      transient: 0.1  // Low decay - bug reports stay relevant
    }
  },

  {
    id: "initial-theory",
    type: "event",
    content: "Maybe the session expired?",
    saliency: {
      linkedTo: ["bug-report"],
      transient: 0.5  // Medium decay - speculation
    }
  },

  {
    id: "log-analysis",
    type: "state",
    content: "Stack trace shows error in auth.js:45 - user object is null",
    saliency: {
      linkedTo: ["bug-report"],
      reference: true,
      transient: 0.0  // Permanent - this is key evidence
    }
  },

  {
    id: "root-cause",
    type: "event",
    content: "Found it! Race condition when token refresh happens during login",
    saliency: {
      linkedTo: ["bug-report", "log-analysis"],
      linkedFrom: ["fix-proposal"],  // Will be updated when fix links back
      transient: 0.0  // Permanent - root cause analysis
    }
  },

  {
    id: "fix-proposal",
    type: "state",
    content: "PR #1234: Add mutex to prevent concurrent token refresh",
    saliency: {
      linkedTo: ["root-cause", "bug-report"],
      pinned: true,
      transient: 0.0
    }
  },

  {
    id: "side-chatter",
    type: "event",
    content: "Anyone want coffee? Making a run",
    saliency: {
      streams: ["discord:dev"],
      transient: 0.9  // Very transient - unrelated chatter
    }
  }
];

/**
 * How the graph affects saliency:
 * 
 * 1. CENTRAL NODES: "bug-report" has many incoming links, making it important
 * 2. EVIDENCE CHAIN: log-analysis → root-cause → fix-proposal form a chain
 * 3. TEMPORAL PROXIMITY: If these are close in time, they boost each other
 * 4. ISOLATED NODES: "side-chatter" has no links, decays quickly
 */

// Different transient values and their effects:
const transientExamples = {
  "permanent": {
    transient: 0.0,
    example: "Critical bug fix documentation",
    halfLife: "∞"
  },
  
  "low-decay": {
    transient: 0.1,
    example: "Important discussion points", 
    halfLife: "~7 hours"
  },
  
  "medium-decay": {
    transient: 0.5,
    example: "Status updates, theories",
    halfLife: "~1.4 hours"
  },
  
  "high-decay": {
    transient: 0.9,
    example: "Greetings, side conversations",
    halfLife: "~46 minutes"
  },
  
  "ultra-transient": {
    transient: 2.0,
    example: "Typing indicators, progress %",
    halfLife: "~21 minutes"
  }
};

/**
 * Graph proximity effects:
 * 
 * Time T+0: Bug reported
 * Time T+5min: Initial theory (links to bug) 
 *   → Both get boost from proximity
 * 
 * Time T+1hour: Log analysis (links to bug)
 *   → Still boosts bug report, but less than theory did
 * 
 * Time T+2hour: Root cause (links to bug + log)
 *   → Forms a cluster with high mutual reinforcement
 *   → Bug report gains even more importance as central node
 */

// Saliency calculation for "bug-report" over time:
const bugReportSaliency = [
  { time: "T+0", score: 2.0, reason: "Fresh, in focus" },
  { time: "T+5min", score: 2.8, reason: "Boosted by linked theory (temporal proximity)" },
  { time: "T+1hr", score: 3.2, reason: "Multiple links, slight decay offset by importance" },
  { time: "T+2hr", score: 3.5, reason: "Central node in discussion graph" },
  { time: "T+24hr", score: 2.8, reason: "Still important due to links, minimal decay (0.1)" }
];

// Compare with isolated chatter:
const chatterSaliency = [
  { time: "T+0", score: 2.0, reason: "Fresh, in focus" },
  { time: "T+5min", score: 1.1, reason: "Rapid decay (0.9), no links" },
  { time: "T+1hr", score: 0.2, reason: "Nearly gone" },
  { time: "T+2hr", score: 0.04, reason: "Effectively invisible" }
];

/**
 * Design benefits:
 * 
 * 1. AUTOMATED: System can infer importance from graph structure
 * 2. NATURAL: Conversations naturally form graphs through replies/references
 * 3. FLEXIBLE: transient as float allows fine-grained control
 * 4. NO MAGIC TIMESTAMPS: No need to predict when something "expires"
 * 5. EMERGENT BEHAVIOR: Important threads stay visible, noise fades away
 */
