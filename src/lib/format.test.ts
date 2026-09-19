import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { formatMinutes, formatShortDate, formatTime } from './format'

// Ancla toda la suite a una zona bien distinta de Argentina (UTC+14) para
// probar que el resultado no depende de la zona de la máquina donde corre
// el test (pide el encargo DS-017). Si alguna función volviera a usar la
// hora "local" de `Date` en vez de la zona fija de ADR-019, estos tests
// fallarían acá. Se usa `vi.stubEnv` (en vez de asignar `process.env.TZ`
// directo) porque el código de la app no tiene tipos de Node habilitados
// (`tsconfig.app.json` solo agrega `vite/client`, a propósito: es código de
// navegador) y esta es la forma tipada que da Vitest para lo mismo.
beforeAll(() => {
  vi.stubEnv('TZ', 'Pacific/Kiritimati') // UTC+14
})

afterEach(() => {
  vi.stubEnv('TZ', 'Pacific/Kiritimati')
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('formatShortDate', () => {
  it('da el formato del plan: día de la semana y mes abreviados en minúscula', () => {
    // 13 de agosto de 2026, 08:00 en Argentina (11:00 UTC).
    expect(formatShortDate('2026-08-13T11:00:00Z')).toBe('jue 13 ago')
  })

  it('en un instante UTC que en Argentina cae un día antes, muestra el día de Argentina', () => {
    // 1° de enero de 2026 02:00 UTC = 31 de diciembre de 2025 23:00 en
    // Argentina (UTC-3, sin horario de verano).
    expect(formatShortDate('2026-01-01T02:00:00Z')).toBe('mié 31 dic')
  })

  it('no depende de la zona horaria de la máquina', () => {
    vi.stubEnv('TZ', 'Pacific/Midway') // UTC-11, para contrastar con Kiritimati (UTC+14)
    expect(formatShortDate('2026-08-13T11:00:00Z')).toBe('jue 13 ago')
  })
})

describe('formatTime', () => {
  it('da la hora en formato 24 h con cero a la izquierda', () => {
    expect(formatTime('2026-08-13T11:00:00Z')).toBe('08:00')
  })

  it('formatea la medianoche de Argentina como 00:00', () => {
    // 10 de marzo de 2026 03:00 UTC = 00:00 en Argentina.
    expect(formatTime('2026-03-10T03:00:00Z')).toBe('00:00')
    expect(formatShortDate('2026-03-10T03:00:00Z')).toBe('mar 10 mar')
  })

  it('en un instante UTC que en Argentina es el día anterior, muestra la hora de Argentina', () => {
    expect(formatTime('2026-01-01T02:00:00Z')).toBe('23:00')
  })

  it('no depende de la zona horaria de la máquina', () => {
    vi.stubEnv('TZ', 'Pacific/Midway')
    expect(formatTime('2026-03-10T03:00:00Z')).toBe('00:00')
  })
})

describe('formatMinutes', () => {
  it('0 minutos', () => {
    expect(formatMinutes(0)).toBe('0 min')
  })

  it('menos de una hora (59 min)', () => {
    expect(formatMinutes(59)).toBe('59 min')
  })

  it('45 minutos (ejemplo del plan)', () => {
    expect(formatMinutes(45)).toBe('45 min')
  })

  it('exactamente una hora (60 min)', () => {
    expect(formatMinutes(60)).toBe('1 h')
  })

  it('una hora con minutos (80 min, ejemplo del plan)', () => {
    expect(formatMinutes(80)).toBe('1 h 20 min')
  })

  it('horas exactas (120 min, ejemplo del plan)', () => {
    expect(formatMinutes(120)).toBe('2 h')
  })
})
