// scripts/entregar-credenciales/ejecutar.ts — DATA-008
//
// Flujo del script de contraseñas iniciales, separado de `scripts/entregar-credenciales.ts` (que
// solo lee los argumentos y el entorno) para poder probarlo entero. Devuelve el código de salida:
// 0 todo bien (o nada para hacer), 2 mal uso, carpeta no permitida o entorno mal configurado,
// 3 hubo cuentas que fallaron.
//
// A quién toca (todo junto, para no pisar nada que no sea del importador): la cuenta tiene que
// estar en la lista de emails, haber sido creada por el importador sin contraseña (evento
// `user_created` con `origen: import-initial`), no haber iniciado sesión nunca
// (`last_sign_in_at` nulo), tener el perfil activo y no tener ya una contraseña entregada
// (evento `password_reset_by_admin`; con `--regenerar` se permite, por si se perdió el archivo).
// Las cuentas del seed y las de e2e (`e2e-fijo-*`) se crearon con contraseña y por otro camino:
// no cumplen esa condición, así que quedan afuera aunque estuvieran en la lista.
//
// Qué hace con cada cuenta: la misma lógica que `reset_password` de `admin-users` — cambia la
// contraseña con `updateUserById`, cierra todas sus sesiones y registra `password_reset_by_admin`.
// Las contraseñas solo se escriben en un CSV dentro de una carpeta fuera del repositorio; nunca
// en la consola ni en un log (la consola muestra solo cantidades y la ruta del archivo).

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ErrorDeEntorno, resolverConexion } from '../import-initial/entorno.ts'
import { generarContrasena } from './generar.ts'
import {
  ErrorDeGuarda,
  filaCsv,
  leerEmails,
  validarCarpetaDeSalida,
} from './guardas.ts'

export const DIR_APP = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export const AYUDA = `Entrega de contraseñas iniciales (DATA-008).

Genera una contraseña por cada cuenta que cargó el importador y todavía no entró nunca, y las
guarda en un CSV (nombre, email, rol, contraseña) FUERA del repositorio, para que se entreguen
una por una por un canal seguro.

Uso:
  pnpm credenciales:inicial --emails <lista.txt> --salida <carpeta> [opciones]

Opciones:
  --emails <archivo>    Lista de emails (uno por línea). Sirve el archivo cuentas-creadas-*.txt
                        que escribe el importador en su carpeta de informes.
  --salida <carpeta>    Dónde se guarda el CSV. Obligatoria, y tiene que estar FUERA de app/
                        y de cualquier repositorio git.
  --dry-run             Solo lista a quién tocaría (en un archivo, sin contraseñas). No cambia nada.
  --regenerar           Permite volver a generar la contraseña de una cuenta que ya tenía una
                        entregada pero que todavía no entró (por ejemplo, si se perdió el CSV).
  --permitir-produccion-f20
                        Permite IMPORT_ENTORNO=app (producción). Solo para el encargo de F20.
  --ayuda               Muestra esta ayuda.

Entorno (variables): las mismas del importador (IMPORT_ENTORNO, VITE_SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY).

Una vez entregadas, borrá el CSV. Cada persona puede cambiar su contraseña desde su Perfil.`

export interface Salida {
  log: (mensaje: string) => void
  error: (mensaje: string) => void
}

export interface DependenciasCredenciales {
  env: Record<string, string | undefined>
  salida: Salida
  /** Carpeta del repositorio, que no admite la salida. Solo se cambia en los tests. */
  dirApp?: string
  ahora?: () => Date
}

export type MotivoOmision =
  | 'no_existe'
  | 'ya_ingreso'
  | 'sin_alta_del_importador'
  | 'ya_tiene_contrasena'
  | 'desactivada'

const TEXTO_MOTIVO: Record<MotivoOmision, string> = {
  no_existe: 'no existe una cuenta con ese email',
  ya_ingreso: 'ya inició sesión alguna vez',
  sin_alta_del_importador:
    'no la creó el importador sin contraseña (cuenta del seed, de pruebas o creada a mano)',
  ya_tiene_contrasena:
    'ya tiene una contraseña entregada (usá --regenerar si hace falta otra)',
  desactivada: 'la cuenta está desactivada',
}

