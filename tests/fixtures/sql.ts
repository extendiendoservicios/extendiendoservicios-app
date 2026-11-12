// tests/fixtures/sql.ts — P28.7
//
// Ejecuta una sentencia SQL en App_dev con la CLI de Supabase (`supabase db query --linked`), para lo
// que PostgREST no expone: por ejemplo `app.auto_close_assignments()` (OF-11), que es la función
// que corre el cron cada 15 minutos y no tiene `execute` para ningún rol de la API. Igual que la
// purga de Insumos (`stock.ts`), antes de ejecutar verifica que el proyecto vinculado de la CLI sea
// el de `VITE_SUPABASE_URL` y que nunca sea producción.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireE2eEnv } from './env.ts'

const RAIZ = fileURLToPath(new URL('../..', import.meta.url))
const REF_PRODUCCION = 'fysuppdadwvabrjpnnoh'

function verificarProyecto(): void {
  const ref = new URL(requireE2eEnv().supabaseUrl).hostname.split('.')[0]
  if (ref === REF_PRODUCCION) {
    throw new Error('Este SQL no corre contra producción.')
  }
  const archivo = path.join(RAIZ, 'supabase', '.temp', 'project-ref')
  const vinculado = existsSync(archivo)
    ? readFileSync(archivo, 'utf8').trim()
    : ''
  if (vinculado !== ref) {
    throw new Error(
      `El proyecto vinculado de la CLI (${vinculado || 'ninguno'}) no es el de VITE_SUPABASE_URL (${ref}): no se ejecuta nada.`,
    )
  }
}

/** Ejecuta `sql` en App_dev y devuelve la salida de la CLI (JSON con las filas). */
export function ejecutarSqlEnAppDev(sql: string): string {
  verificarProyecto()
  const archivo = path.join(
    os.tmpdir(),
    `p28-sql-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}.sql`,
  )
  writeFileSync(archivo, sql, 'utf8')
  try {
    const cli = path.join(
      RAIZ,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
    )
    return execSync(`"${cli}" db query --linked -f "${archivo}"`, {
      cwd: RAIZ,
      stdio: 'pipe',
      timeout: 120_000,
    }).toString('utf8')
  } finally {
    unlinkSync(archivo)
  }
}
