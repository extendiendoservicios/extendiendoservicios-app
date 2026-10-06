// DATA-008: prueba de integración del script de contraseñas iniciales contra App_dev. Usa SOLO
// cuentas ficticias con el prefijo `imp-test-cred-`, que la propia prueba crea y barre (al
// empezar y al terminar). Nunca toca cuentas reales, del seed ni `e2e-fijo-*`. El CSV va a una
// carpeta temporal fuera del repositorio y se borra. Se corre con `pnpm test:import`; no correr
// mientras corre el nocturno de e2e (4:30), que usa App_dev.

import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REF_APP_DEV, refDeUrl } from '../import-initial/entorno.ts'
import { ejecutarEntregaDeCredenciales } from './ejecutar.ts'

const PREFIJO = 'imp-test-cred-'
const url = process.env.VITE_SUPABASE_URL
const claveServicio = process.env.SUPABASE_SERVICE_ROLE_KEY
const claveAnonima = process.env.VITE_SUPABASE_ANON_KEY
const hayCredenciales = Boolean(url && claveServicio && claveAnonima)

// Contraseña conocida de la cuenta que "ya ingresó" (no es una contraseña real de nadie).
const CONTRASENA_PREVIA = 'Prueba-Previa-2026x'

const EMAILS = {
  ana: `${PREFIJO}ana@prueba.test`, // importada, empleada
  beto: `${PREFIJO}beto@prueba.test`, // importada, empleado y supervisor
  yaIngreso: `${PREFIJO}ya-ingreso@prueba.test`, // importada, pero ya inició sesión
  sinAlta: `${PREFIJO}sin-alta@prueba.test`, // sin evento del importador (como el seed)
  conClave: `${PREFIJO}con-clave@prueba.test`, // importada con contraseña ya entregada
  noExiste: `${PREFIJO}no-existe@prueba.test`,
}

