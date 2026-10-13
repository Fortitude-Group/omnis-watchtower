// Standard padded base64. The mod runtime has Uint8Array.prototype.toBase64 but Node 24 does not,
// and core must run identically in both (research R11). Hot path: every Raster frame goes through
// here, so it writes char codes into a reused buffer and builds the string in large chunks.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CODES = Uint8Array.from(ALPHABET, (c) => c.charCodeAt(0))
const EQ = 61
const CHUNK = 8192

let scratch = new Uint8Array(0)

// A native decoder where the runtime has one; plain JS otherwise. The output is pure ASCII, so UTF-8
// (the only label the mod runtime accepts: 'latin1' throws there) decodes it exactly.
type Decoder = { decode(b: Uint8Array): string }
const DecoderCtor = (globalThis as unknown as { TextDecoder?: new () => Decoder }).TextDecoder
const makeDecoder = (): Decoder | null => {
  try {
    return DecoderCtor ? new DecoderCtor() : null
  } catch {
    return null
  }
}
const ascii = makeDecoder()

export const toBase64 = (bytes: Uint8Array): string => {
  const outLen = Math.ceil(bytes.length / 3) * 4
  if (scratch.length < outLen) scratch = new Uint8Array(outLen)
  const out = scratch
  let o = 0
  let i = 0
  const whole = bytes.length - (bytes.length % 3)
  for (; i < whole; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out[o++] = CODES[n >> 18]!
    out[o++] = CODES[(n >> 12) & 63]!
    out[o++] = CODES[(n >> 6) & 63]!
    out[o++] = CODES[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i]! << 16
    out[o++] = CODES[n >> 18]!
    out[o++] = CODES[(n >> 12) & 63]!
    out[o++] = EQ
    out[o++] = EQ
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out[o++] = CODES[n >> 18]!
    out[o++] = CODES[(n >> 12) & 63]!
    out[o++] = CODES[(n >> 6) & 63]!
    out[o++] = EQ
  }
  if (ascii) return ascii.decode(out.subarray(0, o))
  let s = ''
  for (let c = 0; c < o; c += CHUNK) {
    s += String.fromCharCode.apply(null, out.subarray(c, Math.min(o, c + CHUNK)) as unknown as number[])
  }
  return s
}
