// tests/permissions/suite/94-coordinacion.permissions.ts — P24.5
//
// Coordinación libre y jornada del coordinador (migración 0063, P24.1; decisiones CJ-01 a CJ-34 de
// `Docs/Plan_Maestro/modulos/P24_coordinacion_libre_y_jornada.md`), por API directa con `supabase-js`
// y por rol: coordinador (`supervisor`), doble rol (otro coordinador), empleado, administrador sin y
// con capacidades, dueño y `anon`. La matriz genérica (`tablas.ts`, `vistas.ts`, `rpc.ts`,
// `40-capacidades`) ya cubre quién lee cada tabla y vista nueva y quién pasa la puerta de cada RPC
// sin escribir nada; acá se ejercitan con datos reales y escrituras:
//   1. Lectura: el coordinador ve lo propio, el empleado nada, las coordenadas no se leen directo.
//   2. El flujo del coordinador con el `hint` estable de cada bloqueo (jornada, supervisión, CJ-05
//      a CJ-10, CJ-27 a CJ-30).
//   3. Las RPC de administración (preferencias y correcciones de la jornada) con sus `hint` y por
//      capacidad (`manage_supervisions`, `manage_attendance`).
//   4. Las cuatro RPC revocadas dan 42501 a todos los perfiles, también al dueño (CJ-01, CJ-26).
// Todo con el prefijo `e2e-perm-` y fechas relativas a hoy en hora de Argentina; lo que se escribe
// se borra (las jornadas de hoy en el `afterAll`, el resto con el escenario).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { daysFromToday, isTooCloseToMidnight } from '../../fixtures/dates.ts'
import { borrarJornadasDe } from '../../fixtures/scenario.ts'
import { describir, filas, tabla } from './ayudas.ts'
import { clienteDe, contexto, servicio, type Db } from './contexto.ts'
import { PREFIJO } from './escenario.ts'
import { ETIQUETA, PERFILES } from './perfiles.ts'

const CERCA_DE_MEDIANOCHE = isTooCloseToMidnight()
const U = '00000000-0000-4000-8000-000000000001'
/** Obelisco, CABA: las sedes del escenario no tienen coordenadas, así que no se valida contra ellas. */
const POSICION = { p_lat: -34.6037, p_lng: -58.3816, p_accuracy: 12 }

/** El código observado de una respuesta: `OK`, `42501` o el `hint` estable. */
function codigo(res: {
  error: { code?: string; hint?: string | null } | null
}): string {
  if (!res.error) return 'OK'
  return res.error.code === '42501'
    ? '42501'
    : (res.error.hint ?? res.error.code ?? 'ERROR')
}

