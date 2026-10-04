// tests/permissions/suite/inventario.ts — TEST-019 (P18.3)
//
// Inventario de lo que hay que proteger, SACADO DE LAS MIGRACIONES (`supabase/migrations/`) y no
// de memoria: tablas y vistas de `public`, funciones de `public` con sus grants de `execute`,
// buckets de Storage y Edge Functions con sus acciones. El test de inventario compara esto con
// lo que cubre la matriz y falla si aparece algo nuevo sin casos (y también si la matriz nombra
// algo que ya no existe): así la matriz no queda vieja.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('../../..', import.meta.url))
const MIGRACIONES = path.join(RAIZ, 'supabase', 'migrations')
const FUNCIONES = path.join(RAIZ, 'supabase', 'functions')

export interface FuncionPublica {
  nombre: string
  /** Tiene `grant execute ... to authenticated`. */
  authenticated: boolean
  /** Tiene `grant execute ... to service_role` (y no a authenticated). */
  soloServicio: boolean
  /** Algún `revoke execute` le saca el permiso a `anon` (y a `public`). */
  revocadaAAnon: boolean
}

export interface InventarioMigraciones {
  tablas: string[]
  vistas: string[]
  funciones: FuncionPublica[]
  buckets: string[]
  edge: Array<{ nombre: string; acciones: string[] }>
  /** Cantidad de archivos de migración leídos (para el mensaje de falla). */
  archivos: number
}

/** Texto de las migraciones sin las líneas de comentario completas (`-- ...`). */
function sqlSinComentarios(archivo: string): string {
  return readFileSync(path.join(MIGRACIONES, archivo), 'utf8')
    .split(/\r?\n/)
    .filter((linea) => !/^\s*--/.test(linea))
    .join('\n')
}

export function leerInventario(): InventarioMigraciones {
  const archivos = readdirSync(MIGRACIONES)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
  const tablas = new Set<string>()
  const vistas = new Set<string>()
  const funciones = new Map<string, FuncionPublica>()
  const buckets = new Set<string>()

  const funcion = (nombre: string): FuncionPublica => {
    let f = funciones.get(nombre)
    if (!f) {
      f = {
        nombre,
        authenticated: false,
        soloServicio: false,
        revocadaAAnon: false,
      }
      funciones.set(nombre, f)
    }
    return f
  }

  for (const archivo of archivos) {
    const sql = sqlSinComentarios(archivo)
    for (const m of sql.matchAll(/^create\s+table\s+public\.(\w+)/gim)) {
      tablas.add(m[1])
    }
    for (const m of sql.matchAll(
      /^drop\s+table\s+(?:if\s+exists\s+)?public\.(\w+)/gim,
    )) {
      tablas.delete(m[1])
    }
    for (const m of sql.matchAll(
      /^create\s+(?:or\s+replace\s+)?view\s+public\.(\w+)/gim,
    )) {
      vistas.add(m[1])
    }
    for (const m of sql.matchAll(
      /^drop\s+view\s+(?:if\s+exists\s+)?public\.(\w+)/gim,
    )) {
      vistas.delete(m[1])
    }
    for (const m of sql.matchAll(
      /^create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gim,
    )) {
      funcion(m[1])
    }
    for (const m of sql.matchAll(
      /^drop\s+function\s+(?:if\s+exists\s+)?public\.(\w+)/gim,
    )) {
      funciones.delete(m[1])
    }
    for (const m of sql.matchAll(
      /^grant\s+execute\s+on\s+function\s+public\.(\w+)\([^;]*?\)\s+to\s+([^;]+);/gim,
    )) {
      const f = funcion(m[1])
      const a = m[2]
      if (/\bauthenticated\b/.test(a)) f.authenticated = true
      if (/\bservice_role\b/.test(a)) f.soloServicio = true
    }
    for (const m of sql.matchAll(
      /^revoke\s+execute\s+on\s+function\s+public\.(\w+)\([^;]*?\)\s+from\s+([^;]+);/gim,
    )) {
      const f = funcion(m[1])
      if (/\banon\b/.test(m[2]) && /\bpublic\b/.test(m[2]))
        f.revocadaAAnon = true
    }
    for (const m of sql.matchAll(
      /storage\.buckets[^;]*?values\s*\(\s*'(\w+)'/gim,
    )) {
      buckets.add(m[1])
    }
  }

  for (const f of funciones.values()) {
    if (f.authenticated) f.soloServicio = false
  }

  const edge: InventarioMigraciones['edge'] = []
  if (existsSync(FUNCIONES)) {
    for (const entrada of readdirSync(FUNCIONES, { withFileTypes: true })) {
      if (!entrada.isDirectory() || entrada.name.startsWith('_')) continue
      const indice = path.join(FUNCIONES, entrada.name, 'index.ts')
      if (!existsSync(indice)) continue
      const codigo = readFileSync(indice, 'utf8')
      const bloque =
        /const\s+ACTIONS[\s\S]*?>\s*=\s*\{([^}]*)\}/m.exec(codigo)?.[1] ?? ''
      const acciones = [...bloque.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1])
      edge.push({ nombre: entrada.name, acciones })
    }
  }

  return {
    tablas: [...tablas].sort(),
    vistas: [...vistas].sort(),
    funciones: [...funciones.values()].sort((a, b) =>
      a.nombre.localeCompare(b.nombre),
    ),
    buckets: [...buckets].sort(),
    edge,
    archivos: archivos.length,
  }
}
