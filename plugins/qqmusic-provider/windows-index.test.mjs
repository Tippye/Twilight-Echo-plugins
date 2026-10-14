import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { activate, deactivate } from './windows-index.mjs'

const fixture = JSON.parse(readFileSync(new URL('./test/fixtures/windows-public-search-songs.json', import.meta.url)))
const session = { openid: 'public-openid', access_token: 'public-access', refresh_token: 'public-refresh',
  musickey: 'public-key', unionid: '', refresh_key: '', encryptUin: '', musicid: 123,
  musickeyCreateTime: 1, expired_at: Math.floor(Date.now() / 1000) + 3600, loginType: 2 }

function harness({ qrStatus = { status: 'waiting' }, onRequest, mediaFetch } = {}) {
  const storage = new Map()
  let provider
  let polls = 0
  const context = { settings: { get: async key => storage.get(key), set: async (key, value) => { storage.set(key, value) },
    delete: async key => { storage.delete(key) } }, twilight: {
    providers: { register: async value => { provider = value } }, qqAuth: {
      clear: async () => {}, getQrLogin: async () => ({ key: 'opaque-public-test-key', imageDataUrl: 'data:image/png;base64,public', expiresAt: Date.now() + 600000 }),
      checkQrLogin: async () => { polls++; await new Promise(resolve => setImmediate(resolve)); return qrStatus }
    },
    ui: { register: async () => {}, onCommand: () => () => {} }
  } }
  return { context, storage, get provider() { return provider }, get polls() { return polls },
    fetch: async (_url, options) => {
      if (!options.body && mediaFetch) return mediaFetch(_url, options)
      const request = JSON.parse(options.body.toString())
      const key = Object.keys(request).find(key => key !== 'comm')
      if (onRequest) return onRequest(request, key)
      const data = key === 'music.search.SearchCgiService'
        ? { meta: fixture.meta, body: { song: { list: fixture.publicSongs } } } : session
      return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
    }
  }
}

