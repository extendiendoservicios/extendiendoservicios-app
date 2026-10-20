// tests/e2e-ajustes-19oct/helpers/dia.ts — P19.11g
//
// Utilidades de las e2e de la reunión del 19 oct: elegir un día en el `DatePicker` por clic (sin
// depender del foco del teclado, que es lo que vuelve frágil a `elegirFecha` de la suite anterior)
// y dar de baja las licencias propias de la prueba (nada se borra físicamente).

import { expect, type Page } from '@playwright/test'
import { getAdminDb, type FixedAccountKey } from '../../fixtures/accounts.ts'
import { addDays, todayAR } from '../../fixtures/dates.ts'
import { readId } from '../../fixtures/sessions.ts'

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

export const PREFIJO = 'E2E-P1911'

/** Etiqueta del día en el calendario: «20 de octubre de 2026». */
export function etiquetaDia(iso: string): string {
  const [anio, mes, dia] = iso.split('-').map(Number)
  return `${dia} de ${MESES[mes - 1]} de ${anio}`
}

/**
 * Abre el `DatePicker` cuyo botón se llama `nombre` y elige el día `iso` navegando mes a mes con
 * los botones del calendario.
 */
export async function elegirDia(
  page: Page,
  nombre: string | RegExp,
  iso: string,
): Promise<void> {
  const abierto = page.locator(
    '[data-slot="popover-content"][data-state="open"]',
  )
  await expect(abierto).toHaveCount(0)
  await expect(async () => {
    if (!(await abierto.isVisible())) {
      await page.getByRole('button', { name: nombre }).first().click()
    }
    await expect(abierto).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })

  const dia = abierto.getByRole('button', {
    name: new RegExp(`(^|[^0-9])${etiquetaDia(iso)}(,|$)`),
  })
  const adelante = iso >= todayAR()
  const navegar = abierto.getByRole('button', {
    name: adelante ? /mes siguiente/i : /mes anterior/i,
  })
  for (let i = 0; i < 14 && (await dia.count()) === 0; i++) {
    await navegar.click()
  }
  await expect(dia, `el día ${iso} está en el calendario`).toHaveCount(1)
  await dia.click()
  await expect(abierto).toHaveCount(0)
}

/**
 * Da de baja (baja lógica, como el botón «Dar de baja» de la ficha) las licencias vigentes del
 * empleado cuyo motivo empieza con el prefijo de la prueba.
 */
export async function darDeBajaLicencias(
  who: FixedAccountKey,
): Promise<string[]> {
  const { error } = await getAdminDb()
    .from('employee_leaves')
    .update({ deleted_at: new Date().toISOString() })
    .eq('employee_id', readId(who))
    .like('reason', `${PREFIJO}%`)
    .is('deleted_at', null)
  return error ? [`licencias de ${who}: ${error.message}`] : []
}

/** Crea una licencia propia de la prueba (motivo con el prefijo); se da de baja con `darDeBajaLicencias`. */
export async function crearLicencia(
  who: FixedAccountKey,
  desde: string,
  hasta: string | null,
  motivo = 'vacaciones',
): Promise<void> {
  const { error } = await getAdminDb()
    .from('employee_leaves')
    .insert({
      employee_id: readId(who),
      starts_on: desde,
      ends_on: hasta,
      reason: `${PREFIJO} ${motivo}`,
    })
  if (error) throw new Error(`No se pudo crear la licencia: ${error.message}`)
}

/**
 * Fecha futura dentro del año en curso (el imprimible toma el año en curso por omisión): si
 * `hoy + dias` ya cae en otro año, se usa la fecha simétrica hacia atrás.
 */
export function fechaDelAnio(dias: number): string {
  const hoy = todayAR()
  const adelante = addDays(hoy, dias)
  return adelante.slice(0, 4) === hoy.slice(0, 4)
    ? adelante
    : addDays(hoy, -dias)
}
