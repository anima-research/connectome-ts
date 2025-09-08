# Saliency System Evolution

## From Explicit Expiry to Graph-Based Decay

### Original Design Issues

The original design included an `expires` timestamp:
```typescript
{
  expires: "2024-01-15T12:00:00Z",
  transient: true
}
```

**Problems:**
1. Automated systems struggle to predict when something becomes irrelevant
2. Binary cutoff doesn't match natural information decay
3. Requires "future knowledge" about relevance duration

### New Approach: Float-Based Transient + Graph Relationships

```typescript
{
  transient: 0.7,  // Decay rate
  linkedTo: ["request-001", "discussion-002"]
}
```

**Benefits:**
1. Natural exponential decay matches human memory patterns
2. Graph structure emerges from natural conversation flow
3. Temporal proximity automatically handled
4. No artificial timestamps needed

## Graph-Based Saliency

### The Insight
Conversations naturally form directed graphs through references and responses. Important information tends to be highly connected, while noise remains isolated.

### How It Works

1. **Link Creation**
   - User asks question → Answer links to question
   - Follow-up references previous points
   - Documentation gets referenced by implementations

2. **Temporal Proximity Boost**
   - Recent links provide stronger boost
   - Decays smoothly over time
   - No hard cutoffs

3. **Emergent Importance**
   - Central nodes (heavily referenced) gain importance
   - Isolated nodes (off-topic chatter) fade quickly
   - Conversation threads stay coherent

### Example: Bug Report Thread

```
bug-report (t=0)
    ↓ linkedFrom
initial-theory (t=5min) 
    ↓ linkedFrom
log-analysis (t=1hr)
    ↓ linkedFrom  
root-cause (t=2hr)
    ↓ linkedFrom
fix-proposal (t=2.5hr)
```

Each node boosts its linked neighbors based on:
- Number of connections
- Temporal proximity
- Transient values

Result: The entire thread maintains coherence while isolated chatter fades.

## Transient as Float

### Scale Examples

| Value | Use Case | Half-Life |
|-------|----------|-----------|
| 0.0 | Permanent records | ∞ |
| 0.1 | Important discussions | ~7 hours |
| 0.3 | Regular conversation | ~2.3 hours |
| 0.5 | Status updates | ~1.4 hours |
| 0.7 | Notifications | ~1 hour |
| 0.9 | Side chatter | ~46 min |
| 1.5 | Very ephemeral | ~28 min |
| 2.0 | Ultra-transient | ~21 min |

### Calculation
```
decay_factor = e^(-age_hours * transient * 0.5)
```

This gives smooth, predictable decay without magic numbers.

## Advantages Over Previous Approaches

### 1. No Future Knowledge Required
- Old: "This expires at 12:00" (how do you know?)
- New: "This decays quickly" (observable property)

### 2. Natural Information Clustering
- Important threads stay together through links
- Noise naturally separates and fades

### 3. Flexible Decay Rates
- Fine-grained control per facet type
- Can be learned/adjusted over time

### 4. Graph Properties Enable:
- PageRank-style importance calculation
- Community detection for topic clustering
- Link prediction for missing connections

## Future Possibilities

1. **Learning Optimal Transient Values**
   - Track which facets agent references
   - Adjust transient values based on actual usage

2. **Automatic Link Inference**
   - Detect implicit references through NLP
   - Build richer graph without manual linking

3. **Multi-Level Graphs**
   - Topic-level connections
   - Temporal sequence graphs
   - Causal relationship graphs

The graph-based approach with float transient values provides a more natural, flexible, and powerful system for context management.
