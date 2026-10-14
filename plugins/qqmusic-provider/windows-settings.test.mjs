import assert from 'node:assert/strict'
import { test } from 'node:test'
import { serializeWindowsSettings, windowsPlaybackQuality, windowsQualityForm,
  saveWindowsQuality, WINDOWS_QUALITY_KEY, WINDOWS_QUALITY_COMMAND } from './lib/windows/settings.mjs'

test('quality and auth mutations share one read-modify-write owner without losing unrelated keys', async () => {
  let disk = { 'windows-device': { guid: 'public-device' } }
  const sdk = { get: async k => structuredClone(disk[k]), set: async (k, v) => {
    const copy = structuredClone(disk)
    await new Promise(r => setImmediate(r))
    copy[k] = structuredClone(v); disk = copy
  }, delete: async k => { const copy = structuredClone(disk); await new Promise(r => setImmediate(r)); delete copy[k]; disk = copy } }
  const a = serializeWindowsSettings(sdk), b = serializeWindowsSettings(sdk)
  assert.equal(a, b)
  await Promise.all([a.set('windows-auth', { publicSynthetic: true }),
    b.set(WINDOWS_QUALITY_KEY, 'flac'), a.set('test-marker', 1)])
  assert.deepEqual(disk, { 'windows-device': { guid: 'public-device' }, 'windows-auth': { publicSynthetic: true },
    [WINDOWS_QUALITY_KEY]: 'flac', 'test-marker': 1 })
  await Promise.all([a.delete('test-marker'), b.set(WINDOWS_QUALITY_KEY, '320')])
  assert.equal(disk['test-marker'], undefined)
  assert.deepEqual(disk['windows-auth'], { publicSynthetic: true })
  assert.equal(await windowsPlaybackQuality(a), '320')
})

test('a failed preference write rejects and does not poison subsequent auth storage', async () => {
  const disk = new Map()
  const sdk = { get: async k => disk.get(k), set: async (k, v) => {
    if (k === 'failing') throw new Error('synthetic storage failure')
    disk.set(k, v)
  }, delete: async k => { disk.delete(k) } }
  const s = serializeWindowsSettings(sdk)
  await assert.rejects(s.set('failing', 1), /synthetic/)
  await s.set('windows-auth', { publicSynthetic: true })
  assert.deepEqual(await s.get('windows-auth'), { publicSynthetic: true })
})

test('a legacy-secret migration during get cannot overwrite a concurrent quality save', async () => {
  let disk = { 'windows-auth': { publicSynthetic: true } }
  let releaseRead, startedRead
  const started = new Promise(r => { startedRead = r })
  const resume = new Promise(r => { releaseRead = r })
  const s = serializeWindowsSettings({ get: async key => {
    const copy = structuredClone(disk)
    startedRead()
    await resume
    disk = copy // Host migration writes its complete snapshot during this read.
    return copy[key]
  }, set: async (key, value) => { disk = { ...disk, [key]: value } }, delete: async key => { delete disk[key] } })
  const read = s.get('windows-auth')
  await started
  const save = s.set(WINDOWS_QUALITY_KEY, 'flac')
  await new Promise(r => setImmediate(r))
  assert.equal(disk[WINDOWS_QUALITY_KEY], undefined)
  releaseRead()
  await Promise.all([read, save])
  assert.equal(disk[WINDOWS_QUALITY_KEY], 'flac')
  assert.deepEqual(disk['windows-auth'], { publicSynthetic: true })
})

test('the settings form exposes only quality and valid saves do not return other storage values', async () => {
  const disk = new Map([['windows-auth', { publicSynthetic: true }]])
  const s = serializeWindowsSettings({ get: async k => disk.get(k), set: async (k, v) => { disk.set(k, v) },
    delete: async k => { disk.delete(k) } })
  const form = await windowsQualityForm(s)
  assert.equal(form.kind, 'settings-form')
  assert.equal(form.submitCommand, WINDOWS_QUALITY_COMMAND)
  assert.deepEqual(form.fields.map(f => f.key), ['quality'])
  assert.equal(form.fields[0].value, '128')
  const result = await saveWindowsQuality(s, { quality: 'flac', ignored: 'publicSynthetic' })
  assert.equal(result.form.fields[0].value, 'flac')
  assert.equal(JSON.stringify(result).includes('publicSynthetic'), false)
  assert.deepEqual(disk.get('windows-auth'), { publicSynthetic: true })
})

test('invalid quality values reject without overwriting an existing preference', async () => {
  const disk = new Map([[WINDOWS_QUALITY_KEY, '128']])
  const s = serializeWindowsSettings({ get: async k => disk.get(k), set: async (k, v) => { disk.set(k, v) },
    delete: async k => { disk.delete(k) } })
  for (const values of [null, [], {}, { quality: 'unverified-ai' }, { quality: 'flac\n' }, { quality: 320 }]) {
    await assert.rejects(saveWindowsQuality(s, values), /有效/)
  }
  assert.equal(await windowsPlaybackQuality(s), '128')
  disk.set(WINDOWS_QUALITY_KEY, 'unverified-quality')
  await assert.rejects(windowsPlaybackQuality(s), /无效/)
})
