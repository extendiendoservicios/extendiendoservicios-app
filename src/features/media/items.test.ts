import { describe, expect, it } from 'vitest'
import {
  daysUntil,
  describeCounts,
  extensionOfPath,
  groupRowsByPerson,
  groupRowsByShift,
  isMissingPhotos,
  mediaLabel,
  shiftGroupTitle,
  toMediaItem,
} from './items'
import { mediaRow } from './testRows'

describe('toMediaItem', () => {
  it('usa la URL firmada de la miniatura y arma un nombre accesible', () => {
    const item = toMediaItem(
      mediaRow(),
      new Map([['sh1/m1_thumb.jpg', 'https://s/t']]),
    )
    expect(item.thumbUrl).toBe('https://s/t')
    expect(item.label).toBe('Foto de Ana Pérez, 08:15')
    expect(item.unavailable).toBeNull()
    expect(item.canRemove).toBe(false)
  })

  it('lo vencido (has_file = false) queda como constancia gris, sin miniatura', () => {
    const item = toMediaItem(
      mediaRow({ hasFile: false }),
      new Map([['sh1/m1_thumb.jpg', 'https://s/t']]),
    )
    expect(item.unavailable).toBe('expired')
    expect(item.thumbUrl).toBeNull()
  })

  it('un video lleva su duración y su etiqueta', () => {
    const row = mediaRow({ kind: 'video', durationSeconds: 24 })
    expect(toMediaItem(row, undefined).durationSeconds).toBe(24)
    expect(mediaLabel(row)).toMatch(/^Video de Ana Pérez/)
  })

  it('prefiere la hora de la toma a la de la subida', () => {
    const row = mediaRow({ capturedAt: '2026-10-13T12:30:00Z' })
    expect(mediaLabel(row)).toBe('Foto de Ana Pérez, 09:30')
  })
})

describe('agrupar', () => {
  it('el título del turno es «fecha · cliente · sede»', () => {
    expect(shiftGroupTitle(mediaRow())).toBe(
      'mar 13 oct · Limpia Ya · Sede Centro',
    )
  })

  it('agrupa por turno en el orden de llegada y suma un turno que reaparece', () => {
    const groups = groupRowsByShift([
      mediaRow({ id: 'a', shiftId: 'sh1' }),
      mediaRow({ id: 'b', shiftId: 'sh2' }),
      mediaRow({ id: 'c', shiftId: 'sh1' }),
    ])
    expect(groups.map((g) => [g.shiftId, g.rows.map((r) => r.id)])).toEqual([
      ['sh1', ['a', 'c']],
      ['sh2', ['b']],
    ])
  })

  it('agrupa por persona y marca la supervisión', () => {
    const groups = groupRowsByPerson(
      [
        mediaRow({ id: 'a' }),
        mediaRow({ id: 'b', kind: 'video' }),
        mediaRow({
          id: 'c',
          uploadedBy: 'p2',
          uploaderName: 'Luis Gómez',
          uploaderRole: 'supervisor',
        }),
      ],
      undefined,
    )
    expect(groups.map((g) => g.title)).toEqual([
      'Ana Pérez',
      'Luis Gómez · Supervisión',
    ])
    expect(groups[0]?.subtitle).toBe('1 foto · 1 video')
    expect(groups[0]?.items).toHaveLength(2)
  })

  it('cuenta fotos y videos en singular y plural', () => {
    expect(describeCounts([mediaRow(), mediaRow({ id: 'x' })])).toBe('2 fotos')
    expect(describeCounts([mediaRow({ kind: 'video' })])).toBe('1 video')
    expect(describeCounts([])).toBe('')
  })
})

describe('isMissingPhotos («Sin fotos»)', () => {
  const asked = { requiresPhotos: true, status: 'completed' }

  it('marca el turno que las pide, ya empezó y no tiene ninguna', () => {
    expect(isMissingPhotos(asked, [])).toBe(true)
    expect(isMissingPhotos({ ...asked, status: 'in_progress' }, [])).toBe(true)
  })

  it('no marca si no las pide', () => {
    expect(
      isMissingPhotos({ requiresPhotos: false, status: 'completed' }, []),
    ).toBe(false)
  })

  it('no marca un turno que todavía no empezó ni uno cancelado', () => {
    expect(isMissingPhotos({ ...asked, status: 'scheduled' }, [])).toBe(false)
    expect(isMissingPhotos({ ...asked, status: 'assigned' }, [])).toBe(false)
    expect(isMissingPhotos({ ...asked, status: 'cancelled' }, [])).toBe(false)
  })

  it('no marca si hay una foto, aunque ya haya vencido (queda la constancia)', () => {
    expect(isMissingPhotos(asked, [mediaRow()])).toBe(false)
    expect(isMissingPhotos(asked, [mediaRow({ hasFile: false })])).toBe(false)
  })

  it('un video solo no cuenta como foto', () => {
    expect(isMissingPhotos(asked, [mediaRow({ kind: 'video' })])).toBe(true)
  })
})

describe('auxiliares', () => {
  it('la extensión sale de la ruta', () => {
    expect(extensionOfPath('sh1/m1.mp4')).toBe('mp4')
    expect(extensionOfPath('sh1/m1.WEBM')).toBe('webm')
    expect(extensionOfPath('sin-extension')).toBe('jpg')
  })

  it('días hasta el vencimiento', () => {
    expect(daysUntil('2026-10-20', '2026-10-13')).toBe(7)
    expect(daysUntil('2026-10-10', '2026-10-13')).toBe(-3)
  })
})
