// docs/guias/capturas.ts — DOC-018, DOC-019, DOC-020 (P19.4), P24.6b, P25.7
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
// - Empleado y coordinador (390 px): las cuentas fijas no tienen turnos, jornadas ni supervisiones,
//   así que las lecturas de `v_my_day`, `v_my_supervisions`, `v_supervisor_today`, `v_my_workdays`
//   y similares se reemplazan en el navegador por los datos inventados de `datos-ejemplo.ts`.
//   Cualquier escritura (POST, PATCH, DELETE) contra la base se bloquea y el script informa cuántas
//   bloqueó: hoy `mark_changes_seen`, que la app llama sola al abrir Hoy, y `get_stock_summary`, que la app
// llama para el número de avisos junto a Insumos en el menú (en las capturas ese número no aparece).
// - Administración con coordinadores (1280 px, `ejemplo.admin`): las pantallas siguen leyendo los
//   datos reales de `App_dev`, pero las lecturas de jornadas, estado de coordinadores,
//   preferencias y supervisiones se reemplazan por datos inventados. La ficha que se abre es la de
//   la cuenta fija `e2e-fijo-supervisor1`, con su nombre cambiado en pantalla por «Sofía Ejemplo».
// - Insumos (P25.7): las capturas `adm-insumos-*` usan la cuenta del DUEÑO (que tiene «Gestionar
//   stock» sin que nadie se lo dé) y reemplazan las lecturas de Insumos por un catálogo inventado
//   (`datos-ejemplo.ts`), así no dependen de lo que haya cargado en `App_dev`. Las `emp-insumos-*` y
//   `sup-insumos-*` son del celular. Los pasos previos (agregar un artículo, escribir un nombre)
//   solo llenan formularios: nunca se toca «Registrar» ni «Confirmar».
//
// Uso (desde la raíz de `app/`):
//
//   pnpm exec vite --port 5191 --strictPort        # en otra terminal; sirve la app
//   node --env-file=.env.local docs/guias/capturas.ts --url=http://localhost:5191
//   python docs/guias/optimizar-png.py              # opcional: achica los PNG (necesita Pillow)
//
// No hace falta el puerto 5173: estas capturas no usan la Edge Function `admin-users` (el CORS de
// esa función solo admite ese puerto). Con todas las capturas tarda unos cinco minutos.
//
// Opciones:
//   --url=<origen>     origen de la app ya levantada (por omisión http://localhost:5173)
//   --solo=<texto>     solo las capturas cuyo nombre contenga ese texto
//   --salida=<carpeta> carpeta de salida (por omisión docs/guias/img)
//   --listar           muestra los nombres y termina
//
// Las capturas de empleado y coordinador son de 390 px de ancho; las de administración, de 1280 px.
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
  fijarClienteDeEjemplo,
  IDS_DE_EJEMPLO as ID,
  IDS_DE_INSUMOS as SUM,
  instalarDatosDeEjemplo,
  LECTURAS_REALES,
  type EscenarioAdmin,
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
      [/E2E-Fijo(?:-[A-Z]{2})? Supervisor1/g, 'Sofía Ejemplo'],
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
        if (texto === 'ES') texto = 'SE'
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

/** Datos que algunas rutas necesitan (el identificador real de la cuenta de coordinador). */
interface ContextoDeRuta {
  coordinadorId: string
}

