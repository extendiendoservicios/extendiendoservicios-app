// scripts/entregar-credenciales/generar.ts — DATA-008
//
// Generador de contraseñas iniciales. Formato: 12 caracteres en tres grupos de cuatro separados
// por guiones (por ejemplo `Kq7m-Xw3p-Tn9d`), fáciles de dictar o de leer en un papel. El
// alfabeto no tiene caracteres ambiguos (sin 0, O, 1, l, I). Usa `node:crypto` (`randomInt` elige
// con distribución uniforme, sin sesgo de módulo) y garantiza al menos una mayúscula, una
// minúscula y un número.

import { randomInt } from 'node:crypto'

const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // sin I ni O
const MINUSCULAS = 'abcdefghijkmnpqrstuvwxyz' // sin l ni o
const NUMEROS = '23456789' // sin 0 ni 1

export const ALFABETO = `${MAYUSCULAS}${MINUSCULAS}${NUMEROS}`
export const GRUPOS = 3
export const LARGO_GRUPO = 4

/** Los tres tipos de caracteres que tiene que tener cada contraseña. */
function tieneTodosLosTipos(caracteres: string): boolean {
  return (
    [...caracteres].some((c) => MAYUSCULAS.includes(c)) &&
    [...caracteres].some((c) => MINUSCULAS.includes(c)) &&
    [...caracteres].some((c) => NUMEROS.includes(c))
  )
}

/** Una contraseña nueva con el formato `XXXX-XXXX-XXXX`. */
export function generarContrasena(): string {
  for (;;) {
    const caracteres = Array.from(
      { length: GRUPOS * LARGO_GRUPO },
      () => ALFABETO[randomInt(ALFABETO.length)],
    ).join('')
    if (!tieneTodosLosTipos(caracteres)) continue
    const grupos: string[] = []
    for (let i = 0; i < GRUPOS; i++) {
      grupos.push(caracteres.slice(i * LARGO_GRUPO, (i + 1) * LARGO_GRUPO))
    }
    return grupos.join('-')
  }
}
