// tests/e2e-tablero/helpers/dashboard.ts — DASH-008/DASH-009 (P16.2)
//
// Localizadores y lectura de KPIs del tablero (ADM-02), y los escenarios de datos que comparten
// los specs. Los escenarios usan franjas fijas dentro del día del turno (ver `fixtures.ts`).

import { expect, type Locator, type Page } from '@playwright/test'
import type { DisposableUser, TableroScenario } from './fixtures.ts'

/** Franja que ya terminó a cualquier hora del día (salvo la ventana de medianoche). */
export const PAST_START = '00:00'
export const PAST_END = '00:01'

export function kpiSection(page: Page): Locator {
  return page.getByRole('region', { name: 'Indicadores de hoy' })
}

export function attentionSection(page: Page): Locator {
  return page.getByRole('region', { name: 'Requiere atención' })
}

export function servicesSection(page: Page): Locator {
  return page.getByRole('region', { name: 'Servicios de hoy' })
}

/** Tarjeta de alerta cuyo texto contiene `text` (apellido de empleado o nombre de sede). */
export function alertCard(page: Page, text: string): Locator {
  return attentionSection(page).getByRole('listitem').filter({ hasText: text })
}

/** Espera a que el tablero termine de cargar (las dos consultas principales). */
export async function waitForDashboardLoaded(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'Requiere atención' }),
  ).toBeVisible()
  await expect(attentionSection(page).getByText('Cargando…')).toHaveCount(0)
  await expect(page.getByText(/Actualizado hace/)).toBeVisible()
}

function kpiValueLocator(page: Page, label: string): Locator {
  return kpiSection(page)
    .getByText(label, { exact: true })
    .locator('xpath=following-sibling::div[1]')
}

function kpiDetailLocator(page: Page, label: string): Locator {
  return kpiSection(page)
    .getByText(label, { exact: true })
    .locator('xpath=following-sibling::div[2]')
}

export interface KpiReading {
  shifts: number
  clients: number
  sites: number
  present: number
  upcoming: number
  noRecord: number
  absences: number
  delays: number
  notices: number
}

function firstInt(text: string | null, pattern: RegExp): number {
  const match = (text ?? '').match(pattern)
  if (!match) throw new Error(`No se pudo leer "${text}" con ${pattern}`)
  return Number(match[1])
}

export async function readKpis(page: Page): Promise<KpiReading> {
  const num = async (label: string) =>
    Number(await kpiValueLocator(page, label).innerText())
  const turnosDetail = await kpiDetailLocator(page, 'Turnos hoy').innerText()
  const avisosDetail = await kpiDetailLocator(page, 'Avisos').innerText()
  return {
    shifts: await num('Turnos hoy'),
    clients: firstInt(turnosDetail, /(\d+) cliente/),
    sites: firstInt(turnosDetail, /(\d+) sede/),
    present: await num('Presentes'),
    upcoming: await num('Próximos'),
    noRecord: await num('Sin registro'),
    absences: firstInt(avisosDetail, /(\d+) ausencia/),
    delays: firstInt(avisosDetail, /(\d+) demora/),
    notices: await num('Avisos'),
  }
}

export function expectKpiValue(
  page: Page,
  label: string,
  value: number,
): Promise<void> {
  return expect(kpiValueLocator(page, label)).toHaveText(String(value))
}

/** Sin scroll horizontal: el ancho del documento no supera el del viewport. */
export async function expectNoHorizontalScroll(
  page: Page,
  viewportWidth: number,
): Promise<void> {
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  )
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth)
}

export interface CoreScenario {
  clientName: string
  employeeAbsence: DisposableUser
  employeeNoRecord: DisposableUser
  siteAbsence: { id: string; name: string }
  siteNoRecord: { id: string; name: string }
  siteUncovered: { id: string; name: string }
  shiftAbsenceId: string
  shiftNoRecordId: string
  shiftUncoveredId: string
  assignmentNoRecordId: string
}

/**
 * Escenario mínimo de DASH-008: una ausencia avisada, un sin registro y un turno sin cubrir,
 * los tres de hoy con la franja 00:00–00:01 (ya pasada), cada empleado en su propio turno.
 */
export async function buildCoreScenario(
  scenario: TableroScenario,
): Promise<CoreScenario> {
  const client = await scenario.createClient('Cliente')
  const siteAbsence = await scenario.createSite(client.id, 'Sede-Ausencia')
  const siteNoRecord = await scenario.createSite(client.id, 'Sede-SinRegistro')
  const siteUncovered = await scenario.createSite(client.id, 'Sede-SinCubrir')
  const employeeAbsence = await scenario.createEmployee('ausente')
  const employeeNoRecord = await scenario.createEmployee('sinreg')

  const shiftAbsenceId = await scenario.createShift(
    client.id,
    siteAbsence.id,
    PAST_START,
    PAST_END,
  )
  const shiftNoRecordId = await scenario.createShift(
    client.id,
    siteNoRecord.id,
    PAST_START,
    PAST_END,
  )
  const shiftUncoveredId = await scenario.createShift(
    client.id,
    siteUncovered.id,
    PAST_START,
    PAST_END,
  )

  const assignmentAbsenceId = await scenario.assign(
    shiftAbsenceId,
    employeeAbsence.profileId,
  )
  await scenario.notifyAbsence(assignmentAbsenceId)
  const assignmentNoRecordId = await scenario.assign(
    shiftNoRecordId,
    employeeNoRecord.profileId,
  )

  return {
    clientName: client.name,
    employeeAbsence,
    employeeNoRecord,
    siteAbsence,
    siteNoRecord,
    siteUncovered,
    shiftAbsenceId,
    shiftNoRecordId,
    shiftUncoveredId,
    assignmentNoRecordId,
  }
}

export interface ManyAlertsScenario extends CoreScenario {
  /** Cantidad de alertas que arma el escenario (todas de la suite, sin contar datos ajenos). */
  alertCount: number
  extraNoRecord: DisposableUser[]
  overdueEmployee: DisposableUser
}

/**
 * Escenario con 7 alertas propias: las 3 del núcleo más 3 "sin registro" y 1 "en curso pasada la
 * hora de fin" (inicio registrado en nombre, franja 00:00–00:01 ya terminada). Pasa el umbral de
 * 5 alertas del celular.
 */
export async function buildManyAlertsScenario(
  scenario: TableroScenario,
): Promise<ManyAlertsScenario> {
  const core = await buildCoreScenario(scenario)
  const client = await scenario.createClient('Cliente-Extra')
  const extraNoRecord: DisposableUser[] = []
  for (const index of [1, 2, 3]) {
    const site = await scenario.createSite(client.id, `Sede-Extra-${index}`)
    const employee = await scenario.createEmployee(`extra${index}`)
    const shiftId = await scenario.createShift(
      client.id,
      site.id,
      PAST_START,
      PAST_END,
    )
    await scenario.assign(shiftId, employee.profileId)
    extraNoRecord.push(employee)
  }
  const overdueSite = await scenario.createSite(client.id, 'Sede-EnCurso')
  const overdueEmployee = await scenario.createEmployee('encurso')
  const overdueShiftId = await scenario.createShift(
    client.id,
    overdueSite.id,
    PAST_START,
    PAST_END,
  )
  const overdueAssignmentId = await scenario.assign(
    overdueShiftId,
    overdueEmployee.profileId,
  )
  await scenario.recordCheckIn(overdueAssignmentId)

  return { ...core, alertCount: 7, extraNoRecord, overdueEmployee }
}
