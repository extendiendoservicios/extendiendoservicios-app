// tests/permissions/suite/98-personal-administrativo.permissions.ts — P26.9 (módulo P26, CR-16 a CR-19)
//
// Personal administrativo, por API directa contra App_dev (sin pantallas):
//   1. `add_employee_record` (0076, CR-18): el dueño completa la ficha de un admin sin ficha; el
//      admin con todas las capacidades recibe FORBIDDEN; sobre quien ya es empleado,
//      ALREADY_EMPLOYEE; con un DNI repetido, DNI_IN_USE.
//   2. Alta (`create_user` de `admin-users`, CR-17): admin o dueño sin `employee` en el cuerpo es
//      EMPLOYEE_DATA_REQUIRED; con la ficha, el alta suma el rol `employee`.
//   3. Baja (CR-19, trigger `trg_guard_employee_termination`) y edición de la ficha de un dueño o
//      de otro admin por PostgREST.
//   4. P26.7b (0077): un dueño o admin con rol `employee` y una asignación propia avisa una demora
//      como titular (origen `employee_app`).
//
// Cuentas (todas `e2e-p26-*@example.com`, contraseña del seed; nada se borra de Auth, P-014):
//   - `e2e-p26-owner`, `e2e-p26-admin`, `e2e-p26-empleado`: las crea y las restaura 97-credenciales.
//     Acá se las busca por email (si faltan se crean con `service_role`). El dueño y el admin NO
//     tienen ficha: para CR-19 y P26.7b se les planta una ficha temporal con `service_role` (DNI
//     99260101 y 99260102) y se la quita al final, con su rol `employee`.
//   - `e2e-p26-admin-sin-ficha-1`: administrador SIN ficha, creado con `service_role` (Auth + perfil
//     por el trigger + solo los roles `admin` y las capacidades, sin ficha ni rol `employee`, porque
//     desde 0076 el alta por la función ya trae ficha). Es REUTILIZABLE: la prueba exitosa le agrega
//     la ficha (DNI 99260201) y el `finally` la quita junto con el rol `employee`, así que la misma
//     cuenta sirve para todas las corridas y no se consume ninguna.
//   - `e2e-p26-alta-admin-<sufijo>`: la que crea la prueba de alta (CR-17). No hay cómo borrarla:
//     CADA CORRIDA CONSUME UNA CUENTA (una sola). Se la desactiva al terminar.
//
// Datos propios que se borran al final: fichas temporales, disponibilidad, licencia y nota de la
// ficha del dueño, el turno y las asignaciones de P26.7b, y los eventos `roles_changed` que dejó
// esta suite sobre las cuentas propias.

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { daysFromToday } from '../../fixtures/dates.ts'
import {
  ADMIN_CAPABILITIES,
  getAdminDb,
  loadAuthUserIds,
  type AppRole,
} from '../../fixtures/accounts.ts'
import { readE2eEnv, requireE2eEnv } from '../../fixtures/env.ts'
import { deleteClientDeep } from '../../fixtures/scenario.ts'
import { esLimiteDeTasa } from '../../fixtures/sessions.ts'
import { denegado, describir, filas, tabla } from './ayudas.ts'
import { clienteDe, contexto, servicio, tokenVigente } from './contexto.ts'
import { llamarEdge } from './edge-cliente.ts'
import type { Db } from './contexto.ts'

const DNI_FICHA_DUENO = '99260101'
const DNI_FICHA_ADMIN = '99260102'
const DNI_COMPLETAR = '99260201'
const DNI_EMPLEADO_P26 = '99260001' // ficha de e2e-p26-empleado (97-credenciales)
const DNI_ALTA = `9927${Math.floor(Math.random() * 1e4)
  .toString()
  .padStart(4, '0')}`

const sufijo = Math.random().toString(36).slice(2, 8)
const desde = new Date(Date.now() - 60_000).toISOString()
const emailDe = (c: string): string => `e2e-p26-${c}@example.com`
const EMAIL_SIN_FICHA = emailDe('admin-sin-ficha-1')
const EMAIL_ALTA = emailDe(`alta-admin-${sufijo}`)

