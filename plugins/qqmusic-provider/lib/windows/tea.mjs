const DELTA = 0x9e3779b9

function bytes(value, name) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be bytes`)
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
}

/** CommonFunction.dll uses 16 TEA cycles with big-endian block/key words. */
export function encryptTeaBlock(block, key) {
  block = bytes(block, 'block')
  key = bytes(key, 'key')
  if (block.length !== 8 || key.length !== 16) {
    throw new RangeError('TEA requires an 8-byte block and a 16-byte key')
  }
  let left = block.readUInt32BE(0)
  let right = block.readUInt32BE(4)
  const words = [0, 4, 8, 12].map((offset) => key.readUInt32BE(offset))
  let sum = 0
  for (let cycle = 0; cycle < 16; cycle += 1) {
    sum = (sum + DELTA) >>> 0
    left = (left + (((right >>> 5) + words[1]) ^ ((right << 4) + words[0]) ^ (sum + right))) >>> 0
    right = (right + (((left >>> 5) + words[3]) ^ ((left << 4) + words[2]) ^ (sum + left))) >>> 0
  }
  const output = Buffer.alloc(8)
  output.writeUInt32BE(left, 0)
  output.writeUInt32BE(right, 4)
  return output
}

/** QQ framing: random padding/salt, plaintext, seven zero bytes, dual feedback. */
export function encryptQqTea(plaintext, key, nextRandom) {
  plaintext = bytes(plaintext, 'plaintext')
  key = bytes(key, 'key')
  if (key.length !== 16) throw new RangeError('QQ TEA requires a 16-byte key')
  if (typeof nextRandom !== 'function') throw new TypeError('nextRandom must be a function')
  const padding = (8 - ((plaintext.length + 10) % 8)) % 8
  const framed = Buffer.alloc(plaintext.length + padding + 10)
  framed[0] = (nextRandom() & 0xf8) | padding
  for (let offset = 1; offset < padding + 3; offset += 1) {
    framed[offset] = nextRandom() & 0xff
  }
  framed.set(plaintext, padding + 3)
  const output = Buffer.alloc(framed.length)
  let previousCipher = Buffer.alloc(8)
  let previousMixed = Buffer.alloc(8)
  for (let offset = 0; offset < framed.length; offset += 8) {
    const mixed = Buffer.from(framed.subarray(offset, offset + 8))
    for (let index = 0; index < 8; index += 1) mixed[index] ^= previousCipher[index]
    const cipher = encryptTeaBlock(mixed, key)
    for (let index = 0; index < 8; index += 1) cipher[index] ^= previousMixed[index]
    output.set(cipher, offset)
    previousCipher = cipher
    previousMixed = mixed
  }
  return output
}
