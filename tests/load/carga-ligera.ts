// tests/load/carga-ligera.ts — TEST-022 (P18.4, F18)
//
// Carga ligera contra `App_dev` (NUNCA producción: `readE2eEnv` corta si la URL es la de `App`):
// 5 administradores consultando lo que el tablero ADM-02 consulta, cada 30 s, y 30 empleados
// consultando su pantalla Hoy (EMP-03), cada 30 s, durante unos 5 minutos. Mide la latencia
// (p50, p95, p99) de cada consulta, los errores y cualquier límite de conexiones o de tasa
// (HTTP 429 o 5xx, "too many connections", etc.).
//
// Qué consulta cada uno (intervalos reales de `src/`, no inventados):
//   - Administrador (`DashboardScreen`, ADM-02): `v_shifts_board` del día (30 s, `LIST_POLLING_MS`
//     de `features/shifts/queries.ts`), `v_assignments_board` del día (30 s,
//     `ATTENDANCE_LIST_POLLING_MS`), `v_supervisions_admin` del día (60 s) y, cuando cambian las
//     asignaciones, los teléfonos (`v_employees`).
//   - Empleado (`useMyDayQuery`, EMP-03): `v_my_day` (30 s, `MY_DAY_POLLING_MS`) y, al abrir la
//     pantalla, `mark_changes_seen`.
// Cada usuario virtual abre la pantalla (ráfaga inicial con las consultas de apertura) y sigue
// con su polling, con un desfase al azar dentro del primer intervalo (no arrancan todos juntos,
// como pasa con personas reales).
//
// Cuentas: 30 empleados `e2e-carga-NN@example.com` (rol empleado, un turno de hoy cada uno,
// creados una sola vez de forma idempotente) y 5 administradores fijos de F18 (no se usan las
// cuentas reales del seed). Al terminar: los turnos y el cliente de carga se borran y las
// cuentas `e2e-carga-*` quedan desactivadas (nada se borra físicamente, P-014).
//
// Uso (a mano, no corre en el nocturno), desde `app/`:
//   pnpm test:load                      baseline de 5 minutos
//   pnpm test:load -- --duracion=60     más corto
//   pnpm test:load -- --estres=5        suma una fase corta con el polling 5 veces más seguido
// Resultado: tabla por consulta en consola y JSON en `test-results/carga-ligera-<fecha>.json`.

import { mkdirSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/database.types.ts'
import {
  cuentasDelConjunto,
  getAdminDb,
  loadAuthUsers,
  OWNER_EMAIL,
  type AdminDb,
} from '../fixtures/accounts.ts'
import { todayAR } from '../fixtures/dates.ts'
import {
  MISSING_ENV_MESSAGE,
  readE2eEnv,
  requireE2eEnv,
} from '../fixtures/env.ts'
import { deleteClientDeep } from '../fixtures/scenario.ts'
import { signInSession } from '../fixtures/sessions.ts'

if (!readE2eEnv()) {
  console.error(MISSING_ENV_MESSAGE)
  process.exit(1)
}
const env = requireE2eEnv()

// ---------------------------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------------------------

function argumento(nombre: string, porDefecto: number): number {
  const hallado = process.argv.find((a) => a.startsWith(`--${nombre}=`))
  const valor = hallado ? Number(hallado.split('=')[1]) : porDefecto
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error(`--${nombre} tiene que ser un número no negativo.`)
  }
  return valor
}

const DURACION_S = argumento('duracion', 300)
const ADMINS = argumento('admins', 5)
const EMPLEADOS = argumento('empleados', 30)
const ESTRES = argumento('estres', 0) // factor de la fase de estrés (0 = sin fase)
const ESTRES_DURACION_S = argumento('estres-duracion', 60)
// Los primeros segundos (ráfaga de apertura de 35 usuarios a la vez, conexiones en frío) se
// informan aparte para que no tapen el régimen normal.
const ARRANQUE_S = Math.min(30, DURACION_S / 4)

