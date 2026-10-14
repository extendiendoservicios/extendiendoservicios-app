import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  mediaRetentionSchema,
  retentionValuesToInput,
} from './schemas'

describe('mediaRetentionSchema', () => {
  it('acepta de 7 a 365 días', () => {
    for (const days of ['7', '60', '365']) {
      expect(
        mediaRetentionSchema.safeParse({ photoDays: days, videoDays: days })
          .success,
      ).toBe(true)
    }
  })

  it.each(['6', '366', '0', '-5'])('rechaza %s días', (days) => {
    const result = mediaRetentionSchema.safeParse({
      photoDays: days,
      videoDays: '30',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza vacío y decimales con mensajes en español', () => {
    const empty = mediaRetentionSchema.safeParse({
      photoDays: '',
      videoDays: '30',
    })
    expect(empty.success).toBe(false)
    expect(empty.error?.issues[0]?.message).toContain('Indicá los días')
    const decimal = mediaRetentionSchema.safeParse({
      photoDays: '10.5',
      videoDays: '30',
    })
    expect(decimal.error?.issues[0]?.message).toContain('número entero')
  })

  it('pasa los textos a números', () => {
    expect(
      retentionValuesToInput({ photoDays: '90', videoDays: '14' }),
    ).toEqual({ photoDays: 90, videoDays: 14 })
  })
})

describe('formatBytes', () => {
  it('muestra el tamaño en la unidad que corresponde, con coma', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(850 * 1024)).toBe('850 KB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB')
    expect(formatBytes(1073741824)).toBe('1,0 GB')
  })
})
