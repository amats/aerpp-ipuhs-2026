// Only for read-only work. An expired wait does not cancel an SDK operation.
// Callers retaining a resource slot must track the original promise separately.
export async function awaitRead<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => {})
    signal.throwIfAborted()
  }
  let onAbort = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    return await Promise.race([pending, aborted])
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}
