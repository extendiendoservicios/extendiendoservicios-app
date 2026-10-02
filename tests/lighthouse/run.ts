// tests/lighthouse/run.ts — RESP-010 (P17.4, F17)
//
// Mide con Lighthouse el login (COM-01, sin sesión) y, con sesión iniciada por la interfaz, ADM-02
// (dueño), EMP-03 `/app` (empleado) y SUP-02 `/sup` (supervisor), en modo celular y escritorio,
// contra staging (`https://dev.extendiendoservicios.com`, backend `App_dev`). Además comprueba a
// mano la instalabilidad de la PWA (Lighthouse 12+ ya no trae la categoría PWA).
//
// Va fuera del CI (necesita las cuatro variables de `.env.local` para crear y borrar cuentas
// `E2E-P174`). Cómo correrlo, desde `app/`:
//
//   pnpm test:lighthouse
//   pnpm test:lighthouse -- --solo=login,sup --modos=mobile --corridas=3
//   pnpm test:lighthouse -- --base=http://localhost:4173     (contra `pnpm preview`)
//
// Salida (carpeta ignorada por git): `test-results/lighthouse/` con un `.html` y un `.json` por
// pantalla y modo, `resumen.json`, `resumen.md` e `instalabilidad.json`.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import lighthouse from 'lighthouse'
import { EscenarioLighthouse, leerEntorno, type Cuenta } from './escenario.ts'
import { comprobarInstalabilidad, type Comprobacion } from './instalabilidad.ts'

type Modo = 'mobile' | 'desktop'
type Pantalla = 'login' | 'adm' | 'emp' | 'sup'

const BASE_STAGING = 'https://dev.extendiendoservicios.com'
const SALIDA = path.resolve(
  import.meta.dirname,
  '../../test-results/lighthouse',
)
const CATEGORIAS = ['performance', 'accessibility', 'best-practices', 'seo']
const UMBRAL_ACCESIBILIDAD = 90

const PANTALLAS: Record<
  Pantalla,
  { id: string; ruta: string; nombre: string; home: RegExp }
> = {
  login: {
    id: 'COM-01',
    ruta: '/ingresar',
    nombre: 'Login',
    home: /\/ingresar/,
  },
  adm: {
    id: 'ADM-02',
    ruta: '/admin',
    nombre: 'Tablero del dueño',
    home: /\/admin/,
  },
  emp: {
    id: 'EMP-03',
    ruta: '/app',
    nombre: 'Inicio del empleado',
    home: /\/app/,
  },
  sup: {
    id: 'SUP-02',
    ruta: '/sup',
    nombre: 'Inicio del supervisor',
    home: /\/sup/,
  },
}

function argumento(nombre: string): string | undefined {
  const par = process.argv.find((a) => a.startsWith(`--${nombre}=`))
  return par?.slice(nombre.length + 3)
}

