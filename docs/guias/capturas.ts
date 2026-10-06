// docs/guias/capturas.ts — DOC-018, DOC-019, DOC-020 (P19.4)
//
// Regenera las capturas de pantalla de las guías de uso (`docs/guias/img/`).
//
// Es SOLO LECTURA: navega y abre pestañas, pero no ficha, no avisa, no califica y no crea ni edita
// nada. Corre contra `App_dev` (staging), nunca contra producción (`requireE2eEnv` corta si la URL
// es la de `App`). Usa las cuentas fijas `e2e-fijo-*` y el dueño del seed (`docs/test-inventory.md`
// sección 3).
//
// - Administración (1280 px): lee los datos ficticios reales de `App_dev` (el seed). Los nombres de
//   las cuentas de prueba se cambian en pantalla (no en la base) por nombres de ejemplo.
// - Empleado y supervisor (390 px): las cuentas fijas no tienen turnos, así que las lecturas de
//   `v_my_day`, `v_my_supervisions` y similares se reemplazan en el navegador por los datos
//   inventados de `datos-ejemplo.ts`. Cualquier escritura (POST, PATCH, DELETE) contra la base se
//   bloquea y el script informa cuántas bloqueó: hoy solo `mark_changes_seen`, que la app llama
//   sola al abrir Hoy.
//
// Uso (desde la raíz de `app/`):
//
//   pnpm exec vite --port 5191 --strictPort        # en otra terminal; sirve la app
//   node --env-file=.env.local docs/guias/capturas.ts --url=http://localhost:5191
//   python docs/guias/optimizar-png.py              # opcional: achica los PNG (necesita Pillow)
//
// No hace falta el puerto 5173: estas capturas no usan la Edge Function `admin-users` (el CORS de
// esa función solo admite ese puerto). Con las 52 capturas tarda unos tres minutos.
//
// Opciones:
//   --url=<origen>     origen de la app ya levantada (por omisión http://localhost:5173)
//   --solo=<texto>     solo las capturas cuyo nombre contenga ese texto
//   --salida=<carpeta> carpeta de salida (por omisión docs/guias/img)
//   --listar           muestra los nombres y termina
//
// Las capturas de empleado y supervisor son de 390 px de ancho; las de administración, de 1280 px.
// Los datos son siempre ficticios: nunca datos reales del cliente.

import { mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from '@playwright/test'
import { authStorageKey, requireE2eEnv } from '../../tests/fixtures/env.ts'
import { emailOf, signInSession } from '../../tests/fixtures/sessions.ts'
import type { SessionKey } from '../../tests/fixtures/sessions.ts'
import {
  ESCRITURAS_BLOQUEADAS,
  IDS_DE_EJEMPLO as ID,
  instalarDatosDeEjemplo,
  LECTURAS_REALES,
  type EscenarioEmpleado,
  type EscenarioSupervisor,
} from './datos-ejemplo.ts'

/**
 * Cambia en pantalla (nunca en la base) los nombres y correos de las cuentas de prueba por
 * nombres de ejemplo, para que las guías no muestren "E2E-Fijo" ni direcciones de prueba.
 */
async function enmascarar(
  page: Page,
  modo: 'quitar' | 'renombrar',
): Promise<void> {
  await page.evaluate((modoDeFilas) => {
    const reemplazos: Array<[RegExp, string]> = [
      [/E2E-Fijo(?:-[A-Z]{2})? Admin/g, 'Ana Administradora'],
    ]
    // Las filas de las cuentas de prueba (`E2E-...`) se sacan de las listas.
    // Con `renombrar` se les pone un nombre inventado en lugar de sacarlas (listas de personas).
    const inventados = [
      'Ana Ejemplo',
      'Beto Muestra',
      'Carla Demo',
      'Diego Prueba',
      'Elena Modelo',
      'Fabián Ficticio',
      'Gisela Ejemplo',
      'Hugo Muestra',
      'Irene Demo',
      'Julián Prueba',
    ]
    let siguiente = 0
    // La pantalla se vuelve a dibujar sola (se actualiza cada pocos segundos): se reaplica en cada cambio.
    const aplicar = () => {
      for (const fila of document.querySelectorAll('tr, [role="row"], li')) {
        if (fila.closest('aside, nav, header')) continue
        if (!/E2E-/.test(fila.textContent ?? '')) continue
        if (modoDeFilas === 'quitar') {
          fila.remove()
          continue
        }
        const nombre =
          inventados[siguiente++ % inventados.length] ?? 'Persona Ejemplo'
        const iniciales = nombre
          .split(' ')
          .map((parte) => parte[0])
          .join('')
        for (const hoja of fila.querySelectorAll('*')) {
          if (hoja.children.length > 0) continue
          const texto = hoja.textContent ?? ''
          if (/^E2E-Fijo(?:-[A-Z]{2})? \w+$/.test(texto))
            hoja.textContent = nombre
          else if (/^[A-Z]{2}$/.test(texto)) hoja.textContent = iniciales
        }
      }
      // Se reemplaza por elemento (el nombre puede venir partido en varios nodos de texto).
      for (const elemento of document.body.querySelectorAll('*')) {
        if (elemento.children.length > 0) continue
        let texto = elemento.textContent ?? ''
        const original = texto
        for (const [patron, nuevo] of reemplazos) {
          texto = texto.replace(patron, nuevo)
        }
        if (texto === 'EA') texto = 'AA'
        if (texto !== original) elemento.textContent = texto
      }
      for (const campo of document.querySelectorAll('input')) {
        if (/e2e-fijo.*@example\.com/i.test(campo.value)) {
          campo.value = 'laura.ejemplo@ejemplo.com'
        }
      }
    }
    aplicar()
    new MutationObserver(aplicar).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }, modo)
}

const RAIZ = fileURLToPath(new URL('../..', import.meta.url))

type Vista = 'celular' | 'escritorio'
type Rol = 'sin-sesion' | SessionKey

interface Captura {
  /** Nombre del archivo, sin extensión. */
  nombre: string
  rol: Rol
  vista: Vista
  ruta: string
  /** Texto que tiene que estar visible antes de sacar la foto. */
  espera: string | RegExp
  /** Pasos de solo lectura previos (abrir una pestaña, un panel, etc.). */
  preparar?: (page: Page) => Promise<void>
  /** Qué hacer con las filas de cuentas de prueba: sacarlas (por omisión) o renombrarlas. */
  personas?: 'quitar' | 'renombrar'
  /** Captura de página completa (por omisión, solo lo visible). */
  completa?: boolean
  /** Datos de ejemplo que reemplazan las lecturas (ver `datos-ejemplo.ts`). */
  ejemplo?: {
    empleado?: EscenarioEmpleado
    supervisor?: EscenarioSupervisor
    consentimiento?: boolean
  }
}

const TAMANOS: Record<Vista, { width: number; height: number }> = {
  celular: { width: 390, height: 844 },
  escritorio: { width: 1280, height: 800 },
}

// Nombres: `<guía>-<tema>`. Las guías los citan tal cual desde `docs/guias/img/`.
const elegir = (texto: string) => async (page: Page) => {
  await page.getByText(texto).first().click()
}

const primeraFicha = async (page: Page) => {
  await page
    .locator('a[href^="/admin/empleados/"]:not([href$="nuevo"])')
    .first()
    .click()
  await page.getByRole('tab', { name: 'Habilitaciones' }).click()
  await page.waitForTimeout(800)
}

const primerCliente = async (page: Page) => {
  await page
    .locator('a[href^="/admin/clientes/"]:not([href$="nuevo"])')
    .first()
    .click()
  await page.getByText('Nueva sede').first().waitFor()
}

const primeraSede = async (page: Page) => {
  await primerCliente(page)
  await page
    .locator('a[href^="/admin/sedes/"]:not([href*="nueva"])')
    .first()
    .click()
  await page.getByText('Próximos turnos').first().waitFor()
}

const nuevaSede = async (page: Page) => {
  await primerCliente(page)
  await page.getByRole('link', { name: 'Nueva sede' }).click()
  await page.getByText('Restricciones informativas').first().waitFor()
}

const pestanaDelCliente = (nombre: string) => async (page: Page) => {
  await primerCliente(page)
  await page.getByRole('tab', { name: nombre }).click()
  await page.waitForTimeout(800)
}

const plantillaDeUnCliente = async (page: Page) => {
  await page.getByRole('combobox').first().click()
  await page.getByRole('option').first().click()
  await page.waitForTimeout(1200)
}

const primeraSupervision = async (page: Page) => {
  await page
    .locator('a[href^="/admin/supervisiones/"]:not([href$="nueva"])')
    .first()
    .click()
  await page.waitForTimeout(1200)
}

const abrirTurno = async (page: Page) => {
  await page.getByText('Ver', { exact: true }).nth(1).click()
  await page
    .getByText(/Dotación: \d/)
    .first()
    .waitFor()
}

export const CAPTURAS: Captura[] = [
  // ---- Comunes (celular) -------------------------------------------------------------------
  {
    nombre: 'comun-ingreso',
    rol: 'sin-sesion',
    vista: 'celular',
    ruta: '/ingresar',
    espera: 'Ingresar',
  },
  {
    nombre: 'comun-recuperar',
    rol: 'sin-sesion',
    vista: 'celular',
    ruta: '/recuperar',
    espera: 'Recuperar contraseña',
  },
  {
    nombre: 'comun-perfil',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/perfil',
    espera: 'Cambiar contraseña',
    ejemplo: { empleado: 'esperado' },
    completa: true,
  },

  // ---- Empleado (celular) ------------------------------------------------------------------
  {
    nombre: 'emp-hoy',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/app',
    espera: 'Hola, Laura',
    ejemplo: { empleado: 'esperado' },
    completa: true,
  },
  {
    nombre: 'emp-hoy-vacio',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/app',
    espera: 'No tenés servicios hoy',
    ejemplo: { empleado: 'sin-servicios' },
  },
  {
    nombre: 'emp-detalle',
    rol: 'empleado1',
    vista: 'celular',
    ruta: `/app/servicio/${ID.asignacion1}`,
    espera: 'Tareas previstas',
    ejemplo: { empleado: 'esperado' },
    completa: true,
  },
  {
    nombre: 'emp-consentimiento',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/app/fichar/consentimiento',
    espera: 'Tu ubicación al fichar',
    ejemplo: { empleado: 'esperado', consentimiento: false },
  },
  {
    nombre: 'emp-fichar-elegir',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/app/fichar',
    espera: /Cuál vas a empezar/,
    ejemplo: { empleado: 'esperado' },
  },
  {
    nombre: 'emp-fichar-inicio',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/app/fichar',
    espera: /Cuál vas a empezar/,
    ejemplo: { empleado: 'esperado' },
    preparar: async (p) => {
      await elegir('Sede Central')(p)
      await p.getByRole('button', { name: 'Registrar inicio' }).waitFor()
    },
  },
  {
    nombre: 'emp-en-curso',
    rol: 'empleado1',
    vista: 'celular',
    ruta: `/app/en-curso/${ID.asignacion1}`,
    espera: 'Finalizar servicio',
    ejemplo: { empleado: 'en-curso' },
  },
  {
    nombre: 'emp-tareas',
    rol: 'empleado1',
    vista: 'celular',
    ruta: `/app/en-curso/${ID.asignacion1}/tareas`,
    espera: /Barrer/,
    ejemplo: { empleado: 'en-curso' },
  },
  {
    nombre: 'emp-observaciones',
    rol: 'empleado1',
    vista: 'celular',
    ruta: `/app/en-curso/${ID.asignacion1}/observaciones`,
    espera: /Contá cómo fue este servicio/,
    ejemplo: { empleado: 'en-curso' },
  },
  {
    nombre: 'emp-finalizar',
    rol: 'empleado1',
    vista: 'celular',
    ruta: `/app/en-curso/${ID.asignacion1}/finalizar`,
    espera: 'Registrar fin',
    ejemplo: { empleado: 'en-curso' },
  },
  {
    nombre: 'emp-resumen',
    rol: 'empleado1',
    vista: 'celular',
    ruta: `/app/resumen/${ID.asignacion1}`,
    espera: 'Volver a Hoy',
    ejemplo: { empleado: 'finalizado' },
    completa: true,
  },
  {
    nombre: 'emp-avisar-elegir',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/app/avisar',
    espera: /Elegí el servicio/,
    ejemplo: { empleado: 'esperado' },
  },
  {
    nombre: 'emp-hoy-con-aviso',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/app',
    espera: /Avisaste una demora/,
    ejemplo: { empleado: 'con-demora' },
  },
  {
    nombre: 'emp-mas',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/app/mas',
    espera: 'Cerrar sesión',
    ejemplo: { empleado: 'esperado' },
  },

  // ---- Supervisor (celular) ----------------------------------------------------------------
  {
    nombre: 'sup-hoy',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup',
    espera: 'Hola, Sofía',
    ejemplo: { supervisor: 'asignada' },
  },
  {
    nombre: 'sup-supervisiones',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup/supervisiones',
    espera: /Edificio Demo/,
    ejemplo: { supervisor: 'asignada' },
  },
  {
    nombre: 'sup-detalle',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: `/sup/supervisiones/${ID.supervision1}`,
    espera: 'Empleados a supervisar',
    ejemplo: { supervisor: 'asignada' },
    completa: true,
  },
  {
    nombre: 'sup-registro',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: `/sup/supervisiones/${ID.supervision1}/registro`,
    espera: 'Registrar inicio',
    ejemplo: { supervisor: 'asignada' },
  },
  {
    nombre: 'sup-en-curso',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: `/sup/supervisiones/${ID.supervision1}`,
    espera: 'Registrar fin de supervisión',
    ejemplo: { supervisor: 'en-curso' },
    completa: true,
  },
  {
    nombre: 'sup-calificar',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: `/sup/supervisiones/${ID.supervision1}/calificar/${ID.asignacion1}`,
    espera: 'Criterios de calificación',
    ejemplo: { supervisor: 'en-curso' },
    completa: true,
  },
  {
    nombre: 'sup-cerrar',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: `/sup/supervisiones/${ID.supervision1}/cerrar`,
    espera: 'Completar',
    ejemplo: { supervisor: 'por-cerrar' },
    completa: true,
  },
  {
    nombre: 'sup-historial',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup/historial',
    espera: /Edificio Demo/,
    ejemplo: { supervisor: 'completada' },
  },
  {
    nombre: 'sup-mas',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup/mas',
    espera: 'Cerrar sesión',
    ejemplo: { supervisor: 'asignada' },
  },

  // ---- Administración (escritorio) ---------------------------------------------------------
  {
    nombre: 'adm-resumen',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin',
    espera: 'Requiere atención',
  },
  {
    nombre: 'adm-celular-resumen',
    rol: 'admin',
    vista: 'celular',
    ruta: '/admin',
    espera: 'Requiere atención',
  },
  {
    nombre: 'adm-planificacion-mes',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/planificacion',
    espera: 'Generar turnos del mes',
  },
  {
    nombre: 'adm-planificacion-semana',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/planificacion?vista=semana',
    espera: 'Planificación',
  },
  {
    nombre: 'adm-planificacion-dia',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/planificacion?vista=dia',
    espera: /Franja/,
  },
  {
    nombre: 'adm-turno-detalle',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/planificacion?vista=dia',
    espera: /Franja/,
    preparar: abrirTurno,
  },
  {
    nombre: 'adm-turnos-generar',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/turnos/generar',
    espera: 'Mes a generar',
  },
  {
    nombre: 'adm-turno-nuevo',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/turnos/nuevo',
    espera: 'Crear turno',
  },
  {
    nombre: 'adm-asistencia',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/asistencia',
    espera: 'Asistencia',
  },
  {
    nombre: 'adm-supervisiones',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/supervisiones',
    espera: 'Asignar supervisión',
  },
  {
    nombre: 'adm-supervision-detalle',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/supervisiones',
    espera: 'Asignar supervisión',
    preparar: primeraSupervision,
  },
  {
    nombre: 'adm-supervision-asignar',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/supervisiones/nueva',
    espera: 'Asignar supervisión',
  },
  {
    nombre: 'adm-empleados',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/empleados',
    espera: 'Nuevo empleado',
    personas: 'renombrar',
  },
  {
    nombre: 'adm-empleado-ficha',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/empleados',
    espera: 'Nuevo empleado',
    preparar: primeraFicha,
  },
  {
    nombre: 'adm-empleado-nuevo',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/empleados/nuevo',
    espera: 'Usuario y contraseña',
    completa: true,
  },
  {
    nombre: 'adm-clientes',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/clientes',
    espera: 'Nuevo cliente',
  },
  {
    nombre: 'adm-cliente-nuevo',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/clientes/nuevo',
    espera: 'Razón social',
    completa: true,
  },
  {
    nombre: 'adm-cliente-detalle',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/clientes',
    espera: 'Nuevo cliente',
    preparar: primerCliente,
  },
  {
    nombre: 'adm-sede-detalle',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/clientes',
    espera: 'Nuevo cliente',
    preparar: primeraSede,
  },
  {
    nombre: 'adm-sede-nueva',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/clientes',
    espera: 'Nuevo cliente',
    preparar: nuevaSede,
    completa: true,
  },
  {
    nombre: 'adm-cliente-contactos',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/clientes',
    espera: 'Nuevo cliente',
    preparar: pestanaDelCliente('Contactos'),
  },
  {
    nombre: 'adm-servicio-nuevo',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/servicios/nuevo',
    espera: 'Días y franja horaria',
    completa: true,
  },
  {
    nombre: 'adm-tareas',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/tareas',
    espera: 'Elegí un cliente',
    preparar: plantillaDeUnCliente,
  },
  {
    nombre: 'adm-empresa',
    rol: 'owner',
    vista: 'escritorio',
    ruta: '/admin/configuracion/empresa',
    espera: 'Empresa',
  },
  {
    nombre: 'adm-feriados',
    rol: 'owner',
    vista: 'escritorio',
    ruta: '/admin/configuracion/feriados',
    espera: 'Feriados',
  },
  {
    nombre: 'adm-criterios',
    rol: 'owner',
    vista: 'escritorio',
    ruta: '/admin/configuracion/criterios',
    espera: 'Criterios de calificación',
  },
]

function argumento(nombre: string): string | undefined {
  const prefijo = `--${nombre}=`
  return process.argv.find((a) => a.startsWith(prefijo))?.slice(prefijo.length)
}

async function main(): Promise<void> {
  const origen = argumento('url') ?? 'http://localhost:5173'
  const solo = argumento('solo')
  const salida = path.resolve(
    RAIZ,
    argumento('salida') ?? path.join('docs', 'guias', 'img'),
  )

  const lista = CAPTURAS.filter((c) => !solo || c.nombre.includes(solo))
  if (process.argv.includes('--listar')) {
    for (const c of lista) console.log(c.nombre)
    return
  }

  const env = requireE2eEnv() // corta si apunta a producción
  mkdirSync(salida, { recursive: true })

  const navegador = await chromium.launch()
  const sesiones = new Map<Rol, { json: string; usuarioId: string }>()
  let hechas = 0
  const fallidas: string[] = []

  try {
    for (const captura of lista) {
      const contexto = await navegador.newContext({
        viewport: TAMANOS[captura.vista],
        deviceScaleFactor: 1,
        locale: 'es-AR',
        timezoneId: 'America/Argentina/Buenos_Aires',
        hasTouch: captura.vista === 'celular',
        reducedMotion: 'reduce',
      })
      try {
        if (captura.rol !== 'sin-sesion') {
          let guardada = sesiones.get(captura.rol)
          if (!guardada) {
            const sesion = await signInSession(emailOf(captura.rol))
            guardada = {
              json: JSON.stringify(sesion),
              usuarioId: sesion.user.id,
            }
            sesiones.set(captura.rol, guardada)
          }
          const clave = authStorageKey(env.supabaseUrl)
          await contexto.addInitScript(
            ([k, v]) => window.localStorage.setItem(k, v),
            [clave, guardada.json] as const,
          )
          if (captura.ejemplo) {
            await instalarDatosDeEjemplo(contexto, {
              usuarioId: guardada.usuarioId,
              consentimiento: captura.ejemplo.consentimiento ?? true,
              empleado: captura.ejemplo.empleado,
              supervisor: captura.ejemplo.supervisor,
            })
          }
        }
        // Sin avisos que tapen la pantalla en las fotos.
        await contexto.addInitScript(() => {
          window.localStorage.setItem(
            'banner-instalacion-descartado-en',
            String(Date.now()),
          )
        })
        const page = await contexto.newPage()
        await page.goto(`${origen}${captura.ruta}`)
        await page
          .getByText(captura.espera)
          .first()
          .waitFor({ timeout: 20_000 })
        if (captura.preparar) await captura.preparar(page)
        await page.waitForLoadState('networkidle').catch(() => undefined)
        await page.waitForTimeout(1200)
        await enmascarar(page, captura.personas ?? 'quitar')
        await page.waitForTimeout(150)
        await page.screenshot({
          path: path.join(salida, `${captura.nombre}.png`),
          fullPage: captura.completa ?? false,
        })
        hechas++
        console.log(`ok     ${captura.nombre}`)
      } catch (error) {
        fallidas.push(captura.nombre)
        console.log(
          `FALLÓ  ${captura.nombre}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        )
      } finally {
        await contexto.close()
      }
    }
  } finally {
    await navegador.close()
  }

  console.log(
    `Escrituras bloqueadas por la guarda: ${ESCRITURAS_BLOQUEADAS.length === 0 ? 'ninguna' : [...new Set(ESCRITURAS_BLOQUEADAS)].join(', ')}`,
  )
  if (LECTURAS_REALES.size > 0) {
    console.log(
      `Lecturas que salieron a App_dev sin reemplazar: ${[...LECTURAS_REALES].join(', ')}`,
    )
  }
  const kb = readdirSync(salida)
    .filter((f) => f.endsWith('.png'))
    .reduce((suma, f) => suma + statSync(path.join(salida, f)).size, 0)
  console.log(
    `\n${hechas} capturas generadas, ${fallidas.length} fallidas. Peso total de la carpeta: ${Math.round(kb / 1024)} KB.`,
  )
  if (fallidas.length > 0) process.exitCode = 1
}

await main()