async function llamar(
  db: Db,
  rpc: string,
  args: Record<string, unknown> = {},
): Promise<{
  data: unknown
  error: { code?: string; hint?: string | null; message: string } | null
}> {
  return db.rpc(rpc as 'mark_changes_seen', args as never)
}

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'coordinación libre y jornada del coordinador: permisos por rol (P24)',
  () => {
    const c = () => contexto()
    let hoy: string
    /** Turno de hoy cancelado (CJ-25: no se supervisa). */
    let turnoCancelado = ''
    /** Segundo turno de hoy, para CJ-08. */
    let turnoDos = ''
    let asignacionE1 = ''
    /** Estado original del turno de hoy del escenario (el fichaje del empleado lo cambia). */
    let estadoTurnoHoy = ''
    /** Cuándo empezó este archivo (para borrar el rastro de seguridad que deja). */
    let desde = ''
    // Jornadas PROPIAS de este archivo, de supervisor2 (nadie más la usa), para corregirlas sin tocar
    // las del escenario que leen los demás archivos: el orden de los archivos no está garantizado.
    let jornadaCorregir = ''
    let jornadaPausa = ''
    const fechaCorregir = daysFromToday(-3)
    const fechaPausa = daysFromToday(-4)
    let supervisionSup1 = ''
    let supervisionDual = ''

    const sup = () => clienteDe('supervisor')
    const dual = () => clienteDe('dual')
    const emp = () => clienteDe('empleado')

    beforeAll(async () => {
      hoy = daysFromToday(0)
      desde = new Date().toISOString()
      const db = servicio()
      const { data: turnoDeHoy } = await db
        .from('shifts')
        .select('status')
        .eq('id', c().e.turnoHoy)
        .single()
      estadoTurnoHoy = turnoDeHoy!.status
      const jornadaPropia = async (fecha: string) => {
        const hora = (hhmm: string) => `${fecha}T${hhmm}:00-03:00`
        const { data, error } = await db
          .from('supervisor_workdays')
          .insert({
            supervisor_id: c().ids.supervisor2,
            work_date: fecha,
            started_at: hora('08:00'),
            ended_at: hora('16:00'),
          })
          .select('id')
          .single()
        if (error) throw new Error(`jornada propia: ${error.message}`)
        const eventos = await db.from('supervisor_workday_events').insert([
          {
            workday_id: data.id,
            kind: 'start' as const,
            recorded_at: hora('08:00'),
          },
          {
            workday_id: data.id,
            kind: 'end' as const,
            recorded_at: hora('16:00'),
          },
        ])
        if (eventos.error) throw new Error(`eventos: ${eventos.error.message}`)
        return data.id
      }
      jornadaCorregir = await jornadaPropia(fechaCorregir)
      jornadaPausa = await jornadaPropia(fechaPausa)
      const turno = async (slug: string, estado?: 'cancelled') => {
        const { data, error } = await db
          .from('shifts')
          .insert({
            client_id: c().e.clienteA,
            site_id: c().e.sedeA,
            shift_date: hoy,
            start_time: '00:00',
            end_time: '23:59',
            required_staff: 1,
            notes: `${PREFIJO}coord-${slug}`,
            ...(estado
              ? {
                  status: estado,
                  cancelled_at: new Date().toISOString(),
                  cancelled_by: c().ids.owner,
                  cancel_reason: `${PREFIJO}cancelado`,
                }
              : {}),
          })
          .select('id')
          .single()
        if (error) throw new Error(`turno ${slug}: ${error.message}`)
        return data.id
      }
      turnoCancelado = await turno('cancelado', 'cancelled')
      turnoDos = await turno('dos')
      // Un empleado asignado al turno de hoy que ya empezó: hay que calificarlo para cerrar (CJ-10).
      const asignar = await clienteDe('owner').rpc('assign_employee', {
        p_shift_id: c().e.turnoHoy,
        p_employee_id: c().ids.empleado1,
      })
      if (asignar.error) throw new Error(`asignar: ${asignar.error.message}`)
      asignacionE1 = (asignar.data as unknown as { assignment: { id: string } })
        .assignment.id
      const fichar = await emp().rpc('record_check_in', {
        p_assignment_id: asignacionE1,
      })
      if (fichar.error) throw new Error(`fichar: ${fichar.error.message}`)
    }, 120_000)

    afterAll(async () => {
      // Deja todo como estaba: otros archivos leen el escenario y el orden entre archivos no está
      // garantizado (Vitest corre primero los que fallaron la vez anterior).
      const db = servicio()
      const notas: string[] = []
      const nota = (que: string, error: { message: string } | null) => {
        if (error) notas.push(`${que}: ${error.message}`)
      }
      const turnos = [c().e.turnoHoy, turnoDos, turnoCancelado].filter(Boolean)
      const { data: supervisiones } = await db
        .from('supervisions')
        .select('id')
        .in('shift_id', turnos)
      const supIds = (supervisiones ?? []).map((s) => s.id)
      // Primero las jornadas (sueltan `workday_id` de las supervisiones y borran sus eventos).
      notas.push(
        ...(await borrarJornadasDe(
          db,
          [c().ids.supervisor1, c().ids.dual],
          hoy,
        )),
      )
      notas.push(...(await borrarJornadasDe(db, [c().ids.supervisor2])))
      if (supIds.length > 0) {
        nota(
          'eventos de supervisión',
          (
            await db
              .from('supervisor_workday_events')
              .delete()
              .in('supervision_id', supIds)
          ).error,
        )
        nota(
          'ratings',
          (await db.from('ratings').delete().in('supervision_id', supIds))
            .error,
        )
        nota(
          'supervision_attendance',
          (
            await db
              .from('supervision_attendance')
              .delete()
              .in('supervision_id', supIds)
          ).error,
        )
        nota(
          'supervisions',
          (await db.from('supervisions').delete().in('id', supIds)).error,
        )
      }
      if (asignacionE1) {
        nota(
          'attendance_records',
          (
            await db
              .from('attendance_records')
              .delete()
              .eq('assignment_id', asignacionE1)
          ).error,
        )
        nota(
          'assignments',
          (await db.from('assignments').delete().eq('id', asignacionE1)).error,
        )
      }
      const propios = [turnoDos, turnoCancelado].filter(Boolean)
      if (propios.length > 0) {
        nota(
          'shifts',
          (await db.from('shifts').delete().in('id', propios)).error,
        )
      }
      if (estadoTurnoHoy) {
        nota(
          'estado del turno de hoy',
          (
            await db
              .from('shifts')
              .update({ status: estadoTurnoHoy as 'scheduled' })
              .eq('id', c().e.turnoHoy)
          ).error,
        )
      }
      nota(
        'security_events',
        (
          await db
            .from('security_events')
            .delete()
            .eq('event_type', 'workday_corrected')
            .gte('created_at', desde)
        ).error,
      )
      if (notas.length > 0) {
        console.warn(
          `[94-coordinacion] limpieza con notas: ${notas.join(' | ')}`,
        )
      }
    }, 120_000)

    // -----------------------------------------------------------------------------------------
    // 1. Lectura
    // -----------------------------------------------------------------------------------------

    describe('lectura de las tablas y vistas nuevas', () => {
      it('[coordinador] ve su jornada y su preferencia y nada de las ajenas (RB-S01, CJ-03, CJ-12)', async () => {
        const jornadas = await tabla(sup(), 'supervisor_workdays').select('id')
        expect(jornadas.error, describir(jornadas)).toBeNull()
        expect(filas(jornadas).map((f) => f.id)).toEqual([c().e.jornadaSup1])
        const prioridades = await tabla(sup(), 'supervisor_priorities').select(
          'id',
        )
        expect(filas(prioridades).map((f) => f.id)).toEqual([
          c().e.prioridadSup1,
        ])
        const ajena = await tabla(sup(), 'supervisor_workdays')
          .select('id')
          .eq('id', c().e.jornadaDual)
        expect(filas(ajena), 'la jornada de otro coordinador').toEqual([])
      })

      it('[otro coordinador, doble rol] ve su jornada y no la de supervisor1 (RB-S02, CJ-05)', async () => {
        const jornadas = await tabla(dual(), 'supervisor_workdays').select('id')
        expect(filas(jornadas).map((f) => f.id)).toEqual([c().e.jornadaDual])
      })

      for (const perfil of ['empleado', 'anon'] as const) {
        it(`[${ETIQUETA[perfil]}] no lee nada de la coordinación: ni tablas ni vistas (RB-X02, P-084)`, async () => {
          for (const nombre of [
            'supervisor_workdays',
            'supervisor_priorities',
            'supervisor_workday_events',
            'v_my_workdays',
            'v_supervisor_today',
            'v_supervisor_status',
            'v_supervisor_workdays_admin',
          ]) {
            const res = await tabla(clienteDe(perfil), nombre)
              .select('*')
              .limit(5)
            if (perfil === 'anon') {
              expect(res.error?.code, `${nombre}: ${describir(res)}`).toBe(
                '42501',
              )
            } else {
              // Tablas con select por columna: pedir `*` da 42501; lo que no puede dar es contenido.
              expect(
                res.error ? [] : filas(res),
                `${nombre} no puede traer filas`,
              ).toEqual([])
            }
          }
        })
      }

      it('[coordinador] v_supervisor_today lista los turnos de hoy de todos los clientes, con su preferencia (CJ-02, CJ-24, CJ-25)', async () => {
        const res = await tabla(sup(), 'v_supervisor_today')
          .select(
            'shift_id, client_id, is_priority, priority_kind, display_state',
          )
          .in('shift_id', [c().e.turnoHoy, turnoDos])
        expect(res.error, describir(res)).toBeNull()
        const porTurno = new Map(
          filas(res).map((f) => [String(f.shift_id), f] as const),
        )
        // El cliente A es preferencial de supervisor1 por cliente entero (CJ-24).
        expect(porTurno.get(c().e.turnoHoy)).toMatchObject({
          client_id: c().e.clienteA,
          is_priority: true,
          priority_kind: 'client',
        })
        expect(porTurno.get(turnoDos)).toMatchObject({ is_priority: true })
        // El turno cancelado no figura (CJ-25).
        const cancelado = await tabla(sup(), 'v_supervisor_today')
          .select('shift_id')
          .eq('shift_id', turnoCancelado)
        expect(filas(cancelado)).toEqual([])
      })

      it('[otro coordinador] el mismo turno NO es preferencial para quien no lo eligió (CJ-24, RB-S02)', async () => {
        const res = await tabla(dual(), 'v_supervisor_today')
          .select('shift_id, is_priority')
          .eq('shift_id', c().e.turnoHoy)
        expect(filas(res)).toHaveLength(1)
        // El doble rol prefiere el cliente B, no el A.
        expect(filas(res)[0].is_priority).toBe(false)
      })

      for (const perfil of PERFILES) {
        it(`[${ETIQUETA[perfil]}] las coordenadas de los eventos no se leen con select directo, ni siquiera administración (B-40, CJ-20)`, async () => {
          for (const columna of ['latitude', 'longitude', 'accuracy_m']) {
            const res = await tabla(
              clienteDe(perfil),
              'supervisor_workday_events',
            )
              .select(columna)
              .limit(1)
            expect(res.error?.code, `${columna}: ${describir(res)}`).toBe(
              '42501',
            )
          }
        })
      }

      it('[administración] ve si el evento trae posición (has_position) y las vistas de administración traen la posición (CJ-33)', async () => {
        for (const perfil of ['adminSin', 'admin', 'owner'] as const) {
          const eventos = await tabla(
            clienteDe(perfil),
            'supervisor_workday_events',
          )
            .select('id, has_position')
            .in('id', [c().e.eventoJornadaSup1, c().e.eventoJornadaDual])
          expect(eventos.error, describir(eventos)).toBeNull()
          expect(filas(eventos)).toHaveLength(2)
          expect(filas(eventos).every((f) => f.has_position === true)).toBe(
            true,
          )
        }
        const jornada = await tabla(
          clienteDe('admin'),
          'v_supervisor_workdays_admin',
        )
          .select('id, state, worked_minutes, events')
          .eq('id', c().e.jornadaSup1)
        expect(filas(jornada)).toHaveLength(1)
        expect(filas(jornada)[0].state).toBe('ended')
        // 08:00 a 16:00 sin pausas: 480 minutos netos (CJ-13).
        expect(Number(filas(jornada)[0].worked_minutes)).toBe(480)
        expect(JSON.stringify(filas(jornada)[0].events)).not.toMatch(
          /latitude|longitude/,
        )
      })

      for (const perfil of PERFILES) {
        it(`[${ETIQUETA[perfil]}] la función de posición de la base no se expone en la API (workday_event_position)`, async () => {
          const res = await llamar(
            clienteDe(perfil),
            'workday_event_position',
            {
              p_event_id: c().e.eventoJornadaSup1,
            },
          )
          expect(
            res.error,
            'la función de app no debería existir en /rest',
          ).not.toBeNull()
          expect(['PGRST202', '42501', '404']).toContain(res.error?.code ?? '')
        })
      }
    })

    // -----------------------------------------------------------------------------------------
    // 2. El flujo del coordinador, con el hint de cada bloqueo
    // -----------------------------------------------------------------------------------------

    describe('la jornada y la supervisión: cada bloqueo con su hint (RB-S01, CJ-05 a CJ-10, CJ-27 a CJ-30)', () => {
      it('sin jornada: pausar, reanudar, finalizar, reabrir y tomar un turno dan WORKDAY_NOT_STARTED (CJ-07)', async () => {
        for (const rpc of [
          'pause_workday',
          'resume_workday',
          'end_workday',
          'reopen_workday',
        ]) {
          expect(codigo(await llamar(sup(), rpc)), rpc).toBe(
            'WORKDAY_NOT_STARTED',
          )
        }
        expect(
          codigo(
            await llamar(sup(), 'take_supervision', {
              p_shift_id: c().e.turnoHoy,
            }),
          ),
        ).toBe('WORKDAY_NOT_STARTED')
      })

      it('iniciar: la ubicación incompleta o fuera de rango se rechaza y no crea la jornada (CJ-20)', async () => {
        expect(
          codigo(await llamar(sup(), 'start_workday', { p_lat: -34.6 })),
        ).toBe('COORDINATES_INCOMPLETE')
        expect(
          codigo(
            await llamar(sup(), 'start_workday', {
              p_lat: 91,
              p_lng: 0,
              p_accuracy: 1,
            }),
          ),
        ).toBe('COORDINATES_OUT_OF_RANGE')
        const { data } = await servicio()
          .from('supervisor_workdays')
          .select('id')
          .eq('supervisor_id', c().ids.supervisor1)
          .eq('work_date', hoy)
        expect(data).toHaveLength(0)
      })

      it('iniciar con posición: queda en marcha, una sola por día (WORKDAY_ALREADY_STARTED, CJ-30) y los demás roles no pueden', async () => {
        const res = await llamar(sup(), 'start_workday', POSICION)
        expect(res.error, describir(res as never)).toBeNull()
        const estado = res.data as { state: string; workday_id: string }
        expect(estado.state).toBe('running')
        expect(codigo(await llamar(sup(), 'start_workday'))).toBe(
          'WORKDAY_ALREADY_STARTED',
        )
        // Solo el coordinador: el empleado, la administración y el dueño reciben FORBIDDEN; anon, 42501.
        for (const perfil of [
          'empleado',
          'adminSin',
          'admin',
          'owner',
        ] as const) {
          expect(
            codigo(await llamar(clienteDe(perfil), 'start_workday')),
            ETIQUETA[perfil],
          ).toBe('FORBIDDEN')
        }
        expect(codigo(await llamar(clienteDe('anon'), 'start_workday'))).toBe(
          '42501',
        )
        // La posición quedó guardada pero no es legible directo (sí por has_position).
        const { data: ev } = await servicio()
          .from('supervisor_workday_events')
          .select('kind, latitude, has_position')
          .eq('workday_id', estado.workday_id)
        expect(ev).toHaveLength(1)
        expect(ev![0]).toMatchObject({ kind: 'start', has_position: true })
        expect(ev![0].latitude).not.toBeNull()
      })

      it('en marcha: reanudar es WORKDAY_NOT_PAUSED y reabrir es WORKDAY_NOT_ENDED', async () => {
        expect(codigo(await llamar(sup(), 'resume_workday'))).toBe(
          'WORKDAY_NOT_PAUSED',
        )
        expect(codigo(await llamar(sup(), 'reopen_workday'))).toBe(
          'WORKDAY_NOT_ENDED',
        )
      })

      it('pausar: el motivo es opcional (CJ-16) pero admite 300 caracteres; en pausa no se supervisa (CJ-07) y no se pausa de nuevo', async () => {
        expect(
          codigo(
            await llamar(sup(), 'pause_workday', { p_reason: 'x'.repeat(301) }),
          ),
        ).toBe('REASON_TOO_LONG')
        const pausa = await llamar(sup(), 'pause_workday', {
          p_reason: 'e2e-perm: almuerzo',
        })
        expect(pausa.error, describir(pausa as never)).toBeNull()
        expect((pausa.data as { state: string }).state).toBe('paused')
        expect(codigo(await llamar(sup(), 'pause_workday'))).toBe(
          'WORKDAY_PAUSED',
        )
        expect(
          codigo(
            await llamar(sup(), 'take_supervision', {
              p_shift_id: c().e.turnoHoy,
            }),
          ),
        ).toBe('WORKDAY_PAUSED')
        const reanuda = await llamar(sup(), 'resume_workday')
        expect(reanuda.error, describir(reanuda as never)).toBeNull()
        expect((reanuda.data as { state: string }).state).toBe('running')
      })

      it('tomar un turno: inexistente, cancelado, de otro día y de hoy (CJ-06, CJ-25, CJ-26)', async () => {
        expect(
          codigo(await llamar(sup(), 'take_supervision', { p_shift_id: U })),
        ).toBe('SHIFT_NOT_FOUND')
        expect(
          codigo(
            await llamar(sup(), 'take_supervision', {
              p_shift_id: turnoCancelado,
            }),
          ),
        ).toBe('SHIFT_NOT_SUPERVISABLE')
        expect(
          codigo(
            await llamar(sup(), 'take_supervision', {
              p_shift_id: c().e.turnoA,
            }),
          ),
        ).toBe('NOT_TODAY')
        expect(
          codigo(
            await llamar(sup(), 'take_supervision', {
              p_shift_id: c().e.turnoHoy,
              p_lat: -34.6,
            }),
          ),
        ).toBe('COORDINATES_INCOMPLETE')
        const toma = await llamar(sup(), 'take_supervision', {
          p_shift_id: c().e.turnoHoy,
          ...POSICION,
        })
        expect(toma.error, describir(toma as never)).toBeNull()
        const cuerpo = toma.data as {
          supervision: { id: string; status: string; workday_id: string }
          check_in: { kind: string }
          warnings: string[]
        }
        expect(cuerpo.supervision.status).toBe('in_progress')
        expect(cuerpo.supervision.workday_id).not.toBeNull()
        expect(cuerpo.check_in.kind).toBe('check_in')
        expect(cuerpo.warnings).toEqual([])
        supervisionSup1 = cuerpo.supervision.id
      })

      it('de a una y una por turno: SUPERVISION_ALREADY_OPEN; con una abierta no se pausa ni se finaliza (SUPERVISION_OPEN, CJ-08, CJ-29)', async () => {
        expect(
          codigo(
            await llamar(sup(), 'take_supervision', { p_shift_id: turnoDos }),
          ),
        ).toBe('SUPERVISION_ALREADY_OPEN')
        expect(
          codigo(
            await llamar(sup(), 'take_supervision', {
              p_shift_id: c().e.turnoHoy,
            }),
          ),
        ).toBe('SUPERVISION_ALREADY_OPEN')
        expect(codigo(await llamar(sup(), 'pause_workday'))).toBe(
          'SUPERVISION_OPEN',
        )
        expect(codigo(await llamar(sup(), 'end_workday'))).toBe(
          'SUPERVISION_OPEN',
        )
      })

      it('dos coordinadores en el mismo turno (CJ-05) y la supervisión del otro no se toca (NOT_YOUR_SUPERVISION)', async () => {
        expect(codigo(await llamar(dual(), 'start_workday', POSICION))).toBe(
          'OK',
        )
        const toma = await llamar(dual(), 'take_supervision', {
          p_shift_id: c().e.turnoHoy,
          ...POSICION,
        })
        expect(toma.error, describir(toma as never)).toBeNull()
        supervisionDual = (toma.data as { supervision: { id: string } })
          .supervision.id
        expect(supervisionDual).not.toBe(supervisionSup1)
        const { data } = await servicio()
          .from('supervisions')
          .select('supervisor_id, status')
          .eq('shift_id', c().e.turnoHoy)
          .in('id', [supervisionSup1, supervisionDual])
        expect(data).toHaveLength(2)
        expect(new Set(data!.map((s) => s.supervisor_id)).size).toBe(2)

        // Ninguno toca la del otro.
        for (const [quien, ajena] of [
          [sup(), supervisionDual],
          [dual(), supervisionSup1],
        ] as const) {
          expect(
            codigo(
              await llamar(quien, 'discard_supervision', {
                p_supervision_id: ajena,
              }),
            ),
          ).toBe('NOT_YOUR_SUPERVISION')
          expect(
            codigo(
              await llamar(quien, 'complete_supervision', {
                p_supervision_id: ajena,
              }),
            ),
          ).toBe('NOT_YOUR_SUPERVISION')
          expect(
            codigo(
              await llamar(quien, 'rate_employee', {
                p_supervision_id: ajena,
                p_assignment_id: asignacionE1,
                p_score: 3,
              }),
            ),
          ).toBe('NOT_YOUR_SUPERVISION')
        }
        // Y el empleado y la administración (sin ser coordinadores) tampoco.
        for (const perfil of ['empleado', 'adminSin'] as const) {
          expect(
            codigo(
              await llamar(clienteDe(perfil), 'discard_supervision', {
                p_supervision_id: supervisionSup1,
              }),
            ),
            ETIQUETA[perfil],
          ).toBe('FORBIDDEN')
        }
      })

      it('cerrar exige calificar a todos los empleados con inicio (RATINGS_PENDING con los nombres, CJ-10, CJ-28) y cada coordinador califica con su criterio (CJ-09, CJ-11)', async () => {
        const pendiente = await llamar(sup(), 'complete_supervision', {
          p_supervision_id: supervisionSup1,
        })
        expect(codigo(pendiente)).toBe('RATINGS_PENDING')
        expect(pendiente.error?.message).toMatch(/^Falta calificar a: /)
        const { data: empleado } = await servicio()
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', c().ids.empleado1)
          .single()
        expect(pendiente.error?.message).toContain(
          `${empleado!.first_name} ${empleado!.last_name}`,
        )

        // Cada coordinador califica al mismo empleado con su criterio: dos filas, una por supervisión.
        const nota1 = await llamar(sup(), 'rate_employee', {
          p_supervision_id: supervisionSup1,
          p_assignment_id: asignacionE1,
          p_score: 2,
        })
        expect(nota1.error, describir(nota1 as never)).toBeNull()
        const nota2 = await llamar(dual(), 'rate_employee', {
          p_supervision_id: supervisionDual,
          p_assignment_id: asignacionE1,
          p_score: 5,
        })
        expect(nota2.error, describir(nota2 as never)).toBeNull()
        const { data: notas } = await servicio()
          .from('ratings')
          .select('supervision_id, score')
          .eq('assignment_id', asignacionE1)
        expect(
          notas!.map((n) => n.score).sort(),
          'dos calificaciones del mismo empleado en el mismo turno',
        ).toEqual([2, 5])
      })

      it('con una calificación cargada ya no se descarta (SUPERVISION_HAS_RATINGS, CJ-27)', async () => {
        expect(
          codigo(
            await llamar(dual(), 'discard_supervision', {
              p_supervision_id: supervisionDual,
            }),
          ),
        ).toBe('SUPERVISION_HAS_RATINGS')
      })

      it('el empleado sigue sin leer calificaciones y administración las ve por separado (CB-15, P-084, CJ-11)', async () => {
        const propias = await tabla(emp(), 'ratings').select('*')
        expect(propias.error, describir(propias)).toBeNull()
        expect(filas(propias)).toEqual([])
        const todas = await tabla(clienteDe('admin'), 'ratings')
          .select('supervision_id, score')
          .eq('assignment_id', asignacionE1)
        expect(filas(todas)).toHaveLength(2)
      })

      it('cerrar con todo calificado registra el fin; descartar solo antes de cerrar y volver a tomar el turno (CJ-26, CJ-27)', async () => {
        const cierre = await llamar(sup(), 'complete_supervision', {
          p_supervision_id: supervisionSup1,
          p_general_notes: 'e2e-perm: nota',
          ...POSICION,
        })
        expect(cierre.error, describir(cierre as never)).toBeNull()
        const { data: marcas } = await servicio()
          .from('supervision_attendance')
          .select('kind')
          .eq('supervision_id', supervisionSup1)
        expect((marcas ?? []).map((m) => m.kind).sort()).toEqual([
          'check_in',
          'check_out',
        ])
        // Ya cerrada: no se descarta ni se vuelve a cerrar.
        expect(
          codigo(
            await llamar(sup(), 'discard_supervision', {
              p_supervision_id: supervisionSup1,
            }),
          ),
        ).toBe('SUPERVISION_NOT_EDITABLE')
        expect(
          codigo(
            await llamar(sup(), 'complete_supervision', {
              p_supervision_id: supervisionSup1,
            }),
          ),
        ).toBe('SUPERVISION_NOT_EDITABLE')
        // Una por coordinador y por turno: no se vuelve a tomar.
        expect(
          codigo(
            await llamar(sup(), 'take_supervision', {
              p_shift_id: c().e.turnoHoy,
            }),
          ),
        ).toBe('ALREADY_SUPERVISED')

        // Descartar una empezada por error (sin calificar): queda cancelada y se puede volver a tomar.
        const toma = await llamar(sup(), 'take_supervision', {
          p_shift_id: turnoDos,
        })
        expect(toma.error, describir(toma as never)).toBeNull()
        const porError = (toma.data as { supervision: { id: string } })
          .supervision.id
        const descarte = await llamar(sup(), 'discard_supervision', {
          p_supervision_id: porError,
        })
        expect(descarte.error, describir(descarte as never)).toBeNull()
        const { data: fila } = await servicio()
          .from('supervisions')
          .select('status, cancel_reason')
          .eq('id', porError)
          .single()
        expect(fila).toEqual({
          status: 'cancelled',
          cancel_reason: 'Descartada por el coordinador',
        })
        const otraVez = await llamar(sup(), 'take_supervision', {
          p_shift_id: turnoDos,
        })
        expect(otraVez.error, describir(otraVez as never)).toBeNull()
        const abierta = (otraVez.data as { supervision: { id: string } })
          .supervision.id
        expect(
          codigo(
            await llamar(sup(), 'discard_supervision', {
              p_supervision_id: abierta,
            }),
          ),
        ).toBe('OK')
      })

      it('finalizar, no repetir y reabrir (WORKDAY_ENDED, CJ-30); terminada la jornada no se supervisa', async () => {
        const fin = await llamar(sup(), 'end_workday')
        expect(fin.error, describir(fin as never)).toBeNull()
        expect((fin.data as { state: string }).state).toBe('ended')
        expect(codigo(await llamar(sup(), 'end_workday'))).toBe('WORKDAY_ENDED')
        expect(codigo(await llamar(sup(), 'pause_workday'))).toBe(
          'WORKDAY_ENDED',
        )
        expect(codigo(await llamar(sup(), 'resume_workday'))).toBe(
          'WORKDAY_ENDED',
        )
        expect(
          codigo(
            await llamar(sup(), 'take_supervision', { p_shift_id: turnoDos }),
          ),
        ).toBe('WORKDAY_ENDED')
        const reabre = await llamar(sup(), 'reopen_workday')
        expect(reabre.error, describir(reabre as never)).toBeNull()
        expect((reabre.data as { state: string }).state).toBe('running')
      })

      it('mientras la jornada está en curso la administración la ve en el mapa (v_supervisor_status, CJ-22, CJ-33) y los coordinadores no', async () => {
        const res = await tabla(clienteDe('admin'), 'v_supervisor_status')
          .select('supervisor_id, status, latitude, worked_minutes')
          .in('supervisor_id', [c().ids.supervisor1, c().ids.dual])
        expect(res.error, describir(res)).toBeNull()
        const porId = new Map(
          filas(res).map((f) => [String(f.supervisor_id), f] as const),
        )
        // supervisor1 reabrió su jornada: en actividad; el doble rol sigue supervisando.
        expect(porId.get(c().ids.supervisor1)?.status).toBe('in_activity')
        expect(porId.get(c().ids.dual)?.status).toBe('supervising')
        expect(porId.get(c().ids.dual)?.latitude).not.toBeNull()
        for (const perfil of ['supervisor', 'dual', 'empleado'] as const) {
          const propia = await tabla(
            clienteDe(perfil),
            'v_supervisor_status',
          ).select('*')
          expect(filas(propia), ETIQUETA[perfil]).toEqual([])
        }
      })

      it('licencia hoy: no se inicia la jornada (ON_LEAVE, CJ-29) y la jornada sin iniciar no se crea', async () => {
        const db = servicio()
        // El doble rol ya inició su jornada: se la quita para probar el inicio con licencia.
        await borrarJornadasDe(db, [c().ids.dual], hoy)
        const { data: licencia, error } = await db
          .from('employee_leaves')
          .insert({
            employee_id: c().ids.dual,
            starts_on: hoy,
            ends_on: hoy,
            reason: `${PREFIJO}licencia-hoy`,
          })
          .select('id')
          .single()
        expect(error?.message).toBeUndefined()
        try {
          expect(codigo(await llamar(dual(), 'start_workday'))).toBe('ON_LEAVE')
          const { data } = await db
            .from('supervisor_workdays')
            .select('id')
            .eq('supervisor_id', c().ids.dual)
            .eq('work_date', hoy)
          expect(data).toHaveLength(0)
        } finally {
          await db.from('employee_leaves').delete().eq('id', licencia!.id)
        }
      })
    })

    // -----------------------------------------------------------------------------------------
    // 3. Administración: preferencias y correcciones de la jornada, por capacidad
    // -----------------------------------------------------------------------------------------

    describe('preferencias del coordinador (manage_supervisions, CJ-03, CJ-24)', () => {
      const creadas: string[] = []
      afterAll(async () => {
        if (creadas.length > 0) {
          await servicio()
            .from('supervisor_priorities')
            .delete()
            .in('id', creadas)
        }
      })

      it('las valida y las crea con su hint; solo O y A con la capacidad; baja lógica sin borrado físico (P-014)', async () => {
        const admin = clienteDe('admin')
        // Ni cliente ni sede, o las dos cosas.
        expect(
          codigo(
            await llamar(admin, 'set_supervisor_priority', {
              p_supervisor_id: c().ids.supervisor1,
            }),
          ),
        ).toBe('INVALID_PRIORITY_TARGET')
        expect(
          codigo(
            await llamar(admin, 'set_supervisor_priority', {
              p_supervisor_id: c().ids.supervisor1,
              p_client_id: c().e.clienteA,
              p_site_id: c().e.sedeA,
            }),
          ),
        ).toBe('INVALID_PRIORITY_TARGET')
        // Quien no es coordinador, cliente y sede inexistentes.
        expect(
          codigo(
            await llamar(admin, 'set_supervisor_priority', {
              p_supervisor_id: c().ids.empleado1,
              p_client_id: c().e.clienteA,
            }),
          ),
        ).toBe('SUPERVISOR_ROLE_REQUIRED')
        expect(
          codigo(
            await llamar(admin, 'set_supervisor_priority', {
              p_supervisor_id: c().ids.supervisor1,
              p_client_id: U,
            }),
          ),
        ).toBe('CLIENT_NOT_FOUND')
        expect(
          codigo(
            await llamar(admin, 'set_supervisor_priority', {
              p_supervisor_id: c().ids.supervisor1,
              p_site_id: U,
            }),
          ),
        ).toBe('SITE_NOT_FOUND')

        // Sin la capacidad o sin ser administración: FORBIDDEN.
        for (const perfil of [
          'empleado',
          'supervisor',
          'dual',
          'adminSin',
        ] as const) {
          expect(
            codigo(
              await llamar(clienteDe(perfil), 'set_supervisor_priority', {
                p_supervisor_id: c().ids.supervisor1,
                p_site_id: c().e.sedeB,
              }),
            ),
            ETIQUETA[perfil],
          ).toBe('FORBIDDEN')
        }
        expect(
          codigo(
            await llamar(clienteDe('anon'), 'set_supervisor_priority', {
              p_supervisor_id: c().ids.supervisor1,
              p_site_id: c().e.sedeB,
            }),
          ),
        ).toBe('42501')

        // El administrador con la capacidad y el dueño la crean (una sede de otro cliente).
        const creada = await llamar(admin, 'set_supervisor_priority', {
          p_supervisor_id: c().ids.supervisor1,
          p_site_id: c().e.sedeB,
        })
        expect(creada.error, describir(creada as never)).toBeNull()
        const id = (creada.data as { id: string }).id
        creadas.push(id)
        expect(
          codigo(
            await llamar(admin, 'set_supervisor_priority', {
              p_supervisor_id: c().ids.supervisor1,
              p_site_id: c().e.sedeB,
            }),
          ),
        ).toBe('PRIORITY_ALREADY_EXISTS')
        const delDueno = await llamar(
          clienteDe('owner'),
          'set_supervisor_priority',
          {
            p_supervisor_id: c().ids.dual,
            p_site_id: c().e.sedeA,
          },
        )
        expect(delDueno.error, describir(delDueno as never)).toBeNull()
        creadas.push((delDueno.data as { id: string }).id)

        // Quitar: baja lógica; el coordinador la ve en su lista hasta que se da de baja.
        const visible = await tabla(sup(), 'supervisor_priorities')
          .select('id')
          .eq('id', id)
        expect(filas(visible)).toHaveLength(1)
        for (const perfil of ['supervisor', 'adminSin'] as const) {
          expect(
            codigo(
              await llamar(clienteDe(perfil), 'remove_supervisor_priority', {
                p_priority_id: id,
              }),
            ),
            ETIQUETA[perfil],
          ).toBe('FORBIDDEN')
        }
        const baja = await llamar(admin, 'remove_supervisor_priority', {
          p_priority_id: id,
        })
        expect(baja.error, describir(baja as never)).toBeNull()
        expect(
          codigo(
            await llamar(admin, 'remove_supervisor_priority', {
              p_priority_id: id,
            }),
          ),
        ).toBe('PRIORITY_ALREADY_REMOVED')
        const { data: fila } = await servicio()
          .from('supervisor_priorities')
          .select('removed_at, removed_by')
          .eq('id', id)
          .single()
        expect(fila!.removed_at, 'queda la fila con su baja').not.toBeNull()
        expect(fila!.removed_by).toBe(c().ids.admin)
        // Volver a agregarla después de la baja es válido (unicidad solo entre las vigentes).
        const de_nuevo = await llamar(admin, 'set_supervisor_priority', {
          p_supervisor_id: c().ids.supervisor1,
          p_site_id: c().e.sedeB,
        })
        expect(de_nuevo.error, describir(de_nuevo as never)).toBeNull()
        creadas.push((de_nuevo.data as { id: string }).id)
      })
    })

    describe('correcciones de la jornada (manage_attendance, CJ-17, CJ-32)', () => {
      it('admin_correct_workday_event: cada validación con su hint, la corrección deja la traza y marca la jornada', async () => {
        const admin = clienteDe('admin')
        const db = servicio()
        const { data: eventos } = await db
          .from('supervisor_workday_events')
          .select('id, kind')
          .eq('workday_id', jornadaCorregir)
        const inicio = eventos!.find((e) => e.kind === 'start')!.id
        const fin = eventos!.find((e) => e.kind === 'end')!.id

        expect(
          codigo(
            await llamar(admin, 'admin_correct_workday_event', {
              p_event_id: U,
              p_reason: 'x',
            }),
          ),
        ).toBe('EVENT_NOT_FOUND')
        expect(
          codigo(
            await llamar(admin, 'admin_correct_workday_event', {
              p_event_id: inicio,
              p_reason: '  ',
            }),
          ),
        ).toBe('REASON_REQUIRED')
        expect(
          codigo(
            await llamar(admin, 'admin_correct_workday_event', {
              p_event_id: inicio,
              p_reason: 'x',
            }),
          ),
        ).toBe('TIME_REQUIRED')
        expect(
          codigo(
            await llamar(admin, 'admin_correct_workday_event', {
              p_event_id: inicio,
              p_reason: 'x',
              p_remove: true,
            }),
          ),
        ).toBe('EVENT_NOT_REMOVABLE')
        expect(
          codigo(
            await llamar(admin, 'admin_correct_workday_event', {
              p_event_id: inicio,
              p_reason: 'x',
              p_new_time: new Date(Date.now() + 3_600_000).toISOString(),
            }),
          ),
        ).toBe('AT_OUT_OF_RANGE')
        // Un fin anterior al inicio deja la secuencia inválida.
        expect(
          codigo(
            await llamar(admin, 'admin_correct_workday_event', {
              p_event_id: fin,
              p_reason: 'x',
              p_new_time: `${fechaCorregir}T07:00:00-03:00`,
            }),
          ),
        ).toBe('INVALID_EVENT_ORDER')
        // Los eventos de supervisión no se corrigen desde la jornada (el de supervisor1 de hoy).
        const { data: deSupervision } = await db
          .from('supervisor_workday_events')
          .select('id')
          .eq('kind', 'supervision_start')
          .eq('supervision_id', supervisionSup1)
          .single()
        expect(
          codigo(
            await llamar(admin, 'admin_correct_workday_event', {
              p_event_id: deSupervision!.id,
              p_reason: 'x',
              p_new_time: new Date(Date.now() - 60_000).toISOString(),
            }),
          ),
        ).toBe('EVENT_NOT_CORRECTABLE')

        // Sin la capacidad o sin ser administración: FORBIDDEN.
        for (const perfil of ['empleado', 'supervisor', 'adminSin'] as const) {
          expect(
            codigo(
              await llamar(clienteDe(perfil), 'admin_correct_workday_event', {
                p_event_id: inicio,
                p_reason: 'x',
                p_new_time: `${fechaCorregir}T08:30:00-03:00`,
              }),
            ),
            ETIQUETA[perfil],
          ).toBe('FORBIDDEN')
        }

        // La corrección válida: el fin pasa de 16:00 a 17:00 con motivo.
        const valida = await llamar(admin, 'admin_correct_workday_event', {
          p_event_id: fin,
          p_reason: 'e2e-perm: terminó a las 17:00',
          p_new_time: `${fechaCorregir}T17:00:00-03:00`,
        })
        expect(valida.error, describir(valida as never)).toBeNull()
        const { data: jornada } = await db
          .from('supervisor_workdays')
          .select('corrected, ended_at')
          .eq('id', jornadaCorregir)
          .single()
        expect(jornada!.corrected).toBe(true)
        expect(new Date(jornada!.ended_at!).getTime()).toBe(
          new Date(`${fechaCorregir}T17:00:00-03:00`).getTime(),
        )
        const { data: evento } = await db
          .from('supervisor_workday_events')
          .select('corrected_from, corrected_by, correction_reason')
          .eq('id', fin)
          .single()
        expect(evento).toMatchObject({
          correction_reason: 'e2e-perm: terminó a las 17:00',
          corrected_by: c().ids.admin,
        })
        expect(evento!.corrected_from).not.toBeNull()
        // La misma hora otra vez: SAME_TIME.
        expect(
          codigo(
            await llamar(admin, 'admin_correct_workday_event', {
              p_event_id: fin,
              p_reason: 'x',
              p_new_time: `${fechaCorregir}T17:00:00-03:00`,
            }),
          ),
        ).toBe('SAME_TIME')
        // Y la traza en security_events (aviso a administración): solo la ve administración.
        const traza = await tabla(clienteDe('owner'), 'security_events')
          .select('event_type')
          .eq('event_type', 'workday_corrected')
          .limit(1)
        expect(filas(traza).length).toBeGreaterThan(0)
      })

      it('admin_add_workday_pause: valida el motivo y las horas, y agrega la pausa que descuenta horas (CJ-13)', async () => {
        const admin = clienteDe('admin')
        const base = {
          p_workday_id: jornadaPausa,
          p_reason: 'e2e-perm: no registró la pausa',
        }
        const dia = fechaPausa
        expect(
          codigo(
            await llamar(admin, 'admin_add_workday_pause', {
              ...base,
              p_workday_id: U,
              p_starts_at: `${dia}T12:00:00-03:00`,
              p_ends_at: `${dia}T12:30:00-03:00`,
            }),
          ),
        ).toBe('WORKDAY_NOT_FOUND')
        expect(
          codigo(
            await llamar(admin, 'admin_add_workday_pause', {
              ...base,
              p_reason: '',
              p_starts_at: `${dia}T12:00:00-03:00`,
              p_ends_at: `${dia}T12:30:00-03:00`,
            }),
          ),
        ).toBe('REASON_REQUIRED')
        expect(
          codigo(
            await llamar(admin, 'admin_add_workday_pause', {
              ...base,
              p_starts_at: `${dia}T12:00:00-03:00`,
              p_ends_at: null,
            }),
          ),
        ).toBe('TIME_REQUIRED')
        expect(
          codigo(
            await llamar(admin, 'admin_add_workday_pause', {
              ...base,
              p_starts_at: `${dia}T12:30:00-03:00`,
              p_ends_at: `${dia}T12:00:00-03:00`,
            }),
          ),
        ).toBe('INVALID_TIME_RANGE')
        expect(
          codigo(
            await llamar(admin, 'admin_add_workday_pause', {
              ...base,
              p_starts_at: `${dia}T12:00:00-03:00`,
              p_ends_at: `${daysFromToday(0)}T12:30:00-03:00`,
            }),
          ),
        ).toBe('AT_OUT_OF_RANGE')
        expect(
          codigo(
            await llamar(admin, 'admin_add_workday_pause', {
              ...base,
              p_starts_at: `${dia}T12:00:00-03:00`,
              p_ends_at: `${dia}T12:30:00-03:00`,
              p_pause_reason: 'x'.repeat(301),
            }),
          ),
        ).toBe('REASON_TOO_LONG')
        for (const perfil of ['empleado', 'dual', 'adminSin'] as const) {
          expect(
            codigo(
              await llamar(clienteDe(perfil), 'admin_add_workday_pause', {
                ...base,
                p_starts_at: `${dia}T12:00:00-03:00`,
                p_ends_at: `${dia}T12:30:00-03:00`,
              }),
            ),
            ETIQUETA[perfil],
          ).toBe('FORBIDDEN')
        }
        const ok = await llamar(admin, 'admin_add_workday_pause', {
          ...base,
          p_starts_at: `${dia}T12:00:00-03:00`,
          p_ends_at: `${dia}T12:30:00-03:00`,
          p_pause_reason: 'almuerzo',
        })
        expect(ok.error, describir(ok as never)).toBeNull()
        // 08:00 a 16:00 son 480 min; con 30 min de pausa quedan 450.
        const vista = await tabla(
          clienteDe('owner'),
          'v_supervisor_workdays_admin',
        )
          .select('worked_minutes, pause_minutes, corrected')
          .eq('id', jornadaPausa)
        expect(Number(filas(vista)[0].worked_minutes)).toBe(450)
        expect(Number(filas(vista)[0].pause_minutes)).toBe(30)
        expect(filas(vista)[0].corrected).toBe(true)
      })

      it('admin_record_workday: una jornada olvidada, con motivo y dentro del día; no pisa una existente (CJ-30, CJ-32)', async () => {
        const admin = clienteDe('admin')
        const dia = daysFromToday(-5)
        const base = {
          p_supervisor_id: c().ids.supervisor2,
          p_work_date: dia,
          p_started_at: `${dia}T09:00:00-03:00`,
          p_ended_at: `${dia}T13:00:00-03:00`,
          p_reason: 'e2e-perm: se olvidó de iniciarla',
        }
        expect(
          codigo(
            await llamar(admin, 'admin_record_workday', {
              ...base,
              p_reason: ' ',
            }),
          ),
        ).toBe('REASON_REQUIRED')
        expect(
          codigo(
            await llamar(admin, 'admin_record_workday', {
              ...base,
              p_started_at: null,
            }),
          ),
        ).toBe('TIME_REQUIRED')
        expect(
          codigo(
            await llamar(admin, 'admin_record_workday', {
              ...base,
              p_supervisor_id: c().ids.empleado1,
            }),
          ),
        ).toBe('SUPERVISOR_ROLE_REQUIRED')
        expect(
          codigo(
            await llamar(admin, 'admin_record_workday', {
              ...base,
              p_work_date: daysFromToday(1),
              p_started_at: `${daysFromToday(1)}T09:00:00-03:00`,
              p_ended_at: `${daysFromToday(1)}T10:00:00-03:00`,
            }),
          ),
        ).toBe('DATE_IN_FUTURE')
        expect(
          codigo(
            await llamar(admin, 'admin_record_workday', {
              ...base,
              p_started_at: `${daysFromToday(-6)}T23:00:00-03:00`,
            }),
          ),
        ).toBe('AT_OUT_OF_RANGE')
        expect(
          codigo(
            await llamar(admin, 'admin_record_workday', {
              ...base,
              p_ended_at: `${dia}T08:00:00-03:00`,
            }),
          ),
        ).toBe('INVALID_TIME_RANGE')
        expect(
          codigo(
            await llamar(admin, 'admin_record_workday', {
              ...base,
              p_ended_at: null,
            }),
          ),
        ).toBe('ENDED_AT_REQUIRED')
        expect(
          codigo(
            await llamar(admin, 'admin_record_workday', {
              ...base,
              p_work_date: fechaCorregir,
              p_started_at: `${fechaCorregir}T09:00:00-03:00`,
              p_ended_at: `${fechaCorregir}T10:00:00-03:00`,
            }),
          ),
        ).toBe('WORKDAY_ALREADY_EXISTS')
        for (const perfil of ['empleado', 'supervisor', 'adminSin'] as const) {
          expect(
            codigo(
              await llamar(clienteDe(perfil), 'admin_record_workday', base),
            ),
            ETIQUETA[perfil],
          ).toBe('FORBIDDEN')
        }
        const ok = await llamar(admin, 'admin_record_workday', base)
        expect(ok.error, describir(ok as never)).toBeNull()
        const estado = ok.data as {
          corrected: boolean
          minutes: number
          state: string
        }
        expect(estado).toMatchObject({
          corrected: true,
          minutes: 240,
          state: 'ended',
        })
        expect(codigo(await llamar(admin, 'admin_record_workday', base))).toBe(
          'WORKDAY_ALREADY_EXISTS',
        )
      })
    })

    // -----------------------------------------------------------------------------------------
    // 4. Las cuatro RPC revocadas
    // -----------------------------------------------------------------------------------------

    describe('las RPC revocadas dan 42501 a todos, también al dueño (CJ-01, CJ-26)', () => {
      const REVOCADAS: Array<[string, () => Record<string, unknown>]> = [
        [
          'assign_supervision',
          () => ({
            p_shift_id: c().e.turnoHoy,
            p_supervisor_id: c().ids.supervisor1,
          }),
        ],
        [
          'mark_supervision_not_done',
          () => ({ p_supervision_id: c().e.supA, p_reason: 'e2e-perm' }),
        ],
        ['supervision_check_in', () => ({ p_supervision_id: c().e.supA })],
        ['supervision_check_out', () => ({ p_supervision_id: c().e.supA })],
      ]
      for (const [rpc, args] of REVOCADAS) {
        for (const perfil of PERFILES) {
          it(`[${ETIQUETA[perfil]}] ${rpc} -> 42501 (CJ-01, CJ-26)`, async () => {
            const res = await llamar(clienteDe(perfil), rpc, args())
            expect(res.error?.code, describir(res as never)).toBe('42501')
          })
        }
      }
      it('las supervisiones del escenario siguen intactas después de tanto intento (nada se escribió)', async () => {
        const { data } = await servicio()
          .from('supervisions')
          .select('id, status')
          .in('id', [c().e.supA, c().e.supB, c().e.supD])
        expect((data ?? []).every((s) => s.status === 'in_progress')).toBe(true)
        expect(data).toHaveLength(3)
      })
    })
  },
)
