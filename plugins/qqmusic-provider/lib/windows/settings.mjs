import { WINDOWS_QUALITY_OPTIONS } from './quality.mjs'
export const WINDOWS_QUALITY_KEY = 'windows-playback-quality'
export const WINDOWS_QUALITY_COMMAND = 'qqmusic.windows.quality'
const OPTIONS = WINDOWS_QUALITY_OPTIONS
const owners = new WeakMap()

// SDK settings writes read-modify-write one shared file. All Windows source
// callers share this queue so independent quality/device/auth writes retain keys.
export function serializeWindowsSettings(settings) {
  if (owners.has(settings)) return owners.get(settings)
  let writes = Promise.resolve()
  const mutate = fn => {
    const result = writes.then(fn)
    writes = result.catch(() => {})
    return result
  }
  // A host read may migrate legacy sensitive values and write the same file.
  const owner = { get: key => mutate(() => settings.get(key)),
    set: (key, value) => mutate(() => settings.set(key, value)),
    delete: key => mutate(() => settings.delete(key)) }
  owners.set(settings, owner)
  return owner
}

export async function windowsPlaybackQuality(settings) {
  const stored = await settings.get(WINDOWS_QUALITY_KEY)
  if (stored === undefined || stored === null) return '128'
  if (!OPTIONS.some(option => option.value === stored)) throw new Error('QQ 音乐音质设置无效')
  return stored
}

export async function windowsQualityForm(settings) {
  return { kind: 'settings-form', submitCommand: WINDOWS_QUALITY_COMMAND,
    notice: '选择 QQ 音乐播放音质。保存后切换歌曲应用；所选音质需要歌曲和账号支持。',
    fields: [{ key: 'quality', label: '播放音质', type: 'select', required: true,
      value: await windowsPlaybackQuality(settings), options: OPTIONS }] }
}

export async function saveWindowsQuality(settings, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
      !OPTIONS.some(option => option.value === values.quality)) throw new Error('请选择有效的 QQ 音乐音质')
  await settings.set(WINDOWS_QUALITY_KEY, values.quality)
  return { message: '音质已保存。切换歌曲后应用所选音质。', form: await windowsQualityForm(settings) }
}
