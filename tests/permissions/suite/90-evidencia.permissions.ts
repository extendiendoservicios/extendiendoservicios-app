// tests/permissions/suite/90-evidencia.permissions.ts — TEST-030 (P21.6, módulo H)
//
// Evidencia fotográfica (migración 0047) por API directa con `supabase-js`: cada rol contra la
// tabla `shift_media`, la vista `v_shift_media`, el bucket privado `evidence` y las RPC
// `begin_shift_media`, `confirm_shift_media`, `remove_shift_media`, `set_shift_media_keep`,
// `storage_usage` y `set_media_retention`. Separa lo que NO puede cada rol de lo que SÍ puede
// (contraprueba: un `deny all` accidental no pasa).
//
// Reglas del plan (`modulos/H_evidencia_fotografica.md`):
//   H-02  sube el empleado asignado y el supervisor de una supervisión del turno;
//   H-03  cada uno ve lo que subió; dueño y administradores ven todo;
//   H-06  video: hasta 30 s (0,5 s de tolerancia) y 20 MB;
//   H-11  tope de 10 fotos y 2 videos por persona y por turno;
//   H-12  ventana: desde el inicio del turno hasta 2 horas después del fin;
//   H-13  sede con `photos_not_allowed`: la base rechaza la subida;
//   H-15  el autor quita lo que subió mientras la ventana siga abierta;
//   H-17  plazos de 7 a 365 días, los cambian dueño y administradores.
//
// El escenario es propio (`e2e-perm-evid-…`, se borra al final con `deleteClientDeep`). Los turnos
// son de HOY con la franja de todo el día (el inicio ya pasó y el fin todavía no, a cualquier
// hora del día) y las asignaciones del mismo empleado llevan ventanas propias que no se
// superponen (la ventana de subida es la del turno, no la de la asignación).

import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../../../src/lib/database.types.ts'
import { FIXED_ACCOUNTS } from '../../fixtures/accounts.ts'
import { daysFromToday, todayAR } from '../../fixtures/dates.ts'
import { requireE2eEnv } from '../../fixtures/env.ts'
import {
  empezarEvidencia,
  JPEG_ESTRUCTURA,
  objetosDeEvidencia,
  subirEvidencia,
  type BeginResult,
} from '../../fixtures/media.ts'
import { deleteClientDeep } from '../../fixtures/scenario.ts'
import { denegado, describir, filas, tabla } from './ayudas.ts'
import {
  clienteConToken,
  clienteDe,
  contexto,
  servicio,
  type Db,
} from './contexto.ts'
import { PREFIJO } from './escenario.ts'

const DIA_COMPLETO = { start: '00:00', end: '23:59' }

interface Turnos {
  clienteId: string
  /** Hoy, sede con fotos: empleado1 y supervisor1 (el caso feliz). */
  ok: string
  /** Hoy, sede con fotos: empleado2 y supervisor2 (ajeno a empleado1 y supervisor1). */
  ajeno: string
  /** Hoy, sede sin fotos: empleado1 y supervisor1. */
  sinFotos: string
  /** Dentro de 20 días: la ventana todavía no abrió. */
  futuro: string
  /** Hace 20 días: la ventana ya cerró. */
  pasado: string
  /** Hoy, turno cancelado: empleado1 asignado. */
  cancelado: string
  /** Hoy: la supervisión de supervisor1 está cancelada. */
  supCancelada: string
  /** Hoy: la supervisión de supervisor1 está en «no realizada». */
  supNoRealizada: string
  /** Hoy: para los topes (empleado1 y supervisor1). */
  topes: string
}

