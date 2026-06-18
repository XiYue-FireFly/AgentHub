export function decodeProcessChunk(chunk: Buffer | Uint8Array | string): string {
  if (typeof chunk === "string") return chunk
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  if (buffer.length === 0) return ""
  const utf8 = buffer.toString("utf8")
  if (!looksMisdecoded(utf8)) return utf8
  try {
    const gb18030 = new TextDecoder("gb18030", { fatal: false }).decode(buffer)
    if (!looksMisdecoded(gb18030)) return gb18030
  } catch {
    // Runtime may not expose gb18030 in every environment.
  }
  try {
    const gbk = new TextDecoder("gbk", { fatal: false }).decode(buffer)
    if (!looksMisdecoded(gbk)) return gbk
  } catch {
    // Keep the UTF-8 fallback.
  }
  return utf8
}

export function appendDecodedProcessChunk(current: string, chunk: Buffer | Uint8Array | string, maxChars: number): string {
  const next = current + decodeProcessChunk(chunk)
  if (next.length <= maxChars) return next
  return next.slice(0, maxChars) + "\n[AgentHub: output truncated]"
}

function looksMisdecoded(text: string): boolean {
  if (!text) return false
  if (text.includes("\uFFFD")) return true
  return /[锟斤拷]{2,}|[鈥�]{2,}|[ÃÂ]{2,}/.test(text)
}
