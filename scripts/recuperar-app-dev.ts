// scripts/recuperar-app-dev.ts — TEST-024 (ADR-015, docs/restore-test.md)
//
// Deja a App_dev utilizable después de una corrida de `restore-test.yml`. Esa prueba reemplaza el
// esquema `public` y los usuarios de `auth` de App_dev con los de un respaldo y, al terminar, los
// borra: App_dev queda con la estructura y las migraciones intactas, pero SIN usuarios y SIN datos
// (ni los de prueba ni los de las suites e2e). Este script lo reconstruye, en orden, y valida cada
// paso antes de pasar al siguiente:
//
//   1. Migraciones: `supabase db push --dry-run`; si hubiera pendientes, las aplica.
//   2. Configuración de Auth: lee `/auth/v1/settings` y comprueba que el proveedor de email esté
//      encendido. NO corre `config push` solo (puede apagar el proveedor, ver
//      docs/environments.md sección 3): si falta algo, lo informa y se corrige a mano.
//   3. Usuarios de prueba: `scripts/seed-dev.ts` (Admin API; nunca por SQL).
//   4. Datos ficticios: `supabase/seed.sql` (roles, capacidades, empresa, clientes, turnos...).
//   5. Cuentas fijas de las suites e2e (P18.1, `tests/fixtures/`): paso con marcador, ver abajo.
//   6. Validación final: lectura anónima de `v_public_branding`, ingreso del dueño (el hook de
//      Auth arma los roles en el token), lectura con RLS, buckets de Storage y Edge Function.
//
// Uso (desde la raíz de app/, con .env.local completo; ver docs/restore-test.md):
//   node --env-file=.env.local scripts/recuperar-app-dev.ts
//   node --env-file=.env.local scripts/recuperar-app-dev.ts --fixtures "<comando>"
//   pnpm db:recuperar-dev
//
// Opciones:
//   --fixtures "<comando>"  Comando que arma las cuentas fijas de pruebas (P18.1). Se corre desde
//                           la raíz de app/, después del seed. Si no se indica, el paso queda
//                           PENDIENTE y el script lo recuerda con el marcador de más abajo.
//   --local                 Apunta a un Supabase local (`supabase start`) en vez de al proyecto
//                           vinculado. Es para ensayar este mismo script sin tocar App_dev.
//   --workdir <ruta>        Carpeta de proyecto de la CLI (solo con --local, para un ensayo con
//                           otro `project_id` y otros puertos).
//   --contenedor-db <nombre>  Solo con --local: contenedor de Postgres donde se carga seed.sql
//                           (`supabase db query --local` no admite archivos con varias sentencias).
//                           Por defecto, `supabase_db_extendiendoservicios-app`.
//
// Variables (de .env.local; ninguna se imprime): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, SEED_DEV_PASSWORD. La CLI contra App_dev (sin --local) necesita el
// proyecto vinculado (`supabase link`) y la contraseña de la base en SUPABASE_DB_PASSWORD o
// escrita cuando la CLI la pida.
//
// Salvaguardas: se niega a correr contra `App` (producción) y, sin --local, contra cualquier
// proyecto que no sea App_dev. El seed corre sobre una base vacía o con sus propias cuentas
// (supabase/seed.sql corta si encuentra usuarios que no son los suyos).

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------------------------
// MARCADOR DE P18.1: cuando exista `tests/fixtures/` en develop, poner acá el comando que arma las
// cuentas fijas de pruebas (por ejemplo `node --env-file=.env.local tests/fixtures/setup.ts`) y
// borrar el aviso. Mientras tenga el valor de abajo, el paso queda PENDIENTE.
// ---------------------------------------------------------------------------------------------
const COMANDO_FIXTURES_P18_1 = '<COMANDO_DE_SETUP_DE_FIXTURES_P18_1>'

const REF_APP_DEV = 'anesttvrnpsaaaxaquce'
const REF_APP_PRODUCCION = 'fysuppdadwvabrjpnnoh'
const EMAIL_DUENO = 'extserviciosapp@gmail.com'

type Estado = 'OK' | 'FALLA' | 'PENDIENTE' | 'AVISO'

interface Resultado {
  paso: string
  estado: Estado
  detalle: string
}

const resultados: Resultado[] = []

function registrar(paso: string, estado: Estado, detalle: string): void {
  resultados.push({ paso, estado, detalle })
  console.log(`  [${estado}] ${paso}: ${detalle}`)
}

function cortar(mensaje: string): never {
  console.error(`\n${mensaje}`)
  imprimirResumen()
  process.exit(1)
}

