import { expect, test, type Locator, type Page } from '@playwright/test'
import { getAdminDb, nombreDe } from '../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { avisarEnCaminoFechado, type Empleado } from './helpers/aviso.ts'
import {
  faltaMargenHaciaAtras,
  franjaDesdeAhora,
  horaArgentina,
} from './helpers/tiempo.ts'

// P19.5h · AJ-02 (decisión de Mike del 7 oct 2026, migración 0034): «En camino» vence a la hora
// estimada + 15 min; sin estimación, al inicio + 15 min. Vencido, la fila sigue la regla normal:
// «Llegada tarde» (hasta 15 min desde el inicio) o «Sin registro» (más de 15 min) y vuelve a ser
// alerta. Planilla de administración, escritorio 1280 px.
//   - ETA vencida e inicio hace más de 15 min: «Sin registro» roja y alerta.
//   - ETA vencida e inicio hace menos de 15 min: «Llegada tarde» amarilla y alerta amarilla.
//   - ETA vigente (en el futuro, o pasada pero dentro de los 15 min de gracia) con el inicio
//     pasado: sigue «En camino» celeste, sin alerta.
//   - Sin estimación: a menos de 15 min del inicio sigue «En camino»; a más, «Sin registro».
// Los avisos se fechan con `helpers/aviso.ts` (la RPC no permite una estimación en el pasado).
// Cada margen deja varios minutos de holgura respecto del instante de vencimiento para que una
// corrida lenta no cambie el estado esperado. Cuentas: empleado1 a empleado4, de a uno por caso.
// Este archivo reemplaza el criterio de 0033 («En camino» prevalecía hasta el fin de la franja).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('admin') })

function servicios(page: Page): Locator {
  return page.getByRole('region', { name: 'Servicios de hoy' })
}

function filaDe(zona: Locator, texto: string): Locator {
  return zona.getByRole('row').filter({ hasText: texto })
}

async function filtrarPorEstado(page: Page, estado: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Filtrar por estado' }).click()
  await page.getByRole('option', { name: estado, exact: true }).click()
}

interface Caso {
  quien: Empleado
  sede: string
  /** Minutos desde ahora hasta el inicio de la franja (negativo: ya empezó). */
  inicio: number
  llegaEnMin: number | null
}

async function armar(sc: Scenario, nombre: string, casos: Caso[]) {
  const cliente = await sc.client(nombre)
  const armados = []
  for (const caso of casos) {
    const sede = await sc.site(cliente.id, `${nombre}-${caso.sede}`)
    const turno = await sc.shift(
      cliente.id,
      sede.id,
      sc.today,
      franjaDesdeAhora(caso.inicio, 120),
    )
    const asignacion = await sc.assign(turno, caso.quien)
    await avisarEnCaminoFechado(caso.quien, asignacion, caso)
    armados.push({ ...caso, sede, asignacion })
  }
  return armados
}

