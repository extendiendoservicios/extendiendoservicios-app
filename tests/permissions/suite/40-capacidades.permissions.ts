// tests/permissions/suite/40-capacidades.permissions.ts — TEST-019 (P18.3)
//
// Las siete capacidades del administrador, UNA POR UNA (`03_Plan_Maestro_Tecnico.md` sección 5 y
// 6; ADR-006): con la capacidad, la acción pasa la puerta; sin ella, `FORBIDDEN`. El dueño las
// cambia con `set_admin_capability` sobre la cuenta `admin-capacidades` y esa cuenta RENUEVA su
// sesión para que el hook de Auth emita un token con los claims nuevos (los claims viajan en el
// JWT: un cambio recién se ve al renovar). Cubre RB-A01 (efecto en API de cada capacidad),
// RB-X02, flujo crítico 2 de `03` sección 14.2 y CB-17.
//
// Al terminar, la suite deja las siete capacidades habilitadas otra vez (y el `globalSetup`
// las repone igual al cierre).

import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../../../src/lib/database.types.ts'
import {
  ADMIN_CAPABILITIES,
  type AdminCapability,
} from '../../fixtures/accounts.ts'
import { requireE2eEnv } from '../../fixtures/env.ts'
import { clienteDe, contexto, servicio, type Db } from './contexto.ts'
import { llamarEdge } from './edge-cliente.ts'
import { denegado, filas, tabla } from './ayudas.ts'
import { INEXISTENTE } from './rpc.ts'

interface Prueba {
  nombre: string
  /** Ejecuta la acción con la sesión del administrador y devuelve el código observado. */
  ejecutar: (sesion: Db, token: string) => Promise<string>
  /** Qué devuelve cuando la capacidad está HABILITADA (pasó la puerta). */
  conCapacidad: string
}

async function rpc(
  sesion: Db,
  nombre: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { error } = await sesion.rpc(
    nombre as 'mark_changes_seen',
    args as never,
  )
  return error
    ? error.code === '42501'
      ? '42501'
      : (error.hint ?? error.code)
    : 'OK'
}

const PRUEBAS: Record<AdminCapability, Prueba[]> = {
  manage_users: [
    {
      nombre: 'set_user_roles',
      ejecutar: (s) =>
        rpc(s, 'set_user_roles', {
          p_profile_id: INEXISTENTE,
          p_roles: ['employee'],
        }),
      conCapacidad: 'PROFILE_NOT_FOUND',
    },
    {
      nombre: 'insert en employees (alta de ficha)',
      ejecutar: async (s) => {
        const c = contexto()
        const res = await tabla(s, 'employees')
          .insert({
            profile_id: c.ids.adminSin,
            dni: `97${Date.now().toString().slice(-6)}`,
          })
          .select()
        // Se limpia lo que se haya creado.
        for (const f of filas(res)) {
          await servicio()
            .from('employees')
            .delete()
            .eq('profile_id', String(f.profile_id))
        }
        return denegado(res) ? 'FORBIDDEN' : 'OK'
      },
      conCapacidad: 'OK',
    },
    {
      nombre: 'admin-users create_user',
      ejecutar: async (_s, token) => {
        const r = await llamarEdge(token, {
          action: 'create_user',
          email: 'e2e-perm-nunca@example.com',
          password: 'Passw0rd-e2e-perm',
          first_name: 'E',
          last_name: 'P',
          roles: ['employee'],
        })
        return r.hint
      },
      conCapacidad: 'EMPLOYEE_DATA_REQUIRED',
    },
    {
      nombre: 'admin-users reset_password',
      ejecutar: async (_s, token) =>
        (
          await llamarEdge(token, {
            action: 'reset_password',
            profile_id: INEXISTENTE,
            new_password: 'Passw0rd-e2e-perm',
          })
        ).hint,
      conCapacidad: 'PROFILE_NOT_FOUND',
    },
  ],
  cancel_shifts: [
    {
      nombre: 'cancel_shift',
      ejecutar: (s) =>
        rpc(s, 'cancel_shift', {
          p_shift_id: INEXISTENTE,
          p_reason: 'e2e-perm',
        }),
      conCapacidad: 'SHIFT_NOT_FOUND',
    },
  ],
  edit_ratings: [
    {
      nombre: 'rate_employee (edición de una calificación ajena)',
      ejecutar: (s) => {
        const e = contexto().e
        return rpc(s, 'rate_employee', {
          p_supervision_id: e.supA,
          p_assignment_id: e.asigE1,
          p_score: 9,
        })
      },
      conCapacidad: 'SCORE_OUT_OF_RANGE',
    },
  ],
  edit_checklists: [
    {
      nombre: 'reload_shift_tasks',
      ejecutar: (s) =>
        rpc(s, 'reload_shift_tasks', { p_shift_id: INEXISTENTE }),
      conCapacidad: 'SHIFT_NOT_FOUND',
    },
    {
      nombre: 'clone_checklist_template',
      ejecutar: (s) =>
        rpc(s, 'clone_checklist_template', {
          p_client_id: INEXISTENTE,
          p_site_id: INEXISTENTE,
        }),
      conCapacidad: 'CLIENT_NOT_ACTIVE',
    },
    {
      nombre: 'insert en checklist_templates',
      ejecutar: async (s) => {
        const c = contexto()
        const res = await tabla(s, 'checklist_templates')
          .insert({
            client_id: c.e.clienteB,
            name: `e2e-perm-plantilla-${randomUUID().slice(0, 6)}`,
          })
          .select()
        for (const f of filas(res)) {
          await servicio()
            .from('checklist_templates')
            .delete()
            .eq('id', String(f.id))
        }
        return denegado(res) ? 'FORBIDDEN' : 'OK'
      },
      conCapacidad: 'OK',
    },
  ],
  manage_attendance: [
    {
      nombre: 'admin_record_attendance',
      ejecutar: (s) =>
        rpc(s, 'admin_record_attendance', {
          p_assignment_id: INEXISTENTE,
          p_kind: 'check_in',
          p_reason: 'e2e-perm',
        }),
      conCapacidad: 'ASSIGNMENT_NOT_FOUND',
    },
    {
      nombre: 'close_assignment',
      ejecutar: (s) =>
        rpc(s, 'close_assignment', {
          p_assignment_id: INEXISTENTE,
          p_reason: 'e2e-perm',
        }),
      conCapacidad: 'ASSIGNMENT_NOT_FOUND',
    },
    {
      nombre: 'notify_delay en nombre de un empleado',
      ejecutar: (s) =>
        rpc(s, 'notify_delay', {
          p_assignment_id: contexto().e.asigE1,
          p_minutes: 0,
        }),
      conCapacidad: 'MINUTES_REQUIRED',
    },
    {
      nombre: 'notify_absence en nombre de un empleado',
      ejecutar: (s) =>
        rpc(s, 'notify_absence', {
          p_assignment_id: contexto().e.asigE1,
          p_reason_code: 'other',
        }),
      conCapacidad: 'REASON_REQUIRED',
    },
  ],
  generate_shifts: [
    {
      nombre: 'generate_shifts',
      // Mes 13: se rechaza después de la puerta y no genera nada.
      ejecutar: (s) => rpc(s, 'generate_shifts', { p_year: 2099, p_month: 13 }),
      conCapacidad: '22008',
    },
  ],
  manage_supervisions: [
    {
      nombre: 'assign_supervision',
      ejecutar: (s) =>
        rpc(s, 'assign_supervision', {
          p_shift_id: INEXISTENTE,
          p_supervisor_id: INEXISTENTE,
        }),
      conCapacidad: 'SHIFT_NOT_FOUND',
    },
    {
      nombre: 'cancel_supervision',
      ejecutar: (s) =>
        rpc(s, 'cancel_supervision', {
          p_supervision_id: INEXISTENTE,
          p_reason: 'e2e-perm',
        }),
      conCapacidad: 'SUPERVISION_NOT_FOUND',
    },
  ],
}