function imprimirResumen(): void {
  console.log(
    '\n================ RESUMEN DE LA RECUPERACIÓN DE App_dev ================',
  )
  for (const r of resultados) {
    console.log(`  [${r.estado}] ${r.paso}: ${r.detalle}`)
  }
  console.log(
    '=======================================================================',
  )
}

// ---------------------------------------------------------------------------------------------
// Argumentos y entorno
// ---------------------------------------------------------------------------------------------

function valorDe(opcion: string): string | undefined {
  const i = process.argv.indexOf(opcion)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const local = process.argv.includes('--local')
const workdir = valorDe('--workdir')
const comandoFixtures = valorDe('--fixtures') ?? COMANDO_FIXTURES_P18_1
const contenedorDb =
  valorDe('--contenedor-db') ?? 'supabase_db_extendiendoservicios-app'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PASSWORD = process.env.SEED_DEV_PASSWORD

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !PASSWORD) {
  console.error(
    'Faltan variables de entorno. Corré este script con `node --env-file=.env.local ' +
      'scripts/recuperar-app-dev.ts` desde la raíz de app/, con VITE_SUPABASE_URL, ' +
      'VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY y SEED_DEV_PASSWORD cargadas en ' +
      '.env.local (docs/environments.md sección 4).',
  )
  process.exit(1)
}

if (SUPABASE_URL.includes(REF_APP_PRODUCCION)) {
  console.error(
    'VITE_SUPABASE_URL apunta al proyecto de PRODUCCIÓN (App). Este script es solo para ' +
      'App_dev: corta sin tocar nada. Revisá .env.local.',
  )
  process.exit(1)
}

if (local) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(SUPABASE_URL)) {
    console.error(
      'Con --local, VITE_SUPABASE_URL tiene que apuntar a 127.0.0.1 o localhost.',
    )
    process.exit(1)
  }
} else if (!SUPABASE_URL.includes(REF_APP_DEV)) {
  console.error(
    `VITE_SUPABASE_URL no es el de App_dev (no contiene ${REF_APP_DEV}): corta sin tocar nada.`,
  )
  process.exit(1)
}

// La URL de .env.local no alcanza: `db push --linked` va al proyecto vinculado en la CLI, que
// puede ser App si alguien lo vinculó para una tarea de producción.
if (!local) {
  let vinculado = ''
  try {
    vinculado = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
  } catch {
    // sin vincular: queda vacío y corta abajo
  }
  if (vinculado !== REF_APP_DEV) {
    console.error(
      `La CLI de Supabase está vinculada a "${vinculado || 'ningún proyecto'}", no a App_dev ` +
        `(${REF_APP_DEV}): corta sin tocar nada. Vinculala con ` +
        `\`pnpm exec supabase link --project-ref ${REF_APP_DEV}\`.`,
    )
    process.exit(1)
  }
}

const url: string = SUPABASE_URL
const anonKey: string = ANON_KEY
const serviceKey: string = SERVICE_ROLE_KEY
const password: string = PASSWORD

console.log(
  `Recuperando ${local ? 'el Supabase LOCAL (ensayo)' : 'App_dev'} en ${url}...\n`,
)

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

function entreComillas(valor: string): string {
  return `"${valor.replaceAll('"', '\\"')}"`
}

/** Corre la CLI de Supabase del proyecto. Hereda la entrada estándar por si pide la contraseña. */
function cli(args: string[]): { codigo: number; salida: string } {
  const objetivo = local ? ['--local'] : ['--linked']
  const global = workdir ? ['--workdir', entreComillas(workdir)] : []
  const comando = ['pnpm', 'exec', 'supabase', ...args, ...objetivo, ...global]
  const r = spawnSync(comando.join(' '), {
    shell: true,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  const salida = `${r.stdout}${r.stderr}`
  return { codigo: r.status ?? 1, salida }
}

function correrNode(archivo: string): number {
  const r = spawnSync(`node ${archivo}`, {
    shell: true,
    stdio: 'inherit',
    env: process.env,
  })
  return r.status ?? 1
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function contar(tabla: string): Promise<number> {
  const { count, error } = await admin
    .from(tabla)
    .select('*', { count: 'exact', head: true })
  if (error) {
    throw new Error(`No se pudo contar ${tabla}: ${error.message}`)
  }
  return count ?? 0
}

// ---------------------------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------------------------

function pasoMigraciones(): void {
  console.log('1. Migraciones')
  const simulacro = cli(['db', 'push', '--dry-run'])
  if (simulacro.codigo !== 0) {
    console.error(simulacro.salida)
    cortar(
      'No se pudo consultar el estado de las migraciones (ver el mensaje de arriba).',
    )
  }
  if (/up to date/i.test(simulacro.salida)) {
    registrar(
      'migraciones',
      'OK',
      'la base ya tiene todas las migraciones (nada para aplicar)',
    )
    return
  }
  console.log(simulacro.salida)
  console.log('  Hay migraciones pendientes: se aplican ahora.')
  const real = cli(['db', 'push', '--yes'])
  if (real.codigo !== 0) {
    console.error(real.salida)
    cortar('Falló `supabase db push`: no se sigue.')
  }
  registrar('migraciones', 'OK', 'migraciones pendientes aplicadas')
}

async function pasoConfiguracionAuth(): Promise<void> {
  console.log('2. Configuración de Auth')
  const respuesta = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: anonKey },
  })
  if (!respuesta.ok) {
    cortar(`Auth no respondió (/auth/v1/settings dio ${respuesta.status}).`)
  }
  const ajustes = (await respuesta.json()) as { external?: { email?: boolean } }
  if (ajustes.external?.email !== true) {
    registrar(
      'auth_proveedor_email',
      'FALLA',
      'el proveedor de email está apagado: nadie puede iniciar sesión. Corregilo con `supabase config push` ' +
        'siguiendo docs/environments.md sección 3 (verificá el login después)',
    )
    cortar(
      'El proveedor de email de Auth está apagado: no tiene sentido seguir.',
    )
  }
  registrar(
    'auth_proveedor_email',
    'OK',
    'el proveedor de email está encendido',
  )
}