const PREFIJO_CARGA = 'e2e-carga-'
const PERIODO_TURNOS_MS = 30_000
const PERIODO_SUPERVISIONES_MS = 60_000

// ---------------------------------------------------------------------------------------------
// Preparación idempotente
// ---------------------------------------------------------------------------------------------

function emailCarga(n: number): string {
  return `${PREFIJO_CARGA}${String(n).padStart(2, '0')}@example.com`
}

interface Preparado {
  empleados: Array<{ id: string; email: string }>
  clienteId: string
}

async function preparar(db: AdminDb): Promise<Preparado> {
  console.log(
    `[carga] preparando ${EMPLEADOS} empleados de carga y sus turnos de hoy…`,
  )
  const usuarios = await loadAuthUsers(db)
  const empleados: Preparado['empleados'] = []

  for (let n = 1; n <= EMPLEADOS; n++) {
    const email = emailCarga(n)
    let id = usuarios.get(email)?.id ?? null
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({
        email,
        password: env.seedPassword,
        email_confirm: true,
        user_metadata: {
          first_name: 'E2E-Carga',
          last_name: String(n).padStart(2, '0'),
        },
      })
      if (error || !data.user) {
        throw new Error(
          `No se pudo crear ${email}: ${error?.message ?? 'sin usuario'}`,
        )
      }
      id = data.user.id
    } else {
      // Una corrida anterior las dejó desactivadas: se reactivan.
      const { error } = await db.auth.admin.updateUserById(id, {
        email_confirm: true,
        ban_duration: 'none',
      })
      if (error)
        throw new Error(`No se pudo reactivar ${email}: ${error.message}`)
    }

    const pasos: Array<
      [string, PromiseLike<{ error: { message: string } | null }>]
    > = [
      [
        'perfil',
        db
          .from('profiles')
          .update({
            is_active: true,
            deleted_at: null,
            first_name: 'E2E-Carga',
            last_name: String(n).padStart(2, '0'),
          })
          .eq('id', id),
      ],
      [
        'rol',
        db
          .from('user_roles')
          .upsert(
            { profile_id: id, role: 'employee' },
            { onConflict: 'profile_id,role', ignoreDuplicates: true },
          ),
      ],
    ]
    for (const [que, consulta] of pasos) {
      const { error } = await consulta
      if (error) throw new Error(`${que} de ${email}: ${error.message}`)
    }
    const { data: ficha } = await db
      .from('employees')
      .select('profile_id')
      .eq('profile_id', id)
      .maybeSingle()
    if (!ficha) {
      const { error } = await db.from('employees').insert({
        profile_id: id,
        dni: `98${String(n).padStart(6, '0')}`,
        hire_date: '2026-01-05',
        status: 'active',
      })
      if (error) throw new Error(`ficha de ${email}: ${error.message}`)
    } else {
      await db
        .from('employees')
        .update({ status: 'active', terminated_at: null, deleted_at: null })
        .eq('profile_id', id)
    }
    empleados.push({ id, email })
  }

  // Turnos de hoy: un cliente y una sede de carga; un turno de dos personas por cada dos empleados.
  const { data: cliente, error: errCliente } = await db
    .from('clients')
    .insert({
      legal_name: `${PREFIJO_CARGA}cliente-${Date.now().toString(36)}`,
      trade_name: `${PREFIJO_CARGA}cliente`,
      cuit: `20${`${Date.now()}`.slice(-8)}${Math.floor(Math.random() * 10)}`,
      status: 'active',
    })
    .select('id')
    .single()
  if (errCliente) throw new Error(`cliente de carga: ${errCliente.message}`)
  const { data: sede, error: errSede } = await db
    .from('sites')
    .insert({
      client_id: cliente.id,
      name: `${PREFIJO_CARGA}sede`,
      address: 'Dirección de carga 1',
      status: 'active',
    })
    .select('id')
    .single()
  if (errSede) throw new Error(`sede de carga: ${errSede.message}`)

  const dueno = await signInSession(OWNER_EMAIL)
  const duenoCliente = createClient<Database>(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await duenoCliente.auth.setSession({
    access_token: dueno.access_token,
    refresh_token: dueno.refresh_token,
  })
  const hoy = todayAR()
  for (let i = 0; i < empleados.length; i += 2) {
    const { data: turno, error } = await db
      .from('shifts')
      .insert({
        client_id: cliente.id,
        site_id: sede.id,
        shift_date: hoy,
        start_time: '00:00',
        end_time: '23:59',
        required_staff: 2,
        notes: `${PREFIJO_CARGA}turno de carga`,
      })
      .select('id')
      .single()
    if (error) throw new Error(`turno de carga: ${error.message}`)
    for (const e of empleados.slice(i, i + 2)) {
      const { error: errAsignar } = await duenoCliente.rpc('assign_employee', {
        p_shift_id: turno.id,
        p_employee_id: e.id,
      })
      if (errAsignar)
        throw new Error(`asignar ${e.email}: ${errAsignar.message}`)
    }
  }
  return { empleados, clienteId: cliente.id }
}

