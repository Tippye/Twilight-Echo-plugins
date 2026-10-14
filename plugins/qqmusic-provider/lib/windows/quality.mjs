// Common GetSongLevel@1003115a (ev_504c10f5db3c477e649a6b7648aa8da31eb801c637d48dae33ac1276c133ef4a)
// maps UI quality3 -> filename6, quality6 -> filename10, quality7 -> filename12.
// Main's actual labels distinguish 5.1, Hi-Res and Dolby Atmos; no numeric domains are conflated.
const definitions = Object.freeze({
  '128': Object.freeze({ type: 1, encrypted: false, codec: 'mp3', contentType: 'audio/mpeg' }),
  '320': Object.freeze({ type: 3, encrypted: false, codec: 'mp3', contentType: 'audio/mpeg' }),
  flac: Object.freeze({ type: 4, encrypted: true, codec: 'flac', contentType: 'audio/flac' }),
  surround: Object.freeze({ type: 6, encrypted: true, codec: 'flac', contentType: 'audio/flac' }),
  hires: Object.freeze({ type: 10, encrypted: true, codec: 'flac', contentType: 'audio/flac' }),
  dolby: Object.freeze({ type: 12, encrypted: true, codec: 'mp4', contentType: 'audio/mp4' })
})
const aliases = Object.freeze({ default: '128', high: '320', lossless: 'flac' })
export const WINDOWS_QUALITY_OPTIONS = Object.freeze([
  ['标准 MP3（128 kbps）', '128'], ['高品质 MP3（320 kbps）', '320'], ['无损 FLAC', 'flac'],
  ['Hi-Res 无损', 'hires'], ['杜比全景声', 'dolby'], ['5.1 品质', 'surround']
].map(([label, value]) => Object.freeze({ label, value })))
export function windowsQualityDefinition(value) {
  if (typeof value !== 'string') return null
  const key = Object.hasOwn(aliases, value) ? aliases[value] : value
  return Object.hasOwn(definitions, key) ? definitions[key] : null
}
