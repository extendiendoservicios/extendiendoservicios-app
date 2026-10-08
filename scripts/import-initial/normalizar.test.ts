// @vitest-environment node
// DATA-005: pruebas unitarias de la lectura de celdas (sin Excel ni base).

import { describe, expect, it } from 'vitest'
import {
  claveNorm,
  emailValido,
  parsearEntero,
  parsearFecha,
  parsearHora,
  parsearLista,
  parsearNumero,
  parsearSiNo,
  soloDigitos,
  texto,
  verificadorValido,
} from './normalizar.ts'
import { cuitValido, horaExcel } from './pruebas/planilla-ficticia.ts'

describe('claveNorm', () => {
  it('no distingue mayúsculas ni espacios de más', () => {
    expect(claveNorm('  Limpiezas   DEL Sur ')).toBe('limpiezas del sur')
  })
  it('sí distingue tildes', () => {
    expect(claveNorm('Muñoz')).not.toBe(claveNorm('Munoz'))
  })
})

describe('texto', () => {
  it('convierte números enteros sin decimales (teléfonos, DNI, CUIT cargados como número)', () => {
    expect(texto(1155551111)).toBe('1155551111')
    expect(texto(30712345678)).toBe('30712345678')
  })
  it('recorta espacios y trata el vacío como null', () => {
    expect(texto('  hola ')).toBe('hola')
    expect(texto('   ')).toBeNull()
    expect(texto(null)).toBeNull()
  })
})

describe('soloDigitos', () => {
  it('quita puntos, guiones y espacios', () => {
    expect(soloDigitos('30-71234567-8')).toBe('30712345678')
    expect(soloDigitos('30.111.222')).toBe('30111222')
  })
})

describe('parsearFecha', () => {
  it('acepta fechas de Excel, texto DD/MM/AAAA y AAAA-MM-DD', () => {
    expect(parsearFecha(new Date(Date.UTC(1990, 2, 15)))).toEqual({
      ok: true,
      valor: '1990-03-15',
    })
    expect(parsearFecha('05/03/2026')).toEqual({
      ok: true,
      valor: '2026-03-05',
    })
    expect(parsearFecha('2026-03-05')).toEqual({
      ok: true,
      valor: '2026-03-05',
    })
  })
  it('acepta un número de serie de Excel', () => {
    // Días desde el 30/12/1899, como cuenta Excel.
    const serie = Math.round(
      (Date.UTC(2026, 2, 5) - Date.UTC(1899, 11, 30)) / 86_400_000,
    )
    expect(parsearFecha(serie)).toEqual({ ok: true, valor: '2026-03-05' })
  })
  it('rechaza días que no existen y textos sueltos', () => {
    expect(parsearFecha('31/02/2026').ok).toBe(false)
    expect(parsearFecha('mañana').ok).toBe(false)
    expect(parsearFecha('05/03/26').ok).toBe(false)
  })
  it('vacío es válido y da null', () => {
    expect(parsearFecha(null)).toEqual({ ok: true, valor: null })
  })
})

describe('parsearHora', () => {
  it('acepta horas de Excel, fracciones del día y texto', () => {
    expect(parsearHora(horaExcel(7, 30))).toEqual({ ok: true, valor: '07:30' })
    expect(parsearHora(0.5)).toEqual({ ok: true, valor: '12:00' })
    expect(parsearHora('7:05')).toEqual({ ok: true, valor: '07:05' })
    expect(parsearHora('18:00:00')).toEqual({ ok: true, valor: '18:00' })
  })
  it('rechaza 24:00 y horas inexistentes', () => {
    expect(parsearHora('24:00').ok).toBe(false)
    expect(parsearHora('12:60').ok).toBe(false)
    expect(parsearHora('tarde').ok).toBe(false)
  })
})

describe('números, Sí/No y listas', () => {
  it('parsearNumero acepta coma decimal', () => {
    expect(parsearNumero('12,5')).toEqual({ ok: true, valor: 12.5 })
    expect(parsearNumero('abc').ok).toBe(false)
  })
  it('parsearEntero rechaza decimales', () => {
    expect(parsearEntero(3)).toEqual({ ok: true, valor: 3 })
    expect(parsearEntero(2.5).ok).toBe(false)
  })
  it('parsearSiNo acepta Sí, Si y No sin importar mayúsculas', () => {
    expect(parsearSiNo('Sí')).toEqual({ ok: true, valor: true })
    expect(parsearSiNo('SI')).toEqual({ ok: true, valor: true })
    expect(parsearSiNo('no')).toEqual({ ok: true, valor: false })
    expect(parsearSiNo('quizás').ok).toBe(false)
    expect(parsearSiNo(null)).toEqual({ ok: true, valor: null })
  })
  it('parsearLista reconoce la etiqueta sin tildes ni mayúsculas', () => {
    const etiquetas = { activo: 'active', baja: 'closed' } as const
    expect(parsearLista(' ACTIVO ', etiquetas)).toEqual({
      ok: true,
      valor: 'active',
    })
    expect(parsearLista('Suspendido', etiquetas).ok).toBe(false)
  })
})

describe('verificadorValido', () => {
  it('acepta un CUIT con el dígito correcto y rechaza uno con el dígito cambiado', () => {
    const bueno = cuitValido('3071234567')
    expect(verificadorValido(bueno)).toBe(true)
    const malo = bueno.slice(0, 10) + String((Number(bueno[10]) + 1) % 10)
    expect(verificadorValido(malo)).toBe(false)
  })
  it('rechaza lo que no tiene 11 dígitos', () => {
    expect(verificadorValido('123')).toBe(false)
  })
})

describe('emailValido', () => {
  it('pide arroba y dominio', () => {
    expect(emailValido('ana@prueba.test')).toBe(true)
    expect(emailValido('ana@ejemplo')).toBe(false)
    expect(emailValido('ana ejemplo@test.com')).toBe(false)
  })
})
