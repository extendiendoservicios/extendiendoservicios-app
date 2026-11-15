// tests/e2e/admin/p29-modo-panel-pasos.ts — P29.6 (OG-06, OG-07, OG-08)
//
// Cuerpos de prueba compartidos entre el proyecto `chromium` (p29-modo-panel.admin.ts) y el proyecto
// `mobile` (p29-modo-panel.movil.admin.ts). No termina en `.admin.ts`: Playwright no lo toma como
// archivo de pruebas. Cuentas: `adminOperativo` (administración + empleado, todas las capacidades),
// `admin` (solo administración), `empleado1` y `supervisor1`. Los turnos de «Mi turno» son de
// `adminOperativo` (nadie más de la suite de administración lo usa).

import { expect, type Page } from '@playwright/test'
import { FRANJAS } from '../../fixtures/dates.ts'
import { fichar, FRANJAS_MOVIL } from '../../fixtures/movil.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { emailOf } from '../../fixtures/sessions.ts'
import {
  expectNoHorizontalScroll,
  irARedirigida,
  loginByForm,
} from '../../fixtures/ui.ts'

const menuDeUsuario = (page: Page) =>
  page.getByRole('button', { name: 'Menú de usuario' })

/** Ingresa por la pantalla de ingreso con la cuenta que es administración y empleado (OG-06). */
export async function ingresaPorPantallaYVaAlPanel(page: Page): Promise<void> {
  await loginByForm(page, emailOf('adminOperativo'), /\/admin$/)
  await expect(menuDeUsuario(page)).toBeVisible()
  await expectNoHorizontalScroll(page)
}

/** Con la sesión abierta, la raíz también lleva al panel, y desde ahí va y vuelve entre modos (OG-06, OG-08). */
export async function cambiaDeModoYVuelve(page: Page): Promise<void> {
  await irARedirigida(page, '/')
  await expect(page).toHaveURL(/\/admin$/)
  await expectNoHorizontalScroll(page)

  await menuDeUsuario(page).click()
  // Sin rol de coordinador no hay opción de coordinador.
  await expect(
    page.getByRole('menuitem', { name: 'Ir a mi app de coordinador' }),
  ).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Ir a mi app de empleado' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(
    page.getByRole('link', { name: 'Volver al panel' }),
  ).toBeVisible()
  await expectNoHorizontalScroll(page)

  // La app del empleado está completa y otra de sus pantallas también lleva el botón.
  await page.goto('/app/mas')
  await expect(
    page.getByRole('link', { name: 'Volver al panel' }),
  ).toBeVisible()

  await page.getByRole('link', { name: 'Volver al panel' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(menuDeUsuario(page)).toBeVisible()
}

/** Quien administra pero no es empleado ni coordinador no ve ninguna opción de cambio de modo. */
export async function soloAdminSinCambioDeModo(page: Page): Promise<void> {
  await page.goto('/admin')
  await menuDeUsuario(page).click()
  await expect(page.getByRole('menuitem', { name: 'Mi perfil' })).toBeVisible()
  await expect(
    page.getByRole('menuitem', { name: /Ir a mi app de/ }),
  ).toHaveCount(0)
}

/** Un empleado común sigue entrando a /app (sin «Volver al panel») y no pasa al panel (OG-06). */
export async function empleadoSigueEnSuApp(page: Page): Promise<void> {
  await irARedirigida(page, '/')
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('link', { name: 'Volver al panel' })).toHaveCount(
    0,
  )
  await irARedirigida(page, '/admin')
  await expect(page).toHaveURL(/\/app$/)
}

/** Un coordinador sigue entrando a /sup (sin «Volver al panel») y no pasa al panel (OG-06). */
export async function coordinadorSigueEnSuApp(page: Page): Promise<void> {
  await irARedirigida(page, '/')
  await expect(page).toHaveURL(/\/sup$/)
  await expect(page.getByRole('link', { name: 'Volver al panel' })).toHaveCount(
    0,
  )
  await irARedirigida(page, '/admin')
  await expect(page).toHaveURL(/\/sup$/)
}