describe.skipIf(!hayCredenciales)(
  'la entrega de contraseñas contra App_dev',
  () => {
    let admin: SupabaseClient
    let carpeta: string
    let listaEmails: string
    const ids: Record<string, string> = {}
    const consola: string[] = []
    const salida = {
      log: (m: string) => consola.push(m),
      error: (m: string) => consola.push(m),
    }
    const env = { ...process.env, IMPORT_ENTORNO: 'app_dev' }

    const correr = (...extra: string[]) =>
      ejecutarEntregaDeCredenciales(
        ['--emails', listaEmails, '--salida', carpeta, ...extra],
        { env, salida },
      )

    async function iniciarSesion(email: string, contrasena: string) {
      const anonimo = createClient(url ?? '', claveAnonima ?? '', {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { data, error } = await anonimo.auth.signInWithPassword({
        email,
        password: contrasena,
      })
      if (data.session) await anonimo.auth.signOut()
      return { ok: error === null && data.session !== null }
    }

    async function crearCuenta(
      email: string,
      nombre: string,
      opciones: {
        contrasena?: string
        roles?: string[]
        eventoDelImportador?: boolean
        contrasenaYaEntregada?: boolean
      },
    ): Promise<string> {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        ...(opciones.contrasena ? { password: opciones.contrasena } : {}),
        user_metadata: {
          first_name: `${PREFIJO}${nombre}`,
          last_name: 'Prueba',
        },
      })
      if (error || !data.user) {
        throw new Error(`No se pudo crear ${email}: ${error?.message}`)
      }
      const id = data.user.id
      for (const rol of opciones.roles ?? []) {
        const { error: e } = await admin
          .from('user_roles')
          .insert({ profile_id: id, role: rol })
        if (e) throw new Error(e.message)
      }
      if (opciones.eventoDelImportador) {
        await admin.from('security_events').insert({
          event_type: 'user_created',
          target_id: id,
          details: { email, roles: opciones.roles, origen: 'import-initial' },
        })
      }
      if (opciones.contrasenaYaEntregada) {
        await admin.from('security_events').insert({
          event_type: 'password_reset_by_admin',
          target_id: id,
          details: { origen: 'entregar-credenciales' },
        })
      }
      return id
    }

    async function eventosDe(id: string, tipo: string): Promise<number> {
      const { count, error } = await admin
        .from('security_events')
        .select('*', { count: 'exact', head: true })
        .eq('target_id', id)
        .eq('event_type', tipo)
      if (error) throw new Error(error.message)
      return count ?? 0
    }

    async function barrer(): Promise<void> {
      const { data, error } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      })
      if (error) throw new Error(error.message)
      for (const u of data.users) {
        if (!(u.email ?? '').startsWith(PREFIJO)) continue
        await admin
          .from('security_events')
          .delete()
          .or(`actor_id.eq.${u.id},target_id.eq.${u.id}`)
        await admin.from('user_roles').delete().eq('profile_id', u.id)
        await admin.from('profiles').delete().eq('id', u.id)
        const { error: e } = await admin.auth.admin.deleteUser(u.id)
        if (e) throw new Error(`No se pudo borrar ${u.email}: ${e.message}`)
      }
    }

    async function cuentasConPrefijo(): Promise<string[]> {
      const { data, error } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      })
      if (error) throw new Error(error.message)
      return data.users
        .map((u) => u.email ?? '')
        .filter((e) => e.startsWith(PREFIJO))
    }

    /** Filas del CSV como `{ email, rol, contrasena }` (separador `;`, todo entre comillas). */
    async function leerCsv(
      ruta: string,
    ): Promise<
      Array<{ nombre: string; email: string; rol: string; contrasena: string }>
    > {
      const texto = (await readFile(ruta, 'utf8')).replace(/^\uFEFF/, '')
      const [, ...filas] = texto.split('\r\n').filter((l) => l !== '')
      return filas.map((fila) => {
        const [nombre, email, rol, contrasena] = fila.slice(1, -1).split('";"')
        return { nombre, email, rol, contrasena }
      })
    }

    async function archivosCsv(): Promise<string[]> {
      return (await readdir(carpeta)).filter((f) => f.endsWith('.csv')).sort()
    }

    beforeAll(async () => {
      if (refDeUrl(url ?? '') !== REF_APP_DEV) {
        throw new Error(
          'VITE_SUPABASE_URL no es App_dev: la prueba no corre contra otro proyecto.',
        )
      }
      admin = createClient(url ?? '', claveServicio ?? '', {
        auth: { autoRefreshToken: false, persistSession: false },
      }) as SupabaseClient
      await barrer() // por si una corrida anterior se cortó
      carpeta = await mkdtemp(join(tmpdir(), 'imp-test-cred-'))
      listaEmails = join(carpeta, 'lista.txt')
      await writeFile(listaEmails, `${Object.values(EMAILS).join('\n')}\n`)

      ids.ana = await crearCuenta(EMAILS.ana, 'Ana', {
        roles: ['employee'],
        eventoDelImportador: true,
      })
      ids.beto = await crearCuenta(EMAILS.beto, 'Beto', {
        roles: ['employee', 'supervisor'],
        eventoDelImportador: true,
      })
      ids.yaIngreso = await crearCuenta(EMAILS.yaIngreso, 'Ya', {
        contrasena: CONTRASENA_PREVIA,
        roles: ['employee'],
        eventoDelImportador: true,
      })
      ids.sinAlta = await crearCuenta(EMAILS.sinAlta, 'Sin', {
        roles: ['employee'],
      })
      ids.conClave = await crearCuenta(EMAILS.conClave, 'Con', {
        roles: ['employee'],
        eventoDelImportador: true,
        contrasenaYaEntregada: true,
      })
      // "Ya ingresó": un inicio de sesión real fija `last_sign_in_at`.
      expect(
        (await iniciarSesion(EMAILS.yaIngreso, CONTRASENA_PREVIA)).ok,
      ).toBe(true)
    })

    afterAll(async () => {
      if (!admin) return
      await barrer()
      expect(await cuentasConPrefijo()).toEqual([])
      await rm(carpeta, { recursive: true, force: true })
      expect(existsSync(carpeta)).toBe(false)
    })

    it('la simulación lista a quién tocaría y no cambia nada', async () => {
      const codigo = await correr('--dry-run')
      expect(codigo, consola.join('\n')).toBe(0)
      expect(consola.join('\n')).toContain('No se cambió nada')
      expect(await archivosCsv()).toEqual([])
      const archivos = (await readdir(carpeta)).filter((f) =>
        f.startsWith('simulacion-credenciales-'),
      )
      expect(archivos).toHaveLength(1)
      const detalle = await readFile(join(carpeta, archivos[0]), 'utf8')
      expect(detalle).toContain('Se tocarían 2 cuenta(s)')
      expect(detalle).toContain(EMAILS.ana)
      expect(detalle).toContain(EMAILS.beto)
      expect(detalle).toContain('Se omitirían 4 cuenta(s)')
      // Nada cambió: ninguna cuenta recibió el evento.
      expect(await eventosDe(ids.ana, 'password_reset_by_admin')).toBe(0)
      expect(await eventosDe(ids.beto, 'password_reset_by_admin')).toBe(0)
    })

    it('genera contraseñas solo para las cuentas sin contraseña que nunca entraron', async () => {
      consola.length = 0
      const codigo = await correr()
      expect(codigo, consola.join('\n')).toBe(0)

      const csvs = await archivosCsv()
      expect(csvs).toHaveLength(1)
      const filas = await leerCsv(join(carpeta, csvs[0]))
      expect(filas.map((f) => f.email).sort()).toEqual(
        [EMAILS.ana, EMAILS.beto].sort(),
      )
      const ana = filas.find((f) => f.email === EMAILS.ana)
      const beto = filas.find((f) => f.email === EMAILS.beto)
      expect(ana?.rol).toBe('Empleado')
      expect(beto?.rol).toBe('Empleado y Supervisor')
      expect(ana?.nombre).toBe(`${PREFIJO}Ana Prueba`)
      for (const f of filas) {
        expect(f.contrasena).toMatch(
          /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/,
        )
      }

      // Ninguna contraseña apareció en la consola ni en los avisos.
      const textoConsola = consola.join('\n')
      for (const f of filas) expect(textoConsola).not.toContain(f.contrasena)
      expect(textoConsola).toContain('Contraseñas generadas: 2 de 2')

      // La cuenta puede iniciar sesión con la contraseña generada.
      expect((await iniciarSesion(EMAILS.ana, ana?.contrasena ?? '')).ok).toBe(
        true,
      )
      // Y con otra, no.
      expect((await iniciarSesion(EMAILS.ana, 'Otra-Clave-9999')).ok).toBe(
        false,
      )

      // Quedó el evento de auditoría de cada una.
      expect(await eventosDe(ids.ana, 'password_reset_by_admin')).toBe(1)
      expect(await eventosDe(ids.beto, 'password_reset_by_admin')).toBe(1)
    })

    it('no toca la cuenta que ya inició sesión, la que no es del importador ni la que ya tiene contraseña', async () => {
      // La cuenta que ya había entrado conserva su contraseña de antes.
      expect(
        (await iniciarSesion(EMAILS.yaIngreso, CONTRASENA_PREVIA)).ok,
      ).toBe(true)
      for (const clave of ['yaIngreso', 'sinAlta', 'conClave'] as const) {
        // Solo se agregó (a lo sumo) el evento que ya tenía sembrado la prueba.
        expect(await eventosDe(ids[clave], 'password_reset_by_admin')).toBe(
          clave === 'conClave' ? 1 : 0,
        )
      }
      const filas = await leerCsv(join(carpeta, (await archivosCsv())[0]))
      expect(filas.some((f) => f.email === EMAILS.yaIngreso)).toBe(false)
      expect(filas.some((f) => f.email === EMAILS.sinAlta)).toBe(false)
      expect(filas.some((f) => f.email === EMAILS.conClave)).toBe(false)
    })

    it('un segundo intento no vuelve a cambiar contraseñas ya entregadas', async () => {
      consola.length = 0
      const antes = await archivosCsv()
      const codigo = await correr()
      expect(codigo, consola.join('\n')).toBe(0)
      expect(consola.join('\n')).toContain('No hay cuentas para entregar')
      expect(await archivosCsv()).toEqual(antes)
      expect(await eventosDe(ids.beto, 'password_reset_by_admin')).toBe(1)
    })

    it('con --regenerar vuelve a generar la de una cuenta que todavía no entró', async () => {
      consola.length = 0
      const filasAntes = await leerCsv(join(carpeta, (await archivosCsv())[0]))
      const contrasenaVieja =
        filasAntes.find((f) => f.email === EMAILS.beto)?.contrasena ?? ''
      // Un segundo CSV con otro sello: se espera un instante para no repetir el nombre.
      await new Promise((r) => setTimeout(r, 1100))
      const codigo = await correr('--regenerar')
      expect(codigo, consola.join('\n')).toBe(0)
      const csvs = await archivosCsv()
      expect(csvs).toHaveLength(2)
      const nuevas = await leerCsv(join(carpeta, csvs[1]))
      // Beto y la cuenta "con clave" (ya entregada, sin ingreso): Ana ya entró en el paso anterior.
      expect(nuevas.map((f) => f.email).sort()).toEqual(
        [EMAILS.beto, EMAILS.conClave].sort(),
      )
      const nuevaBeto = nuevas.find((f) => f.email === EMAILS.beto)
      expect(nuevaBeto?.contrasena).not.toBe(contrasenaVieja)
      expect((await iniciarSesion(EMAILS.beto, contrasenaVieja)).ok).toBe(false)
      expect(
        (await iniciarSesion(EMAILS.beto, nuevaBeto?.contrasena ?? '')).ok,
      ).toBe(true)
    })
  },
)
