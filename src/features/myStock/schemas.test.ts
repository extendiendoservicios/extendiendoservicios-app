import { describe, expect, it } from 'vitest'
import {
  qtySchema,
  shortageSchema,
  withdrawalSchema,
  withdrawalTargetSchema,
} from './schemas'

describe('qtySchema', () => {
  it('acepta enteros mayores que cero', () => {
    expect(qtySchema.safeParse(1).success).toBe(true)
    expect(qtySchema.safeParse(24).success).toBe(true)
  })

  it('rechaza cero, negativos y decimales', () => {
    expect(qtySchema.safeParse(0).success).toBe(false)
    expect(qtySchema.safeParse(-2).success).toBe(false)
    expect(qtySchema.safeParse(1.5).success).toBe(false)
  })
})

describe('topes de largo de los textos libres (0073, IS-37)', () => {
  it('la observación del retiro admite 500 y rechaza 501, con turno o con sede', () => {
    const ok = 'x'.repeat(500)
    const largo = 'x'.repeat(501)
    expect(
      withdrawalTargetSchema.safeParse({
        kind: 'shift',
        shiftId: 'sh1',
        note: ok,
      }).success,
    ).toBe(true)
    expect(
      withdrawalTargetSchema.safeParse({
        kind: 'shift',
        shiftId: 'sh1',
        note: largo,
      }).success,
    ).toBe(false)
    expect(
      withdrawalTargetSchema.safeParse({
        kind: 'site',
        siteId: 'si1',
        note: ok,
      }).success,
    ).toBe(true)
    const rechazo = withdrawalTargetSchema.safeParse({
      kind: 'site',
      siteId: 'si1',
      note: largo,
    })
    expect(rechazo.success).toBe(false)
    expect(rechazo.error?.issues[0]?.message).toBe('Hasta 500 caracteres.')
  })

  it('el aviso admite descripción de 200 y comentario de 500', () => {
    expect(
      shortageSchema.safeParse({
        description: 'd'.repeat(200),
        comment: 'c'.repeat(500),
      }).success,
    ).toBe(true)
    expect(
      shortageSchema.safeParse({ description: 'd'.repeat(201) }).success,
    ).toBe(false)
    expect(
      shortageSchema.safeParse({
        description: 'corta',
        comment: 'c'.repeat(501),
      }).success,
    ).toBe(false)
  })
})

describe('withdrawalTargetSchema (turno o sede y observación)', () => {
  it('con turno, la observación es opcional', () => {
    expect(
      withdrawalTargetSchema.safeParse({ kind: 'shift', shiftId: 'sh1' })
        .success,
    ).toBe(true)
    expect(
      withdrawalTargetSchema.safeParse({
        kind: 'shift',
        shiftId: 'sh1',
        note: '',
      }).success,
    ).toBe(true)
  })

  it('con turno hace falta elegir uno', () => {
    const result = withdrawalTargetSchema.safeParse({
      kind: 'shift',
      shiftId: '',
    })
    expect(result.success).toBe(false)
  })

  it('con sede, la observación es obligatoria', () => {
    const sinNota = withdrawalTargetSchema.safeParse({
      kind: 'site',
      siteId: 'si1',
      note: '   ',
    })
    expect(sinNota.success).toBe(false)
    expect(sinNota.error?.issues[0]?.message).toBe(
      'Contanos para qué es: la observación es obligatoria.',
    )

    expect(
      withdrawalTargetSchema.safeParse({
        kind: 'site',
        siteId: 'si1',
        note: 'reposición de la semana',
      }).success,
    ).toBe(true)
  })

  it('con sede hace falta elegir una', () => {
    expect(
      withdrawalTargetSchema.safeParse({
        kind: 'site',
        siteId: '',
        note: 'algo',
      }).success,
    ).toBe(false)
  })
})

describe('withdrawalSchema', () => {
  const target = { kind: 'shift', shiftId: 'sh1' } as const

  it('pide al menos un artículo', () => {
    const result = withdrawalSchema.safeParse({ target, lines: [] })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'Agregá al menos un artículo.',
    )
  })

  it('rechaza cantidades que no son enteras mayores que cero', () => {
    expect(
      withdrawalSchema.safeParse({
        target,
        lines: [{ supplyId: 's1', qty: 0 }],
      }).success,
    ).toBe(false)
    expect(
      withdrawalSchema.safeParse({
        target,
        lines: [{ supplyId: 's1', qty: 2.5 }],
      }).success,
    ).toBe(false)
  })

  it('rechaza un artículo repetido', () => {
    expect(
      withdrawalSchema.safeParse({
        target,
        lines: [
          { supplyId: 's1', qty: 1 },
          { supplyId: 's1', qty: 2 },
        ],
      }).success,
    ).toBe(false)
  })

  it('acepta un retiro completo', () => {
    expect(
      withdrawalSchema.safeParse({
        target,
        lines: [
          { supplyId: 's1', qty: 1 },
          { supplyId: 's2', qty: 12 },
        ],
      }).success,
    ).toBe(true)
  })
})

describe('shortageSchema (artículo o descripción)', () => {
  it('acepta un artículo del catálogo', () => {
    expect(shortageSchema.safeParse({ supplyId: 's1' }).success).toBe(true)
  })

  it('acepta una descripción libre', () => {
    expect(
      shortageSchema.safeParse({ description: 'Bolsas de 120 L' }).success,
    ).toBe(true)
  })

  it('rechaza no elegir ninguno de los dos', () => {
    const result = shortageSchema.safeParse({ supplyId: '', description: '  ' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'Elegí un artículo del catálogo o escribí cuál es el que falta.',
    )
  })

  it('rechaza elegir los dos a la vez', () => {
    expect(
      shortageSchema.safeParse({ supplyId: 's1', description: 'Otro' }).success,
    ).toBe(false)
  })

  it('turno, sede y comentario son opcionales', () => {
    expect(
      shortageSchema.safeParse({
        supplyId: 's1',
        shiftId: '',
        siteId: '',
        comment: '',
      }).success,
    ).toBe(true)
  })
})
