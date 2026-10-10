import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  bankDetailsToFormValues,
  bankFieldsShape,
  bankFormValuesToInput,
  cleanCbu,
  formatCbu,
  formatCbuWhileTyping,
  isBankFormEmpty,
} from './schemas'

const schema = z.object(bankFieldsShape)
const CBU = '0170099220000067797370'

describe('validación de datos bancarios (AJ2-04)', () => {
  it('acepta todo vacío', () => {
    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ bankName: '', cbu: '', alias: '' }).success).toBe(
      true,
    )
  })

  it('acepta el CBU de 22 dígitos, con espacios, guiones o puntos', () => {
    expect(schema.safeParse({ cbu: CBU }).success).toBe(true)
    expect(schema.safeParse({ cbu: '01700992 20000067797370' }).success).toBe(
      true,
    )
    expect(
      schema.safeParse({ cbu: '0170-0992-2000-0067-7973-70' }).success,
    ).toBe(true)
  })

  it('rechaza un CBU que no tiene 22 dígitos o tiene letras', () => {
    const short = schema.safeParse({ cbu: '12345' })
    expect(short.success).toBe(false)
    expect(short.error?.issues[0]?.message).toBe(
      'El CBU tiene que tener exactamente 22 dígitos.',
    )
    expect(schema.safeParse({ cbu: `${CBU.slice(0, 21)}X` }).success).toBe(
      false,
    )
    expect(schema.safeParse({ cbu: `${CBU}1` }).success).toBe(false)
  })

  it('el alias admite de 6 a 20 caracteres de letras, números, punto y guion', () => {
    expect(schema.safeParse({ alias: 'mi.alias-01' }).success).toBe(true)
    expect(schema.safeParse({ alias: 'corto' }).success).toBe(false)
    expect(schema.safeParse({ alias: 'a'.repeat(21) }).success).toBe(false)
    expect(schema.safeParse({ alias: 'con espacio' }).success).toBe(false)
    expect(schema.safeParse({ alias: 'con_guion_bajo' }).success).toBe(false)
  })

  it('el banco admite hasta 100 caracteres', () => {
    expect(schema.safeParse({ bankName: 'a'.repeat(100) }).success).toBe(true)
    expect(schema.safeParse({ bankName: 'a'.repeat(101) }).success).toBe(false)
  })
})

describe('formato y normalización del CBU (AJ2-04)', () => {
  it('cleanCbu deja solo los dígitos', () => {
    expect(cleanCbu('0170 0992-2000.0067 797370')).toBe(CBU)
  })

  it('formatCbu agrupa en 8 y 14 dígitos', () => {
    expect(formatCbu(CBU)).toBe('01700992 20000067797370')
    expect(formatCbu('1234')).toBe('1234')
    expect(formatCbu(null)).toBe('')
  })

  it('formatCbuWhileTyping ignora lo que no es dígito y corta en 22', () => {
    expect(formatCbuWhileTyping('0170-0992 abc 2000')).toBe('01700992 2000')
    expect(formatCbuWhileTyping(`${CBU}999`)).toBe('01700992 20000067797370')
  })
})

describe('del formulario al servidor (AJ2-04)', () => {
  it('manda el CBU solo con dígitos, recorta y pasa los vacíos a null', () => {
    expect(
      bankFormValuesToInput({
        bankName: '  Banco Nación ',
        cbu: '01700992 20000067797370',
        alias: ' mi.alias ',
      }),
    ).toEqual({ bankName: 'Banco Nación', cbu: CBU, alias: 'mi.alias' })
    expect(
      bankFormValuesToInput({ bankName: '', cbu: ' ', alias: '' }),
    ).toEqual({
      bankName: null,
      cbu: null,
      alias: null,
    })
  })

  it('isBankFormEmpty detecta el formulario sin datos bancarios', () => {
    expect(isBankFormEmpty({ bankName: ' ', cbu: '', alias: undefined })).toBe(
      true,
    )
    expect(isBankFormEmpty({ alias: 'mi.alias' })).toBe(false)
  })

  it('bankDetailsToFormValues arma los valores iniciales, con el CBU agrupado', () => {
    expect(
      bankDetailsToFormValues({ bankName: 'Banco', cbu: CBU, alias: null }),
    ).toEqual({ bankName: 'Banco', cbu: '01700992 20000067797370', alias: '' })
    expect(bankDetailsToFormValues(null)).toEqual({
      bankName: '',
      cbu: '',
      alias: '',
    })
  })
})