const ids = {} as {
  owner: string
  admin: string
  empleado: string
  sinFicha: string
}
let idAlta: string | null = null
let clienteP2679: string | null = null

type Falla = { message: string } | null
async function ok(que: string, consulta: PromiseLike<{ error: Falla }>) {
  const { error } = await consulta
  expect(error?.message, que).toBeUndefined()
}

async function iniciarSesion(email: string) {
  const env = requireE2eEnv()
  const cliente = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let res = await cliente.auth.signInWithPassword({
    email,
    password: env.seedPassword,
  })
  for (const espera of [5, 10, 20, 30]) {
    if (!res.error || !esLimiteDeTasa(res.error)) break
    await new Promise((r) => setTimeout(r, espera * 1000))
    res = await cliente.auth.signInWithPassword({
      email,
      password: env.seedPassword,
    })
  }
  return { cliente, res }
}

/** Cliente de PostgREST con la sesión de una cuenta propia (e2e-p26-*). */
async function clienteDeCuenta(email: string): Promise<Db> {
  const { res } = await iniciarSesion(email)
  expect(res.error?.message, `sesión de ${email}`).toBeUndefined()
  const env = requireE2eEnv()
  return createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${res.data.session?.access_token}` },
    },
  })
}

/** Busca la cuenta por email; si falta, la crea con `service_role` (Auth + roles, sin ficha). */
async function asegurarCuenta(
  email: string,
  nombre: string,
  roles: readonly AppRole[],
): Promise<string> {
  const db = servicio()
  const env = requireE2eEnv()
  let id = (await loadAuthUserIds(getAdminDb())).get(email)
  if (!id) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: env.seedPassword,
      email_confirm: true,
      user_metadata: { first_name: 'E2E-P26', last_name: nombre },
    })
    expect(error?.message, `alta de ${email}`).toBeUndefined()
    id = data.user?.id
    await ok(
      'roles',
      db.from('user_roles').insert(
        roles.map((role) => ({
          profile_id: id as string,
          role,
          granted_by: contexto().ids.owner,
        })),
      ),
    )
    if (roles.includes('admin')) {
      await ok(
        'capacidades',
        db.from('admin_capabilities').insert(
          ADMIN_CAPABILITIES.map((capability) => ({
            profile_id: id as string,
            capability,
            enabled: true,
            updated_by: contexto().ids.owner,
          })),
        ),
      )
    }
  }
  return id as string
}

/** Quita la ficha y el rol `employee` de la cuenta (la deja como antes del encargo). */
async function quitarFicha(id: string): Promise<void> {
  const db = servicio()
  await db.from('employee_availability').delete().eq('employee_id', id)
  await db.from('employee_leaves').delete().eq('employee_id', id)
  await db.from('employee_client_permissions').delete().eq('employee_id', id)
  await ok('quitar ficha', db.from('employees').delete().eq('profile_id', id))
  await ok(
    'quitar rol employee',
    db.from('user_roles').delete().eq('profile_id', id).eq('role', 'employee'),
  )
}

/** Planta una ficha temporal (sin pasar por la función: así no deja evento ni consume legajo ajeno). */
async function plantarFicha(id: string, dni: string): Promise<void> {
  const db = servicio()
  await quitarFicha(id)
  // Legajo = máximo + 1, como hace la función (la secuencia por omisión puede ir detrás de ese máximo).
  const { data: tope } = await db
    .from('employees')
    .select('employee_number')
    .order('employee_number', { ascending: false })
    .limit(1)
    .single()
  await ok(
    'ficha temporal',
    db.from('employees').insert({
      profile_id: id,
      dni,
      employee_number: (tope?.employee_number ?? 0) + 1,
      created_by: contexto().ids.owner,
    }),
  )
  await ok(
    'rol employee',
    db.from('user_roles').insert({
      profile_id: id,
      role: 'employee',
      granted_by: contexto().ids.owner,
    }),
  )
}

async function ficha(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await servicio()
    .from('employees')
    .select('*')
    .eq('profile_id', id)
    .maybeSingle()
  expect(error?.message).toBeUndefined()
  return data ?? null
}

async function rolesDe(id: string): Promise<string[]> {
  const { data, error } = await servicio()
    .from('user_roles')
    .select('role')
    .eq('profile_id', id)
  expect(error?.message).toBeUndefined()
  return (data ?? []).map((f) => f.role as string).sort()
}

beforeAll(async () => {
  if (!readE2eEnv()) return
  ids.owner = await asegurarCuenta(emailDe('owner'), 'owner', ['owner'])
  ids.admin = await asegurarCuenta(emailDe('admin'), 'admin', ['admin'])
  ids.empleado = await asegurarCuenta(emailDe('empleado'), 'empleado', [
    'employee',
  ])
  ids.sinFicha = await asegurarCuenta(EMAIL_SIN_FICHA, 'admin sin ficha 1', [
    'admin',
  ])
  // Estado de partida: el admin propio sin ficha y sin rol employee (una corrida cortada pudo dejarla).
  await quitarFicha(ids.sinFicha)
  // Las fichas temporales del dueño y del admin propios (CR-19, P26.7b).
  await plantarFicha(ids.owner, DNI_FICHA_DUENO)
  await plantarFicha(ids.admin, DNI_FICHA_ADMIN)
  // La ficha de e2e-p26-empleado la deja 97-credenciales; si no corrió nunca, se planta.
  if (!(await ficha(ids.empleado))) {
    await plantarFicha(ids.empleado, DNI_EMPLEADO_P26)
  }
})

afterAll(async () => {
  if (!readE2eEnv() || !ids.owner) return
  const db = servicio()
  if (clienteP2679) await deleteClientDeep(getAdminDb(), clienteP2679)
  await quitarFicha(ids.owner)
  await quitarFicha(ids.admin)
  await quitarFicha(ids.sinFicha)
  if (idAlta) {
    await db.from('profiles').update({ is_active: false }).eq('id', idAlta)
  }
  const propios = [ids.owner, ids.admin, ids.sinFicha, ids.empleado]
  await db
    .from('security_events')
    .delete()
    .eq('event_type', 'roles_changed')
    .in('target_id', [...propios, ...(idAlta ? [idAlta] : [])])
    .gte('created_at', desde)
})

// ---------------------------------------------------------------------------------------------
// 1. add_employee_record
// ---------------------------------------------------------------------------------------------

describe('add_employee_record (0076, CR-16, CR-18)', () => {
  it('[dueño] completa la ficha de un admin sin ficha: aparece en v_employees con employee en roles; el legajo se asigna solo (CR-16, CR-18)', async () => {
    const dueno = clienteDe('owner')
    // Antes: no figura en el listado.
    const antes = await tabla(dueno, 'v_employees')
      .select('profile_id')
      .eq('profile_id', ids.sinFicha)
    expect(filas(antes), 'sin ficha no figura en v_employees').toHaveLength(0)
    expect(await rolesDe(ids.sinFicha)).toEqual(['admin'])

    const { data, error } = await dueno.rpc('add_employee_record', {
      p_profile_id: ids.sinFicha,
      p_employee: { dni: DNI_COMPLETAR, notes: 'e2e-p26-9' },
    })
    expect(error?.message).toBeUndefined()
    const fila = data as unknown as { profile_id: string; dni: string }
    expect(fila.profile_id).toBe(ids.sinFicha)
    expect(fila.dni).toBe(DNI_COMPLETAR)

    const despues = await tabla(dueno, 'v_employees')
      .select('profile_id, roles, employee_number, status')
      .eq('profile_id', ids.sinFicha)
    const f = filas(despues)
    expect(f, describir(despues)).toHaveLength(1)
    expect(f[0].roles as string[]).toEqual(
      expect.arrayContaining(['admin', 'employee']),
    )
    expect(f[0].employee_number).toEqual(expect.any(Number))
    expect(f[0].status).toBe('active')

    // Queda el evento roles_changed con employee_record_added.
    const { data: ev } = await servicio()
      .from('security_events')
      .select('details')
      .eq('event_type', 'roles_changed')
      .eq('target_id', ids.sinFicha)
      .gte('created_at', desde)
    expect(
      (ev ?? []).some(
        (e) =>
          (e.details as Record<string, unknown>).employee_record_added === true,
      ),
    ).toBe(true)

    // Reutilizable: se restaura la cuenta a "admin sin ficha".
    await quitarFicha(ids.sinFicha)
    expect(await ficha(ids.sinFicha)).toBeNull()
    expect(await rolesDe(ids.sinFicha)).toEqual(['admin'])
  })

  it('[admin con todas las capacidades] -> FORBIDDEN y no se crea la ficha (CR-18)', async () => {
    const res = await clienteDe('admin').rpc('add_employee_record', {
      p_profile_id: ids.sinFicha,
      p_employee: { dni: DNI_COMPLETAR },
    })
    expect(res.error?.hint, res.error?.message).toBe('FORBIDDEN')
    expect(await ficha(ids.sinFicha)).toBeNull()
    expect(await rolesDe(ids.sinFicha)).toEqual(['admin'])
  })

  it('[admin sin capacidades, empleado y coordinador] -> FORBIDDEN y no se crea la ficha (CR-18)', async () => {
    for (const perfil of ['adminSin', 'empleado', 'supervisor'] as const) {
      const res = await clienteDe(perfil).rpc('add_employee_record', {
        p_profile_id: ids.sinFicha,
        p_employee: { dni: DNI_COMPLETAR },
      })
      expect(res.error?.hint, `${perfil}: ${res.error?.message}`).toBe(
        'FORBIDDEN',
      )
    }
    expect(await ficha(ids.sinFicha)).toBeNull()
  })

  it('[anon] -> 42501 (execute revocado)', async () => {
    const res = await clienteDe('anon').rpc('add_employee_record', {
      p_profile_id: ids.sinFicha,
      p_employee: { dni: DNI_COMPLETAR },
    })
    expect(res.error?.code).toBe('42501')
  })

  it('[dueño] sobre quien ya es empleado -> ALREADY_EMPLOYEE y no cambia la ficha (CR-18)', async () => {
    const antes = await ficha(ids.empleado)
    const res = await clienteDe('owner').rpc('add_employee_record', {
      p_profile_id: ids.empleado,
      p_employee: { dni: DNI_COMPLETAR },
    })
    expect(res.error?.hint, res.error?.message).toBe('ALREADY_EMPLOYEE')
    expect(await ficha(ids.empleado)).toEqual(antes)
  })

  it('[dueño] con un DNI que ya usa otra ficha -> DNI_IN_USE y no deja ficha ni rol (CR-18)', async () => {
    const res = await clienteDe('owner').rpc('add_employee_record', {
      p_profile_id: ids.sinFicha,
      p_employee: { dni: DNI_EMPLEADO_P26 },
    })
    expect(res.error?.hint, res.error?.message).toBe('DNI_IN_USE')
    expect(await ficha(ids.sinFicha)).toBeNull()
    expect(await rolesDe(ids.sinFicha)).toEqual(['admin'])
  })

  it('[dueño] sin DNI -> EMPLOYEE_DATA_REQUIRED; persona inexistente -> PROFILE_NOT_FOUND (CR-18)', async () => {
    const sinDni = await clienteDe('owner').rpc('add_employee_record', {
      p_profile_id: ids.sinFicha,
      p_employee: {},
    })
    expect(sinDni.error?.hint).toBe('EMPLOYEE_DATA_REQUIRED')
    const noExiste = await clienteDe('owner').rpc('add_employee_record', {
      p_profile_id: '00000000-0000-4000-8000-000000000001',
      p_employee: { dni: DNI_COMPLETAR },
    })
    expect(noExiste.error?.hint).toBe('PROFILE_NOT_FOUND')
    expect(await ficha(ids.sinFicha)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// 2. Alta de administrador (create_user, CR-17)
// ---------------------------------------------------------------------------------------------

describe('create_user de un administrador o dueño (CR-17)', () => {
  const cuerpo = (extra: Record<string, unknown>) => ({
    action: 'create_user',
    email: EMAIL_ALTA,
    password: requireE2eEnv().seedPassword,
    first_name: 'E2E-P26',
    last_name: 'Alta',
    phone: null,
    ...extra,
  })

  it('[dueño] admin o dueño sin employee en el cuerpo -> EMPLOYEE_DATA_REQUIRED y no se crea la cuenta (CR-17)', async () => {
    const token = await tokenVigente('owner')
    for (const roles of [['admin'], ['owner'], ['admin', 'employee']]) {
      const r = await llamarEdge(token, cuerpo({ roles }))
      expect(r.hint, `${roles.join('+')}: ${JSON.stringify(r.cuerpo)}`).toBe(
        'EMPLOYEE_DATA_REQUIRED',
      )
      expect(r.status).toBe(400)
    }
    // Con una ficha sin DNI el cuerpo se rechaza antes por validación (línea 622 de index.ts).
    const sinDni = await llamarEdge(
      token,
      cuerpo({ roles: ['admin'], employee: { notes: 'sin dni' } }),
    )
    expect(sinDni.hint).toBe('VALIDATION_ERROR')
    const id = (await loadAuthUserIds(getAdminDb())).get(EMAIL_ALTA)
    expect(id, 'ninguna de las altas rechazadas creó la cuenta').toBeUndefined()
  })

  it('[admin con todas] alta de un administrador, aun con ficha -> FORBIDDEN (solo el dueño, ADM-27)', async () => {
    const r = await llamarEdge(
      await tokenVigente('admin'),
      cuerpo({ roles: ['admin'], employee: { dni: DNI_ALTA } }),
    )
    expect(r.hint, JSON.stringify(r.cuerpo)).toBe('FORBIDDEN')
    expect(await ficha(ids.sinFicha)).toBeNull()
  })

  it('[dueño] alta de un administrador con la ficha: queda con employee en user_roles, ficha y v_employees (CR-17)', async () => {
    const r = await llamarEdge(
      await tokenVigente('owner'),
      cuerpo({
        roles: ['admin'],
        employee: { dni: DNI_ALTA, notes: 'e2e-p26-9' },
      }),
    )
    expect(r.hint, JSON.stringify(r.cuerpo)).toBe('OK')
    idAlta = (r.cuerpo as { data: { profile_id: string } }).data.profile_id
    expect(await rolesDe(idAlta)).toEqual(['admin', 'employee'])
    expect((await ficha(idAlta))?.dni).toBe(DNI_ALTA)
    const lista = await tabla(clienteDe('owner'), 'v_employees')
      .select('profile_id, roles')
      .eq('profile_id', idAlta)
    expect(filas(lista), describir(lista)).toHaveLength(1)
    expect(filas(lista)[0].roles as string[]).toEqual(
      expect.arrayContaining(['admin', 'employee']),
    )
    // El alta le da todas las capacidades al administrador (comportamiento previo, 0035).
    const { data: caps } = await servicio()
      .from('admin_capabilities')
      .select('capability')
      .eq('profile_id', idAlta)
      .eq('enabled', true)
    expect((caps ?? []).length).toBe(ADMIN_CAPABILITIES.length)
  })
})

// ---------------------------------------------------------------------------------------------
// 3. Baja y edición de la ficha de un dueño o de otro admin (CR-19)
// ---------------------------------------------------------------------------------------------

describe('CR-19: un admin con la ficha de un dueño, de otro admin y de un empleado', () => {
  const BAJAS: { nombre: string; parche: Record<string, unknown> }[] = [
    {
      nombre: 'status',
      parche: { status: 'terminated' },
    },
    {
      nombre: 'terminated_at',
      parche: { terminated_at: '2020-01-01' },
    },
    {
      nombre: 'deleted_at',
      parche: { deleted_at: '2020-01-01T00:00:00Z' },
    },
  ]
  const OBJETIVOS = ['owner', 'admin'] as const

  let admin: Db

  beforeAll(() => {
    admin = clienteDe('admin')
  })

  for (const objetivo of OBJETIVOS) {
    for (const { nombre, parche } of BAJAS) {
      it(`[admin con todas] cambiar ${nombre} de la ficha de ${objetivo === 'owner' ? 'un dueño' : 'otro admin'} -> FORBIDDEN y la ficha no cambia (CR-19)`, async () => {
        const id = ids[objetivo]
        const antes = await ficha(id)
        try {
          const res = await tabla(admin, 'employees')
            .update(parche)
            .eq('profile_id', id)
            .select()
          expect(res.error?.hint, describir(res)).toBe('FORBIDDEN')
          expect(denegado(res)).toBe(true)
        } finally {
          // Si el defecto existiera y el cambio hubiera pasado, se restaura.
          const ahora = await ficha(id)
          if (JSON.stringify(ahora) !== JSON.stringify(antes)) {
            await servicio()
              .from('employees')
              .update({
                status: 'active',
                terminated_at: null,
                deleted_at: null,
              })
              .eq('profile_id', id)
          }
        }
        const despues = await ficha(id)
        expect(despues?.status).toBe(antes?.status)
        expect(despues?.terminated_at).toBe(antes?.terminated_at)
        expect(despues?.deleted_at).toBe(antes?.deleted_at)
      })
    }
  }

  it('[dueño] control: sí puede dar de baja la ficha de un admin, y se restaura (CR-19)', async () => {
    const id = ids.admin
    try {
      const res = await tabla(clienteDe('owner'), 'employees')
        .update({ status: 'terminated', terminated_at: '2020-01-01' })
        .eq('profile_id', id)
        .select()
      expect(res.error?.message, describir(res)).toBeUndefined()
      expect(filas(res)).toHaveLength(1)
    } finally {
      await servicio()
        .from('employees')
        .update({ status: 'active', terminated_at: null })
        .eq('profile_id', id)
    }
    expect((await ficha(id))?.status).toBe('active')
  })

  for (const { nombre, parche } of BAJAS) {
    it(`[admin con todas] cambiar ${nombre} de la ficha de un empleado común -> permitido; se restaura (CR-19)`, async () => {
      const id = ids.empleado
      try {
        const res = await tabla(admin, 'employees')
          .update(parche)
          .eq('profile_id', id)
          .select()
        expect(res.error?.message, describir(res)).toBeUndefined()
        expect(filas(res)).toHaveLength(1)
      } finally {
        await servicio()
          .from('employees')
          .update({ status: 'active', terminated_at: null, deleted_at: null })
          .eq('profile_id', id)
      }
      const despues = await ficha(id)
      expect(despues?.status).toBe('active')
      expect(despues?.deleted_at).toBeNull()
    })
  }

  it('[admin con todas] edita una nota laboral, la disponibilidad y una licencia de la ficha del dueño -> permitido; se restaura (CR-19)', async () => {
    const id = ids.owner
    const notaAntes = (await ficha(id))?.notes ?? null
    try {
      const nota = await tabla(admin, 'employees')
        .update({ notes: `e2e-p26-9 nota ${sufijo}` })
        .eq('profile_id', id)
        .select()
      expect(nota.error?.message, describir(nota)).toBeUndefined()
      expect(filas(nota)).toHaveLength(1)

      const disp = await tabla(admin, 'employee_availability')
        .insert({
          employee_id: id,
          weekday: 2,
          start_time: '08:00',
          end_time: '12:00',
        })
        .select()
      expect(disp.error?.message, describir(disp)).toBeUndefined()
      expect(filas(disp)).toHaveLength(1)

      const lic = await tabla(admin, 'employee_leaves')
        .insert({
          employee_id: id,
          starts_on: daysFromToday(40),
          ends_on: daysFromToday(41),
          reason: `e2e-perm-p26-9 ${sufijo}`,
        })
        .select()
      expect(lic.error?.message, describir(lic)).toBeUndefined()
      expect(filas(lic)).toHaveLength(1)
    } finally {
      await servicio()
        .from('employees')
        .update({ notes: notaAntes as string | null })
        .eq('profile_id', id)
      await servicio()
        .from('employee_availability')
        .delete()
        .eq('employee_id', id)
      await servicio().from('employee_leaves').delete().eq('employee_id', id)
    }
    expect((await ficha(id))?.notes ?? null).toBe(notaAntes)
  })

  for (const objetivo of OBJETIVOS) {
    for (const parche of [
      { first_name: 'E2E-P26-cambiado' },
      { phone: '1100000000' },
    ]) {
      const campo = Object.keys(parche)[0]
      it(`[admin con todas] editar ${campo} del perfil de ${objetivo === 'owner' ? 'un dueño' : 'otro admin'} -> FORBIDDEN y no cambia (CR-19)`, async () => {
        const id = ids[objetivo]
        const { data: antes } = await servicio()
          .from('profiles')
          .select('first_name, phone')
          .eq('id', id)
          .single()
        const res = await tabla(admin, 'profiles')
          .update(parche)
          .eq('id', id)
          .select()
        try {
          expect(res.error?.hint, describir(res)).toBe('FORBIDDEN')
        } finally {
          await servicio()
            .from('profiles')
            .update({ first_name: antes?.first_name, phone: antes?.phone })
            .eq('id', id)
        }
      })
    }
  }

  it('[dueño] control: sí puede editar el teléfono del perfil de un admin, y se restaura', async () => {
    const id = ids.admin
    const { data: antes } = await servicio()
      .from('profiles')
      .select('phone')
      .eq('id', id)
      .single()
    try {
      const res = await tabla(clienteDe('owner'), 'profiles')
        .update({ phone: '1100000001' })
        .eq('id', id)
        .select()
      expect(res.error?.message, describir(res)).toBeUndefined()
      expect(filas(res)).toHaveLength(1)
    } finally {
      await servicio()
        .from('profiles')
        .update({ phone: antes?.phone ?? null })
        .eq('id', id)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 4. P26.7b (0077): el dueño o admin con rol employee avisa como titular
// ---------------------------------------------------------------------------------------------

describe('P26.7b: notify_delay de un dueño o admin sobre su propia asignación deja employee_app (CR-16)', () => {
  it('el dueño y el admin con rol employee avisan una demora como titulares', async () => {
    const db = servicio()
    const { data: cliente, error: e1 } = await db
      .from('clients')
      .insert({
        legal_name: `e2e-p26-9-${sufijo}`,
        cuit: `20${`${Date.now()}`.slice(-8)}${Math.floor(Math.random() * 10)}`,
      })
      .select('id')
      .single()
    expect(e1?.message).toBeUndefined()
    clienteP2679 = cliente?.id as string
    const { data: sede, error: e2 } = await db
      .from('sites')
      .insert({
        client_id: clienteP2679,
        name: `e2e-p26-9-sede-${sufijo}`,
        address: 'Calle de prueba 123',
      })
      .select('id')
      .single()
    expect(e2?.message).toBeUndefined()
    const { data: turno, error: e3 } = await db
      .from('shifts')
      .insert({
        client_id: clienteP2679,
        site_id: sede?.id as string,
        shift_date: contexto().fechaTurno, // hoy + 3: el aviso es "antes del inicio" sin depender de la hora
        start_time: '08:00',
        end_time: '12:00',
        required_staff: 2,
        notes: 'e2e-p26-9',
      })
      .select('id')
      .single()
    expect(e3?.message).toBeUndefined()

    const dueno = clienteDe('owner')
    const asignar = async (empleadoId: string) => {
      const { data, error } = await dueno.rpc('assign_employee', {
        p_shift_id: turno?.id as string,
        p_employee_id: empleadoId,
      })
      expect(error?.message, 'assign_employee').toBeUndefined()
      return (data as unknown as { assignment: { id: string } }).assignment.id
    }
    const asigDueno = await asignar(ids.owner)
    const asigAdmin = await asignar(ids.admin)

    for (const [clave, asignacion] of [
      ['owner', asigDueno],
      ['admin', asigAdmin],
    ] as const) {
      const c = await clienteDeCuenta(emailDe(clave))
      const { data, error } = await c.rpc('notify_delay', {
        p_assignment_id: asignacion,
        p_minutes: 15,
      })
      expect(error?.message, `${clave}: ${error?.hint}`).toBeUndefined()
      const aviso = data as unknown as { source: string; reported_by: string }
      expect(aviso.source, `${clave}: origen del aviso`).toBe('employee_app')
      expect(aviso.reported_by).toBe(ids[clave])
    }
  })
})
