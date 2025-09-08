# Saliency Hints Usage Guide

## Contextual Hints

### responseToFacet
Used when a facet is created as a direct response to another facet. This creates a semantic link that helps the HUD understand relationships.

```typescript
// User asks a question
{
  type: "addFacet",
  facet: {
    id: "user-question-001",
    type: "event",
    content: "What's our current fuel level?"
  }
}

// Agent's analysis is marked as responding to that question
{
  type: "addFacet",
  facet: {
    id: "fuel-analysis-001",
    type: "state",
    content: "Fuel reserves at 73%. Sufficient for 8.2 parsecs.",
    saliency: {
      responseToFacet: "user-question-001",  // Links back to the question
      streams: ["starship:bridge"]
    }
  }
}
```

**Effect**: The HUD knows these are related. If the question is in context, the response gets boosted priority.

### referencedByFacets
An array that gets updated when other facets reference this one. This is typically managed by the system, not set manually.

```typescript
// A reference document
{
  id: "mission-parameters",
  type: "state",
  content: "Max warp: 9.5, Crew complement: 430",
  saliency: {
    reference: true,
    referencedByFacets: []  // Will be populated as others reference it
  }
}

// Later, agent references it
{
  id: "speed-decision",
  type: "event",
  content: "Setting course at warp 8, well within mission parameters",
  saliency: {
    responseToFacet: "mission-parameters"  // This would add to referencedByFacets
  }
}

// Now mission-parameters would have:
// referencedByFacets: ["speed-decision"]
```

**Effect**: Frequently referenced facets gain importance and are less likely to be dropped from context.

## Temporal Hints

### expires
An ISO timestamp when the facet becomes irrelevant. After this time, the HUD can safely drop it.

```typescript
// Temporary alert
{
  type: "addFacet",
  facet: {
    id: "proximity-alert",
    type: "event",
    content: "Ship approaching, ETA 5 minutes",
    saliency: {
      expires: "2024-01-15T10:35:00Z",  // 5 minutes from now
      streams: ["starship:bridge"]
    }
  }
}

// Temporary access code
{
  type: "addFacet", 
  facet: {
    id: "temp-access-code",
    type: "state",
    content: "Temporary docking code: ALPHA-7-SEVEN",
    saliency: {
      expires: "2024-01-15T11:00:00Z",  // Valid for 30 minutes
      pinned: true  // Important until it expires
    }
  }
}
```

**Effect**: After expiry, these facets get zero saliency score and are dropped from context.

### transient
Boolean flag indicating this information is temporary/ephemeral. Unlike `expires`, there's no specific cutoff time.

```typescript
// File upload notification
{
  type: "addFacet",
  facet: {
    id: "file-upload-001",
    type: "event",
    content: "sensor-data.csv uploaded (2.3MB)",
    saliency: {
      transient: true,  // Not important to preserve long-term
      streams: ["discord:general"]
    }
  }
}

// Status update that will change soon
{
  type: "addFacet",
  facet: {
    id: "download-progress",
    type: "state",
    content: "Downloading stellar maps... 45%",
    saliency: {
      transient: true,  // Will be irrelevant once complete
      streams: ["starship:bridge"]
    }
  }
}
```

**Effect**: Transient facets decay quickly (controlled by HUD's `transientDecayRate`). They age out faster than normal events.

## Common Patterns

### Important Question → Preserved Answer
```typescript
// Question
{ id: "q1", content: "How do we disable the shield generator?" }

// Answer gets linked and marked as reference
{
  id: "a1",
  content: "Shield generator disable sequence: ...",
  saliency: {
    responseToFacet: "q1",
    reference: true,  // This is reference material
    streams: ["starship:engineering"]
  }
}
```

### Temporary Notification → Quick Decay
```typescript
{
  content: "User joined the channel",
  saliency: {
    transient: true,
    expires: "2024-01-15T10:05:00Z"  // Can combine both
  }
}
```

### Cross-Stream Alert → Brief Universal Visibility
```typescript
{
  content: "Red Alert! All hands to battle stations!",
  saliency: {
    crossStream: true,  // Visible in all streams
    expires: "2024-01-15T10:10:00Z"  // But only for 10 minutes
  }
}
```

## Guidelines

1. **Don't over-specify** - Let facet type and content guide defaults
2. **Transient vs Expires** - Use `transient` for "generally temporary", `expires` for specific deadlines
3. **Response chains** - Use `responseToFacet` to maintain conversation threads
4. **Let the system manage** `referencedByFacets` - it's typically updated automatically
5. **Combine hints** - `transient + expires` for belt-and-suspenders temporary content