function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, () => {
      const { port } = s.address() as net.AddressInfo
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

interface Resultado {
  pantalla: Pantalla
  modo: Modo
  corrida: number
  puntajes: Record<string, number>
  accesibilidadFalla: FalloAccesibilidad[]
  archivo: string
}

interface Lhr {
  runtimeError?: { code: string; message: string }
  finalDisplayedUrl?: string
  finalUrl: string
  categories: Record<
    string,
    { score: number | null; auditRefs: { id: string }[] }
  >
  audits: Record<
    string,
    {
      score: number | null
      title: string
      details?: { items?: { node?: { selector?: string; snippet?: string } }[] }
    }
  >
}

interface FalloAccesibilidad {
  auditoria: string
  titulo: string
  elementos: string[]
}

async function iniciarSesion(
  page: Page,
  base: string,
  c: Cuenta,
  home: RegExp,
) {
  await page.goto(`${base}/ingresar`)
  await page.getByLabel('Email').fill(c.email)
  await page.getByLabel('Contraseña', { exact: true }).fill(c.password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(home, { timeout: 30_000 })
  // Esperar a que la pantalla cargue de verdad antes de dejar la sesión guardada.
  await page
    .waitForLoadState('networkidle', { timeout: 30_000 })
    .catch(() => {})
}

/** Deja la sesión (localStorage) y borra service worker y cachés: la medición arranca "fría". */
async function enfriar(context: BrowserContext, page: Page) {
  await page.evaluate(async () => {
    for (const reg of await navigator.serviceWorker.getRegistrations()) {
      await reg.unregister()
    }
    for (const k of await caches.keys()) await caches.delete(k)
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.clearBrowserCache')
  await cdp.detach()
  await page.goto('about:blank')
}

function fallosDeAccesibilidad(lhr: Lhr): FalloAccesibilidad[] {
  const refs = lhr.categories.accessibility.auditRefs
  const fallos: FalloAccesibilidad[] = []
  for (const { id } of refs) {
    const a = lhr.audits[id]
    if (a.score === null || a.score === undefined || a.score >= 1) continue
    const items = a.details?.items ?? []
    fallos.push({
      auditoria: id,
      titulo: a.title,
      elementos: items
        .map((i) => i.node?.selector ?? i.node?.snippet ?? '')
        .filter(Boolean)
        .slice(0, 8),
    })
  }
  return fallos
}

async function medir(
  base: string,
  pantalla: Pantalla,
  modo: Modo,
  corrida: number,
  puerto: number,
  conSesion: boolean,
  desktopConfig: unknown,
): Promise<Resultado> {
  const p = PANTALLAS[pantalla]
  const url = `${base}${p.ruta}`
  const r = await lighthouse(
    url,
    {
      port: puerto,
      output: ['json', 'html'],
      logLevel: 'error',
      onlyCategories: CATEGORIAS,
      // Con sesión, el localStorage tiene que sobrevivir: la limpieza ya la hizo `enfriar`.
      disableStorageReset: conSesion,
    },
    modo === 'desktop' ? (desktopConfig as never) : undefined,
  )
  if (!r) throw new Error(`Lighthouse no devolvió resultado para ${url}`)
  const lhr = r.lhr as unknown as Lhr
  if (lhr.runtimeError) {
    throw new Error(
      `${p.id} ${modo}: ${lhr.runtimeError.code} — ${lhr.runtimeError.message}`,
    )
  }
  const finalUrl: string = lhr.finalDisplayedUrl ?? lhr.finalUrl
  if (!p.home.test(finalUrl)) {
    throw new Error(
      `${p.id} ${modo}: Lighthouse terminó en ${finalUrl} y no en ${p.ruta} (¿se perdió la sesión?).`,
    )
  }
  const base_ = path.join(SALIDA, `${pantalla}-${modo}-${corrida}`)
  const [json, html] = r.report as string[]
  writeFileSync(`${base_}.json`, json)
  writeFileSync(`${base_}.html`, html)
  const puntajes: Record<string, number> = {}
  for (const [k, cat] of Object.entries(lhr.categories)) {
    puntajes[k] = Math.round((cat.score ?? 0) * 100)
  }
  return {
    pantalla,
    modo,
    corrida,
    puntajes,
    accesibilidadFalla: fallosDeAccesibilidad(lhr),
    archivo: `${pantalla}-${modo}-${corrida}.html`,
  }
}

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

function armarResumen(
  base: string,
  resultados: Resultado[],
  instal: Comprobacion[],
): string {
  const l: string[] = []
  l.push(`# Lighthouse — ${base}`, '')
  l.push(`Fecha: ${new Date().toISOString()}`, '')
  l.push(
    '| Pantalla | Modo | Rendimiento | Accesibilidad | Buenas prácticas | SEO | Corridas |',
  )
  l.push('|---|---|---|---|---|---|---|')
  const claves = new Set(resultados.map((r) => `${r.pantalla}|${r.modo}`))
  for (const clave of claves) {
    const [pantalla, modo] = clave.split('|') as [Pantalla, Modo]
    const rs = resultados.filter(
      (r) => r.pantalla === pantalla && r.modo === modo,
    )
    const med = (k: string) => mediana(rs.map((r) => r.puntajes[k] ?? 0))
    const acc = med('accessibility')
    l.push(
      `| ${PANTALLAS[pantalla].id} ${PANTALLAS[pantalla].nombre} | ${modo} | ${med('performance')} | ${acc}${acc < UMBRAL_ACCESIBILIDAD ? ' (BAJO)' : ''} | ${med('best-practices')} | ${med('seo')} | ${rs.length} |`,
    )
  }
  l.push('', '## Accesibilidad: auditorías que no pasan', '')
  const vistos = new Set<string>()
  for (const r of resultados) {
    for (const f of r.accesibilidadFalla) {
      const k = `${r.pantalla}|${r.modo}|${f.auditoria}`
      if (vistos.has(k)) continue
      vistos.add(k)
      l.push(
        `- ${PANTALLAS[r.pantalla].id} (${r.modo}) · ${f.auditoria}: ${f.titulo}`,
      )
      for (const e of f.elementos) l.push(`  - \`${e}\``)
    }
  }
  if (vistos.size === 0) l.push('Ninguna.')
  l.push('', '## Instalabilidad (comprobación manual)', '')
  l.push('| Punto | Resultado | Detalle |', '|---|---|---|')
  for (const c of instal) {
    l.push(
      `| ${c.punto} | ${c.ok ? 'OK' : 'FALLA'} | ${c.detalle.replace(/\|/g, '/')} |`,
    )
  }
  return l.join('\n')
}

async function main() {
  const base = (argumento('base') ?? BASE_STAGING).replace(/\/$/, '')
  const host = new URL(base).hostname
  // Producción nunca: solo staging o un build local.
  if (
    !['dev.extendiendoservicios.com', 'localhost', '127.0.0.1'].includes(host)
  ) {
    throw new Error(`Solo se mide staging o localhost, no ${host}.`)
  }
  const solo = (argumento('solo') ?? 'login,adm,emp,sup').split(
    ',',
  ) as Pantalla[]
  const modos = (argumento('modos') ?? 'mobile,desktop').split(',') as Modo[]
  const corridas = Number(argumento('corridas') ?? '1')
  const sinInstal = process.argv.includes('--sin-instalabilidad')

  const desktopConfig = (
    (await import('lighthouse/core/config/desktop-config.js')) as {
      default: unknown
    }
  ).default

  rmSync(SALIDA, { recursive: true, force: true })
  mkdirSync(SALIDA, { recursive: true })

  const necesitaCuentas = solo.some((s) => s !== 'login')
  const env = necesitaCuentas ? leerEntorno() : null
  if (necesitaCuentas && !env) {
    throw new Error(
      'Faltan variables en .env.local (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SEED_DEV_PASSWORD).',
    )
  }
  const escenario = env ? new EscenarioLighthouse(env) : null

  const resultados: Resultado[] = []
  let instal: Comprobacion[] = []
  const perfiles: string[] = []

  async function conNavegador<T>(
    fn: (ctx: BrowserContext, page: Page, puerto: number) => Promise<T>,
  ): Promise<T> {
    const puerto = await puertoLibre()
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-perfil-'))
    perfiles.push(dir)
    const ctx = await chromium.launchPersistentContext(dir, {
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: [`--remote-debugging-port=${puerto}`],
    })
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage())
      return await fn(ctx, page, puerto)
    } finally {
      await ctx.close()
    }
  }

  try {
    if (escenario && solo.some((s) => s !== 'login')) {
      console.log('Armando cuentas y datos descartables E2E-P174...')
      await escenario.armar()
    }

    for (const pantalla of solo) {
      const cuenta: Cuenta | null =
        pantalla === 'adm'
          ? escenario!.duenoSemilla
          : pantalla === 'emp'
            ? escenario!.empleado
            : pantalla === 'sup'
              ? escenario!.supervisor
              : null
      await conNavegador(async (ctx, page, puerto) => {
        if (pantalla === 'login') {
          if (!sinInstal) {
            console.log('Instalabilidad (COM-01, sin sesión)...')
            instal = await comprobarInstalabilidad(page, base)
            await page.goto('about:blank')
          }
        } else {
          console.log(
            `Iniciando sesión por la interfaz (${PANTALLAS[pantalla].id})...`,
          )
          await iniciarSesion(page, base, cuenta!, PANTALLAS[pantalla].home)
          await enfriar(ctx, page)
        }
        for (const modo of modos) {
          for (let corrida = 1; corrida <= corridas; corrida++) {
            console.log(
              `Midiendo ${PANTALLAS[pantalla].id} · ${modo} · corrida ${corrida}...`,
            )
            const r = await medir(
              base,
              pantalla,
              modo,
              corrida,
              puerto,
              pantalla !== 'login',
              desktopConfig,
            )
            resultados.push(r)
            console.log(
              `  rendimiento ${r.puntajes.performance} · accesibilidad ${r.puntajes.accessibility} · buenas prácticas ${r.puntajes['best-practices']} · SEO ${r.puntajes.seo}`,
            )
          }
        }
      })
    }
  } finally {
    if (escenario) {
      const notas = await escenario.limpiar()
      console.log(
        notas.length
          ? `Limpieza con notas:\n- ${notas.join('\n- ')}`
          : 'Limpieza: cuentas y datos E2E-P174 borrados.',
      )
    }
    for (const dir of perfiles) rmSync(dir, { recursive: true, force: true })
  }

  const resumen = armarResumen(base, resultados, instal)
  writeFileSync(path.join(SALIDA, 'resumen.md'), resumen)
  writeFileSync(
    path.join(SALIDA, 'resumen.json'),
    JSON.stringify(resultados, null, 2),
  )
  writeFileSync(
    path.join(SALIDA, 'instalabilidad.json'),
    JSON.stringify(instal, null, 2),
  )
  console.log(`\n${resumen}\n\nInformes en ${SALIDA}`)

  const bajos = resultados.filter(
    (r) => (r.puntajes.accessibility ?? 0) < UMBRAL_ACCESIBILIDAD,
  )
  const fallasInstal = instal.filter((c) => !c.ok)
  if (bajos.length || fallasInstal.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