/** Borra los datos de carga y deja las cuentas desactivadas (marcadas con `e2e-carga-`). */
async function limpiar(db: AdminDb): Promise<void> {
  const { data: clientes } = await db
    .from('clients')
    .select('id')
    .like('legal_name', `${PREFIJO_CARGA}%`)
  for (const c of clientes ?? []) {
    const notas = await deleteClientDeep(db, c.id)
    if (notas.length > 0)
      console.warn(`[carga] limpieza con notas: ${notas.join(' | ')}`)
  }
  for (const [email, usuario] of await loadAuthUsers(db)) {
    if (!email.startsWith(PREFIJO_CARGA)) continue
    await db.from('profiles').update({ is_active: false }).eq('id', usuario.id)
    await db.auth.admin.updateUserById(usuario.id, { ban_duration: '876000h' })
  }
}

// ---------------------------------------------------------------------------------------------
// Medición
// ---------------------------------------------------------------------------------------------

type Cliente = SupabaseClient<Database>

interface Muestra {
  ms: number
  ok: boolean
  error?: string
}
const muestras = new Map<string, Muestra[]>()
let fase = 'baseline'
const porFase = new Map<string, Map<string, Muestra[]>>()

function registrar(consulta: string, m: Muestra): void {
  const lista = muestras.get(consulta) ?? []
  lista.push(m)
  muestras.set(consulta, lista)
  const delaFase = porFase.get(fase) ?? new Map<string, Muestra[]>()
  const l2 = delaFase.get(consulta) ?? []
  l2.push(m)
  delaFase.set(consulta, l2)
  porFase.set(fase, delaFase)
}

async function medir(
  consulta: string,
  hacer: () => PromiseLike<{
    error: { message: string; code?: string } | null
    status?: number
  }>,
): Promise<void> {
  const t0 = performance.now()
  try {
    const r = await hacer()
    const ms = performance.now() - t0
    if (r.error) {
      registrar(consulta, {
        ms,
        ok: false,
        error: `${r.status ?? ''} ${r.error.code ?? ''} ${r.error.message}`
          .trim()
          .slice(0, 140),
      })
    } else {
      registrar(consulta, { ms, ok: true })
    }
  } catch (e) {
    registrar(consulta, {
      ms: performance.now() - t0,
      ok: false,
      error: `excepción: ${(e as Error).message}`.slice(0, 140),
    })
  }
}

function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 0) return NaN
  const idx = Math.min(
    ordenados.length - 1,
    Math.ceil((p / 100) * ordenados.length) - 1,
  )
  return ordenados[Math.max(0, idx)]
}

interface Fila {
  consulta: string
  n: number
  errores: number
  p50: number
  p95: number
  p99: number
  max: number
  media: number
}