interface Captura {
  /** Nombre del archivo, sin extensión. */
  nombre: string
  rol: Rol
  vista: Vista
  ruta: string | ((contexto: ContextoDeRuta) => string)
  /** Texto que tiene que estar visible antes de sacar la foto. */
  espera: string | RegExp
  /** Pasos de solo lectura previos (abrir una pestaña, un panel, etc.). */
  preparar?: (page: Page) => Promise<void>
  /** Qué hacer con las filas de cuentas de prueba: sacarlas (por omisión) o renombrarlas. */
  personas?: 'quitar' | 'renombrar'
  /** Captura de página completa (por omisión, solo lo visible). */
  completa?: boolean
  /** Selector CSS de un elemento: se saca la foto solo de ese elemento (en vez de la pantalla). */
  elemento?: string
  /** Datos de ejemplo que reemplazan las lecturas (ver `datos-ejemplo.ts`). */
  ejemplo?: {
    empleado?: EscenarioEmpleado
    supervisor?: EscenarioSupervisor
    admin?: EscenarioAdmin
    consentimiento?: boolean
    /** Celular: suma las lecturas de Insumos (catálogo y turnos para retirar). */
    insumos?: boolean
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

const abrirTurno = async (page: Page) => {
  await page.getByText('Ver', { exact: true }).nth(1).click()
  await page
    .getByText(/Dotación: \d/)
    .first()
    .waitFor()
}

const BARRA_DE_JORNADA = '[data-testid="workday-bar"]'

/** Abre el primer cliente y le avisa al script cuál es, para mostrar sus coordinadores preferenciales. */
const clienteConPreferencias = async (page: Page) => {
  const enlace = page
    .locator('a[href^="/admin/clientes/"]:not([href$="nuevo"])')
    .first()
  const href = await enlace.getAttribute('href')
  fijarClienteDeEjemplo(href?.split('/').pop() ?? null)
  await enlace.click()
  const bloque = page.getByText('Coordinadores preferenciales').first()
  await bloque.waitFor()
  await bloque.scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
}

/** Abre la supervisión que quedó «Sin cerrar» (la fila lleva esa marca). */
const supervisionSinCerrar = async (page: Page) => {
  await page
    .getByRole('row')
    .filter({ hasText: 'Sin cerrar' })
    .getByRole('link')
    .first()
    .click()
  await page.getByText('Criterios usados').waitFor()
  await page.waitForTimeout(800)
}

/** Abre el cuadro para corregir la hora de un evento de la jornada (no confirma nada). */
const corregirHora = async (page: Page) => {
  await page
    .getByRole('button', { name: /Corregir hora/ })
    .first()
    .click()
  await page.getByText('Hora nueva').waitFor()
}

/** Abre la hoja imprimible de la pestaña «Asistencia» de un coordinador (no imprime nada). */
const descargarDetalle = async (page: Page) => {
  const boton = page.getByRole('button', { name: 'Descargar detalle' })
  await boton.waitFor()
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('Descargar detalle') && b.disabled,
      ),
  )
  await boton.click()
  await page.getByText('Imprimir o guardar como PDF').waitFor()
  await page.waitForTimeout(800)
}

const verElemento = (selector: string) => async (page: Page) => {
  await page.locator(selector).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(2500)
}

/** Agrega un artículo al formulario de ingreso, eligiéndolo del buscador. */
const agregarAlIngreso = async (page: Page, nombre: RegExp) => {
  await page.getByRole('combobox', { name: 'Agregar un artículo' }).click()
  await page.getByRole('option', { name: nombre }).first().click()
}

/** Ingreso con dos artículos cargados y los datos del comprobante (sin registrar nada). */
const llenarIngreso = async (page: Page) => {
  await agregarAlIngreso(page, /Lavandina/)
  await page.locator('#entry-qty-0').fill('12')
  await page.locator('#entry-cost-0').fill('1400')
  await agregarAlIngreso(page, /Bolsa de residuos/)
  await page.locator('#entry-qty-1').fill('30')
  await page.locator('#entry-supplier').fill('Droguería Ejemplo')
  await page.locator('#entry-document').fill('R-0001-00012345')
}

/** «Cargar control» con quien revisó y dos artículos contados (sin confirmar). */
const llenarControl = async (page: Page) => {
  await page.getByText('Un nombre escrito').first().click()
  await page.locator('#count-reviewer-name').fill('Laura Administradora')
  await page.getByLabel(/^Contado de Lavandina/).fill('2')
  await page.getByLabel(/^Contado de Desengrasante/).fill('18')
  await page.getByLabel(/^Contado de Guantes/).fill('0')
  // Sin foco en el último campo y con la pantalla arriba de todo (si no, el encabezado fijo queda
  // en el medio de la captura de página completa).
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    for (const elemento of document.querySelectorAll('*')) {
      if (elemento.scrollTop > 0) elemento.scrollTop = 0
    }
    window.scrollTo(0, 0)
  })
}

/** Retiro del celular: elige el primer turno y pasa a los artículos, con dos agregados. */
const elegirTurnoYArticulos = async (page: Page) => {
  await page.getByText('Edificio Demo · Sede Central').first().click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('button', { name: /^Agregar Lavandina/ }).click()
  await page.getByRole('button', { name: /^Agregar Bolsa de residuos/ }).click()
  await page
    .getByText(/Revisar retiro/)
    .first()
    .waitFor()
}

