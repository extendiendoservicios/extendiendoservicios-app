import { expect, test } from '@playwright/test'
import { getAdminDb } from '../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import {
  fichar,
  fijarConsentimiento,
  marcarCambiosVistos,
} from '../fixtures/movil.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import {
  faltaMargenHaciaAdelante,
  franjaDesdeAhora,
  horaArgentina,
} from './helpers/tiempo.ts'

// P19.5d · AJ-02 (empleado, 390 px): «Estoy en camino».
//   - Turno que empieza dentro de las próximas 3 h: el botón aparece, la hoja «¿En cuánto
//     llegás?» ofrece 10, 15, 20, 30, 45, 60 min y «No sé / sin estimar», la tarjeta muestra
//     «Avisaste que estás en camino · llegás ~HH:MM» (la hora que guardó el servidor, en hora de
//     Argentina) y «Cambiar hora estimada»; cambiar la estimación reemplaza a la anterior.
//   - Turno a más de 3 h: el botón no se ofrece y el servidor lo rechaza (ON_THE_WAY_TOO_EARLY).
//   - Después de fichar el inicio, el aviso y el botón desaparecen.
// Las franjas se arman desde "ahora" y dentro del día del turno; cuando la hora de la corrida no
// deja margen en el día, el test se saltea con el motivo (nunca depende de la hora del CI).
// Cuentas: empleado1 (dentro de 3 h) y empleado2 (a más de 3 h).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.describe('empleado: «Estoy en camino» (AJ-02)', () => {
  test.describe('turno dentro de las próximas 3 horas', () => {
    test.use({ storageState: storageStatePath('empleado1') })

    test(
      'avisa en camino con una estimación, la cambia, y al fichar el inicio el aviso desaparece',
      cubre('RB-E07', 'RB-E01', 'CB-21'),
      async ({ page }) => {
        const motivo = faltaMargenHaciaAdelante(45, 60)
        test.skip(motivo !== null, motivo ?? '')
        test.setTimeout(180_000)

        const sc = new Scenario()
        try {
          const cliente = await sc.client('encamino')
          const sede = await sc.site(cliente.id, 'encamino')
          const franja = franjaDesdeAhora(45, 60)
          const turno = await sc.shift(cliente.id, sede.id, sc.today, franja)
          const asignacion = await sc.assign(turno, 'empleado1')
          await fijarConsentimiento('empleado1', true)
          await marcarCambiosVistos('empleado1')

          await test.step('Hoy ofrece «Estoy en camino» y la hoja trae las opciones rápidas', async () => {
            await page.goto('/app')
            await expect(page.getByText(sede.name).first()).toBeVisible()
            const boton = page.getByRole('button', { name: 'Estoy en camino' })
            await expect(boton).toBeVisible()
            await expect(
              page.getByRole('button', { name: 'Cambiar hora estimada' }),
            ).toHaveCount(0)
            await boton.click()
            const hoja = page.getByRole('dialog', {
              name: '¿En cuánto llegás?',
            })
            await expect(hoja).toBeVisible()
            for (const minutos of [10, 15, 20, 30, 45, 60]) {
              await expect(
                hoja.getByRole('button', { name: `${minutos} min` }),
              ).toBeVisible()
            }
            await expect(
              hoja.getByRole('button', { name: 'No sé / sin estimar' }),
            ).toBeVisible()
            // Sin elegir nada no se puede confirmar.
            await expect(
              hoja.getByRole('button', { name: 'Confirmar' }),
            ).toBeDisabled()
            await expectNoHorizontalScroll(page)
          })

          await test.step('«No sé / sin estimar»: el aviso queda sin hora', async () => {
            const hoja = page.getByRole('dialog', {
              name: '¿En cuánto llegás?',
            })
            await hoja
              .getByRole('button', { name: 'No sé / sin estimar' })
              .click()
            await hoja.getByRole('button', { name: 'Confirmar' }).click()
            await expect(hoja).toHaveCount(0)
            await expect(
              page.getByText('Avisaste que estás en camino.'),
            ).toBeVisible()
            await expect(
              page.getByRole('button', { name: 'Estoy en camino' }),
            ).toHaveCount(0)
            const { data } = await getAdminDb()
              .from('attendance_notices')
              .select('kind, estimated_arrival_at, source')
              .eq('assignment_id', asignacion)
            expect(data).toHaveLength(1)
            expect(data?.[0]?.kind).toBe('on_the_way')
            expect(data?.[0]?.estimated_arrival_at).toBeNull()
            expect(data?.[0]?.source).toBe('employee_app')
          })

          await test.step('elige 30 min: la tarjeta muestra «llegás ~HH:MM» con la hora del servidor', async () => {
            await page
              .getByRole('button', { name: 'Cambiar hora estimada' })
              .click()
            const hoja = page.getByRole('dialog', {
              name: '¿En cuánto llegás?',
            })
            await expect(
              hoja.getByText(
                'Elegí la nueva estimación: reemplaza a la que avisaste antes.',
              ),
            ).toBeVisible()
            await hoja.getByRole('button', { name: '30 min' }).click()
            await hoja.getByRole('button', { name: 'Confirmar' }).click()
            await expect(hoja).toHaveCount(0)

            const guardada = await ultimaEstimacion(asignacion)
            expect(
              guardada,
              'el servidor guardó la hora estimada',
            ).not.toBeNull()
            // now() + 30 min, con un margen de pocos segundos de diferencia de reloj.
            const diferencia = new Date(guardada!).getTime() - Date.now()
            expect(diferencia).toBeGreaterThan(29 * 60_000)
            expect(diferencia).toBeLessThan(31 * 60_000)
            await expect(
              page.getByText(
                `Avisaste que estás en camino · llegás ~${horaArgentina(guardada!)}`,
              ),
            ).toBeVisible()
            await expect(
              page.getByRole('button', { name: 'Cambiar hora estimada' }),
            ).toBeVisible()
          })

          await test.step('cambia a 10 min: la nueva estimación reemplaza a la anterior (el último aviso manda)', async () => {
            await page
              .getByRole('button', { name: 'Cambiar hora estimada' })
              .click()
            const hoja = page.getByRole('dialog', {
              name: '¿En cuánto llegás?',
            })
            await hoja.getByRole('button', { name: '10 min' }).click()
            await hoja.getByRole('button', { name: 'Confirmar' }).click()
            await expect(hoja).toHaveCount(0)
            const guardada = await ultimaEstimacion(asignacion)
            const diferencia = new Date(guardada!).getTime() - Date.now()
            expect(diferencia).toBeGreaterThan(9 * 60_000)
            expect(diferencia).toBeLessThan(11 * 60_000)
            await expect(
              page.getByText(
                `Avisaste que estás en camino · llegás ~${horaArgentina(guardada!)}`,
              ),
            ).toBeVisible()
            const { count } = await getAdminDb()
              .from('attendance_notices')
              .select('id', { count: 'exact', head: true })
              .eq('assignment_id', asignacion)
            expect(count, 'tres avisos, el último vigente').toBe(3)
          })

          await test.step('también aparece en el detalle del servicio', async () => {
            await page.goto(`/app/servicio/${asignacion}`)
            await expect(
              page.getByText(
                /Avisaste que estás en camino · llegás ~\d{2}:\d{2}/,
              ),
            ).toBeVisible()
            await expect(
              page.getByRole('button', { name: 'Cambiar hora estimada' }),
            ).toBeVisible()
          })

          await test.step('al fichar el inicio el aviso y el botón desaparecen', async () => {
            await fichar('empleado1', asignacion, 'inicio')
            await page.goto('/app')
            await expect(page.getByText(sede.name).first()).toBeVisible()
            await expect(
              page.getByText(/Avisaste que estás en camino/),
            ).toHaveCount(0)
            await expect(
              page.getByRole('button', {
                name: /Estoy en camino|Cambiar hora estimada/,
              }),
            ).toHaveCount(0)
            // Y el servidor ya no deja avisar: la asignación empezó.
            const empleado = await sessionClient('empleado1')
            const { error } = await empleado.rpc('notify_on_the_way', {
              p_assignment_id: asignacion,
              p_eta_minutes: 5,
            })
            expect(error?.hint).toBe('ASSIGNMENT_STARTED')
          })
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })

  test.describe('turno a más de 3 horas', () => {
    test.use({ storageState: storageStatePath('empleado2') })

    test(
      'no se ofrece el botón y el servidor lo rechaza con ON_THE_WAY_TOO_EARLY',
      cubre('RB-E07', 'RB-X02'),
      async ({ page }) => {
        const motivo = faltaMargenHaciaAdelante(210, 30)
        test.skip(motivo !== null, motivo ?? '')

        const sc = new Scenario()
        try {
          const cliente = await sc.client('encamino-tarde')
          const sede = await sc.site(cliente.id, 'encamino-tarde')
          const franja = franjaDesdeAhora(210, 30)
          const turno = await sc.shift(cliente.id, sede.id, sc.today, franja)
          const asignacion = await sc.assign(turno, 'empleado2')
          await fijarConsentimiento('empleado2', true)
          await marcarCambiosVistos('empleado2')

          await page.goto('/app')
          await expect(page.getByText(sede.name).first()).toBeVisible()
          await expect(
            page.getByRole('button', {
              name: /Estoy en camino|Cambiar hora estimada/,
            }),
          ).toHaveCount(0)

          const empleado = await sessionClient('empleado2')
          const { error } = await empleado.rpc('notify_on_the_way', {
            p_assignment_id: asignacion,
            p_eta_minutes: 20,
          })
          expect(error?.hint).toBe('ON_THE_WAY_TOO_EARLY')
          const { count } = await getAdminDb()
            .from('attendance_notices')
            .select('id', { count: 'exact', head: true })
            .eq('assignment_id', asignacion)
          expect(count, 'no quedó ningún aviso').toBe(0)
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })
})

/** Hora estimada (ISO) del último aviso «en camino» de la asignación, según el servidor. */
async function ultimaEstimacion(assignmentId: string): Promise<string | null> {
  const { data, error } = await getAdminDb()
    .from('attendance_notices')
    .select('estimated_arrival_at')
    .eq('assignment_id', assignmentId)
    .eq('kind', 'on_the_way')
    .order('created_at', { ascending: false })
    .limit(1)
  expect(error, error?.message).toBeNull()
  return data?.[0]?.estimated_arrival_at ?? null
}