function resumir(datos: Map<string, Muestra[]>): Fila[] {
  const filas: Fila[] = []
  for (const [consulta, lista] of [...datos].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const buenas = lista
      .filter((m) => m.ok)
      .map((m) => m.ms)
      .sort((a, b) => a - b)
    filas.push({
      consulta,
      n: lista.length,
      errores: lista.filter((m) => !m.ok).length,
      p50: percentil(buenas, 50),
      p95: percentil(buenas, 95),
      p99: percentil(buenas, 99),
      max: buenas[buenas.length - 1] ?? NaN,
      media: buenas.length
        ? buenas.reduce((a, b) => a + b, 0) / buenas.length
        : NaN,
    })
  }
  return filas
}

function imprimir(titulo: string, filas: Fila[]): void {
  console.log(`\n${titulo}`)
  console.log(
    'consulta'.padEnd(34) +
      ['n', 'err', 'p50', 'p95', 'p99', 'máx', 'media']
        .map((h) => h.padStart(8))
        .join(''),
  )
  for (const f of filas) {
    const ms = (x: number) => (Number.isNaN(x) ? '-' : x.toFixed(0)).padStart(8)
    console.log(
      f.consulta.padEnd(34) +
        String(f.n).padStart(8) +
        String(f.errores).padStart(8) +
        ms(f.p50) +
        ms(f.p95) +
        ms(f.p99) +
        ms(f.max) +
        ms(f.media),
    )
  }
  console.log('(latencias en ms, solo de las consultas que respondieron bien)')
}

// ---------------------------------------------------------------------------------------------
// Usuarios virtuales
// ---------------------------------------------------------------------------------------------

