// DATA-005: prueba de integración del importador contra App_dev, con datos FICTICIOS marcados
// con el prefijo `imp-test-`. Carga, reintenta con --resume sin duplicar, comprueba que una
// planilla con errores no escribe nada y al final barre todo lo que creó, incluidas las cuentas
// de Auth. Solo toca filas que lleven el prefijo (el nocturno de e2e usa App_dev: no se borra
// nada ajeno). Se corre con `pnpm test:import`.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REF_APP_DEV, refDeUrl } from './entorno.ts'
import { ejecutarImportacion } from './ejecutar.ts'
import {
  crearPlanilla,
  cuitValido,
  fechaExcel,
  horaExcel,
  type DatosPlanilla,
} from './pruebas/planilla-ficticia.ts'

const PREFIJO = 'imp-test-'

/** Un campo de texto de una fila devuelta por la base (el cliente sin tipos devuelve `any`). */
function campo(fila: unknown, nombre: string): string {
  return (fila as Record<string, string>)[nombre]
}
const url = process.env.VITE_SUPABASE_URL
const claveServicio = process.env.SUPABASE_SERVICE_ROLE_KEY
const hayCredenciales = Boolean(url && claveServicio)

/** Primer CUIT válido de la forma 30999 + 5 dígitos a partir de `n` (algunos dan verificador 10). */
function cuitDe(n: number): string {
  for (let i = n; ; i++) {
    try {
      return cuitValido(`30999${String(i).padStart(5, '0')}`)
    } catch {
      continue
    }
  }
}

const CUIT_A = cuitDe(100)
const CUIT_B = cuitDe(200)
const CUIT_ERROR = cuitDe(300)

function datosFicticios(): DatosPlanilla {
  return {
    Clientes: [
      {
        cuit: CUIT_A,
        razonSocial: `${PREFIJO}Alfa S.A.`,
        direccion: 'Calle Inventada 1, CABA',
      },
      // Sin dirección y sin sedes: advertencia y ninguna sede.
      { cuit: CUIT_B, razonSocial: `${PREFIJO}Beta S.R.L.` },
      // Sin CUIT, con dirección: vinculado por razón social y con sede Principal automática.
      {
        razonSocial: `${PREFIJO}Gamma Sin Cuit`,
        direccion: 'Calle Inventada 3, Quilmes',
      },
    ],
    Contactos: [
      {
        cliente: CUIT_A,
        nombre: `${PREFIJO}Contacto Uno`,
        telefono: 1144445555,
        principal: 'Sí',
      },
      {
        cliente: `  ${PREFIJO.toUpperCase()}gamma   sin cuit `,
        nombre: `${PREFIJO}Contacto Dos`,
      },
    ],
    Sedes: [
      {
        cliente: CUIT_A,
        nombre: `${PREFIJO}Planta`,
        direccion: 'Av. Inventada 100',
        latitud: -34.6,
        longitud: -58.4,
        celular: 'Sí',
      },
    ],
    Empleados: [
      {
        dni: '99900001',
        nombre: `${PREFIJO}Ana`,
        apellido: 'Uno',
        email: `${PREFIJO}ana@prueba.test`,
        telefono: 1155551111,
        nacimiento: fechaExcel(1990, 3, 15),
        legajo: 998001,
      },
      {
        dni: '99900002',
        nombre: `${PREFIJO}Beto`,
        apellido: 'Dos',
        email: `${PREFIJO}beto@prueba.test`,
      },
    ],
    Supervisores: [
      // Mismo DNI que un empleado: una sola cuenta con los dos roles.
      {
        dni: '99900002',
        nombre: `${PREFIJO}Beto`,
        apellido: 'Dos',
        email: `${PREFIJO}beto@prueba.test`,
      },
      {
        dni: '99900003',
        nombre: `${PREFIJO}Carla`,
        apellido: 'Tres',
        email: `${PREFIJO}carla@prueba.test`,
      },
    ],
    Servicios: [
      {
        cliente: CUIT_A,
        sede: `${PREFIJO}Planta`,
        nombre: `${PREFIJO}Limpieza mañana`,
        lunes: 'Sí',
        miercoles: 'Sí',
        viernes: 'Sí',
        inicio: horaExcel(7),
        fin: horaExcel(15, 30),
        dotacion: 2,
        desde: fechaExcel(2099, 1, 1),
        feriados: 'No',
      },
      {
        cliente: `${PREFIJO}Gamma Sin Cuit`,
        sede: 'Principal',
        nombre: `${PREFIJO}Limpieza sábado`,
        sabado: 'Sí',
        inicio: '14:00',
        fin: '18:00',
        desde: fechaExcel(2099, 1, 1),
      },
    ],
    Habilitaciones: [{ dni: '99900001', cliente: CUIT_A }],
    Feriados: [
      { fecha: fechaExcel(2099, 1, 1), nombre: `${PREFIJO}Feriado uno` },
      { fecha: fechaExcel(2099, 5, 25), nombre: `${PREFIJO}Feriado dos` },
    ],
    Criterios: [
      { orden: 99, titulo: `${PREFIJO}Criterio`, descripcion: 'Prueba.' },
    ],
  }
}