/** «Mi turno» en el Resumen: lleva al fichaje de la app del empleado y de ahí se vuelve al panel (OG-07). */
export async function miTurnoLlevaAlFichaje(page: Page): Promise<void> {
  const sc = new Scenario()
  try {
    const cliente = await sc.client('mi-turno')
    const sede = await sc.site(cliente.id, 'mi-turno')
    // Todo el día: el inicio ya pasó y el fin no, así que corresponde «Registrar inicio».
    const turno = await sc.shift(
      cliente.id,
      sede.id,
      sc.today,
      FRANJAS_MOVIL.diaCompleto,
    )
    const asignacion = await sc.assign(turno, 'adminOperativo')

    await page.goto('/admin')
    const tarjeta = page.getByRole('region', { name: 'Mi turno' })
    await expect(tarjeta).toBeVisible()
    await expect(tarjeta).toContainText(cliente.name)
    await expect(tarjeta).toContainText(sede.name)
    await expectNoHorizontalScroll(page)

    await tarjeta.getByRole('link', { name: 'Registrar inicio' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/app/fichar\\?asignacion=${asignacion}$`),
    )
    // La pantalla de fichar de la app del empleado, con el botón para volver al panel.
    await expect(
      page.getByRole('link', { name: 'Volver al panel' }),
    ).toBeVisible()
    await expectNoHorizontalScroll(page)
    await page.getByRole('link', { name: 'Volver al panel' }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('region', { name: 'Mi turno' })).toBeVisible()
  } finally {
    expect(await sc.cleanup(), 'limpieza').toEqual([])
  }
}

/** Con el inicio ya registrado, «Mi turno» ofrece «Registrar fin» y «Abrir mi servicio» (OG-07). */
export async function miTurnoEnCursoRegistraFin(page: Page): Promise<void> {
  const sc = new Scenario()
  try {
    const cliente = await sc.client('mi-turno-fin')
    const sede = await sc.site(cliente.id, 'mi-turno-fin')
    const turno = await sc.shift(
      cliente.id,
      sede.id,
      sc.today,
      FRANJAS_MOVIL.diaCompleto,
    )
    const asignacion = await sc.assign(turno, 'adminOperativo')
    await fichar('adminOperativo', asignacion, 'inicio')

    await page.goto('/admin')
    const tarjeta = page.getByRole('region', { name: 'Mi turno' })
    await expect(tarjeta).toContainText(sede.name)
    await expect(
      tarjeta.getByRole('link', { name: 'Registrar inicio' }),
    ).toHaveCount(0)
    await expect(
      tarjeta.getByRole('link', { name: 'Abrir mi servicio' }),
    ).toHaveAttribute('href', `/app/en-curso/${asignacion}`)
    await tarjeta.getByRole('link', { name: 'Registrar fin' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/app/en-curso/${asignacion}/finalizar$`),
    )
    await expect(
      page.getByRole('link', { name: 'Volver al panel' }),
    ).toBeVisible()
    await expectNoHorizontalScroll(page)
  } finally {
    expect(await sc.cleanup(), 'limpieza').toEqual([])
  }
}

/** Sin turno hoy no hay tarjeta «Mi turno» (OG-07). */
export async function sinTurnoNoHayTarjeta(page: Page): Promise<void> {
  await page.goto('/admin')
  await expect(
    page.getByRole('region', { name: 'Servicios de hoy' }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Mi turno' })).toHaveCount(0)
}

/** Quien no es empleado nunca ve «Mi turno», aunque haya turnos de otras personas hoy (OG-07). */
export async function soloAdminNoVeMiTurno(page: Page): Promise<void> {
  const sc = new Scenario()
  try {
    const cliente = await sc.client('mi-turno-admin')
    const sede = await sc.site(cliente.id, 'mi-turno-admin')
    const turno = await sc.shift(cliente.id, sede.id, sc.today, FRANJAS.manana)
    // Asignado a otra cuenta: la tarjeta es solo de la propia persona.
    await sc.assign(turno, 'empleado5')
    await page.goto('/admin')
    await expect(
      page.getByRole('region', { name: 'Servicios de hoy' }),
    ).toBeVisible()
    await expect(page.getByRole('region', { name: 'Mi turno' })).toHaveCount(0)
  } finally {
    expect(await sc.cleanup(), 'limpieza').toEqual([])
  }
}
