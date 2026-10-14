import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { mapWindowsTrack, isUnsupportedWindowsSong, windowsSongReference, windowsSongMid, windowsSongMedia, windowsSearchPage, windowsSearchWindow } from './lib/windows/tracks.mjs'
import { windowsArtistReference, windowsAlbumReference } from './lib/windows/search-catalog.mjs'

const fixture = JSON.parse(readFileSync(new URL('./test/fixtures/windows-public-search-songs.json', import.meta.url)))
// Artificial metadata only; this reproduces the observed shape without private values.
const unsupportedSong = () => ({ ...structuredClone(fixture.publicSongs[0]), id: 123,
  mid: '', title: '公开测试记录', name: '公开测试记录', type: 21, data_type: 0,
  file: { ...fixture.publicSongs[0].file, media_mid: '' } })

test('observed Windows song DTO maps a stable Track without persisting media credentials', () => {
  const song = fixture.publicSongs[0]
  const track = mapWindowsTrack(song)
  assert.equal(track.id, 'qq:0039MnYb0qxYhV:97773')
  assert.equal(track.title, '晴天')
  assert.equal(track.artist, '周杰伦')
  assert.equal(track.album, '叶惠美')
  assert.deepEqual(windowsArtistReference(track.artists[0].id), { singerMid: song.singer[0].mid, singerId: String(song.singer[0].id) })
  assert.deepEqual(windowsAlbumReference(track.albumId), { albumMid: song.album.mid, albumId: String(song.album.id) })
  assert.equal(track.duration, 269)
  assert.equal(track.size, 4317292)
  assert.equal(windowsSongMid({ id: track.id }), song.mid)
  assert.deepEqual(windowsSongReference({ id: track.id }), { songmid: song.mid, songid: '97773' })
  assert.equal(Object.hasOwn(track, 'providerMediaId'), false)
  assert.equal(Object.hasOwn(track, 'playbackStatus'), false)
  assert.equal(windowsSongMedia(song).mediaMid, '003Qui1q2u1Zho')
})

test('native UInt32 song IDs remain exact and reject incompatible detail IDs', () => {
  const song = { ...fixture.publicSongs[0], id: '4294967295' }
  assert.equal(windowsSongMedia(song).songid, '4294967295')
  for (const id of ['4294967296', '9007199254740993', 9007199254740992, 0]) {
    assert.throws(() => windowsSongMedia({ ...song, id }), /媒体信息/)
  }
})

test('offset windows retain partial-page skip and require real server totals', () => {
  assert.deepEqual(windowsSearchWindow(30, 35), { pageSize: 30, page: 2, skip: 5, limit: 30 })
  assert.deepEqual(windowsSearchWindow(100, 125), { pageSize: 60, page: 3, skip: 5, limit: 100 })
  assert.deepEqual(windowsSearchPage({ body: { song: { list: fixture.publicSongs } }, meta: fixture.meta }),
    { songs: fixture.publicSongs, total: 997 })
  assert.throws(() => windowsSearchPage({ body: { song: { list: [] } } }))
  for (const offset of [-1, 0.5, 1000001]) assert.throws(() => windowsSearchWindow(30, offset))
})

test('invalid identifiers and incomplete metadata fail before a playback request', () => {
  for (const id of ['qq:97773', 'qq:0039MnYb0qxYhV', 'qq:0039MnYb0qxYhV:4294967296', 'qq:0039MnYb0qxYhV:97773:extra', 'ncm:0039MnYb0qxYhV:97773', null]) {
    assert.throws(() => windowsSongMid({ id }))
  }
  assert.equal(mapWindowsTrack({ ...fixture.publicSongs[0], mid: '../bad' }), null)
  assert.throws(() => windowsSongMedia({ ...fixture.publicSongs[0], file: {} }))
})

test('the observed native type21 empty-MID shape retains real identity and visible metadata', () => {
  const input = unsupportedSong()
  const track = mapWindowsTrack(input)
  assert.equal(isUnsupportedWindowsSong(input), true)
  assert.equal(track.id, 'qq:native:21:123')
  assert.equal(track.filePath, track.id)
  assert.equal(track.fileName, '公开测试记录')
  assert.equal(track.playbackStatus, 'unsupported')
  assert.equal(track.title, input.title)
  assert.equal(track.artist, '周杰伦')
  assert.equal(track.album, '叶惠美')
  assert.equal(track.duration, 269)
  assert.equal(track.streamUrl, null)
  assert.equal(Object.hasOwn(track, 'songmid'), false)
  const restored = JSON.parse(JSON.stringify(track))
  assert.equal(restored.id, track.id)
  assert.equal(restored.playbackStatus, 'unsupported')
  input.title = 'changed'
  input.singer[0].name = 'changed'
  assert.equal(track.title, '公开测试记录')
  assert.equal(track.artist, '周杰伦')
})

test('native unsupported identities refuse playback without inventing a normal MID', () => {
  const input = unsupportedSong()
  for (const track of [mapWindowsTrack(input), 'qq:native:21:123', { id: 'qq:native:21:123' },
    'qq:native:21:4294967295']) {
    assert.throws(() => windowsSongReference(track), { message: '当前音源尚不支持该记录' })
    assert.throws(() => windowsSongMid(track), { message: '当前音源尚不支持该记录' })
  }
  assert.throws(() => windowsSongMedia(input), { message: '当前音源尚不支持该记录' })
  for (const id of ['qq:native:21:0', 'qq:native:21:0123', 'qq:native:21:4294967296',
    'qq:native:21:123\n', 'qq:native:22:123', 'qq:native:21:' + '1'.repeat(1000)]) {
    assert.throws(() => windowsSongReference(id), { message: 'QQ 音乐歌曲标识无效' })
  }
})

test('type21 exception is narrow and malformed empty-MID records remain rejected', () => {
  const input = unsupportedSong()
  const mutations = [
    { type: 22 }, { type: '21' }, { data_type: undefined }, { data_type: 1 }, { data_type: '0' },
    { mid: undefined }, { mid: null }, { mid: ' ' },
    { file: { ...input.file, media_mid: undefined } }, { file: { ...input.file, media_mid: ' ' } },
    { id: 0 }, { id: -1 }, { id: 4294967296 }, { id: Number.MAX_SAFE_INTEGER + 1 },
    { id: '1'.repeat(1000) }, { title: '' }, { title: '\0' }, { title: '\ud800' },
    { name: undefined }, { interval: '269' }, { album: null }, { singer: new Array(1) },
    { singer: [{ name: '' }] }, { file: { ...input.file, size_flac: -1 } }
  ]
  for (const mutation of mutations) {
    const song = { ...input, ...mutation }
    assert.equal(isUnsupportedWindowsSong(song), false)
    assert.equal(mapWindowsTrack(song), null)
    assert.throws(() => windowsSongMedia(song), { message: 'QQ 音乐歌曲详情缺少媒体信息' })
  }
  assert.equal(mapWindowsTrack({ ...input, id: 4294967295 }).id, 'qq:native:21:4294967295')
  assert.equal(mapWindowsTrack({ ...input, id: '123' }).id, 'qq:native:21:123')
  const withMedia = { ...input, mid: fixture.publicSongs[0].mid,
    file: { ...input.file, media_mid: fixture.publicSongs[0].file.media_mid } }
  assert.equal(isUnsupportedWindowsSong(withMedia), false)
  assert.equal(Object.hasOwn(mapWindowsTrack(withMedia), 'playbackStatus'), false)
  assert.equal(windowsSongMedia(withMedia).songtype, 21)
})