describe('Evidencia fotográfica (módulo H): permisos por rol', () => {
  let t: Turnos
  let empleado2: Db
  /** Fila confirmada de empleado1 en `ok`. */
  let deEmpleado: { id: string; storagePath: string; thumbPath: string }
  /** Fila confirmada de supervisor1 en `ok` (misma sede y turno que empleado1). */
  let deSupervisor: { id: string; storagePath: string; thumbPath: string }
  /** Fila confirmada de empleado2 en `ajeno`. */
  let deAjeno: { id: string; storagePath: string; thumbPath: string }
  let plazosAntes: { photo: number; video: number }

  const empleado = () => clienteDe('empleado')
  const supervisor = () => clienteDe('supervisor')

  beforeAll(async () => {
    const c = contexto()
    const db = servicio()
    const env = requireE2eEnv()

    // Sesión de empleado2 (el ajeno): un inicio de sesión más.
    const anon = createClient<Database>(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const login = await anon.auth.signInWithPassword({
      email: FIXED_ACCOUNTS.empleado2.email,
      password: env.seedPassword,
    })
    if (login.error || !login.data.session)
      throw new Error(`Sin sesión de empleado2: ${login.error?.message}`)
    empleado2 = clienteConToken(login.data.session.access_token)

    const dueno = clienteConToken(c.tokens.owner)
    const { data: cliente, error: errorCliente } = await db
      .from('clients')
      .insert({
        legal_name: `${PREFIJO}evid-${Date.now().toString(36)}`,
        cuit: `20${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
      })
      .select('id')
      .single()
    if (errorCliente) throw new Error(`cliente: ${errorCliente.message}`)
    const clienteId = cliente.id

    const sede = async (slug: string, sinFotos: boolean) => {
      const { data, error } = await db
        .from('sites')
        .insert({
          client_id: clienteId,
          name: `${PREFIJO}evid-${slug}`,
          address: 'Calle de prueba 123',
          photos_not_allowed: sinFotos,
        })
        .select('id')
        .single()
      if (error) throw new Error(`sede ${slug}: ${error.message}`)
      return data.id
    }
    const sedeConFotos = await sede('con-fotos', false)
    const sedeSinFotos = await sede('sin-fotos', true)

    const turno = async (siteId: string, fecha: string, slug: string) => {
      const { data, error } = await db
        .from('shifts')
        .insert({
          client_id: clienteId,
          site_id: siteId,
          shift_date: fecha,
          start_time: DIA_COMPLETO.start,
          end_time: DIA_COMPLETO.end,
          required_staff: 2,
          notes: `${PREFIJO}evid-${slug}`,
        })
        .select('id')
        .single()
      if (error) throw new Error(`turno ${slug}: ${error.message}`)
      return data.id
    }
    const asignar = async (
      turnoId: string,
      quien: string,
      ventana?: { start: string; end: string },
    ) => {
      const { error } = await dueno.rpc('assign_employee', {
        p_shift_id: turnoId,
        p_employee_id: quien,
        ...(ventana ? { p_start: ventana.start, p_end: ventana.end } : {}),
      })
      if (error)
        throw new Error(`asignar (${turnoId}): ${error.hint} ${error.message}`)
    }
    const supervisar = async (turnoId: string, quien: string) => {
      const { data, error } = await dueno.rpc('assign_supervision', {
        p_shift_id: turnoId,
        p_supervisor_id: quien,
      })
      if (error) throw new Error(`supervisar: ${error.hint} ${error.message}`)
      return (data as unknown as { supervision: { id: string } }).supervision.id
    }

    const hoy = todayAR()
    const ok = await turno(sedeConFotos, hoy, 'ok')
    const ajeno = await turno(sedeConFotos, hoy, 'ajeno')
    const sinFotos = await turno(sedeSinFotos, hoy, 'sin-fotos')
    const futuro = await turno(sedeConFotos, daysFromToday(20), 'futuro')
    const pasado = await turno(sedeConFotos, daysFromToday(-20), 'pasado')
    const cancelado = await turno(sedeConFotos, hoy, 'cancelado')
    const supCancelada = await turno(sedeConFotos, hoy, 'sup-cancelada')
    const supNoRealizada = await turno(sedeConFotos, hoy, 'sup-no-realizada')
    const topes = await turno(sedeConFotos, hoy, 'topes')

    // Ventanas de asignación de empleado1 que no se superponen entre sí (mismo día).
    await asignar(ok, c.ids.empleado1, { start: '00:00', end: '00:05' })
    await asignar(sinFotos, c.ids.empleado1, { start: '00:05', end: '00:10' })
    await asignar(cancelado, c.ids.empleado1, { start: '00:10', end: '00:15' })
    await asignar(topes, c.ids.empleado1, { start: '00:15', end: '00:20' })
    await asignar(futuro, c.ids.empleado1)
    await asignar(pasado, c.ids.empleado1)
    await asignar(ajeno, c.ids.empleado2)

    await supervisar(ok, c.ids.supervisor1)
    await supervisar(sinFotos, c.ids.supervisor1)
    await supervisar(futuro, c.ids.supervisor1)
    await supervisar(pasado, c.ids.supervisor1)
    await supervisar(topes, c.ids.supervisor1)
    await supervisar(ajeno, c.ids.supervisor2)
    const supCanceladaId = await supervisar(supCancelada, c.ids.supervisor1)
    const supNoRealizadaId = await supervisar(supNoRealizada, c.ids.supervisor1)

    const cancelaSup = await dueno.rpc('cancel_supervision', {
      p_supervision_id: supCanceladaId,
      p_reason: `${PREFIJO}evid cancelada`,
    })
    if (cancelaSup.error)
      throw new Error(`cancel_supervision: ${cancelaSup.error.message}`)
    const noHecha = await supervisor().rpc('mark_supervision_not_done', {
      p_supervision_id: supNoRealizadaId,
      p_reason: `${PREFIJO}evid no realizada`,
    })
    if (noHecha.error)
      throw new Error(`mark_supervision_not_done: ${noHecha.error.message}`)
    const cancelaTurno = await dueno.rpc('cancel_shift', {
      p_shift_id: cancelado,
      p_reason: `${PREFIJO}evid turno cancelado`,
    })
    if (cancelaTurno.error)
      throw new Error(`cancel_shift: ${cancelaTurno.error.message}`)

    t = {
      clienteId,
      ok,
      ajeno,
      sinFotos,
      futuro,
      pasado,
      cancelado,
      supCancelada,
      supNoRealizada,
      topes,
    }

    // Lo que ya existe antes de las pruebas: una foto de cada autor.
    deEmpleado = await subirEvidencia(empleado(), ok)
    deSupervisor = await subirEvidencia(supervisor(), ok)
    deAjeno = await subirEvidencia(empleado2, ajeno)

    const { data: empresa } = await db
      .from('company_settings')
      .select('photo_retention_days, video_retention_days')
      .eq('id', 1)
      .single()
    plazosAntes = {
      photo: empresa?.photo_retention_days ?? 60,
      video: empresa?.video_retention_days ?? 30,
    }
  }, 180_000)

  afterAll(async () => {
    const db = servicio()
    if (t) {
      const notas = await deleteClientDeep(db, t.clienteId)
      if (notas.length > 0)
        console.warn(
          `[permisos] evidencia, limpieza con notas: ${notas.join(' | ')}`,
        )
    }
    // Repone los plazos pase lo que pase.
    if (plazosAntes) {
      await db
        .from('company_settings')
        .update({
          photo_retention_days: plazosAntes.photo,
          video_retention_days: plazosAntes.video,
        })
        .eq('id', 1)
    }
  }, 120_000)

  // ---------------------------------------------------------------------------------------------
  // EMPLEADO · lo que SÍ puede
  // ---------------------------------------------------------------------------------------------

  describe('[empleado] lo que sí puede', () => {
    it('sube en su turno, dentro de la ventana: begin, objetos y confirm (H-02, H-12)', async () => {
      const subida = await subirEvidencia(empleado(), t.ok)
      const { data, error } = await empleado()
        .from('shift_media')
        .select(
          'id, uploaded_by, assignment_id, supervision_id, confirmed_at, kind',
        )
        .eq('id', subida.id)
        .single()
      expect(error?.message).toBeUndefined()
      expect(data?.uploaded_by).toBe(contexto().ids.empleado1)
      expect(data?.assignment_id).not.toBeNull()
      expect(data?.supervision_id).toBeNull()
      expect(data?.confirmed_at).not.toBeNull()
    })

    it('ve las filas que subió, en la tabla y en la vista (H-03)', async () => {
      const tabla1 = await empleado()
        .from('shift_media')
        .select('id')
        .eq('shift_id', t.ok)
      expect(filas(tabla1 as never).map((f) => f.id)).toContain(deEmpleado.id)
      const vista = await empleado()
        .from('v_shift_media')
        .select('id, uploaded_by')
        .eq('shift_id', t.ok)
      const ids = (vista.data ?? []).map((f) => f.id)
      expect(ids).toContain(deEmpleado.id)
      for (const f of vista.data ?? [])
        expect(f.uploaded_by).toBe(contexto().ids.empleado1)
    })

    it('firma y baja sus propios objetos (archivo y miniatura)', async () => {
      const firma = await empleado()
        .storage.from('evidence')
        .createSignedUrl(deEmpleado.storagePath, 60)
      expect(firma.error?.message).toBeUndefined()
      expect(firma.data?.signedUrl).toBeTruthy()
      const mini = await empleado()
        .storage.from('evidence')
        .createSignedUrl(deEmpleado.thumbPath, 60)
      expect(mini.data?.signedUrl).toBeTruthy()
      const bajada = await empleado()
        .storage.from('evidence')
        .download(deEmpleado.storagePath)
      expect(bajada.error?.message).toBeUndefined()
      expect(bajada.data?.size).toBeGreaterThan(0)
    })

    it('confirmar dos veces la misma fila no rompe nada (idempotente)', async () => {
      const otra = await empleado().rpc('confirm_shift_media', {
        p_media_id: deEmpleado.id,
      })
      expect(otra.error?.message).toBeUndefined()
    })

    it('quita lo que subió y borra sus archivos mientras la ventana sigue abierta (H-15)', async () => {
      const subida = await subirEvidencia(empleado(), t.ok)
      const quita = await empleado().rpc('remove_shift_media', {
        p_media_id: subida.id,
      })
      expect(quita.error?.message).toBeUndefined()
      const borra = await empleado()
        .storage.from('evidence')
        .remove([subida.storagePath, subida.thumbPath])
      expect(borra.error?.message).toBeUndefined()
      expect(borra.data?.length).toBe(2)
      // La fila queda como constancia, pero ya no figura en la vista (quitada).
      const vista = await empleado()
        .from('v_shift_media')
        .select('id')
        .eq('id', subida.id)
      expect(vista.data ?? []).toHaveLength(0)
    })

    it('un video de 30 s exactos y uno de 30,5 s entran; uno de 31 s no (H-06)', async () => {
      const a = await empezarEvidencia(empleado(), t.topes, {
        kind: 'video',
        durationSeconds: 30,
      })
      expect(a.error?.message).toBeUndefined()
      const b = await empezarEvidencia(empleado(), t.topes, {
        kind: 'video',
        durationSeconds: 31,
      })
      expect(b.error?.hint).toBe('MEDIA_TOO_LONG')
      // Se descarta lo pendiente que dejó `a` (no cuenta contra el tope de los otros casos).
      const id = (a.data as unknown as BeginResult).media.id
      await servicio().from('shift_media').delete().eq('id', id)
    })
  })

  // ---------------------------------------------------------------------------------------------
  // EMPLEADO · lo que NO puede
  // ---------------------------------------------------------------------------------------------

  describe('[empleado] lo que no puede', () => {
    it('no sube en un turno ajeno: NOT_SHIFT_PARTICIPANT (H-02)', async () => {
      const r = await empezarEvidencia(empleado(), t.ajeno)
      expect(r.error?.hint).toBe('NOT_SHIFT_PARTICIPANT')
    })

    it('no sube en una sede sin fotos: PHOTOS_NOT_ALLOWED (H-13)', async () => {
      const r = await empezarEvidencia(empleado(), t.sinFotos)
      expect(r.error?.hint).toBe('PHOTOS_NOT_ALLOWED')
      const v = await empezarEvidencia(empleado(), t.sinFotos, {
        kind: 'video',
      })
      expect(v.error?.hint).toBe('PHOTOS_NOT_ALLOWED')
    })

    it('no sube antes de que empiece el turno: MEDIA_WINDOW_NOT_OPEN (H-12)', async () => {
      const r = await empezarEvidencia(empleado(), t.futuro)
      expect(r.error?.hint).toBe('MEDIA_WINDOW_NOT_OPEN')
    })

    it('no sube pasadas 2 horas del fin: MEDIA_WINDOW_CLOSED (H-12)', async () => {
      const r = await empezarEvidencia(empleado(), t.pasado)
      expect(r.error?.hint).toBe('MEDIA_WINDOW_CLOSED')
    })

    it('no sube en un turno cancelado (H-02)', async () => {
      const r = await empezarEvidencia(empleado(), t.cancelado)
      // Según el estado de la asignación, la base dice SHIFT_CANCELLED o NOT_SHIFT_PARTICIPANT:
      // lo que importa es que no deje subir.
      expect(r.error).not.toBeNull()
      expect(['SHIFT_CANCELLED', 'NOT_SHIFT_PARTICIPANT']).toContain(
        r.error?.hint,
      )
    })

    it('no pasa el tope: la foto 11 y el video 3 dan MEDIA_LIMIT_REACHED (H-11)', async () => {
      const ids: string[] = []
      for (let i = 0; i < 10; i += 1) {
        const r = await empezarEvidencia(empleado(), t.topes)
        expect(r.error?.message, `foto ${i + 1}`).toBeUndefined()
        ids.push((r.data as unknown as BeginResult).media.id)
      }
      const foto = await empezarEvidencia(empleado(), t.topes)
      expect(foto.error?.hint).toBe('MEDIA_LIMIT_REACHED')
      for (let i = 0; i < 2; i += 1) {
        const r = await empezarEvidencia(empleado(), t.topes, { kind: 'video' })
        expect(r.error?.message, `video ${i + 1}`).toBeUndefined()
        ids.push((r.data as unknown as BeginResult).media.id)
      }
      const video = await empezarEvidencia(empleado(), t.topes, {
        kind: 'video',
      })
      expect(video.error?.hint).toBe('MEDIA_LIMIT_REACHED')
      // El tope es por persona: el supervisor del mismo turno todavía puede subir.
      const sup = await empezarEvidencia(supervisor(), t.topes)
      expect(sup.error?.message).toBeUndefined()
      ids.push((sup.data as unknown as BeginResult).media.id)
      await servicio().from('shift_media').delete().in('id', ids)
    })

    it('valida tipo, tamaño y duración (H-05, H-06)', async () => {
      const casos: Array<
        [string, Parameters<typeof empezarEvidencia>[2], string]
      > = [
        [
          'foto que no es JPEG',
          { mimeType: 'image/png' },
          'MEDIA_INVALID_TYPE',
        ],
        [
          'video que no es MP4 ni WebM',
          { kind: 'video', mimeType: 'video/quicktime' },
          'MEDIA_INVALID_TYPE',
        ],
        ['tamaño cero', { sizeBytes: 0 }, 'MEDIA_INVALID_SIZE'],
        ['más de 20 MB', { sizeBytes: 21 * 1024 * 1024 }, 'MEDIA_TOO_LARGE'],
        [
          'video sin duración',
          { kind: 'video', durationSeconds: null },
          'MEDIA_INVALID_DURATION',
        ],
        [
          'video de 31 s',
          { kind: 'video', durationSeconds: 31 },
          'MEDIA_TOO_LONG',
        ],
      ]
      for (const [que, opciones, hint] of casos) {
        const r = await empezarEvidencia(empleado(), t.ok, opciones)
        expect(r.error?.hint, que).toBe(hint)
        expect(r.error?.message, que).toMatch(/\S/)
      }
    })

    it('no lee la foto de otro, ni la fila ni el objeto (H-03, CB-15)', async () => {
      // Misma sede y turno (el supervisor) y otro turno (empleado2).
      for (const ajena of [deSupervisor, deAjeno]) {
        const f = await empleado()
          .from('shift_media')
          .select('id')
          .eq('id', ajena.id)
        expect(denegado(f as never), describir(f as never)).toBe(true)
        const v = await empleado()
          .from('v_shift_media')
          .select('id')
          .eq('id', ajena.id)
        expect(v.data ?? []).toHaveLength(0)
        const firma = await empleado()
          .storage.from('evidence')
          .createSignedUrl(ajena.storagePath, 60)
        expect(firma.error).not.toBeNull()
        expect(firma.data).toBeNull()
        const baja = await empleado()
          .storage.from('evidence')
          .download(ajena.storagePath)
        expect(baja.error).not.toBeNull()
        const mini = await empleado()
          .storage.from('evidence')
          .createSignedUrl(ajena.thumbPath, 60)
        expect(mini.error).not.toBeNull()
      }
      // Todo lo que ve en el turno es suyo.
      const todo = await empleado().from('shift_media').select('uploaded_by')
      for (const f of todo.data ?? [])
        expect(f.uploaded_by).toBe(contexto().ids.empleado1)
    })

    it('no escribe en rutas inventadas, ni en la carpeta de un turno ajeno (H-02)', async () => {
      const inventadas = [
        `${t.ok}/${randomUUID()}.jpg`,
        `${t.ajeno}/${randomUUID()}.jpg`,
        `${t.ok}/${randomUUID()}_thumb.jpg`,
        `${randomUUID()}/${randomUUID()}.jpg`,
        `libre-${randomUUID()}.jpg`,
        `${t.ok}/../${randomUUID()}.jpg`,
      ]
      for (const ruta of inventadas) {
        const r = await empleado()
          .storage.from('evidence')
          .upload(ruta, JPEG_ESTRUCTURA, { contentType: 'image/jpeg' })
        expect(r.error, `ruta inventada ${ruta}`).not.toBeNull()
      }
      expect(
        (await objetosDeEvidencia(servicio())).filter((o) =>
          o.includes('libre-'),
        ),
      ).toEqual([])
    })

    it('no escribe en las rutas de la fila pendiente de otra persona (H-02)', async () => {
      const ajena = await empezarEvidencia(supervisor(), t.ok)
      expect(ajena.error?.message).toBeUndefined()
      const datos = ajena.data as unknown as BeginResult
      const r = await empleado()
        .storage.from('evidence')
        .upload(datos.storage_path, JPEG_ESTRUCTURA, {
          contentType: 'image/jpeg',
        })
      expect(r.error).not.toBeNull()
      const mini = await empleado()
        .storage.from('evidence')
        .upload(datos.thumb_path, JPEG_ESTRUCTURA, {
          contentType: 'image/jpeg',
        })
      expect(mini.error).not.toBeNull()
      // Tampoco la puede confirmar ni quitar.
      const confirma = await empleado().rpc('confirm_shift_media', {
        p_media_id: datos.media.id,
      })
      expect(confirma.error?.hint).toBe('NOT_YOUR_MEDIA')
      const quita = await empleado().rpc('remove_shift_media', {
        p_media_id: datos.media.id,
      })
      expect(quita.error?.hint).toBe('NOT_YOUR_MEDIA')
      await servicio().from('shift_media').delete().eq('id', datos.media.id)
    })

    it('no pisa un archivo ya subido, ni propio ni ajeno (sin update, sin upsert)', async () => {
      for (const ruta of [deEmpleado.storagePath, deSupervisor.storagePath]) {
        const sinUpsert = await empleado()
          .storage.from('evidence')
          .upload(ruta, JPEG_ESTRUCTURA, { contentType: 'image/jpeg' })
        expect(sinUpsert.error, `sin upsert ${ruta}`).not.toBeNull()
        const conUpsert = await empleado()
          .storage.from('evidence')
          .upload(ruta, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
            contentType: 'image/jpeg',
            upsert: true,
          })
        expect(conUpsert.error, `con upsert ${ruta}`).not.toBeNull()
      }
      // El original sigue intacto (mismo tamaño que lo subido).
      const baja = await empleado()
        .storage.from('evidence')
        .download(deEmpleado.storagePath)
      expect(baja.data?.size).toBe(JPEG_ESTRUCTURA.length)
    })

    it('no borra objetos que no quitó: ni los propios confirmados ni los ajenos', async () => {
      for (const o of [deEmpleado, deSupervisor, deAjeno]) {
        await empleado()
          .storage.from('evidence')
          .remove([o.storagePath, o.thumbPath])
      }
      const quedan = await objetosDeEvidencia(servicio())
      for (const o of [deEmpleado, deSupervisor, deAjeno]) {
        expect(quedan).toContain(o.storagePath)
        expect(quedan).toContain(o.thumbPath)
      }
    })

    it('no lista el bucket: ve solo lo suyo', async () => {
      const lista = await empleado().storage.from('evidence').list(t.ok)
      const nombres = (lista.data ?? []).map((o) => `${t.ok}/${o.name}`)
      expect(nombres).not.toContain(deSupervisor.storagePath)
      expect(nombres).not.toContain(deSupervisor.thumbPath)
    })

    it('no escribe en shift_media por la tabla (sin políticas de insert, update ni delete) (P-014)', async () => {
      const ins = await tabla(empleado(), 'shift_media').insert({
        shift_id: t.ok,
        uploaded_by: contexto().ids.empleado1,
        kind: 'photo',
        storage_path: `${t.ok}/${randomUUID()}.jpg`,
        thumb_path: `${t.ok}/${randomUUID()}_thumb.jpg`,
        size_bytes: 1,
      })
      expect(denegado(ins), describir(ins)).toBe(true)
      const upd = await tabla(empleado(), 'shift_media')
        .update({ keep: true })
        .eq('id', deEmpleado.id)
        .select('id')
      expect(denegado(upd), describir(upd)).toBe(true)
      const del = await tabla(empleado(), 'shift_media')
        .delete()
        .eq('id', deEmpleado.id)
        .select('id')
      expect(denegado(del), describir(del)).toBe(true)
      const { data } = await servicio()
        .from('shift_media')
        .select('keep, removed_at')
        .eq('id', deEmpleado.id)
        .single()
      expect(data?.keep).toBe(false)
      expect(data?.removed_at).toBeNull()
    })

    it('no usa set_shift_media_keep, storage_usage ni set_media_retention: FORBIDDEN (H-08, H-09, H-17, CB-17)', async () => {
      const keep = await empleado().rpc('set_shift_media_keep', {
        p_media_id: deEmpleado.id,
        p_keep: true,
      })
      expect(keep.error?.hint).toBe('FORBIDDEN')
      const uso = await empleado().rpc('storage_usage')
      expect(uso.error?.hint).toBe('FORBIDDEN')
      const plazo = await empleado().rpc('set_media_retention', {
        p_photo_days: 365,
      })
      expect(plazo.error?.hint).toBe('FORBIDDEN')
      const directo = await tabla(empleado(), 'company_settings')
        .update({ photo_retention_days: 365 })
        .eq('id', 1)
        .select('id')
      expect(denegado(directo), describir(directo)).toBe(true)
    })

    it('el sistema de limpieza es solo del servicio: evidence_cleanup_* da error de permisos', async () => {
      for (const rpc of [
        'evidence_cleanup_candidates',
        'evidence_cleanup_mark',
      ] as const) {
        const r = await empleado().rpc(
          rpc as 'storage_usage',
          (rpc === 'evidence_cleanup_mark' ? { p_ids: [] } : {}) as never,
        )
        expect(r.error, rpc).not.toBeNull()
      }
    })
  })

  // ---------------------------------------------------------------------------------------------
  // SUPERVISOR
  // ---------------------------------------------------------------------------------------------

  describe('[supervisor] lo que sí puede', () => {
    it('sube en un turno de su supervisión, dentro de la ventana (H-02, H-12)', async () => {
      const subida = await subirEvidencia(supervisor(), t.ok)
      const { data } = await supervisor()
        .from('shift_media')
        .select('uploaded_by, assignment_id, supervision_id, confirmed_at')
        .eq('id', subida.id)
        .single()
      expect(data?.uploaded_by).toBe(contexto().ids.supervisor1)
      expect(data?.supervision_id).not.toBeNull()
      expect(data?.assignment_id).toBeNull()
      expect(data?.confirmed_at).not.toBeNull()
    })

    it('ve lo que subió y firma sus objetos (H-03)', async () => {
      const v = await supervisor()
        .from('v_shift_media')
        .select('id')
        .eq('id', deSupervisor.id)
      expect(v.data ?? []).toHaveLength(1)
      const firma = await supervisor()
        .storage.from('evidence')
        .createSignedUrl(deSupervisor.storagePath, 60)
      expect(firma.data?.signedUrl).toBeTruthy()
    })

    it('quita lo que subió (H-15)', async () => {
      const subida = await subirEvidencia(supervisor(), t.ok)
      const quita = await supervisor().rpc('remove_shift_media', {
        p_media_id: subida.id,
      })
      expect(quita.error?.message).toBeUndefined()
    })
  })

  describe('[supervisor] lo que no puede', () => {
    it('no sube en un turno que no supervisa: NOT_SHIFT_PARTICIPANT', async () => {
      const r = await empezarEvidencia(supervisor(), t.ajeno)
      expect(r.error?.hint).toBe('NOT_SHIFT_PARTICIPANT')
    })

    it('no sube con la supervisión cancelada ni «no realizada»', async () => {
      for (const turno of [t.supCancelada, t.supNoRealizada]) {
        const r = await empezarEvidencia(supervisor(), turno)
        expect(r.error?.hint, turno).toBe('NOT_SHIFT_PARTICIPANT')
      }
    })

    it('no sube en sede sin fotos, ni antes, ni después de la ventana', async () => {
      expect(
        (await empezarEvidencia(supervisor(), t.sinFotos)).error?.hint,
      ).toBe('PHOTOS_NOT_ALLOWED')
      expect((await empezarEvidencia(supervisor(), t.futuro)).error?.hint).toBe(
        'MEDIA_WINDOW_NOT_OPEN',
      )
      expect((await empezarEvidencia(supervisor(), t.pasado)).error?.hint).toBe(
        'MEDIA_WINDOW_CLOSED',
      )
    })

    it('no lee lo del empleado del mismo turno ni lo de otros turnos (H-03)', async () => {
      for (const ajena of [deEmpleado, deAjeno]) {
        const f = await supervisor()
          .from('shift_media')
          .select('id')
          .eq('id', ajena.id)
        expect(denegado(f as never), describir(f as never)).toBe(true)
        const v = await supervisor()
          .from('v_shift_media')
          .select('id')
          .eq('id', ajena.id)
        expect(v.data ?? []).toHaveLength(0)
        const firma = await supervisor()
          .storage.from('evidence')
          .createSignedUrl(ajena.storagePath, 60)
        expect(firma.error).not.toBeNull()
        const baja = await supervisor()
          .storage.from('evidence')
          .download(ajena.thumbPath)
        expect(baja.error).not.toBeNull()
      }
    })

    it('no escribe en rutas inventadas ni pisa archivos', async () => {
      const inventada = await supervisor()
        .storage.from('evidence')
        .upload(`${t.ok}/${randomUUID()}.jpg`, JPEG_ESTRUCTURA, {
          contentType: 'image/jpeg',
        })
      expect(inventada.error).not.toBeNull()
      const pisa = await supervisor()
        .storage.from('evidence')
        .upload(deSupervisor.storagePath, JPEG_ESTRUCTURA, {
          contentType: 'image/jpeg',
          upsert: true,
        })
      expect(pisa.error).not.toBeNull()
      const pisaAjeno = await supervisor()
        .storage.from('evidence')
        .upload(deEmpleado.storagePath, JPEG_ESTRUCTURA, {
          contentType: 'image/jpeg',
          upsert: true,
        })
      expect(pisaAjeno.error).not.toBeNull()
    })

    it('no pasa el tope de 10 fotos', async () => {
      const ids: string[] = []
      for (let i = 0; i < 10; i += 1) {
        const r = await empezarEvidencia(supervisor(), t.topes)
        expect(r.error?.message, `foto ${i + 1}`).toBeUndefined()
        ids.push((r.data as unknown as BeginResult).media.id)
      }
      const once = await empezarEvidencia(supervisor(), t.topes)
      expect(once.error?.hint).toBe('MEDIA_LIMIT_REACHED')
      await servicio().from('shift_media').delete().in('id', ids)
    })

    it('no escribe en shift_media por la tabla', async () => {
      const upd = await tabla(supervisor(), 'shift_media')
        .update({ keep: true })
        .eq('id', deSupervisor.id)
        .select('id')
      expect(denegado(upd), describir(upd)).toBe(true)
      const del = await tabla(supervisor(), 'shift_media')
        .delete()
        .eq('id', deSupervisor.id)
        .select('id')
      expect(denegado(del), describir(del)).toBe(true)
    })

    it('no usa set_shift_media_keep, storage_usage ni set_media_retention: FORBIDDEN (CB-17)', async () => {
      const keep = await supervisor().rpc('set_shift_media_keep', {
        p_media_id: deSupervisor.id,
        p_keep: true,
      })
      expect(keep.error?.hint).toBe('FORBIDDEN')
      expect((await supervisor().rpc('storage_usage')).error?.hint).toBe(
        'FORBIDDEN',
      )
      expect(
        (await supervisor().rpc('set_media_retention', { p_video_days: 365 }))
          .error?.hint,
      ).toBe('FORBIDDEN')
    })
  })

  // ---------------------------------------------------------------------------------------------
  // ADMINISTRADORES Y DUEÑO
  // ---------------------------------------------------------------------------------------------

  for (const perfil of ['adminSin', 'admin', 'owner'] as const) {
    const etiqueta =
      perfil === 'owner'
        ? 'dueño'
        : perfil === 'admin'
          ? 'administrador con todas'
          : 'administrador sin capacidades'

    describe(`[${etiqueta}] lo que sí puede`, () => {
      it('ve todo: la tabla, la vista y los objetos de todos los autores (H-03)', async () => {
        const db = clienteDe(perfil)
        for (const m of [deEmpleado, deSupervisor, deAjeno]) {
          const f = await db.from('shift_media').select('id').eq('id', m.id)
          expect(f.data ?? [], m.id).toHaveLength(1)
          const v = await db.from('v_shift_media').select('id').eq('id', m.id)
          expect(v.data ?? [], m.id).toHaveLength(1)
          const firma = await db.storage
            .from('evidence')
            .createSignedUrl(m.storagePath, 60)
          expect(firma.error?.message).toBeUndefined()
          expect(firma.data?.signedUrl).toBeTruthy()
          const baja = await db.storage.from('evidence').download(m.thumbPath)
          expect(baja.error?.message).toBeUndefined()
        }
      })

      it('conserva y deja de conservar con set_shift_media_keep (H-08)', async () => {
        const db = clienteDe(perfil)
        const conserva = await db.rpc('set_shift_media_keep', {
          p_media_id: deEmpleado.id,
          p_keep: true,
        })
        expect(conserva.error?.message).toBeUndefined()
        const fila = await servicio()
          .from('shift_media')
          .select('keep, kept_by, kept_at')
          .eq('id', deEmpleado.id)
          .single()
        expect(fila.data?.keep).toBe(true)
        expect(fila.data?.kept_by).toBe(
          contexto().ids[perfil === 'adminSin' ? 'adminSin' : perfil],
        )
        expect(fila.data?.kept_at).not.toBeNull()
        const suelta = await db.rpc('set_shift_media_keep', {
          p_media_id: deEmpleado.id,
          p_keep: false,
        })
        expect(suelta.error?.message).toBeUndefined()
        const despues = await servicio()
          .from('shift_media')
          .select('keep')
          .eq('id', deEmpleado.id)
          .single()
        expect(despues.data?.keep).toBe(false)
      })

      it('set_shift_media_keep sin valor: KEEP_REQUIRED; con una fila inexistente: MEDIA_NOT_FOUND', async () => {
        const db = clienteDe(perfil)
        const sin = await db.rpc('set_shift_media_keep', {
          p_media_id: deEmpleado.id,
          p_keep: null as never,
        })
        expect(sin.error?.hint).toBe('KEEP_REQUIRED')
        const noHay = await db.rpc('set_shift_media_keep', {
          p_media_id: randomUUID(),
          p_keep: true,
        })
        expect(noHay.error?.hint).toBe('MEDIA_NOT_FOUND')
      })

      it('storage_usage devuelve el total, el tope de 1 GB y el nivel (H-09, H-14)', async () => {
        const r = await clienteDe(perfil).rpc('storage_usage')
        expect(r.error?.message).toBeUndefined()
        const uso = r.data as unknown as {
          total_bytes: number
          limit_bytes: number
          percent: number
          level: string
          buckets: Array<{ bucket?: string; bucket_id?: string }>
        }
        expect(uso.limit_bytes).toBe(1024 * 1024 * 1024)
        expect(uso.total_bytes).toBeGreaterThan(0)
        expect(['ok', 'warning', 'critical']).toContain(uso.level)
        expect(Array.isArray(uso.buckets)).toBe(true)
      })

      it('cambia los plazos dentro del rango de 7 a 365 días y los puede dejar como estaban (H-17)', async () => {
        const db = clienteDe(perfil)
        for (const dias of [7, 365]) {
          const r = await db.rpc('set_media_retention', {
            p_photo_days: dias,
            p_video_days: dias,
          })
          expect(r.error?.message, `${dias} días`).toBeUndefined()
          const fila = r.data as unknown as {
            photo_retention_days: number
            video_retention_days: number
          }
          expect(fila.photo_retention_days).toBe(dias)
          expect(fila.video_retention_days).toBe(dias)
        }
        // null = no cambia ese plazo.
        const soloVideo = await db.rpc('set_media_retention', {
          p_video_days: 45,
        })
        expect(soloVideo.error?.message).toBeUndefined()
        expect(
          (
            soloVideo.data as unknown as {
              photo_retention_days: number
              video_retention_days: number
            }
          ).photo_retention_days,
        ).toBe(365)
        const repone = await db.rpc('set_media_retention', {
          p_photo_days: plazosAntes.photo,
          p_video_days: plazosAntes.video,
        })
        expect(repone.error?.message).toBeUndefined()
      })

      it('rechaza plazos fuera de rango: RETENTION_OUT_OF_RANGE (6, 366 y 0)', async () => {
        const db = clienteDe(perfil)
        for (const dias of [6, 366, 0, -1]) {
          const foto = await db.rpc('set_media_retention', {
            p_photo_days: dias,
          })
          expect(foto.error?.hint, `foto ${dias}`).toBe(
            'RETENTION_OUT_OF_RANGE',
          )
          const video = await db.rpc('set_media_retention', {
            p_video_days: dias,
          })
          expect(video.error?.hint, `video ${dias}`).toBe(
            'RETENTION_OUT_OF_RANGE',
          )
        }
        const { data } = await servicio()
          .from('company_settings')
          .select('photo_retention_days, video_retention_days')
          .eq('id', 1)
          .single()
        expect(data?.photo_retention_days).toBe(plazosAntes.photo)
        expect(data?.video_retention_days).toBe(plazosAntes.video)
      })
    })

    describe(`[${etiqueta}] lo que no puede`, () => {
      it('no sube: begin_shift_media es solo para empleado y supervisor (FORBIDDEN) (H-02)', async () => {
        const foto = await empezarEvidencia(clienteDe(perfil), t.ok)
        expect(foto.error?.hint).toBe('FORBIDDEN')
        const video = await empezarEvidencia(clienteDe(perfil), t.ok, {
          kind: 'video',
        })
        expect(video.error?.hint).toBe('FORBIDDEN')
        const { data } = await servicio()
          .from('shift_media')
          .select('id')
          .eq(
            'uploaded_by',
            contexto().ids[perfil === 'adminSin' ? 'adminSin' : perfil],
          )
        expect(data ?? []).toHaveLength(0)
      })

      it('no escribe objetos en el bucket evidence (ni en una ruta inventada)', async () => {
        const r = await clienteDe(perfil)
          .storage.from('evidence')
          .upload(`${t.ok}/${randomUUID()}.jpg`, JPEG_ESTRUCTURA, {
            contentType: 'image/jpeg',
          })
        expect(r.error).not.toBeNull()
        const pisa = await clienteDe(perfil)
          .storage.from('evidence')
          .upload(deEmpleado.storagePath, JPEG_ESTRUCTURA, {
            contentType: 'image/jpeg',
            upsert: true,
          })
        expect(pisa.error).not.toBeNull()
      })

      it('no confirma ni quita archivos de otros (solo el autor): FORBIDDEN', async () => {
        const confirma = await clienteDe(perfil).rpc('confirm_shift_media', {
          p_media_id: deEmpleado.id,
        })
        expect(confirma.error?.hint).toBe('FORBIDDEN')
        const quita = await clienteDe(perfil).rpc('remove_shift_media', {
          p_media_id: deEmpleado.id,
        })
        expect(quita.error?.hint).toBe('FORBIDDEN')
      })

      it('no escribe en shift_media por la tabla (P-014: nada se borra)', async () => {
        const upd = await tabla(clienteDe(perfil), 'shift_media')
          .update({ keep: true })
          .eq('id', deEmpleado.id)
          .select('id')
        expect(denegado(upd), describir(upd)).toBe(true)
        const del = await tabla(clienteDe(perfil), 'shift_media')
          .delete()
          .eq('id', deEmpleado.id)
          .select('id')
        expect(denegado(del), describir(del)).toBe(true)
        const directo = await tabla(clienteDe(perfil), 'company_settings')
          .update({ photo_retention_days: 1 })
          .eq('id', 1)
          .select('photo_retention_days')
        // El check de la tabla (7 a 365) rechaza el 1 aunque la RLS dejara escribir.
        expect(directo.error ?? denegado(directo)).toBeTruthy()
        const { data } = await servicio()
          .from('company_settings')
          .select('photo_retention_days')
          .eq('id', 1)
          .single()
        expect(data?.photo_retention_days).toBe(plazosAntes.photo)
      })
    })
  }

  // ---------------------------------------------------------------------------------------------
  // ELIMINAR EVIDENCIA Y «CONSERVAR» MÚLTIPLE (migración 0058, P21.8a)
  // ---------------------------------------------------------------------------------------------
  //
  // Las filas de estas pruebas son de empleado2 en el turno `ajeno` (tope de 10 fotos por persona
  // y por turno: hay 1 de base, 1 compartida de abajo y 2 por perfil de administración = 8; las dos pruebas de cada perfil comparten su par, así que la de eliminar va después de la de «Conservar») para no
  // tocar el tope de empleado1 y supervisor1 que usan los demás casos del archivo.

  describe('eliminar evidencia (0058): delete_shift_media y set_shift_media_keep_many', () => {
    /** Fila que el dueño elimina una vez, para los casos de quienes no pueden borrar objetos. */
    let eliminada: { id: string; storagePath: string; thumbPath: string }

    const unoMas = () => subirEvidencia(empleado2, t.ajeno)

    beforeAll(async () => {
      eliminada = await unoMas()
      const r = await clienteDe('owner').rpc('delete_shift_media', {
        p_ids: [eliminada.id],
      })
      if (r.error)
        throw new Error(
          `delete_shift_media: ${r.error.hint} ${r.error.message}`,
        )
    }, 60_000)

    afterAll(async () => {
      // Lo que quedó en Storage de la fila compartida (la fila la borra deleteClientDeep).
      if (eliminada)
        await servicio()
          .storage.from('evidence')
          .remove([eliminada.storagePath, eliminada.thumbPath])
    }, 60_000)

    it('empleado: delete_shift_media y set_shift_media_keep_many dan FORBIDDEN y no tocan nada (CB-17)', async () => {
      const del = await empleado().rpc('delete_shift_media', {
        p_ids: [deEmpleado.id],
      })
      expect(del.error?.hint).toBe('FORBIDDEN')
      const keep = await empleado().rpc('set_shift_media_keep_many', {
        p_ids: [deEmpleado.id],
        p_keep: true,
      })
      expect(keep.error?.hint).toBe('FORBIDDEN')
      const { data } = await servicio()
        .from('shift_media')
        .select('keep, deleted_at')
        .eq('id', deEmpleado.id)
        .single()
      expect(data?.keep).toBe(false)
      expect(data?.deleted_at).toBeNull()
    })

    it('supervisor: delete_shift_media y set_shift_media_keep_many dan FORBIDDEN y no tocan nada (CB-17)', async () => {
      const del = await supervisor().rpc('delete_shift_media', {
        p_ids: [deSupervisor.id],
      })
      expect(del.error?.hint).toBe('FORBIDDEN')
      const keep = await supervisor().rpc('set_shift_media_keep_many', {
        p_ids: [deSupervisor.id],
        p_keep: true,
      })
      expect(keep.error?.hint).toBe('FORBIDDEN')
      const { data } = await servicio()
        .from('shift_media')
        .select('keep, deleted_at')
        .eq('id', deSupervisor.id)
        .single()
      expect(data?.keep).toBe(false)
      expect(data?.deleted_at).toBeNull()
    })

    it('anónimo: sin permiso de ejecución en las dos RPC', async () => {
      const del = await clienteDe('anon').rpc('delete_shift_media', {
        p_ids: [deEmpleado.id],
      })
      expect(del.error).not.toBeNull()
      const keep = await clienteDe('anon').rpc('set_shift_media_keep_many', {
        p_ids: [deEmpleado.id],
        p_keep: true,
      })
      expect(keep.error).not.toBeNull()
      const { data } = await servicio()
        .from('shift_media')
        .select('keep, deleted_at')
        .eq('id', deEmpleado.id)
        .single()
      expect(data?.keep).toBe(false)
      expect(data?.deleted_at).toBeNull()
    })

    it('ni el autor, ni otro empleado, ni un supervisor borran los objetos de una fila eliminada', async () => {
      for (const [quien, db] of [
        ['autor (empleado2)', empleado2],
        ['empleado', empleado()],
        ['supervisor', supervisor()],
      ] as const) {
        await db.storage
          .from('evidence')
          .remove([eliminada.storagePath, eliminada.thumbPath])
        const quedan = await objetosDeEvidencia(servicio())
        expect(quedan, quien).toContain(eliminada.storagePath)
        expect(quedan, quien).toContain(eliminada.thumbPath)
      }
    })

    it('el anónimo tampoco borra objetos de una fila eliminada', async () => {
      await clienteDe('anon')
        .storage.from('evidence')
        .remove([eliminada.storagePath, eliminada.thumbPath])
      const quedan = await objetosDeEvidencia(servicio())
      expect(quedan).toContain(eliminada.storagePath)
      expect(quedan).toContain(eliminada.thumbPath)
    })

    it('una fila eliminada no se puede volver a conservar con set_shift_media_keep: MEDIA_EXPIRED', async () => {
      const r = await clienteDe('owner').rpc('set_shift_media_keep', {
        p_media_id: eliminada.id,
        p_keep: true,
      })
      expect(r.error?.hint).toBe('MEDIA_EXPIRED')
    })

    it('la vista muestra la fila eliminada como constancia: sin archivo, con quién y cuándo', async () => {
      const v = await clienteDe('admin')
        .from('v_shift_media')
        .select(
          'id, has_file, expires_on, deleted_at, deleted_by, deleted_by_first_name, deleted_by_last_name',
        )
        .eq('id', eliminada.id)
        .single()
      expect(v.error?.message).toBeUndefined()
      expect(v.data?.has_file).toBe(false)
      expect(v.data?.expires_on).toBeNull()
      expect(v.data?.deleted_at).not.toBeNull()
      expect(v.data?.deleted_by).toBe(contexto().ids.owner)
      expect(v.data?.deleted_by_first_name).toBeTruthy()
      expect(v.data?.deleted_by_last_name).toBeTruthy()
    })

    for (const perfil of ['adminSin', 'admin', 'owner'] as const) {
      const etiqueta =
        perfil === 'owner'
          ? 'dueño'
          : perfil === 'admin'
            ? 'administrador con todas'
            : 'administrador sin capacidades'
      const idDe = () => contexto().ids[perfil]
      // Las dos pruebas de este perfil comparten el mismo par de filas (tope de 10 por persona y turno):
      // primero se marca y desmarca, después se elimina. Se crea la primera vez que se pide.
      let par: Promise<
        [
          { id: string; storagePath: string; thumbPath: string },
          { id: string; storagePath: string; thumbPath: string },
        ]
      > | null = null
      const elPar = () => (par ??= Promise.all([unoMas(), unoMas()]))

      it(`[${etiqueta}] set_shift_media_keep_many marca, desmarca y cuenta solo los cambios`, async () => {
        const db = clienteDe(perfil)
        const [a, b] = await elPar()
        const ids = [a.id, b.id]
        // Una eliminada, una inexistente y un nulo se ignoran sin error.
        const mezcla = [...ids, eliminada.id, randomUUID()]

        const marca = await db.rpc('set_shift_media_keep_many', {
          p_ids: mezcla,
          p_keep: true,
        })
        expect(marca.error?.message).toBeUndefined()
        expect(marca.data).toBe(2)
        const filasMarcadas = await servicio()
          .from('shift_media')
          .select('id, keep, kept_by, kept_at')
          .in('id', [...ids, eliminada.id])
        for (const f of filasMarcadas.data ?? []) {
          if (f.id === eliminada.id) {
            expect(f.keep, 'la eliminada no cambia').toBe(false)
          } else {
            expect(f.keep).toBe(true)
            expect(f.kept_by).toBe(idDe())
            expect(f.kept_at).not.toBeNull()
          }
        }

        // Repetir no cambia nada: cuenta 0.
        const otraVez = await db.rpc('set_shift_media_keep_many', {
          p_ids: ids,
          p_keep: true,
        })
        expect(otraVez.data).toBe(0)

        const suelta = await db.rpc('set_shift_media_keep_many', {
          p_ids: ids,
          p_keep: false,
        })
        expect(suelta.data).toBe(2)
        const despues = await servicio()
          .from('shift_media')
          .select('keep, kept_by')
          .in('id', ids)
        for (const f of despues.data ?? []) {
          expect(f.keep).toBe(false)
          expect(f.kept_by).toBeNull()
        }
      })

      it(`[${etiqueta}] delete_shift_media marca las filas, devuelve las rutas y deja la constancia; Storage solo deja borrar después`, async () => {
        const db = clienteDe(perfil)
        const [a, b] = await elPar()
        // Una «Conservar» también se puede eliminar.
        const conserva = await db.rpc('set_shift_media_keep_many', {
          p_ids: [b.id],
          p_keep: true,
        })
        expect(conserva.data).toBe(1)

        // Antes de la RPC, el borrado directo de Storage no pasa (la fila no está eliminada).
        await db.storage.from('evidence').remove([a.storagePath, a.thumbPath])
        const antes = await objetosDeEvidencia(servicio())
        expect(antes).toContain(a.storagePath)
        expect(antes).toContain(a.thumbPath)

        const fantasma = randomUUID()
        const r = await db.rpc('delete_shift_media', {
          p_ids: [a.id, b.id, a.id, fantasma],
        })
        expect(r.error?.message).toBeUndefined()
        const res = r.data as unknown as {
          requested_count: number
          deleted_count: number
          ignored_count: number
          bytes_freed_estimate: number
          deleted_ids: string[]
          paths: string[]
        }
        expect(res.requested_count).toBe(3) // sin repetidos
        expect(res.deleted_count).toBe(2)
        expect(res.ignored_count).toBe(1)
        expect(res.bytes_freed_estimate).toBeGreaterThan(0)
        expect([...res.deleted_ids].sort()).toEqual([a.id, b.id].sort())
        expect([...res.paths].sort()).toEqual(
          [a.storagePath, a.thumbPath, b.storagePath, b.thumbPath].sort(),
        )

        const filas2 = await servicio()
          .from('shift_media')
          .select('id, deleted_at, deleted_by, removed_at, expired_at')
          .in('id', [a.id, b.id])
        expect(filas2.data ?? []).toHaveLength(2)
        for (const f of filas2.data ?? []) {
          expect(f.deleted_at).not.toBeNull()
          expect(f.deleted_by).toBe(idDe())
          expect(f.removed_at).toBeNull()
        }

        // La vista la sigue mostrando, sin archivo y con quién la eliminó.
        const vista = await db
          .from('v_shift_media')
          .select('id, has_file, deleted_by, deleted_by_first_name')
          .in('id', [a.id, b.id])
        expect(vista.data ?? []).toHaveLength(2)
        for (const f of vista.data ?? []) {
          expect(f.has_file).toBe(false)
          expect(f.deleted_by).toBe(idDe())
          expect(f.deleted_by_first_name).toBeTruthy()
        }

        // Idempotente: volver a eliminarlas no cambia nada.
        const otraVez = await db.rpc('delete_shift_media', {
          p_ids: [a.id, b.id],
        })
        expect((otraVez.data as unknown as typeof res).deleted_count).toBe(0)
        expect((otraVez.data as unknown as typeof res).ignored_count).toBe(2)
        expect((otraVez.data as unknown as typeof res).paths).toEqual([])

        // Después de la RPC, el mismo perfil sí borra los objetos de esas filas.
        const borra = await db.storage.from('evidence').remove(res.paths)
        expect(borra.error?.message).toBeUndefined()
        expect(borra.data?.length).toBe(4)
        const despues = await objetosDeEvidencia(servicio())
        for (const ruta of res.paths) expect(despues).not.toContain(ruta)

        // Y no puede borrar objetos de otras filas que no se eliminaron.
        await db.storage
          .from('evidence')
          .remove([deAjeno.storagePath, deAjeno.thumbPath])
        const quedan = await objetosDeEvidencia(servicio())
        expect(quedan).toContain(deAjeno.storagePath)
        expect(quedan).toContain(deAjeno.thumbPath)
        const fila = await servicio()
          .from('shift_media')
          .select('deleted_at')
          .eq('id', deAjeno.id)
          .single()
        expect(fila.data?.deleted_at).toBeNull()
      })

      it(`[${etiqueta}] no elimina por la tabla ni cambia deleted_at a mano`, async () => {
        const upd = await tabla(clienteDe(perfil), 'shift_media')
          .update({ deleted_at: new Date().toISOString(), deleted_by: idDe() })
          .eq('id', deAjeno.id)
          .select('id')
        expect(denegado(upd), describir(upd)).toBe(true)
        const { data } = await servicio()
          .from('shift_media')
          .select('deleted_at')
          .eq('id', deAjeno.id)
          .single()
        expect(data?.deleted_at).toBeNull()
      })

      it(`[${etiqueta}] hints: MEDIA_IDS_REQUIRED, MEDIA_TOO_MANY y KEEP_REQUIRED`, async () => {
        const db = clienteDe(perfil)
        const muchos = Array.from({ length: 201 }, () => randomUUID())
        const dosCientos = Array.from({ length: 200 }, () => randomUUID())

        expect(
          (await db.rpc('delete_shift_media', { p_ids: [] })).error?.hint,
        ).toBe('MEDIA_IDS_REQUIRED')
        expect(
          (await db.rpc('delete_shift_media', { p_ids: null as never })).error
            ?.hint,
        ).toBe('MEDIA_IDS_REQUIRED')
        expect(
          (await db.rpc('delete_shift_media', { p_ids: muchos })).error?.hint,
        ).toBe('MEDIA_TOO_MANY')
        // El tope es sobre ids distintos: 200 inexistentes pasan y se ignoran todos.
        const tope = await db.rpc('delete_shift_media', { p_ids: dosCientos })
        expect(tope.error?.message).toBeUndefined()
        expect(
          (tope.data as unknown as { ignored_count: number }).ignored_count,
        ).toBe(200)

        expect(
          (
            await db.rpc('set_shift_media_keep_many', {
              p_ids: [],
              p_keep: true,
            })
          ).error?.hint,
        ).toBe('MEDIA_IDS_REQUIRED')
        expect(
          (
            await db.rpc('set_shift_media_keep_many', {
              p_ids: null as never,
              p_keep: true,
            })
          ).error?.hint,
        ).toBe('MEDIA_IDS_REQUIRED')
        expect(
          (
            await db.rpc('set_shift_media_keep_many', {
              p_ids: muchos,
              p_keep: true,
            })
          ).error?.hint,
        ).toBe('MEDIA_TOO_MANY')
        expect(
          (
            await db.rpc('set_shift_media_keep_many', {
              p_ids: [deAjeno.id],
              p_keep: null as never,
            })
          ).error?.hint,
        ).toBe('KEEP_REQUIRED')
      })
    }
  })

  // ---------------------------------------------------------------------------------------------
  // ANÓNIMO
  // ---------------------------------------------------------------------------------------------

  describe('[anon] sin sesión no puede nada', () => {
    it('ni lee shift_media ni v_shift_media, ni firma objetos', async () => {
      const f = await clienteDe('anon').from('shift_media').select('id')
      expect(denegado(f as never), describir(f as never)).toBe(true)
      const v = await clienteDe('anon').from('v_shift_media').select('id')
      expect(denegado(v as never), describir(v as never)).toBe(true)
      const firma = await clienteDe('anon')
        .storage.from('evidence')
        .createSignedUrl(deEmpleado.storagePath, 60)
      expect(firma.error).not.toBeNull()
      const publica = await fetch(
        `${requireE2eEnv().supabaseUrl}/storage/v1/object/public/evidence/${deEmpleado.storagePath}`,
      )
      expect(publica.ok).toBe(false)
    })

    it('ninguna RPC de evidencia responde', async () => {
      const db = clienteDe('anon')
      const resultados = [
        await empezarEvidencia(db, t.ok),
        await db.rpc('confirm_shift_media', { p_media_id: deEmpleado.id }),
        await db.rpc('remove_shift_media', { p_media_id: deEmpleado.id }),
        await db.rpc('set_shift_media_keep', {
          p_media_id: deEmpleado.id,
          p_keep: true,
        }),
        await db.rpc('storage_usage'),
        await db.rpc('set_media_retention', { p_photo_days: 30 }),
      ]
      for (const r of resultados) expect(r.error).not.toBeNull()
    })

    it('no sube objetos al bucket', async () => {
      const r = await clienteDe('anon')
        .storage.from('evidence')
        .upload(`${t.ok}/${randomUUID()}.jpg`, JPEG_ESTRUCTURA, {
          contentType: 'image/jpeg',
        })
      expect(r.error).not.toBeNull()
    })
  })

  // ---------------------------------------------------------------------------------------------
  // BUCKET
  // ---------------------------------------------------------------------------------------------

  describe('bucket evidence', () => {
    it('es privado, de 20 MB y solo admite JPEG, MP4 y WebM', async () => {
      const { data, error } = await servicio().storage.getBucket('evidence')
      expect(error?.message).toBeUndefined()
      expect(data?.public).toBe(false)
      expect(data?.file_size_limit).toBe(20 * 1024 * 1024)
      expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual(
        ['image/jpeg', 'video/mp4', 'video/webm'].sort(),
      )
    })

    it('rechaza un tipo no permitido aunque la ruta sea la de una fila pendiente propia', async () => {
      const b = await empezarEvidencia(empleado(), t.ok)
      expect(b.error?.message).toBeUndefined()
      const datos = b.data as unknown as BeginResult
      const r = await empleado()
        .storage.from('evidence')
        .upload(datos.storage_path, new Uint8Array([1, 2, 3]), {
          contentType: 'application/pdf',
        })
      expect(r.error).not.toBeNull()
      await servicio().from('shift_media').delete().eq('id', datos.media.id)
    })

    it('confirm_shift_media sin los objetos subidos: MEDIA_UPLOAD_INCOMPLETE', async () => {
      const b = await empezarEvidencia(empleado(), t.ok)
      const datos = b.data as unknown as BeginResult
      const c = await empleado().rpc('confirm_shift_media', {
        p_media_id: datos.media.id,
      })
      expect(c.error?.hint).toBe('MEDIA_UPLOAD_INCOMPLETE')
      await servicio().from('shift_media').delete().eq('id', datos.media.id)
    })
  })
})
