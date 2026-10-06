// @vitest-environment node
// DATA-008: pruebas del generador de contraseñas iniciales.

import { describe, expect, it } from 'vitest'
import { ALFABETO, generarContrasena } from './generar.ts'

describe('generarContrasena', () => {
  it('tiene 12 caracteres en tres grupos de cuatro separados por guiones', () => {
    for (let i = 0; i < 500; i++) {
      expect(generarContrasena()).toMatch(
        /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/,
      )
    }
  })

  it('no usa caracteres ambiguos (0, O, 1, l, I, o)', () => {
    expect(ALFABETO).not.toMatch(/[0O1lIo]/)
    for (let i = 0; i < 500; i++) {
      expect(generarContrasena()).not.toMatch(/[0O1lIo]/)
    }
  })

  it('siempre tiene una mayúscula, una minúscula y un número', () => {
    for (let i = 0; i < 1000; i++) {
      const c = generarContrasena()
      expect(c).toMatch(/[A-Z]/)
      expect(c).toMatch(/[a-z]/)
      expect(c).toMatch(/[2-9]/)
    }
  })

  it('no se repite entre corridas (5000 contraseñas, todas distintas)', () => {
    const vistas = new Set<string>()
    for (let i = 0; i < 5000; i++) vistas.add(generarContrasena())
    expect(vistas.size).toBe(5000)
  })

  it('usa todo el alfabeto y reparte los caracteres sin sesgo evidente', () => {
    const cuentas = new Map<string, number>()
    const total = 20_000
    for (let i = 0; i < total; i++) {
      for (const c of generarContrasena().replaceAll('-', '')) {
        cuentas.set(c, (cuentas.get(c) ?? 0) + 1)
      }
    }
    expect(cuentas.size).toBe(ALFABETO.length)
    const esperado = (total * 12) / ALFABETO.length
    for (const n of cuentas.values()) {
      // Tolerancia amplia (±25 %): detecta un sesgo grosero, no es una prueba estadística fina.
      expect(n).toBeGreaterThan(esperado * 0.75)
      expect(n).toBeLessThan(esperado * 1.25)
    }
  })

  it('cumple el mínimo de 8 caracteres de la configuración de Auth', () => {
    expect(generarContrasena().length).toBeGreaterThanOrEqual(8)
  })
})
