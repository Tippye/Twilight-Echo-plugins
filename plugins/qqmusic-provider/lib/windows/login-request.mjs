import { nativeSigned64 } from './json-integer.mjs'

export const WINDOWS_LOGIN_REQUEST_KEY = 'music.login.LoginServer.Login'
export const WINDOWS_LOGIN_DEFAULT_APPID = 100497308
export const WINDOWS_LOGIN_REQUEST_PROVENANCE = Object.freeze({
  artifact: 'QQMusic_Protocol.dll',
  artifactSha256: 'ba66aa248b885227179f1676fbc54576a036f46b9d096fea33131c4f30fa6476',
  version: '22.71',
  qrProducer: '0x100c8b01',
  qrEvidenceId: 'ev_fb4b8f2ff57a35132a2ff960b883302bb7d2a2aa53ea80d642d70396924704d3',
  codeProducer: '0x100c8c37',
  tokenProducer: '0x100c8f20',
  defaultAppidConstructor: '0x100c8583'
})

function string(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  return value
}

function cString(value, name) {
  value = string(value, name)
  if (value.includes('\0')) throw new TypeError(`${name} must not contain NUL`)
  return value
}

function call(param) {
  return { module: 'music.login.LoginServer', method: 'Login', param }
}

function legacyContext(appid, deviceName) {
  if (!Number.isInteger(appid) || appid < 0 || appid > 0xffffffff) {
    throw new RangeError('appid must be an unsigned int32')
  }
  return { onlyNeedAccessToken: 0, forceRefreshToken: 0, appid,
    deviceName: string(deviceName, 'deviceName') }
}

/** Actual type4 scan branch; obtaining QR credentials and checking login are separate. */
export function buildWindowsQrLoginCall({ musicId, token, qrCodeId } = {}) {
  return call({
    musicid: nativeSigned64(musicId),
    token: cString(token, 'token'),
    qrCodeID: cString(qrCodeId, 'qrCodeId')
  })
}

/** Legacy QQ authorization-code branch; the constructor default may be overridden. */
export function buildWindowsQQCodeLoginCall({ code, deviceName,
  appid = WINDOWS_LOGIN_DEFAULT_APPID } = {}) {
  return call({ code: cString(code, 'code'), ...legacyContext(appid, deviceName) })
}

/** Server request used for QQ token restoration; its result must be validated remotely. */
export function buildWindowsQQTokenLoginCall({ openid, musickey, expiredIn, musicId,
  refreshKey, accessToken, refreshToken, deviceName,
  appid = WINDOWS_LOGIN_DEFAULT_APPID } = {}) {
  return call({
    openid: string(openid, 'openid'),
    musickey: string(musickey, 'musickey'),
    expired_in: nativeSigned64(expiredIn),
    musicid: nativeSigned64(musicId),
    ...legacyContext(appid, deviceName),
    deviceType: 'Widnows', // Exact native literal.
    refresh_key: string(refreshKey, 'refreshKey'),
    access_token: string(accessToken, 'accessToken'),
    refresh_token: string(refreshToken, 'refreshToken')
  })
}
