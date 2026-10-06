// tests/permissions/suite/escenario.ts — TEST-019 (P18.3)
//
// Datos que plantea el `globalSetup` una vez por corrida y que la matriz lee y ataca. Todos con
// el prefijo `e2e-perm-` y fechas relativas a hoy (hora de Argentina). Se limpian al final.
//
//   Cliente A / sede A / turno A: empleado1 y empleado2 (compañeros), supervisión de supervisor1.
//   Cliente B / sede B / turno B: empleado3, supervisión de supervisor2 (todo lo AJENO a A).
//   Turno D (cliente B): empleado4 y el doble rol asignados, y el doble rol supervisándolo (CB-13).
//
// `service_role` no puede llamar a las RPC de negocio ni insertar asignaciones (no hay
// `auth.uid()`): esas operaciones van con la sesión del dueño.

import { randomBytes } from 'node:crypto'
import type { AdminDb } from '../../fixtures/accounts.ts'
import { daysFromToday } from '../../fixtures/dates.ts'
import { deleteClientDeep } from '../../fixtures/scenario.ts'
import type { Db, IdsCuentas, IdsEscenario } from './contexto.ts'

export const PREFIJO = 'e2e-perm-'

/** Id que ninguna cuenta tiene: blanco de las acciones que no deben escribir nada. */
export const PERSONA_INEXISTENTE = '00000000-0000-4000-8000-000000000001'