describe('capacidades del administrador, una por una', () => {
  let sesion: Db
  let dueno: Db
  let tokenActual = ''

  async function fijar(capacidad: AdminCapability, habilitada: boolean) {
    const { error } = await dueno.rpc('set_admin_capability', {
      p_profile_id: contexto().ids.adminCapacidades,
      p_capability: capacidad,
      p_enabled: habilitada,
    })
    expect(error, error?.message).toBeNull()
    // Renovar: el hook de Auth emite el token con los claims nuevos.
    const { data, error: errorRenovar } = await sesion.auth.refreshSession()
    expect(errorRenovar, errorRenovar?.message).toBeNull()
    tokenActual = data.session?.access_token ?? ''
    expect(tokenActual).not.toBe('')
  }

  beforeAll(async () => {
    const env = requireE2eEnv()
    dueno = clienteDe('owner')
    sesion = createClient<Database>(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const c = contexto()
    const { error } = await sesion.auth.setSession({
      access_token: c.tokens.adminCapacidades,
      refresh_token: c.refreshAdminCapacidades,
    })
    expect(error, error?.message).toBeNull()
    // Punto de partida: las siete habilitadas, con un token fresco.
    for (const capacidad of ADMIN_CAPABILITIES) {
      await dueno.rpc('set_admin_capability', {
        p_profile_id: c.ids.adminCapacidades,
        p_capability: capacidad,
        p_enabled: true,
      })
    }
    await sesion.auth.refreshSession()
  })

  afterAll(async () => {
    const c = contexto()
    for (const capacidad of ADMIN_CAPABILITIES) {
      await dueno.rpc('set_admin_capability', {
        p_profile_id: c.ids.adminCapacidades,
        p_capability: capacidad,
        p_enabled: true,
      })
    }
  })

  for (const capacidad of ADMIN_CAPABILITIES) {
    describe(`capacidad ${capacidad}`, () => {
      it(`sin ${capacidad}: todas sus acciones dan FORBIDDEN (RB-A01, RB-X02, CB-17)`, async () => {
        await fijar(capacidad, false)
        for (const prueba of PRUEBAS[capacidad]) {
          const observado = await prueba.ejecutar(sesion, tokenActual)
          expect(observado, `${prueba.nombre} sin ${capacidad}`).toBe(
            'FORBIDDEN',
          )
        }
      })

      it(`con ${capacidad}: sus acciones pasan la puerta (RB-A01, RB-X02)`, async () => {
        await fijar(capacidad, true)
        for (const prueba of PRUEBAS[capacidad]) {
          const observado = await prueba.ejecutar(sesion, tokenActual)
          expect(observado, `${prueba.nombre} con ${capacidad}`).toBe(
            prueba.conCapacidad,
          )
        }
      })
    })
  }

  it('el efecto de una capacidad no se filtra a otras (solo se apaga la que se apagó) (RB-X02)', async () => {
    await fijar('cancel_shifts', false)
    // Con `cancel_shifts` apagada, las demás siguen funcionando.
    expect(await PRUEBAS.generate_shifts[0].ejecutar(sesion, tokenActual)).toBe(
      '22008',
    )
    expect(await PRUEBAS.cancel_shifts[0].ejecutar(sesion, tokenActual)).toBe(
      'FORBIDDEN',
    )
    await fijar('cancel_shifts', true)
  })
})