async function iniciarSesion(email: string): Promise<Cliente> {
  const cliente = createClient<Database>(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // Los ingresos van escalonados: el proveedor limita los ingresos por IP. Cada 429 se cuenta
  // y se reintenta con espera creciente (es parte de lo que se mide).
  for (let intento = 1; intento <= 6; intento++) {
    const t0 = performance.now()
    const { error } = await cliente.auth.signInWithPassword({
      email,
      password: env.seedPassword,
    })
    const ms = performance.now() - t0
    if (!error) {
      registrar('auth: signInWithPassword', { ms, ok: true })
      return cliente
    }
    registrar('auth: signInWithPassword', {
      ms,
      ok: false,
      error: `${error.status ?? ''} ${error.code ?? ''} ${error.message}`
        .trim()
        .slice(0, 140),
    })
    await new Promise((r) => setTimeout(r, 2_000 * intento))
  }
  throw new Error(`No se pudo iniciar sesión como ${email}`)
}

const detener = new AbortController()
const factorPolling = { valor: 1 }

function repetir(periodoMs: number, tarea: () => Promise<void>): Promise<void> {
  // Desfase inicial al azar dentro del primer período; después, cada `periodoMs / factor`.
  return new Promise<void>((resolver) => {
    let temporizador: NodeJS.Timeout | undefined
    const ciclo = (): void => {
      if (detener.signal.aborted) {
        resolver()
        return
      }
      void tarea().then(() => {
        if (detener.signal.aborted) {
          resolver()
          return
        }
        temporizador = setTimeout(ciclo, periodoMs / factorPolling.valor)
      })
    }
    temporizador = setTimeout(ciclo, Math.random() * periodoMs)
    detener.signal.addEventListener('abort', () => {
      clearTimeout(temporizador)
      resolver()
    })
  })
}

async function administrador(cliente: Cliente, hoy: string): Promise<void> {
  const turnos = () =>
    medir('admin: v_shifts_board (día)', () =>
      cliente
        .from('v_shifts_board')
        .select(
          'id, client_id, client_legal_name, client_trade_name, site_id, site_name, site_city, shift_date, start_time, end_time, required_staff, status, display_status, assigned_count, present_count, finished_count, absent_count, delayed_count, generated, notes',
        )
        .eq('shift_date', hoy)
        .order('start_time', { ascending: true }),
    )
  const tablero = () =>
    medir('admin: v_assignments_board (día)', () =>
      cliente
        .from('v_assignments_board')
        .select(
          'id, shift_id, shift_date, shift_status, client_id, client_legal_name, site_id, site_name, employee_id, employee_first_name, employee_last_name, employee_avatar_path, effective_start_time, effective_end_time, effective_starts_at, effective_ends_at, status, display_status, notes, check_in_at, check_out_at, check_in_source, check_in_recorded_by, check_out_source, check_out_recorded_by, minutes_late, minutes_early_leave, last_notice_kind, last_notice_minutes_late, last_notice_reason_code, last_notice_reason_text, last_notice_reported_by, last_notice_source, last_notice_at',
        )
        .eq('shift_date', hoy)
        .is('removed_at', null)
        .order('effective_start_time', { ascending: true })
        .order('id', { ascending: true }),
    )
  const supervisiones = () =>
    medir('admin: v_supervisions_admin (día)', () =>
      cliente
        .from('v_supervisions_admin')
        .select(
          'id, shift_id, shift_date, client_id, client_legal_name, site_id, site_name, start_time, end_time, supervisor_id, supervisor_first_name, supervisor_last_name, status, assigned_at, check_in_at, check_out_at, general_notes, cancel_reason, not_done_reason, criteria_snapshot, ratings_count, ratings_avg, assigned_employees_count',
        )
        .gte('shift_date', hoy)
        .lte('shift_date', hoy)
        .order('shift_date', { ascending: false })
        .order('start_time', { ascending: false })
        .order('id', { ascending: false }),
    )
  const telefonos = async () => {
    const { data } = await cliente
      .from('v_assignments_board')
      .select('employee_id')
      .eq('shift_date', hoy)
      .is('removed_at', null)
    const ids = [...new Set((data ?? []).map((r) => r.employee_id as string))]
    if (ids.length === 0) return
    await medir('admin: v_employees (teléfonos)', () =>
      cliente
        .from('v_employees')
        .select('profile_id, phone')
        .in('profile_id', ids),
    )
  }

  // Apertura de la pantalla: las cuatro consultas.
  await Promise.all([turnos(), tablero(), supervisiones()])
  await telefonos()
  await Promise.all([
    repetir(PERIODO_TURNOS_MS, turnos),
    repetir(PERIODO_TURNOS_MS, tablero),
    repetir(PERIODO_SUPERVISIONES_MS, supervisiones),
  ])
}

async function empleado(cliente: Cliente): Promise<void> {
  const hoy = () =>
    medir('empleado: v_my_day', () =>
      cliente
        .from('v_my_day')
        .select('*')
        .order('shift_date', { ascending: true })
        .order('effective_start_time', { ascending: true }),
    )
  await hoy()
  await medir('empleado: mark_changes_seen', () =>
    cliente.rpc('mark_changes_seen'),
  )
  await repetir(PERIODO_TURNOS_MS, hoy)
}

// ---------------------------------------------------------------------------------------------
// Corrida
// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = getAdminDb()
  const hoy = todayAR()
  const inicio = new Date()
  let salida = 0

  try {
    const preparado = await preparar(db)
    // Administradores: los fijos de F18 (conjuntos base y edge).
    const cuentasAdmin = [
      ...cuentasDelConjunto('base'),
      ...cuentasDelConjunto('edge'),
    ]
      .filter((c) => c.roles.includes('admin'))
      .slice(0, ADMINS)
    if (cuentasAdmin.length < ADMINS) {
      throw new Error(
        `Hay ${cuentasAdmin.length} administradores fijos y se pidieron ${ADMINS}.`,
      )
    }

    console.log(
      `[carga] ingresando ${ADMINS} administradores y ${EMPLEADOS} empleados…`,
    )
    const adminClientes: Cliente[] = []
    for (const c of cuentasAdmin)
      adminClientes.push(await iniciarSesion(c.email))
    const empClientes: Cliente[] = []
    for (const e of preparado.empleados)
      empClientes.push(await iniciarSesion(e.email))

    console.log(
      `[carga] baseline: ${DURACION_S} s, polling de 30 s (administrador: 3 consultas, empleado: 1)…`,
    )
    fase = 'arranque'
    const vivos = [
      ...adminClientes.map((c) => administrador(c, hoy)),
      ...empClientes.map((c) => empleado(c)),
    ]
    const t0 = performance.now()
    await new Promise((r) => setTimeout(r, ARRANQUE_S * 1000))
    const duracionArranque = (performance.now() - t0) / 1000
    fase = 'baseline'
    const t00 = performance.now()
    await new Promise((r) => setTimeout(r, (DURACION_S - ARRANQUE_S) * 1000))
    const duracionBaseline = (performance.now() - t00) / 1000

    let duracionEstres = 0
    if (ESTRES > 0) {
      console.log(
        `[carga] estrés: ${ESTRES_DURACION_S} s con el polling ${ESTRES} veces más seguido…`,
      )
      fase = `estres x${ESTRES}`
      factorPolling.valor = ESTRES
      const t1 = performance.now()
      await new Promise((r) => setTimeout(r, ESTRES_DURACION_S * 1000))
      duracionEstres = (performance.now() - t1) / 1000
    }

    detener.abort()
    await Promise.allSettled(vivos)

    // Resultados
    const resultado: Record<string, unknown> = {
      inicio: inicio.toISOString(),
      destino: new URL(env.supabaseUrl).hostname.split('.')[0],
      administradores: ADMINS,
      empleados: EMPLEADOS,
      duracionArranqueS: Math.round(duracionArranque),
      duracionBaselineS: Math.round(duracionBaseline),
      duracionEstresS: Math.round(duracionEstres),
      factorEstres: ESTRES,
      fases: {},
    }
    for (const [nombreFase, datos] of porFase) {
      const filas = resumir(datos)
      imprimir(`Fase ${nombreFase}`, filas)
      const total = filas.reduce((a, f) => a + f.n, 0)
      const errores = filas.reduce((a, f) => a + f.errores, 0)
      const segundos =
        nombreFase === 'baseline'
          ? duracionBaseline
          : nombreFase === 'arranque'
            ? duracionArranque
            : duracionEstres
      console.log(
        `Total: ${total} pedidos, ${errores} con error, ${(total / Math.max(segundos, 1)).toFixed(2)} pedidos/s`,
      )
      ;(resultado.fases as Record<string, unknown>)[nombreFase] = {
        segundos: Math.round(segundos),
        pedidos: total,
        errores,
        pedidosPorSegundo: Number((total / Math.max(segundos, 1)).toFixed(2)),
        consultas: filas,
      }
    }
    const erroresDetalle = new Map<string, number>()
    for (const lista of muestras.values()) {
      for (const m of lista) {
        if (!m.ok && m.error)
          erroresDetalle.set(m.error, (erroresDetalle.get(m.error) ?? 0) + 1)
      }
    }
    if (erroresDetalle.size > 0) {
      console.log(
        '\nErrores distintos (límites de tasa o de conexiones incluidos):',
      )
      for (const [mensaje, n] of erroresDetalle)
        console.log(`  ${n} × ${mensaje}`)
    } else {
      console.log('\nSin errores: ningún 429, 5xx ni rechazo por conexiones.')
    }
    resultado.errores = Object.fromEntries(erroresDetalle)
    mkdirSync('test-results', { recursive: true })
    const archivo = `test-results/carga-ligera-${hoy}-${Date.now()}.json`
    writeFileSync(archivo, JSON.stringify(resultado, null, 2))
    console.log(`\nResultado guardado en ${archivo}`)
  } catch (e) {
    console.error(`[carga] falló: ${(e as Error).message}`)
    salida = 1
  } finally {
    detener.abort()
    console.log('[carga] limpiando los datos de carga…')
    await limpiar(db)
  }
  process.exit(salida)
}

await main()
