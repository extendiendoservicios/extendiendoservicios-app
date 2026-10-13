import { describe, expect, it } from 'vitest'
import { expiryText, fileLine, formatFileSize, whenLine } from './details'
import type { MediaItem } from './types'

const base: MediaItem = {
  id: 'm1',
  kind: 'photo',
  thumbUrl: null,
  label: 'Foto',
  expiresOn: '2026-11-12',
}

describe('formatFileSize', () => {
  it('elige la unidad y usa coma decimal', () => {
    expect(formatFileSize(850)).toBe('850 B')
    expect(formatFileSize(170_000)).toBe('166 KB')
    expect(formatFileSize(8_800_000)).toBe('8,4 MB')
    expect(formatFileSize(25 * 1024 * 1024)).toBe('25 MB')
  })
})

describe('expiryText', () => {
  it('cubre vencimiento, conservada y estados sin archivo', () => {
    expect(expiryText(base)).toBe('Vence el 12 nov 2026')
    expect(expiryText({ ...base, keep: true })).toBe('Conservada: no vence')
    expect(expiryText({ ...base, unavailable: 'expired' })).toBe('Venció')
  })
})

describe('whenLine', () => {
  it('sin captura distinta muestra solo la subida (hora de Buenos Aires)', () => {
    const item: MediaItem = {
      ...base,
      details: {
        capturedAt: '2026-10-13T21:14:10Z',
        uploadedAt: '2026-10-13T21:14:30Z',
      },
    }
    expect(whenLine(item)).toBe('Subida mar 13 oct, 18:14')
  })

  it('con captura distinta muestra ambas', () => {
    const item: MediaItem = {
      ...base,
      details: {
        capturedAt: '2026-10-13T13:40:00Z',
        uploadedAt: '2026-10-13T21:14:00Z',
      },
    }
    expect(whenLine(item)).toBe(
      'Sacada mar 13 oct, 10:40 · Subida mar 13 oct, 18:14',
    )
  })

  it('sin datos devuelve null', () => {
    expect(whenLine(base)).toBeNull()
  })
})

describe('fileLine', () => {
  it('foto: tipo, tamaño y vencimiento', () => {
    expect(fileLine({ ...base, details: { sizeBytes: 850 } })).toBe(
      'Foto · 850 B · Vence el 12 nov 2026',
    )
  })

  it('video: suma la duración', () => {
    expect(
      fileLine({
        ...base,
        kind: 'video',
        durationSeconds: 28,
        keep: true,
        details: { sizeBytes: 8_800_000 },
      }),
    ).toBe('Video · 0:28 · 8,4 MB · Conservada: no vence')
  })
})
