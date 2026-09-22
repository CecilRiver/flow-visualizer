/** Maximum number of YAML reads in flight at once (DESIGN.md 6.5). */
export const FILE_READ_CONCURRENCY = 4

/**
 * Maps over `items` with a bounded number of concurrent workers, preserving
 * input order in the result. Used so a folder never spawns hundreds of
 * simultaneous file reads.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  if (items.length === 0) return results

  const workerCount = Math.max(1, Math.min(limit, items.length))
  let nextIndex = 0

  const run = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await worker(items[index] as T, index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, run))
  return results
}