test.describe('AJ-02 · vencimiento de «En camino» en la planilla', () => {
  test(
    'con hora estimada: vencida pasa a «Sin registro» roja o «Llegada tarde» amarilla y vuelve a ser alerta; vigente sigue celeste',
    cubre('RB-A06', 'RB-A08', 'CB-05'),
    async ({ page }) => {
      const motivo = faltaMargenHaciaAtras(32)
      test.skip(motivo !== null, motivo ?? '')
      test.setTimeout(240_000)

      const sc = new Scenario()
      try {
        const [vencidaSin, vencidaTarde, vigenteFutura, vigenteGracia] =
          await armar(sc, 'adm-vence', [
            // Inicio hace 30 min, estimó llegar hace 20: venció hace 5 min -> Sin registro.
            { quien: 'empleado1', sede: 'sin', inicio: -30, llegaEnMin: -20 },
            // Inicio hace 4 min, estimó llegar hace 20: venció -> Llegada tarde (quedan 11 min).
            { quien: 'empleado2', sede: 'tarde', inicio: -4, llegaEnMin: -20 },
            // Inicio hace 30 min, llega dentro de 5 min: vigente.
            { quien: 'empleado3', sede: 'futura', inicio: -30, llegaEnMin: 5 },
            // Inicio hace 30 min, debía llegar hace 5 min: vence dentro de 10 min, vigente.
            { quien: 'empleado4', sede: 'gracia', inicio: -30, llegaEnMin: -5 },
          ])

        await page.goto('/admin')

        await test.step('ETA vencida con el inicio hace más de 15 min: «Sin registro» roja', async () => {
          const fila = filaDe(servicios(page), vencidaSin.sede.name)
          await expect(fila).toContainText('Sin registro')
          await expect(fila).not.toContainText('En camino')
          await expect(fila).not.toContainText('llega ~')
          await expect(fila).toHaveClass(/bg-danger-bg/)
          await expect(fila).not.toHaveClass(/bg-info-bg/)
        })

        await test.step('ETA vencida con el inicio hace menos de 15 min: «Llegada tarde» amarilla', async () => {
          const fila = filaDe(servicios(page), vencidaTarde.sede.name)
          await expect(fila).toContainText('Llegada tarde')
          await expect(fila).not.toContainText('En camino')
          await expect(fila).toHaveClass(/bg-warning-bg/)
        })

        await test.step('«Requiere atención»: los dos vencidos son alerta; los vigentes no', async () => {
          const atencion = page.getByRole('region', {
            name: 'Requiere atención',
          })
          const alertaSin = atencion.getByRole('listitem').filter({
            hasText: `${nombreDe('empleado1')} no registró el inicio`,
          })
          await expect(alertaSin).toBeVisible()
          await expect(alertaSin).toHaveClass(/bg-danger-bg/)
          const alertaTarde = atencion.getByRole('listitem').filter({
            hasText: `${nombreDe('empleado2')} llegó tarde: todavía no registró el inicio`,
          })
          await expect(alertaTarde).toBeVisible()
          await expect(alertaTarde).toHaveClass(/bg-warning-bg/)
          for (const vigente of ['empleado3', 'empleado4'] as const) {
            await expect(
              atencion.getByRole('listitem').filter({
                hasText: nombreDe(vigente),
              }),
            ).toHaveCount(0)
          }
        })

        await test.step('ETA vigente con el inicio pasado (en el futuro o dentro de los 15 min de gracia): sigue «En camino» celeste', async () => {
          for (const caso of [vigenteFutura, vigenteGracia]) {
            const fila = filaDe(servicios(page), caso.sede.name)
            await expect(fila).toContainText('En camino')
            await expect(fila).toHaveClass(/bg-info-bg/)
            await expect(fila).not.toHaveClass(/bg-danger-bg|bg-warning-bg/)
            const { data } = await getAdminDb()
              .from('attendance_notices')
              .select('estimated_arrival_at')
              .eq('assignment_id', caso.asignacion)
              .single()
            await expect(fila).toContainText(
              `llega ~${horaArgentina(data!.estimated_arrival_at!)}`,
            )
          }
        })

        await test.step('Asistencia de hoy: los filtros siguen la misma regla', async () => {
          await page.goto('/admin/asistencia')
          const lista = page.getByRole('main')
          await filtrarPorEstado(page, 'En camino')
          await expect(filaDe(lista, vigenteFutura.sede.name)).toBeVisible()
          await expect(filaDe(lista, vigenteGracia.sede.name)).toBeVisible()
          await expect(filaDe(lista, vencidaSin.sede.name)).toHaveCount(0)
          await expect(filaDe(lista, vencidaTarde.sede.name)).toHaveCount(0)
          await filtrarPorEstado(page, 'Sin registro')
          await expect(filaDe(lista, vencidaSin.sede.name)).toBeVisible()
          await expect(filaDe(lista, vigenteFutura.sede.name)).toHaveCount(0)
          await filtrarPorEstado(page, 'Llegada tarde')
          await expect(filaDe(lista, vencidaTarde.sede.name)).toBeVisible()
          await expect(filaDe(lista, vencidaSin.sede.name)).toHaveCount(0)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'sin hora estimada: a menos de 15 min del inicio sigue «En camino»; a más, «Sin registro» roja con alerta',
    cubre('RB-A06', 'RB-A08', 'CB-05'),
    async ({ page }) => {
      const motivo = faltaMargenHaciaAtras(22)
      test.skip(motivo !== null, motivo ?? '')
      test.setTimeout(180_000)

      const sc = new Scenario()
      try {
        const [reciente, viejo] = await armar(sc, 'adm-vence-sinest', [
          // Inicio hace 4 min: el aviso vale hasta el inicio + 15 (dentro de 11 min).
          {
            quien: 'empleado1',
            sede: 'reciente',
            inicio: -4,
            llegaEnMin: null,
          },
          // Inicio hace 20 min: el aviso venció hace 5 min.
          { quien: 'empleado2', sede: 'viejo', inicio: -20, llegaEnMin: null },
        ])

        await page.goto('/admin')
        const filaReciente = filaDe(servicios(page), reciente.sede.name)
        await expect(filaReciente).toContainText('En camino')
        await expect(filaReciente).toHaveClass(/bg-info-bg/)
        await expect(filaReciente).not.toContainText('llega ~')

        const filaViejo = filaDe(servicios(page), viejo.sede.name)
        await expect(filaViejo).toContainText('Sin registro')
        await expect(filaViejo).not.toContainText('En camino')
        await expect(filaViejo).toHaveClass(/bg-danger-bg/)

        const atencion = page.getByRole('region', { name: 'Requiere atención' })
        await expect(
          atencion.getByRole('listitem').filter({
            hasText: `${nombreDe('empleado2')} no registró el inicio`,
          }),
        ).toBeVisible()
        await expect(
          atencion.getByRole('listitem').filter({
            hasText: nombreDe('empleado1'),
          }),
        ).toHaveCount(0)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