/** En este orden se escriben los roles de una persona con más de uno. */
const ROL_LEGIBLE: Record<string, string> = {
  employee: 'Empleado',
  supervisor: 'Supervisor',
  admin: 'Administrador',
  owner: 'Dueño',
}

interface Candidata {
  id: string
  email: string
  nombre: string
  roles: string[]
}

function sello(fecha: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${fecha.getFullYear()}${p(fecha.getMonth() + 1)}${p(fecha.getDate())}-${p(fecha.getHours())}${p(fecha.getMinutes())}${p(fecha.getSeconds())}`
}

function trozos<T>(lista: T[], tamano: number): T[][] {
  const salida: T[][] = []
  for (let i = 0; i < lista.length; i += tamano) {
    salida.push(lista.slice(i, i + tamano))
  }
  return salida
}

/** Todas las cuentas de Auth por email (en minúsculas), recorriendo las páginas de la API. */
async function leerCuentas(
  admin: SupabaseClient,
): Promise<Map<string, { id: string; ultimoIngreso: string | null }>> {
  const cuentas = new Map<
    string,
    { id: string; ultimoIngreso: string | null }
  >()
  for (let pagina = 1; ; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 1000,
    })
    if (error) throw new Error(`No se pudo leer las cuentas: ${error.message}`)
    for (const u of data.users) {
      if (u.email) {
        cuentas.set(u.email.toLowerCase(), {
          id: u.id,
          ultimoIngreso: u.last_sign_in_at ?? null,
        })
      }
    }
    if (data.users.length < 1000) break
  }
  return cuentas
}

/** Quién creó cada cuenta y a quién ya se le entregó una contraseña, según `security_events`. */
async function leerEventos(
  admin: SupabaseClient,
  ids: string[],
): Promise<{ delImportador: Set<string>; conContrasena: Set<string> }> {
  const delImportador = new Set<string>()
  const conContrasena = new Set<string>()
  for (const grupo of trozos(ids, 50)) {
    const { data, error } = await admin
      .from('security_events')
      .select('target_id, event_type, details')
      .in('target_id', grupo)
      .in('event_type', ['user_created', 'password_reset_by_admin'])
    if (error) throw new Error(`No se pudo leer los eventos: ${error.message}`)
    for (const e of (data ?? []) as Array<{
      target_id: string
      event_type: string
      details: { origen?: string } | null
    }>) {
      if (e.event_type === 'password_reset_by_admin') {
        conContrasena.add(e.target_id)
      } else if (e.details?.origen === 'import-initial') {
        delImportador.add(e.target_id)
      }
    }
  }
  return { delImportador, conContrasena }
}

export async function ejecutarEntregaDeCredenciales(
  argumentos: string[],
  deps: DependenciasCredenciales,
): Promise<number> {
  const { salida } = deps
  let parseados
  try {
    parseados = parseArgs({
      args: argumentos,
      allowPositionals: false,
      options: {
        emails: { type: 'string' },
        salida: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        regenerar: { type: 'boolean', default: false },
        'permitir-produccion-f20': { type: 'boolean', default: false },
        ayuda: { type: 'boolean', default: false },
      },
    })
  } catch (error) {
    salida.error(
      `Opción no válida: ${error instanceof Error ? error.message : String(error)}\n\n${AYUDA}`,
    )
    return 2
  }
  const { values } = parseados
  if (values.ayuda) {
    salida.log(AYUDA)
    return 0
  }
  if (!values.emails) {
    salida.error(
      `Falta --emails <archivo> con la lista de emails a los que se les genera la contraseña.\n\n${AYUDA}`,
    )
    return 2
  }

  // La carpeta se valida antes que nada: si no es segura, no se lee ni se toca nada.
  let carpeta: string
  try {
    carpeta = validarCarpetaDeSalida(values.salida, deps.dirApp ?? DIR_APP)
  } catch (error) {
    if (error instanceof ErrorDeGuarda) {
      salida.error(error.message)
      return 2
    }
    throw error
  }

  const dryRun = values['dry-run']
  let conexion
  try {
    conexion = resolverConexion(deps.env, {
      permitirProduccionF20: values['permitir-produccion-f20'],
    })
  } catch (error) {
    if (error instanceof ErrorDeEntorno) {
      salida.error(error.message)
      return 2
    }
    throw error
  }

  let contenido: string
  try {
    contenido = await readFile(resolve(values.emails), 'utf8')
  } catch {
    salida.error(`No se pudo leer el archivo de emails ${values.emails}.`)
    return 2
  }
  const { emails, invalidos } = leerEmails(contenido)
  if (invalidos.length > 0) {
    salida.error(
      `La lista tiene ${invalidos.length} renglón(es) que no son un email (líneas ${invalidos.slice(0, 10).join(', ')}${invalidos.length > 10 ? '...' : ''}). No se hizo nada: corregí la lista.`,
    )
    return 2
  }
  if (emails.length === 0) {
    salida.error('La lista de emails está vacía. No se hizo nada.')
    return 2
  }

  salida.log(
    `Entorno de destino verificado: ${conexion.entorno} (proyecto ${conexion.ref}).`,
  )
  const admin = createClient(conexion.url, conexion.claveServicio, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ---- Quiénes entran y quiénes se omiten -------------------------------------------------
  const cuentas = await leerCuentas(admin)
  const ids = emails.flatMap((e) => cuentas.get(e)?.id ?? [])
  const eventos = await leerEventos(admin, ids)
  const perfiles = new Map<
    string,
    { nombre: string; activo: boolean; roles: string[] }
  >()
  for (const grupo of trozos(ids, 50)) {
    const { data: filasPerfil, error } = await admin
      .from('profiles')
      .select('id, first_name, last_name, is_active')
      .in('id', grupo)
    if (error) throw new Error(`No se pudo leer los perfiles: ${error.message}`)
    const { data: filasRoles, error: errorRoles } = await admin
      .from('user_roles')
      .select('profile_id, role')
      .in('profile_id', grupo)
    if (errorRoles) {
      throw new Error(`No se pudo leer los roles: ${errorRoles.message}`)
    }
    for (const f of (filasPerfil ?? []) as Array<{
      id: string
      first_name: string
      last_name: string
      is_active: boolean
    }>) {
      perfiles.set(f.id, {
        nombre: `${f.first_name} ${f.last_name}`.trim(),
        activo: f.is_active,
        roles: [],
      })
    }
    for (const r of (filasRoles ?? []) as Array<{
      profile_id: string
      role: string
    }>) {
      perfiles.get(r.profile_id)?.roles.push(r.role)
    }
  }

  const candidatas: Candidata[] = []
  const omitidas: Array<{ email: string; motivo: MotivoOmision }> = []
  for (const email of emails) {
    const cuenta = cuentas.get(email)
    if (!cuenta) {
      omitidas.push({ email, motivo: 'no_existe' })
      continue
    }
    const perfil = perfiles.get(cuenta.id)
    let motivo: MotivoOmision | null = null
    if (cuenta.ultimoIngreso !== null) motivo = 'ya_ingreso'
    else if (!eventos.delImportador.has(cuenta.id))
      motivo = 'sin_alta_del_importador'
    else if (perfil && !perfil.activo) motivo = 'desactivada'
    else if (eventos.conContrasena.has(cuenta.id) && !values.regenerar)
      motivo = 'ya_tiene_contrasena'
    if (motivo !== null) {
      omitidas.push({ email, motivo })
      continue
    }
    candidatas.push({
      id: cuenta.id,
      email,
      nombre: perfil?.nombre ?? email,
      roles: perfil?.roles ?? [],
    })
  }

  // Siempre en el mismo orden (empleado, supervisor, administrador, dueño), no el de la base.
  const ordenRol = Object.keys(ROL_LEGIBLE)
  const rol = (c: Candidata) =>
    [...c.roles]
      .sort((a, b) => ordenRol.indexOf(a) - ordenRol.indexOf(b))
      .map((r) => ROL_LEGIBLE[r] ?? r)
      .join(' y ') || '-'
  const resumenOmitidas = new Map<MotivoOmision, number>()
  for (const o of omitidas) {
    resumenOmitidas.set(o.motivo, (resumenOmitidas.get(o.motivo) ?? 0) + 1)
  }
  const sufijo = sello((deps.ahora ?? (() => new Date()))())
  await mkdir(carpeta, { recursive: true })

  const informarOmitidas = () => {
    for (const [motivo, cantidad] of resumenOmitidas) {
      salida.log(`  Omitidas (${TEXTO_MOTIVO[motivo]}): ${cantidad}`)
    }
  }

  if (dryRun) {
    const ruta = join(carpeta, `simulacion-credenciales-${sufijo}.txt`)
    const lineas = [
      'SIMULACIÓN: a quién se le generaría una contraseña (no se cambió nada)',
      '',
      `Se tocarían ${candidatas.length} cuenta(s):`,
      ...candidatas.map((c) => `  - ${c.email} (${c.nombre}, ${rol(c)})`),
      '',
      `Se omitirían ${omitidas.length} cuenta(s):`,
      ...omitidas.map((o) => `  - ${o.email}: ${TEXTO_MOTIVO[o.motivo]}`),
      '',
    ]
    await writeFile(ruta, lineas.join('\n'), 'utf8')
    salida.log(
      `Simulación: se tocarían ${candidatas.length} cuenta(s) y se omitirían ${omitidas.length}. No se cambió nada.`,
    )
    informarOmitidas()
    salida.log(`Detalle de la simulación (sin contraseñas): ${ruta}`)
    return 0
  }

  if (candidatas.length === 0) {
    salida.log('No hay cuentas para entregar: no se cambió nada.')
    informarOmitidas()
    return 0
  }

  // ---- Generación ----------------------------------------------------------------------------
  // El CSV se arma a medida que se cambia cada contraseña (no al final): si el proceso se corta
  // a la mitad, las contraseñas ya cambiadas no se pierden. Se crea con `wx`: nunca pisa uno.
  const rutaCsv = join(carpeta, `credenciales-${sufijo}.csv`)
  await writeFile(
    rutaCsv,
    `\uFEFF${filaCsv(['Nombre', 'Email', 'Rol', 'Contraseña'])}\r\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  )

  let entregadas = 0
  let avisos = 0
  const fallas: Array<{ email: string; mensaje: string }> = []
  for (const c of candidatas) {
    const contrasena = generarContrasena()
    const { error } = await admin.auth.admin.updateUserById(c.id, {
      password: contrasena,
    })
    if (error) {
      fallas.push({ email: c.email, mensaje: error.message })
      continue
    }
    // Con la contraseña ya cambiada, se anota en el CSV antes de cualquier otro paso.
    await appendFile(
      rutaCsv,
      `${filaCsv([c.nombre, c.email, rol(c), contrasena])}\r\n`,
      'utf8',
    )
    entregadas++

    const { error: errorSesiones } = await admin.rpc(
      'admin_revoke_user_sessions',
      { p_profile_id: c.id },
    )
    if (errorSesiones) {
      avisos++
      fallas.push({
        email: c.email,
        mensaje: `La contraseña se cambió pero no se pudieron cerrar las sesiones: ${errorSesiones.message}`,
      })
    }
    const { error: errorEvento } = await admin.from('security_events').insert({
      event_type: 'password_reset_by_admin',
      target_id: c.id,
      details: { origen: 'entregar-credenciales' },
    })
    if (errorEvento) {
      avisos++
      fallas.push({
        email: c.email,
        mensaje: `La contraseña se cambió pero no se pudo registrar el evento de auditoría: ${errorEvento.message}`,
      })
    }
  }

  salida.log(
    `Contraseñas generadas: ${entregadas} de ${candidatas.length} cuenta(s).`,
  )
  informarOmitidas()
  salida.log(`Archivo con las contraseñas: ${rutaCsv}`)
  salida.log(
    `Entregá cada contraseña por un canal individual y borrá el archivo ${basename(rutaCsv)} cuando termines.`,
  )
  if (fallas.length > 0) {
    const rutaFallas = join(carpeta, `credenciales-${sufijo}-fallas.txt`)
    await writeFile(
      rutaFallas,
      `${fallas.map((f) => `${f.email}: ${f.mensaje}`).join('\n')}\n`,
      'utf8',
    )
    salida.error(
      `Hubo ${fallas.length} falla(s) o aviso(s) (${avisos} son avisos de una cuenta que sí quedó con contraseña). Detalle: ${rutaFallas}`,
    )
    return fallas.length > avisos ? 3 : 0
  }
  return 0
}
