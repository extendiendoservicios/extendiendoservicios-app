// scripts/entregar-credenciales/guardas.ts — DATA-008
//
// Resguardos del script de credenciales, todos puros o con acceso mínimo al disco para que los
// tests los ejerciten sin base: la carpeta de salida no puede estar dentro del repositorio, la
// lista de emails se lee con tolerancia y el CSV se arma con comillas y sin fórmulas ejecutables.

import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, resolve, sep } from 'node:path'

export class ErrorDeGuarda extends Error {}

/** Compara rutas sin distinguir mayúsculas en Windows (el disco no las distingue). */
function normalizar(ruta: string): string {
  return process.platform === 'win32' ? ruta.toLowerCase() : ruta
}

/** Resuelve enlaces simbólicos y uniones de la parte de la ruta que ya existe. */
function rutaReal(ruta: string): string {
  const completa = resolve(ruta)
  let existente = completa
  const faltantes: string[] = []
  while (!existsSync(existente)) {
    const padre = dirname(existente)
    if (padre === existente) return completa
    faltantes.unshift(basename(existente))
    existente = padre
  }
  return resolve(realpathSync(existente), ...faltantes)
}

function estaDentroDe(ruta: string, base: string): boolean {
  const r = normalizar(ruta)
  const b = normalizar(base)
  return r === b || r.startsWith(b.endsWith(sep) ? b : b + sep)
}

/**
 * Valida la carpeta donde se escribe el CSV con las contraseñas y devuelve su ruta absoluta
 * (sin crearla). Se rechaza si cae dentro de `app/` (el repositorio, que es público) o dentro
 * de cualquier carpeta que tenga un `.git` más arriba: un CSV con contraseñas no puede quedar
 * donde un `git add` lo alcance.
 */
export function validarCarpetaDeSalida(
  carpeta: string | undefined,
  dirApp: string,
): string {
  if (carpeta === undefined || carpeta.trim() === '') {
    throw new ErrorDeGuarda(
      'Falta --salida <carpeta>: indicá una carpeta FUERA del repositorio donde guardar el archivo con las contraseñas.',
    )
  }
  const destino = rutaReal(carpeta)
  if (estaDentroDe(destino, rutaReal(dirApp))) {
    throw new ErrorDeGuarda(
      'La carpeta de salida está dentro del repositorio (app/). Las contraseñas no pueden quedar ahí: elegí una carpeta de afuera.',
    )
  }
  let actual = destino
  for (;;) {
    if (existsSync(resolve(actual, '.git'))) {
      throw new ErrorDeGuarda(
        'La carpeta de salida está dentro de un repositorio git. Las contraseñas no pueden quedar ahí: elegí una carpeta de afuera.',
      )
    }
    const padre = dirname(actual)
    if (padre === actual) break
    actual = padre
  }
  return destino
}

/**
 * Lee la lista de emails de un texto: uno por línea (o separados por coma o punto y coma). Se
 * ignoran las líneas vacías y las que empiezan con `#`. Se pasan a minúsculas y se quitan los
 * repetidos. Devuelve también los renglones que no parecen un email.
 */
export function leerEmails(contenido: string): {
  emails: string[]
  invalidos: number[]
} {
  const vistos = new Set<string>()
  const emails: string[] = []
  const invalidos: number[] = []
  contenido.split(/\r?\n/).forEach((linea, indice) => {
    const limpia = linea.replace(/^\uFEFF/, '').trim()
    if (limpia === '' || limpia.startsWith('#')) return
    for (const parte of limpia.split(/[;,]/)) {
      const email = parte.trim().toLowerCase()
      if (email === '') continue
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        invalidos.push(indice + 1)
        continue
      }
      if (!vistos.has(email)) {
        vistos.add(email)
        emails.push(email)
      }
    }
  })
  return { emails, invalidos }
}

/**
 * Una celda del CSV. Separador `;` (Excel en español lo abre en columnas), siempre entre
 * comillas, y si empieza con `=`, `+`, `-` o `@` se le antepone un apóstrofe para que Excel no
 * lo tome por una fórmula (los nombres vienen de la planilla de la empresa).
 */
export function celdaCsv(valor: string): string {
  const seguro = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor
  return `"${seguro.replaceAll('"', '""')}"`
}

export function filaCsv(valores: string[]): string {
  return valores.map(celdaCsv).join(';')
}