describe.skipIf(!hayCredenciales)('el importador contra App_dev', () => {
  let admin: ReturnType<typeof createClient>
  let carpeta: string
  let planilla: string
  const salidas: string[] = []
  const salida = {
    log: (m: string) => salidas.push(m),
    error: (m: string) => salidas.push(m),
  }
  // Variable explícita de destino: la prueba nunca corre contra otro proyecto.
  const env = { ...process.env, IMPORT_ENTORNO: 'app_dev' }

  const correr = (...extra: string[]) =>
    ejecutarImportacion([planilla, '--salida', carpeta, ...extra], {
      env,
      salida,
    })

  async function contar(tabla: string, columna: string): Promise<number> {
    const { count, error } = await admin
      .from(tabla)
      .select('*', { count: 'exact', head: true })
      .like(columna, `${PREFIJO}%`)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    return count ?? 0
  }

  /** Cuentas de Auth con el prefijo (se listan todas: hay pocas). */
  async function cuentasConPrefijo(): Promise<
    Array<{ id: string; email: string }>
  > {
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    if (error) throw new Error(error.message)
    return data.users
      .filter((u) => (u.email ?? '').startsWith(PREFIJO))
      .map((u) => ({ id: u.id, email: u.email ?? '' }))
  }

  /** Barre todo lo que lleva el prefijo, en orden de dependencias. Nada ajeno. */
  async function barrer(): Promise<void> {
    const { data: clientes } = await admin
      .from('clients')
      .select('id')
      .like('legal_name', `${PREFIJO}%`)
    const idsClientes = (clientes ?? []).map((c) => campo(c, 'id'))
    const cuentas = await cuentasConPrefijo()
    const idsPersonas = cuentas.map((c) => c.id)

    if (idsClientes.length > 0) {
      await admin
        .from('employee_client_permissions')
        .delete()
        .in('client_id', idsClientes)
      await admin.from('services').delete().in('client_id', idsClientes)
      await admin.from('client_contacts').delete().in('client_id', idsClientes)
      await admin.from('sites').delete().in('client_id', idsClientes)
      await admin.from('clients').delete().in('id', idsClientes)
    }
    await admin.from('holidays').delete().like('name', `${PREFIJO}%`)
    await admin.from('rating_criteria').delete().like('title', `${PREFIJO}%`)
    for (const id of idsPersonas) {
      await admin
        .from('employee_client_permissions')
        .delete()
        .eq('employee_id', id)
      await admin
        .from('security_events')
        .delete()
        .or(`actor_id.eq.${id},target_id.eq.${id}`)
      await admin.from('user_roles').delete().eq('profile_id', id)
      await admin.from('employees').delete().eq('profile_id', id)
      await admin.from('profiles').delete().eq('id', id)
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error)
        throw new Error(`No se pudo borrar la cuenta ${id}: ${error.message}`)
    }
  }

  beforeAll(async () => {
    // Doble verificación del destino antes de crear el cliente: tiene que ser App_dev.
    if (refDeUrl(url ?? '') !== REF_APP_DEV) {
      throw new Error(
        'VITE_SUPABASE_URL no es App_dev: la prueba no corre contra otro proyecto.',
      )
    }
    admin = createClient(url ?? '', claveServicio ?? '', {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    carpeta = await mkdtemp(join(tmpdir(), 'imp-test-'))
    planilla = join(carpeta, 'planilla-ficticia.xlsx')
    await writeFile(planilla, await crearPlanilla(datosFicticios()))
    await barrer() // por si una corrida anterior se cortó
  })

  afterAll(async () => {
    if (!admin) return
    await barrer()
    expect(await contar('clients', 'legal_name')).toBe(0)
    expect(await cuentasConPrefijo()).toEqual([])
    await rm(carpeta, { recursive: true, force: true })
  })

  it('la simulación consultando la base no escribe nada', async () => {
    const codigo = await correr('--dry-run', '--consultar-base')
    expect(codigo).toBe(0)
    expect(salidas.join('\n')).toContain('No se escribió nada')
    expect(await contar('clients', 'legal_name')).toBe(0)
    expect(await cuentasConPrefijo()).toEqual([])
  })

  it('carga todo en el orden y con los datos esperados', async () => {
    const codigo = await correr()
    expect(codigo, salidas.join('\n')).toBe(0)

    expect(await contar('clients', 'legal_name')).toBe(3)
    expect(await contar('client_contacts', 'name')).toBe(2)
    // Planta (explícita) + Principal automática de Gamma; Beta no tiene dirección ni sede.
    const { data: sedes } = await admin
      .from('sites')
      .select('name, address, latitude, status, clients!inner(legal_name)')
      .like('clients.legal_name', `${PREFIJO}%`)
    const filasSedes = (sedes ?? []) as unknown as Array<{
      name: string
      address: string
      latitude: number | null
      status: string
    }>
    const nombresSedes = filasSedes.map((s) => s.name).sort()
    expect(nombresSedes).toEqual(['Principal', `${PREFIJO}Planta`])
    const principal = filasSedes.find((s) => s.name === 'Principal')
    if (!principal) throw new Error('Falta la sede Principal')
    expect(principal.address).toBe('Calle Inventada 3, Quilmes')
    expect(principal.latitude).toBeNull()
    expect(principal.status).toBe('active')

    // Tres personas con usuario; Beto con los dos roles.
    const cuentas = await cuentasConPrefijo()
    expect(cuentas).toHaveLength(3)
    const beto = cuentas.find((c) => c.email.includes('beto'))
    const { data: roles } = await admin
      .from('user_roles')
      .select('role')
      .eq('profile_id', beto?.id ?? '')
    expect((roles ?? []).map((r) => campo(r, 'role')).sort()).toEqual([
      'employee',
      'supervisor',
    ])
    const ana = cuentas.find((c) => c.email.includes('ana'))
    const { data: empleada } = await admin
      .from('employees')
      .select('dni, employee_number, birth_date, status')
      .eq('profile_id', ana?.id ?? '')
      .single()
    expect(empleada).toMatchObject({
      dni: '99900001',
      employee_number: 998001,
      birth_date: '1990-03-15',
      status: 'active',
    })
    const { data: perfil } = await admin
      .from('profiles')
      .select('first_name, phone')
      .eq('id', ana?.id ?? '')
      .single()
    expect(perfil).toMatchObject({
      first_name: `${PREFIJO}Ana`,
      phone: '1155551111',
    })

    const { data: habilitaciones } = await admin
      .from('employee_client_permissions')
      .select('employee_id')
      .eq('employee_id', ana?.id ?? '')
    expect(habilitaciones).toHaveLength(1)

    const { data: servicios } = await admin
      .from('services')
      .select(
        'name, weekdays, start_time, end_time, required_staff, works_on_holidays',
      )
      .like('name', `${PREFIJO}%`)
      .order('name')
    expect(servicios).toEqual([
      {
        name: `${PREFIJO}Limpieza mañana`,
        weekdays: [1, 3, 5],
        start_time: '07:00:00',
        end_time: '15:30:00',
        required_staff: 2,
        works_on_holidays: false,
      },
      {
        name: `${PREFIJO}Limpieza sábado`,
        weekdays: [6],
        start_time: '14:00:00',
        end_time: '18:00:00',
        required_staff: 1,
        works_on_holidays: true,
      },
    ])
    expect(await contar('holidays', 'name')).toBe(2)
    expect(await contar('rating_criteria', 'title')).toBe(1)

    // La cuenta se crea sin contraseña (DATA-008 las asigna después) y deja su evento.
    const { count } = await admin
      .from('security_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'user_created')
      .in(
        'target_id',
        cuentas.map((c) => c.id),
      )
    expect(count).toBe(3)
  })

  it('repetir la carga sin --resume se frena antes de escribir y no duplica nada', async () => {
    salidas.length = 0
    const codigo = await correr()
    expect(codigo).toBe(1)
    expect(salidas.join('\n')).toContain('--resume')
    expect(await contar('clients', 'legal_name')).toBe(3)
    expect(await cuentasConPrefijo()).toHaveLength(3)
  })

  it('--resume omite lo ya cargado y no duplica', async () => {
    salidas.length = 0
    const codigo = await correr('--resume')
    expect(codigo, salidas.join('\n')).toBe(0)
    expect(salidas.join('\n')).toContain('0 creado(s)')
    expect(await contar('clients', 'legal_name')).toBe(3)
    expect(await contar('client_contacts', 'name')).toBe(2)
    expect(await contar('services', 'name')).toBe(2)
    expect(await contar('holidays', 'name')).toBe(2)
    expect(await contar('rating_criteria', 'title')).toBe(1)
    expect(await cuentasConPrefijo()).toHaveLength(3)
    const { count } = await admin
      .from('sites')
      .select('*', { count: 'exact', head: true })
      .eq('name', 'Principal')
      .in(
        'client_id',
        (
          (
            await admin
              .from('clients')
              .select('id')
              .like('legal_name', `${PREFIJO}%`)
          ).data ?? []
        ).map((c) => campo(c, 'id')),
      )
    expect(count).toBe(1)
  })

  it('--resume completa solo lo que falta después de una carga cortada', async () => {
    // Se simula una carga interrumpida: faltan un servicio, un feriado, un contacto y una habilitación.
    await admin
      .from('services')
      .delete()
      .like('name', `${PREFIJO}Limpieza sábado`)
    await admin.from('holidays').delete().like('name', `${PREFIJO}Feriado dos`)
    await admin
      .from('client_contacts')
      .delete()
      .like('name', `${PREFIJO}Contacto Dos`)
    const ana = (await cuentasConPrefijo()).find((c) => c.email.includes('ana'))
    await admin
      .from('employee_client_permissions')
      .delete()
      .eq('employee_id', ana?.id ?? '')

    salidas.length = 0
    const codigo = await correr('--resume')
    expect(codigo, salidas.join('\n')).toBe(0)
    expect(await contar('services', 'name')).toBe(2)
    expect(await contar('holidays', 'name')).toBe(2)
    expect(await contar('client_contacts', 'name')).toBe(2)
    const { count } = await admin
      .from('employee_client_permissions')
      .select('*', { count: 'exact', head: true })
      .eq('employee_id', ana?.id ?? '')
    expect(count).toBe(1)
    expect(await contar('clients', 'legal_name')).toBe(3)
  })

  it('una planilla con un error no escribe nada, ni siquiera lo válido', async () => {
    const datos = datosFicticios()
    datos.Clientes = [
      { cuit: CUIT_ERROR, razonSocial: `${PREFIJO}Delta Válido` },
      // CUIT de largo incorrecto: error.
      { cuit: '12345', razonSocial: `${PREFIJO}Delta Con Error` },
    ]
    datos.Contactos = []
    datos.Sedes = []
    datos.Servicios = []
    datos.Habilitaciones = []
    datos.Empleados = [
      {
        dni: '99900009',
        nombre: `${PREFIJO}Dani`,
        apellido: 'Nueve',
        email: `${PREFIJO}dani@prueba.test`,
      },
    ]
    datos.Supervisores = []
    datos.Feriados = []
    datos.Criterios = []
    const conErrores = join(carpeta, 'planilla-con-errores.xlsx')
    await writeFile(conErrores, await crearPlanilla(datos))

    salidas.length = 0
    const codigo = await ejecutarImportacion(
      [conErrores, '--salida', carpeta, '--resume'],
      { env, salida },
    )
    expect(codigo).toBe(1)
    expect(salidas.join('\n')).toContain('no se escribió nada')
    const { count } = await admin
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .like('legal_name', `${PREFIJO}Delta%`)
    expect(count).toBe(0)
    expect(
      (await cuentasConPrefijo()).some((c) => c.email.includes('dani')),
    ).toBe(false)
  })

  it('con IMPORT_ENTORNO apuntando a otro destino que la URL, se niega sin tocar la base', async () => {
    salidas.length = 0
    const codigo = await ejecutarImportacion([planilla, '--salida', carpeta], {
      env: { ...process.env, IMPORT_ENTORNO: 'app' },
      salida,
    })
    expect(codigo).toBe(2)
    expect(salidas.join('\n')).toContain('PRODUCCIÓN')
  })
})