/** Aviso de faltante del celular con un insumo escrito y un comentario (sin enviar). */
const llenarAviso = async (page: Page) => {
  await page.getByText('Otro insumo').first().click()
  await page.getByLabel('Qué insumo falta').fill('Esponjas verdes')
  await page.getByLabel('Comentario').fill('No hay ninguna en el carro.')
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

  // ---- Coordinador (celular) ---------------------------------------------------------------
  // La barra de jornada en cada estado (solo la tarjeta, no la pantalla entera).
  {
    nombre: 'sup-jornada-sin-iniciar',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup',
    espera: 'Todavía no iniciaste la jornada.',
    elemento: BARRA_DE_JORNADA,
    ejemplo: { supervisor: 'sin-jornada' },
  },
  {
    nombre: 'sup-jornada-en-actividad',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup',
    espera: /Iniciada a las/,
    elemento: BARRA_DE_JORNADA,
    ejemplo: { supervisor: 'en-actividad' },
  },
  {
    nombre: 'sup-jornada-supervisando',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup',
    espera: /Supervisando:/,
    elemento: BARRA_DE_JORNADA,
    ejemplo: { supervisor: 'supervisando' },
  },
  {
    nombre: 'sup-jornada-en-pausa',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup',
    espera: /En pausa desde/,
    elemento: BARRA_DE_JORNADA,
    ejemplo: { supervisor: 'en-pausa' },
  },
  {
    nombre: 'sup-jornada-finalizada',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup',
    espera: 'Reabrir jornada',
    elemento: BARRA_DE_JORNADA,
    ejemplo: { supervisor: 'finalizada' },
  },
  {
    nombre: 'sup-jornada-pausar',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup',
    espera: /Iniciada a las/,
    ejemplo: { supervisor: 'en-actividad' },
    preparar: async (p) => {
      await p.getByRole('button', { name: 'Pausar' }).click()
      await p.getByText('Pausar la jornada').waitFor()
      await p.getByLabel('Motivo de la pausa').fill('Almuerzo')
    },
  },
  {
    nombre: 'sup-hoy',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup',
    espera: 'Otras sedes',
    ejemplo: { supervisor: 'en-actividad' },
    completa: true,
  },
  {
    nombre: 'sup-turno',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: `/sup/turnos/${ID.turno1}`,
    espera: 'Quién más lo supervisa',
    ejemplo: { supervisor: 'en-actividad', consentimiento: false },
    completa: true,
  },
  {
    nombre: 'sup-turno-bloqueado',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: `/sup/turnos/${ID.turno1}`,
    espera: 'Iniciá tu jornada para poder supervisar.',
    ejemplo: { supervisor: 'sin-jornada', consentimiento: false },
  },
  {
    nombre: 'sup-supervisiones',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup/supervisiones',
    espera: /Edificio Demo/,
    ejemplo: { supervisor: 'supervisando' },
  },
  {
    nombre: 'sup-en-curso',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: `/sup/supervisiones/${ID.supervision1}`,
    espera: 'Empleados a supervisar',
    ejemplo: { supervisor: 'supervisando' },
    completa: true,
  },
  {
    nombre: 'sup-calificar',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: `/sup/supervisiones/${ID.supervision1}/calificar/${ID.asignacion2}`,
    espera: 'Criterios de calificación',
    ejemplo: { supervisor: 'supervisando' },
    completa: true,
  },
  {
    nombre: 'sup-cerrar',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: `/sup/supervisiones/${ID.supervision1}/cerrar`,
    espera: 'Calificaste a 2 de 2 empleados.',
    ejemplo: { supervisor: 'por-cerrar' },
    completa: true,
  },
  {
    nombre: 'sup-historial',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup/historial',
    espera: /Cerrada automáticamente/,
    ejemplo: { supervisor: 'historial' },
    completa: true,
  },
  {
    nombre: 'sup-mas',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup/mas',
    espera: 'Cerrar sesión',
    ejemplo: { supervisor: 'en-actividad' },
  },

  // ---- Administración (escritorio) ---------------------------------------------------------
  {
    nombre: 'adm-resumen',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin',
    espera: 'Requiere atención',
    ejemplo: { admin: 'coordinadores' },
  },
  {
    nombre: 'adm-resumen-mapa',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin',
    espera: 'Dónde está el equipo',
    ejemplo: { admin: 'coordinadores' },
    elemento: 'section[aria-label="Mapa de presencia"]',
    preparar: verElemento('section[aria-label="Mapa de presencia"]'),
  },
  {
    nombre: 'adm-resumen-jornadas',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin',
    espera: 'Jornadas abiertas',
    ejemplo: { admin: 'coordinadores' },
    elemento: 'section[aria-label="Supervisiones de hoy"]',
  },
  {
    nombre: 'adm-celular-resumen',
    rol: 'admin',
    vista: 'celular',
    ruta: '/admin',
    espera: 'Requiere atención',
    ejemplo: { admin: 'coordinadores' },
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
    espera: 'Calendario',
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
    nombre: 'adm-asistencia-coordinadores',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/asistencia',
    espera: 'Asistencia',
    ejemplo: { admin: 'coordinadores' },
    elemento: 'section[aria-label="Coordinadores"]',
    preparar: verElemento('section[aria-label="Coordinadores"]'),
  },
  {
    nombre: 'adm-supervisiones',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/supervisiones',
    espera: 'Calificaciones cargadas',
    ejemplo: { admin: 'coordinadores' },
  },
  {
    nombre: 'adm-supervision-detalle',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/supervisiones',
    espera: 'Calificaciones cargadas',
    ejemplo: { admin: 'coordinadores' },
    preparar: supervisionSinCerrar,
  },
  {
    nombre: 'adm-coordinador-preferenciales',
    rol: 'admin',
    vista: 'escritorio',
    ruta: ({ coordinadorId }) =>
      `/admin/empleados/${coordinadorId}?pestana=preferenciales`,
    espera: 'Cliente entero, todas sus sedes',
    ejemplo: { admin: 'coordinadores' },
  },
  {
    nombre: 'adm-coordinador-jornadas',
    rol: 'admin',
    vista: 'escritorio',
    ruta: ({ coordinadorId }) =>
      `/admin/empleados/${coordinadorId}?pestana=jornadas`,
    espera: 'Registro de la jornada',
    ejemplo: { admin: 'coordinadores' },
    completa: true,
  },
  {
    nombre: 'adm-jornada-corregir',
    rol: 'admin',
    vista: 'escritorio',
    ruta: ({ coordinadorId }) =>
      `/admin/empleados/${coordinadorId}?pestana=jornadas`,
    espera: 'Registro de la jornada',
    ejemplo: { admin: 'coordinadores' },
    preparar: corregirHora,
  },
  {
    nombre: 'adm-jornada-imprimir',
    rol: 'admin',
    vista: 'escritorio',
    ruta: ({ coordinadorId }) =>
      `/admin/empleados/${coordinadorId}?pestana=asistencia`,
    espera: 'Descargar detalle',
    ejemplo: { admin: 'coordinadores' },
    preparar: descargarDetalle,
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
    nombre: 'adm-cliente-preferenciales',
    rol: 'admin',
    vista: 'escritorio',
    ruta: '/admin/clientes',
    espera: 'Nuevo cliente',
    ejemplo: { admin: 'coordinadores' },
    preparar: clienteConPreferencias,
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
  // ---- Insumos (módulo E, P25.7): administración con la cuenta del dueño --------------------
  {
    nombre: 'adm-insumos-stock',
    rol: 'owner',
    vista: 'escritorio',
    ruta: '/admin/insumos',
    espera: 'Nuevo artículo',
    ejemplo: { admin: 'insumos' },
    completa: true,
  },
  {
    nombre: 'adm-insumos-ficha',
    rol: 'owner',
    vista: 'escritorio',
    ruta: `/admin/insumos/${SUM.lavandina}`,
    espera: 'Cambiar precios',
    ejemplo: { admin: 'insumos' },
    completa: true,
  },
  {
    nombre: 'adm-insumos-ingreso',
    rol: 'owner',
    vista: 'escritorio',
    ruta: '/admin/insumos/ingreso',
    espera: 'Registrar ingreso',
    ejemplo: { admin: 'insumos' },
    preparar: llenarIngreso,
    completa: true,
  },
  {
    nombre: 'adm-insumos-movimientos',
    rol: 'owner',
    vista: 'escritorio',
    ruta: '/admin/insumos?pestana=movimientos',
    espera: 'Exportar a Excel',
    ejemplo: { admin: 'insumos' },
    completa: true,
  },
  {
    nombre: 'adm-insumos-consumo',
    rol: 'owner',
    vista: 'escritorio',
    ruta: '/admin/insumos?pestana=consumo',
    espera: /Total del período/,
    ejemplo: { admin: 'insumos' },
    completa: true,
  },
  {
    nombre: 'adm-insumos-control',
    rol: 'owner',
    vista: 'escritorio',
    ruta: '/admin/insumos/control',
    espera: 'Confirmar control',
    ejemplo: { admin: 'insumos' },
    preparar: llenarControl,
    completa: true,
  },
  {
    nombre: 'adm-insumos-faltantes',
    rol: 'owner',
    vista: 'escritorio',
    ruta: '/admin/insumos?pestana=faltantes',
    espera: 'Esponjas verdes',
    ejemplo: { admin: 'insumos' },
    completa: true,
  },

  // ---- Insumos (celular) -----------------------------------------------------------------
  {
    nombre: 'emp-insumos',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/app/insumos',
    espera: 'Retirar insumos',
    ejemplo: { empleado: 'esperado', insumos: true },
    completa: true,
  },
  {
    nombre: 'emp-insumos-retirar',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/app/insumos/retirar',
    espera: 'Continuar',
    ejemplo: { empleado: 'esperado', insumos: true },
    preparar: elegirTurnoYArticulos,
  },
  {
    nombre: 'emp-insumos-faltante',
    rol: 'empleado1',
    vista: 'celular',
    ruta: '/app/insumos/faltante',
    espera: 'Enviar aviso',
    ejemplo: { empleado: 'esperado', insumos: true },
    preparar: llenarAviso,
  },
  {
    nombre: 'sup-insumos',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup/insumos',
    espera: 'Retirar insumos',
    ejemplo: { supervisor: 'en-actividad', insumos: true },
    completa: true,
  },
  {
    nombre: 'sup-insumos-retirar',
    rol: 'supervisor1',
    vista: 'celular',
    ruta: '/sup/insumos/retirar',
    espera: 'Otras sedes',
    ejemplo: { supervisor: 'en-actividad', insumos: true },
    completa: true,
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
  const sesionDe = async (rol: SessionKey) => {
    let guardada = sesiones.get(rol)
    if (!guardada) {
      const sesion = await signInSession(emailOf(rol))
      guardada = { json: JSON.stringify(sesion), usuarioId: sesion.user.id }
      sesiones.set(rol, guardada)
    }
    return guardada
  }
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
          const guardada = await sesionDe(captura.rol)
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
              admin: captura.ejemplo.admin,
              insumos: captura.ejemplo.insumos,
              coordinadorId: (await sesionDe('supervisor1')).usuarioId,
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
        const ruta =
          typeof captura.ruta === 'function'
            ? captura.ruta({
                coordinadorId: (await sesionDe('supervisor1')).usuarioId,
              })
            : captura.ruta
        await page.goto(`${origen}${ruta}`)
        await page
          .getByText(captura.espera)
          .first()
          .waitFor({ timeout: 20_000 })
        if (captura.preparar) await captura.preparar(page)
        await page.waitForLoadState('networkidle').catch(() => undefined)
        await page.waitForTimeout(1200)
        await enmascarar(page, captura.personas ?? 'quitar')
        await page.waitForTimeout(150)
        const archivo = path.join(salida, `${captura.nombre}.png`)
        if (captura.elemento) {
          await page.locator(captura.elemento).first().screenshot({
            path: archivo,
          })
        } else if (captura.completa && captura.vista === 'celular') {
          // En el celular la barra de abajo es fija: en vez de la página completa se agranda la
          // ventana hasta que entre todo, así la barra queda al pie y no en el medio.
          const alto = await page.evaluate(
            () => document.documentElement.scrollHeight,
          )
          await page.setViewportSize({
            width: TAMANOS.celular.width,
            height: Math.min(Math.max(alto, TAMANOS.celular.height), 3200),
          })
          await page.waitForTimeout(600)
          await page.screenshot({ path: archivo })
        } else {
          await page.screenshot({
            path: archivo,
            fullPage: captura.completa ?? false,
          })
        }
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
