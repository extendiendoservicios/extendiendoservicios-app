// tests/permissions/suite/edge-casos.ts — TEST-019 (P18.3)
//
// Casos de la Edge Function `admin-users` por acción y perfil (esperado de `06_API.md`
// sección 2.1). Los usa `60-edge.permissions.ts` y los cuenta el inventario.

import type { Contexto } from './contexto.ts'
import { INEXISTENTE } from './rpc.ts'
import type { Perfil } from './perfiles.ts'

export interface CasoEdge {
  accion: string
  cuerpo: (c: Contexto) => Record<string, unknown>
  /** Código esperado por perfil. */
  esperado: Record<Perfil, string>
  cubre: string[]
}

function esperado(
  pasan: Partial<Record<Perfil, string>>,
): Record<Perfil, string> {
  return {
    anon: 'UNAUTHENTICATED',
    empleado: 'FORBIDDEN',
    supervisor: 'FORBIDDEN',
    dual: 'FORBIDDEN',
    adminSin: 'FORBIDDEN',
    admin: 'FORBIDDEN',
    owner: 'FORBIDDEN',
    ...pasan,
  }
}

const ADMIN_Y_DUENO = (hint: string) => ({ admin: hint, owner: hint })

export const CASOS: CasoEdge[] = [
  {
    accion: 'create_user',
    cuerpo: () => ({
      action: 'create_user',
      email: 'e2e-perm-nunca@example.com',
      password: 'Passw0rd-e2e-perm',
      first_name: 'E',
      last_name: 'P',
      roles: ['employee'],
    }),
    esperado: esperado(ADMIN_Y_DUENO('EMPLOYEE_DATA_REQUIRED')),
    cubre: ['RB-A01', 'RB-A02', 'RB-X02'],
  },
  {
    accion: 'reset_password',
    cuerpo: () => ({
      action: 'reset_password',
      profile_id: INEXISTENTE,
      new_password: 'Passw0rd-e2e-perm',
    }),
    esperado: esperado(ADMIN_Y_DUENO('PROFILE_NOT_FOUND')),
    cubre: ['RB-A02', 'RB-X02'],
  },
  {
    accion: 'update_email',
    cuerpo: () => ({
      action: 'update_email',
      profile_id: INEXISTENTE,
      email: 'e2e-perm-nunca@example.com',
    }),
    esperado: esperado(ADMIN_Y_DUENO('PROFILE_NOT_FOUND')),
    cubre: ['RB-A02', 'RB-X02'],
  },
  {
    accion: 'sign_out_user',
    cuerpo: () => ({ action: 'sign_out_user', profile_id: INEXISTENTE }),
    // Hoy responde 200 y deja un evento `sessions_revoked` aunque la persona no exista
    // (DEF-P08, ver `defectos.ts`).
    esperado: esperado(ADMIN_Y_DUENO('PROFILE_NOT_FOUND')),
    cubre: ['RB-A02', 'RB-X02', 'P-015'],
  },
  {
    accion: 'deactivate_user',
    cuerpo: () => ({
      action: 'deactivate_user',
      profile_id: INEXISTENTE,
      reason: 'e2e-perm',
    }),
    esperado: esperado(ADMIN_Y_DUENO('PROFILE_NOT_FOUND')),
    cubre: ['RB-A02', 'RB-X02'],
  },
  {
    // Reactivar es solo del dueño: ni el administrador con `manage_users`.
    accion: 'reactivate_user',
    cuerpo: () => ({ action: 'reactivate_user', profile_id: INEXISTENTE }),
    esperado: esperado({ owner: 'PROFILE_NOT_FOUND' }),
    cubre: ['RB-A01', 'RB-X02'],
  },
]
