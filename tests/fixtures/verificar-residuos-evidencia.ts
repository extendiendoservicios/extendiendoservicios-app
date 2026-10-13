// tests/fixtures/verificar-residuos-evidencia.ts — TEST-030 (P21.6)
//
// Verifica con la clave de servicio que las pruebas de evidencia no dejaron residuos en App_dev:
// 0 filas en `shift_media`, 0 objetos en el bucket `evidence` y 0 clientes `e2e-` activos. Solo lee.
//
//   node --env-file=.env.local tests/fixtures/verificar-residuos-evidencia.ts

import { getAdminDb } from './accounts.ts'
import { readE2eEnv } from './env.ts'
import { objetosDeEvidencia } from './media.ts'

if (!readE2eEnv()) {
  console.error('Faltan las variables de .env.local.')
  process.exit(2)
}
const db = getAdminDb()
const filas = await db
  .from('shift_media')
  .select('id', { count: 'exact', head: true })
const objetos = await objetosDeEvidencia(db)
// Los clientes con baja lógica son residuos viejos que la base no dejó borrar (tienen historia):
// no son de esta corrida, se informan aparte.
const clientes = await db
  .from('clients')
  .select('id', { count: 'exact', head: true })
  .like('legal_name', 'e2e-%')
  .is('deleted_at', null)
const conBaja = await db
  .from('clients')
  .select('id', { count: 'exact', head: true })
  .like('legal_name', 'e2e-%')
  .not('deleted_at', 'is', null)
const resumen = {
  shift_media: filas.count ?? `error: ${filas.error?.message}`,
  objetos_evidence: objetos.length,
  clientes_e2e_activos: clientes.count ?? `error: ${clientes.error?.message}`,
  clientes_e2e_con_baja_logica_viejos: conBaja.count ?? 'error',
}
console.log(JSON.stringify(resumen))
process.exit(
  resumen.shift_media === 0 &&
    resumen.objetos_evidence === 0 &&
    resumen.clientes_e2e_activos === 0
    ? 0
    : 1,
)
