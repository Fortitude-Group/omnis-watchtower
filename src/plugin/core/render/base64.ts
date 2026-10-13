// Standard padded base64. The mod runtime has Uint8Array.prototype.toBase64 but Node 24 does not,
// and core must run identically in both (research R11). Hot path: every Raster frame goes through
// here, so it writes char codes into a reused buffer and builds the string in large chunks.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CODES = Uint8Array.from(ALPHABET, (c) => c.charCodeAt(0))
const EQ = 61
const CHUNK = 8192

let scratch = new Uint8Array(0)

// A native ASCII decoder where the runtime has one (Node, browsers); plain JS otherwise.
type Decoder = { decode(b: Uint8Array): string }
const DecoderCtor = (globalThis as unknown as { TextDecoder?: new (label: string) => Decoder }).TextDecoder
const ascii: Decoder | null = DecoderCtor ? new DecoderCtor('latin1') : null

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