async function pasoUsuarios(): Promise<void> {
  console.log('3. Usuarios de prueba (scripts/seed-dev.ts)')
  const codigo = correrNode('scripts/seed-dev.ts')
  if (codigo !== 0) {
    cortar('Falló scripts/seed-dev.ts: no se sigue.')
  }
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  })
  if (error) {
    cortar(`No se pudo listar los usuarios de Auth: ${error.message}`)
  }
  if (data.users.length < 14) {
    registrar(
      'usuarios_de_auth',
      'FALLA',
      `hay ${data.users.length} usuarios y deberían ser al menos 14`,
    )
    cortar('Faltan usuarios de prueba.')
  }
  registrar('usuarios_de_auth', 'OK', `${data.users.length} usuarios en Auth`)
}

async function pasoDatos(): Promise<void> {
  console.log('4. Datos ficticios (supabase/seed.sql)')
  const r = local
    ? spawnSync(
        `docker exec -i ${contenedorDb} psql -U postgres -X -q -v ON_ERROR_STOP=1 -o /dev/null -f - < supabase/seed.sql`,
        { shell: true, encoding: 'utf8' },
      )
    : cli(['db', 'query', '-f', 'supabase/seed.sql'])
  const codigoSeed = 'codigo' in r ? r.codigo : (r.status ?? 1)
  if (codigoSeed !== 0) {
    console.error('salida' in r ? r.salida : `${r.stdout}${r.stderr}`)
    cortar('Falló supabase/seed.sql: no se sigue.')
  }
  const esperado: Array<[string, number]> = [
    ['company_settings', 1],
    ['profiles', 14],
    ['user_roles', 14],
    ['employees', 10],
    ['clients', 1],
    ['sites', 1],
    ['services', 1],
    ['shifts', 1],
  ]
  const faltan: string[] = []
  for (const [tabla, minimo] of esperado) {
    const n = await contar(tabla)
    if (n < minimo) {
      faltan.push(`${tabla} (${n}, mínimo ${minimo})`)
    }
  }
  if (faltan.length > 0) {
    registrar(
      'datos_del_seed',
      'FALLA',
      `tablas con menos filas de las esperadas: ${faltan.join(', ')}`,
    )
    cortar('El seed no dejó los datos esperados.')
  }
  registrar('datos_del_seed', 'OK', `${esperado.length} tablas con datos`)
}

function pasoFixtures(): void {
  console.log('5. Cuentas fijas de las suites e2e (P18.1, tests/fixtures/)')
  if (comandoFixtures === COMANDO_FIXTURES_P18_1) {
    registrar(
      'fixtures_p18_1',
      'PENDIENTE',
      'todavía no hay comando: cuando exista tests/fixtures/, pasalo con --fixtures "<comando>" o completá ' +
        'COMANDO_FIXTURES_P18_1 en este script. Hasta entonces las suites e2e que dependan de esas cuentas van a fallar',
    )
    return
  }
  const codigo =
    spawnSync(comandoFixtures, {
      shell: true,
      stdio: 'inherit',
      env: process.env,
    }).status ?? 1
  if (codigo !== 0) {
    registrar(
      'fixtures_p18_1',
      'FALLA',
      `el comando terminó con código ${codigo}`,
    )
    return
  }
  registrar('fixtures_p18_1', 'OK', 'cuentas fijas de pruebas creadas')
}

