import { describe, expect, it } from 'vitest'
import { detectIosInstallMode } from './iosInstall'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1'
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15'
const IPHONE_EDGE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 EdgiOS/126.0 Mobile/15E148 Safari/605.1.15'
const IPHONE_WHATSAPP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPHONE_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 330.0.0.0'
const IPHONE_FACEBOOK =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

describe('detectIosInstallMode (OF-09)', () => {
  it('iPhone con Safari', () => {
    expect(detectIosInstallMode(IPHONE_SAFARI)).toBe('safari')
  })

  it.each([
    ['Chrome', IPHONE_CHROME],
    ['Firefox', IPHONE_FIREFOX],
    ['Edge', IPHONE_EDGE],
    ['WhatsApp', IPHONE_WHATSAPP],
    ['Instagram', IPHONE_INSTAGRAM],
    ['Facebook', IPHONE_FACEBOOK],
  ])('iPhone con %s pide abrir en Safari', (_nombre, ua) => {
    expect(detectIosInstallMode(ua)).toBe('other-browser')
  })

  it('Android y Mac de escritorio no son iOS', () => {
    expect(detectIosInstallMode(ANDROID_CHROME)).toBe('not-ios')
    expect(detectIosInstallMode(MAC_SAFARI, 'MacIntel', 0)).toBe('not-ios')
  })

  it('iPad moderno (se presenta como Mac pero es táctil) cuenta como iOS', () => {
    expect(detectIosInstallMode(MAC_SAFARI, 'MacIntel', 5)).toBe('safari')
  })
})
