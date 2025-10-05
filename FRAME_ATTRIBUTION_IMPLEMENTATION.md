# Frame Attribution Implementation - Complete

## What Was Fixed

The compression system couldn't reliably extract specific frame ranges (e.g., "frames 100-150") from rendered context because frame attribution was lost during message assembly.

## Changes Made

### 1. Types Updated (`src/hud/types-v2.ts`)
- Added `sourceFrames?: { from: number; to: number }` to messages
- Added `frameToMessageIndex?: Map<number, number>` to metadata
- Enables tracking which frames contributed to each message

### 2. HUD Updated (`src/hud/frame-tracking-hud.ts`)
- Modified `buildFrameBasedMessages()` to track frame attribution
- Each message now includes its source frame range
- Returns `frameToMessageIndex` for quick lookups

### 3. New Extraction Utilities (`src/hud/frame-extraction.ts`)
- `extractFrameRange()`: Extract specific frame range from rendered context
- `hasFramesInRange()`: Check if frames exist in range
- `getRenderedFrameSequences()`: Get all frame sequences
- `findFrameGaps()`: Detect missing frames

### 4. Exports Updated (`src/index.ts`)
- Exported all frame extraction utilities
- Available for use by CompressionTransform and other components

### 5. CompressionTransform Ready (`src/transforms/compression-transform.ts`)
- Added import for `extractFrameRange`
- Can now properly extract frame ranges for compression

## How It Works

**Before:**
```typescript
// Messages lost frame attribution
{
  role: 'user',
  content: '...' // Which frames made this?
}
```

**After:**
```typescript
// Messages track source frames
{
  role: 'user',
  content: '...',
  sourceFrames: { from: 105, to: 105 }
}

// Extract specific range
const extracted = extractFrameRange(context, 100, 150);
// Returns only messages from frames 100-150
```

## Usage Example

```typescript
// In CompressionTransform
process(state: ReadonlyVEILState): VEILDelta[] {
  // Render current history
  const { context } = this.hud.renderWithFrameTracking(
    state.frameHistory,
    new Map(state.facets)
  );
  
  // Extract specific frame range for compression
  const extracted = extractFrameRange(context, 100, 150);
  
  // Compress only that range
  await this.engine.compressRange({
    fromFrame: 100,
    toFrame: 150,
    content: extracted.content,
    totalTokens: extracted.tokens
  });
  
  // ...
}
```

## Benefits

1. ✅ **Correct Frame Range Extraction**: Can reliably target specific frames
2. ✅ **No Priority Dependency**: Doesn't require transforms to run in specific order
3. ✅ **Backwards Compatible**: Optional fields, existing code still works
4. ✅ **Foundation for Snapshots**: Ready for Phase 2 (stored frame snapshots)
5. ✅ **No Performance Impact**: Minimal overhead, just tracking metadata

## Next Steps (Phase 2 - Not Yet Implemented)

1. Add `renderedSnapshot` to Frame type
2. Capture snapshots during frame finalization
3. Use snapshots for compression (preserves original subjective experience)
4. Implement tentative freezing for invalidation detection

## Testing

To verify this works:

```typescript
// Create test context with frame attribution
const context = hud.render(frames, facets);

// Verify attribution exists
console.log(context.messages[0].sourceFrames); // { from: 1, to: 1 }
console.log(context.metadata.frameToMessageIndex); // Map(1 => 0, 2 => 1, ...)

// Test extraction
const extracted = extractFrameRange(context, 5, 10);
console.log(extracted.messages.length); // Only messages from frames 5-10
console.log(extracted.sourceFrames); // { from: 5, to: 10 }
```

## Related Issues

- Resolves the poly-temporality problem (partially - snapshots complete it)
- Removes dependency on Transform priority for compression
- Enables proper frame-based compression as specified in requirements