function rolesDelToken(token: string): string[] {
  const carga = token.split('.')[1] ?? ''
  const json = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) as {
    roles?: string[]
  }
  return json.roles ?? []
}

async function pasoValidacion(): Promise<void> {
  console.log('6. Validación final')

  // Lectura anónima: lo único que ve `anon` (04 sección 7.2).
  const anonimo = createClient(url, anonKey, {
    auth: { persistSession: false },
  })
  const marca = await anonimo.from('v_public_branding').select('*')
  if (marca.error || (marca.data ?? []).length !== 1) {
    registrar(
      'anon_v_public_branding',
      'FALLA',
      marca.error?.message ??
        `devolvió ${marca.data?.length ?? 0} filas y debía ser 1`,
    )
  } else {
    registrar(
      'anon_v_public_branding',
      'OK',
      'la pantalla de ingreso puede leer el nombre y el logo de la empresa',
    )
  }

  // Ingreso del dueño con el hook de Auth y lectura con RLS.
  const cliente = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const sesion = await cliente.auth.signInWithPassword({
    email: EMAIL_DUENO,
    password,
  })
  if (sesion.error || !sesion.data.session) {
    registrar(
      'ingreso_del_dueno',
      'FALLA',
      sesion.error?.message ?? 'no devolvió sesión',
    )
  } else {
    const roles = rolesDelToken(sesion.data.session.access_token)
    if (!roles.includes('owner')) {
      registrar(
        'ingreso_del_dueno',
        'FALLA',
        `el token no trae el rol owner (roles: ${roles.join(', ') || 'ninguno'}): el hook de Auth no está funcionando`,
      )
    } else {
      registrar(
        'ingreso_del_dueno',
        'OK',
        `ingresó con el email del dueño y el hook armó los roles: ${roles.join(', ')}`,
      )
    }
    const perfiles = await cliente
      .from('profiles')
      .select('id', { count: 'exact', head: true })
    if (perfiles.error || (perfiles.count ?? 0) < 14) {
      registrar(
        'lectura_con_rls_como_dueno',
        'FALLA',
        perfiles.error?.message ??
          `ve ${perfiles.count} perfiles y debía ver al menos 14`,
      )
    } else {
      registrar(
        'lectura_con_rls_como_dueno',
        'OK',
        `el dueño ve ${perfiles.count} perfiles`,
      )
    }
    await cliente.auth.signOut()
  }

  // Buckets de Storage (0014).
  const buckets = await admin.storage.listBuckets()
  const ids = (buckets.data ?? []).map((b) => b.id)
  if (buckets.error || !ids.includes('avatars') || !ids.includes('branding')) {
    registrar(
      'buckets_de_storage',
      'FALLA',
      buckets.error?.message ?? `buckets: ${ids.join(', ') || 'ninguno'}`,
    )
  } else {
    registrar('buckets_de_storage', 'OK', 'avatars y branding existen')
  }

  // Edge Function admin-users (no depende de la base: tiene que seguir desplegada).
  if (local) {
    registrar(
      'edge_function_admin_users',
      'AVISO',
      'no se comprueba en el ensayo local',
    )
  } else {
    const r = await fetch(`${url}/functions/v1/admin-users`, {
      method: 'POST',
      headers: { apikey: anonKey },
    })
    if (r.status === 404 || r.status >= 500) {
      registrar(
        'edge_function_admin_users',
        'FALLA',
        `respondió ${r.status}: no está desplegada o no arranca`,
      )
    } else {
      registrar(
        'edge_function_admin_users',
        'OK',
        `desplegada (sin sesión responde ${r.status}, como corresponde)`,
      )
    }
  }
}

async function main(): Promise<void> {
  pasoMigraciones()
  await pasoConfiguracionAuth()
  await pasoUsuarios()
  await pasoDatos()
  pasoFixtures()
  await pasoValidacion()
  imprimirResumen()
  if (resultados.some((r) => r.estado === 'FALLA')) {
    console.error(
      '\nLa recuperación terminó con fallas: revisá las líneas [FALLA] de arriba.',
    )
    process.exitCode = 1
    return
  }
  if (resultados.some((r) => r.estado === 'PENDIENTE')) {
    console.log(
      '\nApp_dev quedó utilizable, pero queda un paso PENDIENTE (ver arriba).',
    )
    return
  }
  console.log('\nApp_dev quedó utilizable.')
}

main().catch((error: unknown) => {
  console.error(error)
  imprimirResumen()
  process.exit(1)
})