export function nombreUnico(slug: string): string {
  return `${PREFIJO}${slug}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
}

export function cuitUnico(): string {
  return `20${`${Date.now()}`.slice(-8)}${Math.floor(Math.random() * 10)}`
}

async function ok<T>(
  que: string,
  consulta: PromiseLike<{
    data: T
    error: { message: string } | null
  }>,
): Promise<NonNullable<T>> {
  const { data, error } = await consulta
  if (error || data === null || data === undefined) {
    throw new Error(
      `Escenario de permisos, ${que}: ${error?.message ?? 'sin datos'}`,
    )
  }
  return data
}

/** Barre lo que haya dejado una corrida anterior cortada a la mitad. */
export async function barrerResiduos(db: AdminDb): Promise<number> {
  const { data } = await db
    .from('clients')
    .select('id')
    .like('legal_name', `${PREFIJO}%`)
  let barridos = 0
  for (const fila of data ?? []) {
    await deleteClientDeep(db, fila.id)
    barridos += 1
  }
  // Licencias de una corrida cortada: la siguiente chocaría con `employee_leaves_no_overlap`.
  await db.from('employee_leaves').delete().like('reason', `${PREFIJO}%`)
  await db.from('holidays').delete().like('name', `${PREFIJO}%`)
  await db.from('rating_criteria').delete().like('title', `${PREFIJO}%`)
  await db.from('security_events').delete().eq('details->>e2e', 'perm')
  // Eventos que dejan las acciones de la Edge Function sobre la persona inexistente de la matriz.
  await db.from('security_events').delete().eq('target_id', PERSONA_INEXISTENTE)
  return barridos
}

export async function plantar(
  db: AdminDb,
  dueno: Db,
  ids: IdsCuentas,
  fechaTurno: string,
): Promise<IdsEscenario> {
  const franja = { start: '08:00', end: '12:00' }

  const crearCliente = async (slug: string) =>
    (
      await ok(
        `cliente ${slug}`,
        db
          .from('clients')
          .insert({ legal_name: nombreUnico(slug), cuit: cuitUnico() })
          .select('id')
          .single(),
      )
    ).id
  const crearSede = async (clienteId: string, slug: string) =>
    (
      await ok(
        `sede ${slug}`,
        db
          .from('sites')
          .insert({
            client_id: clienteId,
            name: nombreUnico(slug),
            address: 'Calle de prueba 123',
          })
          .select('id')
          .single(),
      )
    ).id
  const crearTurno = async (clienteId: string, sedeId: string, slug: string) =>
    (
      await ok(
        `turno ${slug}`,
        db
          .from('shifts')
          .insert({
            client_id: clienteId,
            site_id: sedeId,
            shift_date: fechaTurno,
            start_time: franja.start,
            end_time: franja.end,
            required_staff: 3,
            notes: `${PREFIJO}${slug}`,
          })
          .select('id')
          .single(),
      )
    ).id
  const asignar = async (turnoId: string, empleadoId: string) => {
    const { data, error } = await dueno.rpc('assign_employee', {
      p_shift_id: turnoId,
      p_employee_id: empleadoId,
    })
    if (error)
      throw new Error(`Escenario de permisos, asignar: ${error.message}`)
    return (data as unknown as { assignment: { id: string } }).assignment.id
  }
  const supervisar = async (turnoId: string, supervisorId: string) => {
    const { data, error } = await dueno.rpc('assign_supervision', {
      p_shift_id: turnoId,
      p_supervisor_id: supervisorId,
    })
    if (error)
      throw new Error(`Escenario de permisos, supervisar: ${error.message}`)
    return (data as unknown as { supervision: { id: string } }).supervision.id
  }

  const clienteA = await crearCliente('a')
  const clienteB = await crearCliente('b')
  const sedeA = await crearSede(clienteA, 'sede-a')
  const sedeB = await crearSede(clienteB, 'sede-b')
  const turnoA = await crearTurno(clienteA, sedeA, 'turno-a')
  const turnoB = await crearTurno(clienteB, sedeB, 'turno-b')
  const turnoD = await crearTurno(clienteB, sedeB, 'turno-d')

  // Servicio pausado: no entra en ninguna generación de turnos de otras pruebas.
  const servicioA = (
    await ok(
      'servicio',
      db
        .from('services')
        .insert({
          client_id: clienteA,
          site_id: sedeA,
          name: nombreUnico('servicio-a'),
          weekdays: [1],
          start_time: franja.start,
          end_time: franja.end,
          valid_from: fechaTurno,
          status: 'paused',
        })
        .select('id')
        .single(),
    )
  ).id

  const asigE1 = await asignar(turnoA, ids.empleado1)
  const asigE2 = await asignar(turnoA, ids.empleado2)
  const asigE3 = await asignar(turnoB, ids.empleado3)
  const asigE4 = await asignar(turnoD, ids.empleado4)
  const asigDual = await asignar(turnoD, ids.dual)
  const supA = await supervisar(turnoA, ids.supervisor1)
  const supB = await supervisar(turnoB, ids.supervisor2)
  const supD = await supervisar(turnoD, ids.dual)
  // En curso, para que `rate_employee` llegue a la validación del puntaje (sin escribir nada).
  await ok(
    'supervisiones en curso',
    db
      .from('supervisions')
      .update({ status: 'in_progress' })
      .in('id', [supA, supB, supD])
      .select('id'),
  )

  const tarea = async (turnoId: string, slug: string) =>
    (
      await ok(
        `tarea ${slug}`,
        db
          .from('shift_tasks')
          .insert({
            shift_id: turnoId,
            position: 1,
            title: `${PREFIJO}${slug}`,
            is_required: true,
          })
          .select('id')
          .single(),
      )
    ).id
  const tareaA = await tarea(turnoA, 'tarea-a')
  const tareaB = await tarea(turnoB, 'tarea-b')

  const plantilla = async (clienteId: string, sedeId: string, slug: string) => {
    const id = (
      await ok(
        `plantilla ${slug}`,
        db
          .from('checklist_templates')
          .insert({
            client_id: clienteId,
            site_id: sedeId,
            name: `${PREFIJO}${slug}`,
          })
          .select('id')
          .single(),
      )
    ).id
    const item = (
      await ok(
        `ítem ${slug}`,
        db
          .from('checklist_template_items')
          .insert({
            template_id: id,
            position: 1,
            title: `${PREFIJO}${slug}-item`,
          })
          .select('id')
          .single(),
      )
    ).id
    return { id, item }
  }
  const plantillaA = await plantilla(clienteA, sedeA, 'plantilla-a')
  const plantillaB = await plantilla(clienteB, sedeB, 'plantilla-b')

  const contacto = async (clienteId: string, slug: string) =>
    (
      await ok(
        `contacto ${slug}`,
        db
          .from('client_contacts')
          .insert({ client_id: clienteId, name: `${PREFIJO}${slug}` })
          .select('id')
          .single(),
      )
    ).id
  const contactoA = await contacto(clienteA, 'contacto-a')
  const contactoB = await contacto(clienteB, 'contacto-b')

  const disponibilidad = async (empleadoId: string) =>
    (
      await ok(
        'disponibilidad',
        db
          .from('employee_availability')
          .insert({
            employee_id: empleadoId,
            weekday: 1,
            start_time: '08:00',
            end_time: '12:00',
          })
          .select('id')
          .single(),
      )
    ).id
  const disponibilidadE1 = await disponibilidad(ids.empleado1)
  const disponibilidadE3 = await disponibilidad(ids.empleado3)

  const licencia = async (empleadoId: string) =>
    (
      await ok(
        'licencia',
        db
          .from('employee_leaves')
          .insert({
            employee_id: empleadoId,
            starts_on: daysFromToday(120),
            ends_on: daysFromToday(121),
            reason: `${PREFIJO}licencia`,
          })
          .select('id')
          .single(),
      )
    ).id
  const licenciaE1 = await licencia(ids.empleado1)
  const licenciaE3 = await licencia(ids.empleado3)

  await ok(
    'habilitaciones',
    db
      .from('employee_client_permissions')
      .insert([
        { employee_id: ids.empleado1, client_id: clienteA },
        { employee_id: ids.empleado3, client_id: clienteB },
      ])
      .select('client_id'),
  )

  const asistencia = async (asignacionId: string) =>
    (
      await ok(
        'asistencia',
        db
          .from('attendance_records')
          .insert({
            assignment_id: asignacionId,
            kind: 'check_in',
            recorded_at: new Date().toISOString(),
            source: 'admin',
            reason: `${PREFIJO}asistencia`,
          })
          .select('id')
          .single(),
      )
    ).id
  const asistenciaE1 = await asistencia(asigE1)
  const asistenciaE2 = await asistencia(asigE2)
  const asistenciaE3 = await asistencia(asigE3)

  const aviso = async (asignacionId: string) =>
    (
      await ok(
        'aviso',
        db
          .from('attendance_notices')
          .insert({
            assignment_id: asignacionId,
            kind: 'delay',
            minutes_late: 5,
            source: 'admin',
            reason_text: `${PREFIJO}aviso`,
          })
          .select('id')
          .single(),
      )
    ).id
  const avisoE1 = await aviso(asigE1)
  const avisoE2 = await aviso(asigE2)
  const avisoE3 = await aviso(asigE3)

  const calificacion = async (supervisionId: string, asignacionId: string) =>
    (
      await ok(
        'calificación',
        db
          .from('ratings')
          .insert({
            supervision_id: supervisionId,
            assignment_id: asignacionId,
            score: 4,
            comment: `${PREFIJO}calificacion`,
          })
          .select('id')
          .single(),
      )
    ).id
  const calificacionA = await calificacion(supA, asigE1)
  const calificacionB = await calificacion(supB, asigE3)

  const asistSup = async (supervisionId: string) =>
    (
      await ok(
        'asistencia de supervisión',
        db
          .from('supervision_attendance')
          .insert({
            supervision_id: supervisionId,
            kind: 'check_in',
            recorded_at: new Date().toISOString(),
          })
          .select('id')
          .single(),
      )
    ).id
  const asistSupA = await asistSup(supA)
  const asistSupB = await asistSup(supB)

  const criterio = (
    await ok(
      'criterio',
      db
        .from('rating_criteria')
        .insert({ position: 98, title: `${PREFIJO}criterio` })
        .select('id')
        .single(),
    )
  ).id
  const feriado = (
    await ok(
      'feriado',
      db
        .from('holidays')
        .insert({ holiday_date: '2191-03-05', name: `${PREFIJO}feriado` })
        .select('id')
        .single(),
    )
  ).id
  const evento = (
    await ok(
      'evento de seguridad',
      db
        .from('security_events')
        .insert({ event_type: 'sign_in_failed', details: { e2e: 'perm' } })
        .select('id')
        .single(),
    )
  ).id

  return {
    clienteA,
    clienteB,
    sedeA,
    sedeB,
    servicioA,
    turnoA,
    turnoB,
    turnoD,
    asigE1,
    asigE2,
    asigE3,
    asigE4,
    asigDual,
    supA,
    supB,
    supD,
    tareaA,
    tareaB,
    plantillaA: plantillaA.id,
    plantillaB: plantillaB.id,
    itemA: plantillaA.item,
    itemB: plantillaB.item,
    contactoA,
    contactoB,
    disponibilidadE1,
    disponibilidadE3,
    licenciaE1,
    licenciaE3,
    asistenciaE1,
    asistenciaE2,
    asistenciaE3,
    avisoE1,
    avisoE2,
    avisoE3,
    calificacionA,
    calificacionB,
    asistSupA,
    asistSupB,
    criterio,
    feriado,
    evento,
  }
}

/** Borra todo lo plantado. Devuelve las notas de lo que no se pudo borrar. */
export async function limpiar(db: AdminDb, e: IdsEscenario): Promise<string[]> {
  const notas: string[] = []
  for (const clienteId of [e.clienteA, e.clienteB]) {
    notas.push(...(await deleteClientDeep(db, clienteId)))
  }
  const borrar = async (
    que: string,
    consulta: PromiseLike<{ error: { message: string } | null }>,
  ) => {
    const { error } = await consulta
    if (error) notas.push(`${que}: ${error.message}`)
  }
  await borrar(
    'criterio',
    db.from('rating_criteria').delete().eq('id', e.criterio),
  )
  await borrar('feriado', db.from('holidays').delete().eq('id', e.feriado))
  await borrar(
    'evento',
    db.from('security_events').delete().eq('details->>e2e', 'perm'),
  )
  await borrar(
    'eventos de la persona inexistente',
    db.from('security_events').delete().eq('target_id', PERSONA_INEXISTENTE),
  )
  await borrar(
    'disponibilidad',
    db
      .from('employee_availability')
      .delete()
      .in('id', [e.disponibilidadE1, e.disponibilidadE3]),
  )
  await borrar(
    'licencias',
    db.from('employee_leaves').delete().in('id', [e.licenciaE1, e.licenciaE3]),
  )
  return notas
}
