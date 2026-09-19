// Pure, Angular-free helpers deciding how many items of a large array or
// object to render before asking the user to reveal more. "Large" is
// judged by estimated byte weight, not raw item count — a list of huge
// nested objects should paginate at a lower item count than a list of
// short strings.

const SAMPLE_SIZE = 20;
const INITIAL_BUDGET_BYTES = 50_000;
const MIN_INITIAL_COUNT = 20;

// Flat batch sizes for the "reveal more" buttons: small / bigger / much
// bigger. "Show all" is handled separately (not a fixed size).
export const REVEAL_BATCHES = [20, 100, 1000] as const;

// Memoized per container identity (the array itself, or the owning object
// for object entries) — safe because every edit in json-edit.util.ts
// returns a new array/object reference, so identity-keyed caching
// self-invalidates on any edit without needing explicit cache eviction.
const avgBytesCache = new WeakMap<object, number>();

// Average serialized size of a sample of `items` (its first `SAMPLE_SIZE`),
// memoized against `cacheKey` — pass the array itself for a plain array
// (cacheKey === items), or the owning object for object entries (cacheKey
// is the stable object identity; items, e.g. Object.values(cacheKey), can
// be a freshly-computed array each call since only cacheKey's identity is
// what makes the cache hit or miss).
export function estimateAvgItemBytes(cacheKey: object, items: readonly unknown[]): number {
  if (items.length === 0) return 0;
  const cached = avgBytesCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const sampleCount = Math.min(SAMPLE_SIZE, items.length);
  let total = 0;
  for (let i = 0; i < sampleCount; i++) {
    total += JSON.stringify(items[i])?.length ?? 4;
  }
  const avg = total / sampleCount;
  avgBytesCache.set(cacheKey, avg);
  return avg;
}

// How many items to show up front, given the (post-filter) length and the
// estimated average item size: fit as many as the byte budget allows,
// never fewer than MIN_INITIAL_COUNT, never more than `length` itself.
export function initialRevealCount(length: number, avgBytes: number): number {
  if (length === 0) return 0;
  if (avgBytes <= 0) return length;
  return Math.min(length, Math.max(MIN_INITIAL_COUNT, Math.floor(INITIAL_BUDGET_BYTES / avgBytes)));
}
