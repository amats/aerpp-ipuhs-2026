// Serialized into synthetic browser contexts; never imported by the application.
export function installSessionTokenCapture() {
  const target = window as Window & { __aerppTestSessionToken?: string }
  const originalFetch = target.fetch
  target.fetch = async (...args) => {
    const response = await originalFetch.apply(target, args)
    const headerToken = response.headers.get("x-aerpp-session-token")
    if (headerToken !== null) target.__aerppTestSessionToken = headerToken
    const [input, options] = args
    const headers = new Headers(
      options?.headers ??
        (input instanceof Request ? input.headers : undefined),
    )
    if (headers.has("next-action") !== true) return response

    // Development Flight responses can remain open after the action result arrives.
    void (async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      try {
        reader = response.clone().body?.getReader()
        if (reader === undefined) return
        const decoder = new TextDecoder()
        let tail = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done === true) break
          const text = tail + decoder.decode(value, { stream: true })
          for (const match of text.matchAll(
            /"sessionToken":"([a-f0-9-]+:[a-f0-9]{64})"/g,
          ))
            target.__aerppTestSessionToken = match[1]
          tail = text.slice(-256)
        }
      } catch {
        // Navigation and reset may cancel a synthetic response mid-stream.
      } finally {
        reader?.releaseLock()
      }
    })()
    return response
  }
}
