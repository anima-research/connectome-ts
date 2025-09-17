import { createHash } from 'crypto';

/**
 * Generates a deterministic UUID-like identifier based on the provided input.
 * Using an internal SHA-1 hash avoids adding a dependency on a UUID library
 * while still producing stable, human-readable identifiers.
 */
export function deterministicUUID(input: string): string {
  const hash = createHash('sha1').update(input).digest('hex');
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    hash.substring(12, 16),
    hash.substring(16, 20),
    hash.substring(20, 32)
  ].join('-');
}