test('Windows entry registers observed search and remotely verified login methods', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const h = harness()
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    assert.ok(h.provider.capabilities.includes('search'))
    assert.equal(h.provider.capabilities.includes('playbackUrl'), true)
    const result = await h.provider.searchSongs('晴天', 2, 0, { signal: new AbortController().signal })
    assert.equal(result.items[0].id, 'qq:0039MnYb0qxYhV:97773')
    assert.equal(result.total, 997)
    assert.match(h.storage.get('windows-device').guid, /^[a-f0-9]{32}$/)
    assert.deepEqual(await h.provider.checkLogin({}), { loggedIn: false, profile: null })
    await assert.rejects(h.provider.getPlaybackUrl(result.items[0], {}, {}), /扫码登录/)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('registered artist methods use the current Windows session and shared canonical album identities', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const artist = 'qq:artist:0025NhlN2yWrP4:4558'
  const requests = []
  const h = harness({ onRequest: (request, key) => {
    requests.push(request[key])
    let data = session
    if (key.endsWith('.GetSingerSongList')) data = { singerMid: '0025NhlN2yWrP4', totalNum: 1, songList: [{ songInfo: fixture.publicSongs[0] }] }
    if (key.endsWith('.GetSingerDetail')) data = { singer_list: [{ basic_info: { singer_mid: '0025NhlN2yWrP4', singer_id: 4558, name: '周杰伦' }, ex_info: { desc: 'public artist description' } }] }
    if (key.endsWith('.GetAlbumList')) data = { singerMid: '0025NhlN2yWrP4', total: 1, albumList: [{ albumID: 1458791, albumMid: '003RMaRI1iFoYd', albumName: '周杰伦的床边故事', totalNum: 10, publishDate: '2016-06-24', singerName: '周杰伦' }] }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    assert.equal((await h.provider.fetchArtistTopSongs(artist, {}))[0].id, 'qq:0039MnYb0qxYhV:97773')
    assert.equal(await h.provider.fetchArtistIntro(artist, {}), 'public artist description')
    const albums = await h.provider.fetchArtistAlbums(artist, {})
    assert.equal(albums[0].id, 'qq:album:003RMaRI1iFoYd:1458791')
    assert.equal(albums[0].trackCount, 10)
    assert.deepEqual(requests.find(call => call.method === 'GetSingerSongList').param,
      { singerMid: '0025NhlN2yWrP4', begin: 0, num: 10, order: 1 })
  } finally { await deactivate(); globalThis.fetch = original }
})

test('logout during a public artist request cannot commit an earlier account response', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let release, announce
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { announce = resolve })
  const h = harness({ onRequest: async (request, key) => {
    let data = session
    if (key.endsWith('.GetSingerSongList')) {
      announce(); await held
      data = { singerMid: '0025NhlN2yWrP4', totalNum: 1, songList: [{ songInfo: fixture.publicSongs[0] }] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const loading = h.provider.fetchArtistTopSongs('qq:artist:0025NhlN2yWrP4:4558', {})
    const rejected = assert.rejects(loading, /取消|登录|会话/)
    await started
    await h.provider.logout({})
    release()
    await rejected
  } finally { release(); await deactivate(); globalThis.fetch = original }
})

test('Home sections dispatch distinct current-session Daily and latest reads and real-supplied playlist references', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const requests = []
  const h = harness({ onRequest: (request, key) => {
    const call = request[key]
    requests.push(call)
    let data = session
    if (call.method === 'get_recommend_feed') data = { retcode: 0, v_shelf: [{ id: 201, v_niche: [{ v_card: [{ id: '42', title: '每日30首' }] }] }] }
    if (call.module === 'music.srfDissInfo.aiDissInfo') data = { code: 0, subcode: 0, dirinfo: { id: 42, songnum: 1 }, total_song_num: 1, hasmore: 0, songlist: [fixture.publicSongs[0]] }
    if (call.method === 'get_new_song_info') data = { songlist: fixture.publicSongs }
    if (call.method === 'get_new_hot_recommend') data = { grids: [{ id: 42, type: 10014, title: 'public synthetic recommendation', picurl: '', creator: { uin: '987', nick: 'public' } }] }
    if (call.module === 'music.srfDissInfo.DissInfoForPc') {
      assert.equal(call.param.login_uin, session.musicid)
      assert.equal(call.param.host_uin, session.musicid)
      assert.equal(Object.hasOwn(call.param, 'dirid'), false)
      data = { code: 0, subcode: 0, dirinfo: { id: 42, host_uin: 0, creator: { musicid: 0 } },
        total_song_num: 1, songlist: [fixture.publicSongs[0]] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    assert.deepEqual(h.provider.ui.streamingSections.map(s => s.args), [['daily'], ['latest']])
    assert.equal((await h.provider.fetchRecommendSongs('daily', {}))[0].id, 'qq:0039MnYb0qxYhV:97773')
    assert.equal((await h.provider.fetchRecommendSongs('latest', {})).length, fixture.publicSongs.length)
    assert.equal((await h.provider.fetchRecommendPlaylists({}))[0].id, 'qq:playlist:0:42')
    const daily = requests.find(call => call.module === 'music.srfDissInfo.aiDissInfo')
    assert.equal(daily.param.disstid, 42)
    assert.match(daily.param.guid, /^[a-f0-9]{32}$/)
    assert.equal(requests.filter(call => call.method === 'get_recommend_feed').length, 1)
    await assert.rejects(h.provider.fetchRecommendSongs('soaring', {}), /分区无效/)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('public playlist search binds the actual native owner instead of its source creator', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const requests = []
  const h = harness({ onRequest: (request, key) => {
    const call = request[key]
    requests.push(call)
    let data = session
    if (call.module === 'music.search.SearchCgiService') data = { meta: { sum: 300 }, body: { songlist: { list: [
      { dissid: 42, dissname: 'Public synthetic playlist', imgurl: '', song_count: 99, creator: { creator_uin: '987', name: 'Public creator' } }
    ] } } }
    if (call.module === 'music.srfDissInfo.DissInfoForPc') data = {
      code: 0, subcode: 0, dirinfo: { id: 42, host_uin: 0, creator: { musicid: 0 } },
      total_song_num: 1, songlist: [fixture.publicSongs[0]]
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const result = await h.provider.searchPlaylists('public', 1, 0, {})
    assert.equal(result.total, 300)
    assert.equal(result.items[0].id, 'qq:playlist:0:42')
    assert.equal(result.items[0].trackCount, 1)
    const detail = requests.find(call => call.module === 'music.srfDissInfo.DissInfoForPc')
    assert.equal(detail.param.login_uin, session.musicid)
    assert.equal(detail.param.host_uin, session.musicid)
    assert.equal(Object.hasOwn(detail.param, 'dirid'), false)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('logout during a public search playlist binding cannot publish earlier account references', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let release, announce
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { announce = resolve })
  const h = harness({ onRequest: async (request, key) => {
    const call = request[key]
    let data = session
    if (call.module === 'music.search.SearchCgiService') data = { meta: { sum: 1 }, body: { songlist: { list: [
      { dissid: 42, dissname: 'Public synthetic playlist', imgurl: '', creator: { creator_uin: '987', name: 'Public creator' } }
    ] } } }
    if (call.module === 'music.srfDissInfo.DissInfoForPc') {
      announce(); await held
      data = { code: 0, subcode: 0, dirinfo: { id: 42, host_uin: 0, creator: { musicid: 0 } },
        total_song_num: 1, songlist: [fixture.publicSongs[0]] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const loading = h.provider.searchPlaylists('public', 1, 0, {})
    const rejected = assert.rejects(loading, /取消|登录|会话/)
    await started
    await h.provider.logout({})
    release()
    await rejected
  } finally { release(); await deactivate(); globalThis.fetch = original }
})

test('logout while the bound Daily detail is pending cannot publish its earlier account tracks', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let release, announce
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { announce = resolve })
  const h = harness({ onRequest: async (request, key) => {
    let data = session
    if (request[key].method === 'get_recommend_feed') data = { retcode: 0, v_shelf: [{ id: 201, v_niche: [{ v_card: [{ id: '42', title: '每日30首' }] }] }] }
    if (request[key].module === 'music.srfDissInfo.aiDissInfo') {
      announce(); await held
      data = { code: 0, subcode: 0, dirinfo: { id: 42, songnum: 1 }, total_song_num: 1, hasmore: 0, songlist: [fixture.publicSongs[0]] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const loading = h.provider.fetchRecommendSongs('daily', {})
    const rejected = assert.rejects(loading, /取消|登录|会话/)
    await started
    await h.provider.logout({})
    release()
    await rejected
  } finally { release(); await deactivate(); globalThis.fetch = original }
})

test('registered discovery uses source taxonomy, unknown feed totals and the shared native playlist identity binder', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const requests = []
  const basic = { tid: 42, title: 'Public synthetic playlist', creator: { uin: '', nick: 'Public creator' },
    cover: { medium_url: '' }, song_cnt: 99 }
  const h = harness({ onRequest: (request, key) => {
    const call = request[key]
    requests.push(call)
    let data = session
    if (call.method === 'GetAllTag') data = { v_group: [{ group_id: 6, group_name: '语种',
      v_item: [{ id: 5, name: '日语', source: 0 }, { id: 9527, name: 'AI歌单', source: 1 }] }] }
    if (call.method === 'GetRecommendWhole') data = { FeedRsp: { FromLimit: 400, HasMore: false,
      List: [{ Playlist: { basic } }] } }
    if (call.method === 'get_category_content') data = { retcode: 0, content: { total_cnt: 1, v_item: [{ basic }] } }
    if (call.module === 'music.srfDissInfo.DissInfoForPc') data = { code: 0, subcode: 0,
      dirinfo: { id: 42, host_uin: 0, creator: { musicid: 0 } }, total_song_num: 1, songlist: [fixture.publicSongs[0]] }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    assert.equal(h.provider.ui.streamingDiscovery.supportsSort, false)
    const catalogue = await h.provider.fetchPlaylistCategories({})
    assert.equal(catalogue.groups[0].tags.length, 1)
    assert.equal(catalogue.groups[0].tags[0].name, '日语')
    const feed = await h.provider.fetchDiscoveryPlaylists('全部', 'hot', 30, 0, {})
    assert.equal(feed.items[0].id, 'qq:playlist:0:42')
    assert.equal(feed.items[0].trackCount, 1)
    assert.equal(feed.total, 0)
    assert.equal(feed.hasMore, false)
    const category = await h.provider.fetchDiscoveryPlaylists('日语', 'hot', 30, 0, {})
    assert.equal(category.total, 1)
    assert.equal(category.items[0].id, 'qq:playlist:0:42')
    const content = requests.find(call => call.method === 'get_category_content')
    assert.equal(content.param.caller, String(session.musicid))
    assert.equal(content.param.category_id, 5)
    assert.equal(content.param.page, 0)
    assert.equal(content.param.size, 30)
    assert.equal(requests.find(call => call.method === 'GetAllTag').param.qq, '')
    await assert.rejects(h.provider.fetchDiscoveryPlaylists('日语', 'new', 30, 0, {}), /发现数据无法验证/)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('persisted dual IDs resolve native scene0 details and play through a revocable loopback URL', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const audio = Buffer.alloc(2048, 7)
  audio.write('ID3'); audio[3] = 4; audio.fill(0, 6, 10)
  let details = 0
  const h = harness({ onRequest: (request, key) => {
    const call = request[key]
    let data = session
    if (key === 'Protocol_UpdateSongInfo') {
      details++
      assert.deepEqual(call.param, { ids: [97773], types: [0], ctx: 0, scene: 0 })
      data = { tracks: [fixture.publicSongs[0]] }
    }
    if (key === 'queryvkey') {
      assert.equal(call.module, 'music.vkey.GetVkey')
      const filename = call.param.filename[0]
      data = { retcode: 0, sip: ['https://dl.stream.qqmusic.qq.com/'],
        midurlinfo: [{ result: 0, songmid: '0039MnYb0qxYhV', filename, purl: `${filename}?vkey=public`, ekey: '' }] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  }, mediaFetch: async (_url, options) => {
    if (options.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(audio.length) } })
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)
    const first = Number(match[1]), last = Number(match[2])
    return new Response(audio.subarray(first, last + 1), { status: 206,
      headers: { 'Content-Length': String(last - first + 1), 'Content-Range': `bytes ${first}-${last}/${audio.length}` } })
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const url = await h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, { quality: '128' }, {})
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/audio\/[a-f0-9]{48}$/)
    assert.equal(details, 1)
    const response = await original(url)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio)
    await h.provider.logout({})
    assert.equal((await original(url)).status, 404)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('concurrent authorized polls exchange the official one-shot code once', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let exchanges = 0
  const h = harness({ qrStatus: { status: 'authorized', code: 'public-test-code' }, onRequest: (request, key) => {
    assert.equal(request[key].param.code, 'public-test-code')
    exchanges++
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data: session } }))
  } })
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    const qr = await h.provider.getQrLogin({})
    const result = await Promise.all([h.provider.checkQrLogin(qr.key, {}), h.provider.checkQrLogin(qr.key, {})])
    assert.ok(result.every(item => item.code === 0 && item.profile.id === '123'))
    assert.equal(h.polls, 1)
    assert.equal(exchanges, 1)
    assert.equal(h.storage.get('windows-auth').musickey, 'public-key')
    await h.provider.logout({})
    assert.equal(h.storage.has('windows-auth'), false)
    assert.equal((await h.provider.checkQrLogin(qr.key, {})).code, 65)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('partial-page offset is applied once and invalid DTOs cannot cause unlimited pagination', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const pages = []
  const h = harness({ onRequest: (request, key) => {
    pages.push(request[key].param.page_num)
    const songs = [fixture.publicSongs[0], fixture.publicSongs[1]]
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0,
      data: { meta: { sum: 999999 }, body: { song: { list: songs } } } } }))
  } })
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    const result = await h.provider.searchSongs('晴天', 2, 1, {})
    assert.deepEqual(pages, [1, 2])
    assert.deepEqual(result.items.map(item => item.id), ['qq:004Fs2FP1EvZYc:244115385', 'qq:0039MnYb0qxYhV:97773'])
    await assert.rejects(h.provider.searchSongs('晴天', 2, -1, {}))
  } finally { await deactivate(); globalThis.fetch = original }
})

test('persisted track lyrics use native scene0 context and the verified plaintext Windows call', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const requests = []
  const text = '[00:01.00]public synthetic lyric'
  const h = harness({ onRequest: (request, key) => {
    requests.push({ key, call: request[key] })
    const data = key === 'Protocol_UpdateSongInfo' ? { tracks: [fixture.publicSongs[0]] }
      : { crypt: 0, qrc: 0, lyric: Buffer.from(text).toString('base64'), trans: '', roma: '' }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    assert.ok(h.provider.capabilities.includes('lyrics'))
    const result = await h.provider.getLyrics({ id: 'qq:0039MnYb0qxYhV:97773' }, {})
    assert.deepEqual(result, { lyrics: text, translatedLyrics: null, wordLyrics: null })
    assert.equal(requests[0].key, 'Protocol_UpdateSongInfo')
    assert.equal(requests[1].key, 'music.musichallSong.PlayLyricInfo.GetPlayLyricInfo')
    const p = requests[1].call.param
    assert.equal(p.songID, 97773)
    assert.equal(p.type, fixture.publicSongs[0].type)
    assert.equal(Buffer.from(p.songName, 'base64').toString(), fixture.publicSongs[0].name)
    assert.deepEqual([p.qrc, p.crypt, p.trans, p.roma], [0, 0, 0, 0])
  } finally { await deactivate(); globalThis.fetch = original }
})

test('a CDN status is reported as source validation failure without inventing account rights', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const h = harness({ onRequest: (request, key) => {
    const filename = request[key].param.filename?.[0]
    const data = key === 'Protocol_UpdateSongInfo' ? { tracks: [fixture.publicSongs[0]] }
      : key === 'queryvkey' ? { retcode: 0, midurlinfo: [{ result: 0, songmid: '0039MnYb0qxYhV',
        filename, purl: 'public-media' }] } : session
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  }, mediaFetch: async () => new Response(null, { status: 404 }) })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    await assert.rejects(h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, {}, {}),
      error => error.message === 'QQ 音乐播放源验证失败（404）')
  } finally { await deactivate(); globalThis.fetch = original }
})

test('library and complete native playlist retain an unsupported record without losing the rest', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const special = structuredClone(fixture.publicSongs[0])
  Object.assign(special, { id: 97888, type: 21, data_type: 0, mid: '', title: 'Public synthetic special record' })
  special.file.media_mid = ''
  const h = harness({ onRequest: (request, key) => {
    let data = session
    if (key === 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin') data = {
      total: 1, bFinish: true, v_delTid: [], v_playlist: [{ uin: '123', tid: 99, dirId: 201,
        dirName: 'Public synthetic directory', songNum: 2, bigpicUrl: '', picUrl: '', nick: '' }] }
    if (key === 'music.musicasset.PlaylistFavRead') data = {
      number: 1, total: 1, hasmore: 0, hide: false, v_delTids: [77], v_failTids: [],
      v_list: [{ uin: '456', tid: 77, name: 'Public synthetic favorite', logo: '', songnum: 3, nickname: '', dirShow: 1 }] }
    if (key === 'music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo') {
      assert.equal(request[key].param.dirid, 201)
      data = { code: 0, subcode: 0, dirinfo: { id: 99, host_uin: 0, dirid: 201 },
        songlist: [fixture.publicSongs[0], special], total_song_num: 2 }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  h.storage.set('windows-auth', session)
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    const library = await h.provider.fetchUserLibrary(false, {})
    assert.equal(library.likedPlaylist.id, 'qq:playlist:123:99:201')
    // No speculative deletion rule is applied to an unproved favorite delta.
    assert.equal(library.playlists.length, 2)
    const tracks = await h.provider.fetchPlaylistTracks(library.likedPlaylist.id, false, {})
    assert.equal(tracks.length, 2)
    assert.equal(tracks[1].id, 'qq:native:21:97888')
    assert.equal(tracks[1].playbackStatus, 'unsupported')
    assert.equal(h.provider.fetchPlaylistTracksPage, undefined)
    await assert.rejects(h.provider.getPlaybackUrl(tracks[1], {}, {}), /当前音源尚不支持/)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('incomplete library snapshots and an account change cannot commit a partial library', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let changeAccount = false
  let h
  h = harness({ onRequest: (_request, key) => {
    let data = session
    if (key === 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin') {
      data = { total: 1, bFinish: false, v_delTid: [], v_playlist: [] }
      if (changeAccount) h.storage.set('windows-auth', { ...session, musicid: 456 })
    }
    if (key === 'music.musicasset.PlaylistFavRead') data = {
      number: 0, total: 0, hasmore: 0, hide: false, v_list: [], v_delTids: [], v_failTids: [] }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  h.storage.set('windows-auth', session)
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    await assert.rejects(h.provider.fetchUserLibrary(false, {}), /尚未返回完整/)
    changeAccount = true
    await assert.rejects(h.provider.fetchUserLibrary(false, {}), /请求已取消/)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('displayable search metadata without a media MID reaches the existing native detail lookup', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const partial = structuredClone(fixture.publicSongs[0])
  partial.file.media_mid = ''
  let details = 0
  const lyric = '[00:01.00]public synthetic lyric'
  const h = harness({ onRequest: (_request, key) => {
    let data = session
    if (key === 'music.search.SearchCgiService') data = { meta: { sum: 1 }, body: { song: { list: [partial] } } }
    if (key === 'Protocol_UpdateSongInfo') { details++; data = { tracks: [fixture.publicSongs[0]] } }
    if (key === 'music.musichallSong.PlayLyricInfo.GetPlayLyricInfo') data = {
      crypt: 0, qrc: 0, lyric: Buffer.from(lyric).toString('base64'), trans: '', roma: '' }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    const page = await h.provider.searchSongs('Public', 1, 0, {})
    assert.equal(page.items.length, 1)
    assert.equal((await h.provider.getLyrics(page.items[0], {})).lyrics, lyric)
    assert.equal(details, 1)
    await h.provider.getLyrics(page.items[0], {})
    assert.equal(details, 1)
  } finally { await deactivate(); globalThis.fetch = original }
})
