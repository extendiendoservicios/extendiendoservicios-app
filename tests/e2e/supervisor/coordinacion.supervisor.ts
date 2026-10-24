import { expect, test, type Page } from '@playwright/test'
import { FIXED_ACCOUNTS, nombreDe } from '../../fixtures/accounts.ts'
import {
  FRANJAS,
  isTooCloseToMidnight,
  minutesSinceMidnightAR,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  calificar,
  contextoDe,
  fichar,
  FRANJAS_MOVIL,
  fijarConsentimiento,
  POSICION_SIMULADA,
  tarjetaDeTurno,
} from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P24.5: la coordinación libre a 390 px (CJ-02, CJ-04, CJ-05, CJ-06, CJ-09, CJ-11, CJ-24, CJ-25,
// CJ-27): dos coordinadores en el mismo turno, el orden de «Hoy» y «Mis sedes» con preferencias
// por cliente y por sede. Cuentas: supervisor1 y supervisor2; empleado1 y empleado2 trabajan.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

const posicion = {
  geolocation: POSICION_SIMULADA,
  permissions: ['geolocation' as const],
}

/** Separador de líneas del texto de una tarjeta (los bloques del `innerText` dejan líneas en blanco). */
const SALTO = /\n+/

function filaDe(page: Page, nombre: string) {
  return page
    .locator('div.flex.items-center.justify-between.gap-2')
    .filter({ hasText: nombre })
}

/** Los textos de las tarjetas de turno de un bloque («Mis sedes» u «Otras sedes»), en orden. */
async function tarjetasDe(page: Page, bloque: string): Promise<string[]> {
  return page
    .getByRole('region', { name: bloque })
    .getByRole('link')
    .allInnerTexts()
}

test.describe('dos coordinadores en el mismo turno', () => {
  test.use({ storageState: storageStatePath('supervisor1'), ...posicion })

  test(
    'los dos supervisan el mismo turno, cada uno califica con su criterio y se ven mutuamente en «Quién más lo supervisa»',
    cubre(
      'RB-S01',
      'RB-S04',
      'CJ-05',
      'CJ-09',
      'CJ-10',
      'CJ-11',
      'CJ-25',
      'CJ-27',
    ),
    async ({ page, browser }, testInfo) => {
      test.setTimeout(300_000)
      const sc = new Scenario()
      const otroContexto = await contextoDe(
        browser,
        testInfo,
        'supervisor2',
        posicion,
      )
      try {
        const cliente = await sc.client('dos-coord')
        const sede = await sc.site(cliente.id, 'dos-coord')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        const asignacion = await sc.assign(turno, 'empleado1')
        await fijarConsentimiento('empleado1', true)
        await fichar('empleado1', asignacion, 'inicio')
        await fijarConsentimiento('supervisor1', true)
        await fijarConsentimiento('supervisor2', true)
        await sc.asegurarJornada('supervisor1')
        await sc.asegurarJornada('supervisor2')

        const otra = await otroContexto.newPage()

        await test.step('el primero toma el turno desde la interfaz', async () => {
          await page.goto('/sup')
          await tarjetaDeTurno(page, sede.name).click()
          await page.getByRole('button', { name: 'Supervisar' }).click()
          await page
            .getByTestId('attendance-result')
            .getByRole('button', { name: 'Seguir con la supervisión' })
            .click()
          await expect(page.getByText(/Iniciada a las/)).toBeVisible()
        })

        let supervisionDos = ''
        await test.step('CJ-25: el segundo ve en Hoy y en el detalle quién lo supervisa y también puede tomarlo (CJ-05)', async () => {
          await otra.goto('/sup')
          const tarjeta = tarjetaDeTurno(otra, sede.name)
          await expect(tarjeta).toContainText('Supervisando:')
          await expect(tarjeta).toContainText(
            FIXED_ACCOUNTS.supervisor1.firstName,
          )
          await tarjeta.click()
          await expect(otra.getByText('Quién más lo supervisa')).toBeVisible()
          await expect(
            otra.getByText(`Supervisando: ${nombreDe('supervisor1')}`),
          ).toBeVisible()
          await expect(
            otra.getByRole('button', { name: 'Supervisar' }),
          ).toBeEnabled()
          await otra.getByRole('button', { name: 'Supervisar' }).click()
          await otra
            .getByTestId('attendance-result')
            .getByRole('button', { name: 'Seguir con la supervisión' })
            .click()
          await expect(otra.getByText(/Iniciada a las/)).toBeVisible()
          supervisionDos = otra.url().split('/').pop()!
        })

        await test.step('CJ-05: en la base hay dos supervisiones en curso del mismo turno', async () => {
          const { data } = await sc.db
            .from('supervisions')
            .select('id, supervisor_id, status')
            .eq('shift_id', turno)
            .order('created_at')
          expect(data).toHaveLength(2)
          expect(data!.every((s) => s.status === 'in_progress')).toBe(true)
          expect(new Set(data!.map((s) => s.supervisor_id)).size).toBe(2)
        })

        await test.step('el primero ve ahora «Supervisando: …» con los dos, él como «Vos»', async () => {
          await page.goto('/sup')
          const tarjeta = tarjetaDeTurno(page, sede.name)
          await expect(tarjeta).toContainText('Supervisando:')
          await expect(tarjeta).toContainText('Vos')
          await tarjeta.click()
          await expect(
            page.getByText(`Supervisando: ${nombreDe('supervisor2')}`),
          ).toBeVisible()
          await expect(
            page.getByText('Vos lo estás supervisando.'),
          ).toBeVisible()
        })

        await test.step('CJ-09: cada uno califica con su criterio al mismo empleado', async () => {
          const { data: sup } = await sc.db
            .from('supervisions')
            .select('id, supervisor_id')
            .eq('shift_id', turno)
          const supUno = sup!.find((s) => s.id !== supervisionDos)!.id
          await calificar(
            'supervisor1',
            supUno,
            asignacion,
            2,
            'e2e-dos: criterio uno',
          )
          await calificar(
            'supervisor2',
            supervisionDos,
            asignacion,
            5,
            'e2e-dos: criterio dos',
          )
          const { data: notas } = await sc.db
            .from('ratings')
            .select('supervision_id, score')
            .eq('assignment_id', asignacion)
          expect(notas).toHaveLength(2)
          expect(notas!.map((n) => n.score).sort()).toEqual([2, 5])
        })

        await test.step('cada uno cierra la suya por pantalla (CJ-10 cumplido) y queda su calificación separada (CJ-11)', async () => {
          await page.goto('/sup/supervisiones')
          await page.getByRole('link').filter({ hasText: sede.name }).click()
          await expect(
            filaDe(page, nombreDe('empleado1')).getByRole('img', {
              name: '2 de 5 estrellas',
            }),
          ).toBeVisible()
          await page.getByRole('link', { name: 'Cerrar supervisión' }).click()
          await page.getByRole('button', { name: 'Cerrar supervisión' }).click()
          await expect(page).toHaveURL(/\/sup$/)

          await otra.goto(`/sup/supervisiones/${supervisionDos}`)
          await expect(
            filaDe(otra, nombreDe('empleado1')).getByRole('img', {
              name: '5 de 5 estrellas',
            }),
          ).toBeVisible()
          await otra.getByRole('link', { name: 'Cerrar supervisión' }).click()
          await otra.getByRole('button', { name: 'Cerrar supervisión' }).click()
          await expect(otra).toHaveURL(/\/sup$/)

          const { data } = await sc.db
            .from('supervisions')
            .select('status')
            .eq('shift_id', turno)
          expect(data!.map((s) => s.status)).toEqual(['completed', 'completed'])
        })

        await test.step('CJ-25: el turno queda con «Supervisó: …» de los dos', async () => {
          await page.goto('/sup')
          const tarjeta = tarjetaDeTurno(page, sede.name)
          await expect(tarjeta).toContainText('Supervisó:')
          await expect(tarjeta).toContainText('Vos')
          await expectNoHorizontalScroll(page)
        })
      } finally {
        await otroContexto.close()
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'CJ-06: un turno ya terminado del mismo día también se puede supervisar y calificar',
    cubre('RB-S01', 'RB-S04', 'CJ-06', 'CJ-10'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('terminado')
        const sede = await sc.site(cliente.id, 'terminado')
        // 00:00–00:01: terminó a cualquier hora salvo los primeros minutos del día (se saltea antes).
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const asignacion = await sc.assign(turno, 'empleado2')
        await fijarConsentimiento('empleado2', true)
        await fichar('empleado2', asignacion, 'inicio')
        await fijarConsentimiento('supervisor1', true)
        await sc.asegurarJornada('supervisor1')

        await page.goto('/sup')
        const tarjeta = tarjetaDeTurno(page, sede.name)
        await expect(tarjeta).toContainText('Terminado')
        await tarjeta.click()
        await expect(
          page.getByRole('button', { name: 'Supervisar' }),
        ).toBeEnabled()
        await page.getByRole('button', { name: 'Supervisar' }).click()
        await page
          .getByTestId('attendance-result')
          .getByRole('button', { name: 'Seguir con la supervisión' })
          .click()

        // Con la supervisión abierta (sin fin registrado) la ventana de calificación no corre:
        // con el turno ya terminado igual se puede calificar (P24.1, rate_employee).
        await filaDe(page, nombreDe('empleado2'))
          .getByRole('link', { name: 'Calificar' })
          .click()
        await page.getByRole('radio', { name: '3 de 5 estrellas' }).click()
        await page.getByRole('button', { name: 'Guardar calificación' }).click()
        await expect(
          filaDe(page, nombreDe('empleado2')).getByRole('img', {
            name: '3 de 5 estrellas',
          }),
        ).toBeVisible()
        await page.getByRole('link', { name: 'Cerrar supervisión' }).click()
        await page.getByRole('button', { name: 'Cerrar supervisión' }).click()
        await expect(page).toHaveURL(/\/sup$/)
        const { data } = await sc.db
          .from('supervisions')
          .select('status')
          .eq('shift_id', turno)
          .single()
        expect(data?.status).toBe('completed')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('orden de «Hoy» y «Mis sedes»', () => {
  test.use({ storageState: storageStatePath('supervisor1'), ...posicion })

  test(
    'CJ-25, CJ-04, CJ-24: «Mis sedes» y «Otras sedes» ordenan en curso, por empezar y terminados; la preferencia por cliente cubre sedes futuras; el buscador filtra «Otras sedes»',
    cubre('RB-S02', 'RB-S03', 'CJ-02', 'CJ-04', 'CJ-24', 'CJ-25'),
    async ({ page }) => {
      test.skip(
        minutesSinceMidnightAR() > 23 * 60 + 25,
        'La franja «por empezar» (23:40) ya empezó: el turno pasa a «En curso» y el orden esperado cambia.',
      )
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const preferido = await sc.client('orden-pref')
        const suelto = await sc.client('orden-suelto')
        const porEmpezar = { start: '23:40', end: '23:58' }

        // Se crean en el orden inverso al esperado para que el orden de la pantalla no sea el de alta.
        const sedeTerminada = await sc.site(preferido.id, 'orden-1-terminada')
        const turnoTerminado = await sc.shift(
          preferido.id,
          sedeTerminada.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const sedePorEmpezar = await sc.site(
          preferido.id,
          'orden-2-por-empezar',
        )
        await sc.shift(preferido.id, sedePorEmpezar.id, sc.today, porEmpezar)
        const sedeEnCurso = await sc.site(preferido.id, 'orden-3-en-curso')
        await sc.shift(
          preferido.id,
          sedeEnCurso.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        const sedeCancelada = await sc.site(preferido.id, 'orden-cancelada')
        const turnoCancelado = await sc.shift(
          preferido.id,
          sedeCancelada.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        const cancelar = await (
          await sessionClient('owner')
        ).rpc('cancel_shift', {
          p_shift_id: turnoCancelado,
          p_reason: 'e2e-orden',
        })
        expect(cancelar.error, cancelar.error?.message).toBeNull()

        // Preferencia por CLIENTE: cubre todas sus sedes, también las que se creen después (CJ-24).
        await sc.prioridad('supervisor1', { clientId: preferido.id })
        const sedeNueva = await sc.site(preferido.id, 'orden-4-nueva')
        await sc.shift(
          preferido.id,
          sedeNueva.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )

        // El otro cliente: una sede preferida por SEDE y otras dos que no.
        const sedeElegida = await sc.site(suelto.id, 'orden-elegida')
        await sc.shift(
          suelto.id,
          sedeElegida.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        await sc.prioridad('supervisor1', { siteId: sedeElegida.id })
        const sedeOtraTerminada = await sc.site(suelto.id, 'orden-otra-a')
        await sc.shift(
          suelto.id,
          sedeOtraTerminada.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const sedeOtraEnCurso = await sc.site(suelto.id, 'orden-otra-b')
        await sc.shift(
          suelto.id,
          sedeOtraEnCurso.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )

        await page.goto('/sup')
        await expect(page.getByText('Mis sedes', { exact: true })).toBeVisible()

        await test.step('«Mis sedes»: en curso, después por empezar y al final terminados', async () => {
          const mis = page.getByRole('region', { name: 'Mis sedes' })
          await expect(mis).toContainText(sedeElegida.name)
          const textos = await tarjetasDe(page, 'Mis sedes')
          const propios = textos.filter((t) => t.includes('e2e-orden-'))
          // La tarjeta trae el cliente en la primera línea y la sede en la segunda.
          const nombres = propios.map((t) => t.split(SALTO)[1] ?? '')
          const indice = (parte: string) =>
            nombres.findIndex((n) => n.includes(parte))
          // Ninguna «Otras sedes» se cuela, y la cancelada no aparece.
          expect(nombres.some((n) => n.includes('orden-otra'))).toBe(false)
          expect(nombres.some((n) => n.includes('orden-cancelada'))).toBe(false)
          // Los dos en curso (3, 4 y elegida) van antes del por empezar (2), y este antes del terminado (1).
          const enCurso = [
            indice('orden-3'),
            indice('orden-4'),
            indice('orden-elegida'),
          ]
          expect(enCurso.every((i) => i >= 0)).toBe(true)
          expect(Math.max(...enCurso)).toBeLessThan(indice('orden-2'))
          expect(indice('orden-2')).toBeLessThan(indice('orden-1'))
          const por = propios.find((t) => t.includes('orden-2'))!
          expect(por).toContain('Por empezar')
          expect(propios.find((t) => t.includes('orden-1'))!).toContain(
            'Terminado',
          )
          expect(propios.find((t) => t.includes('orden-3'))!).toContain(
            'En curso',
          )
        })

        await test.step('CJ-24: la sede creada después del alta de la preferencia por cliente ya está en «Mis sedes»', async () => {
          await expect(
            page
              .getByRole('region', { name: 'Mis sedes' })
              .getByRole('link')
              .filter({ hasText: sedeNueva.name }),
          ).toBeVisible()
        })

        await test.step('«Otras sedes»: las que no son preferidas, también ordenadas; el turno cancelado no figura en ningún bloque', async () => {
          const textos = await tarjetasDe(page, 'Otras sedes')
          const propios = textos
            .map((t) => t.split(SALTO)[1] ?? '')
            .filter((n) => n.includes('orden-otra'))
            .map((n) => /orden-otra-[ab]/.exec(n)?.[0])
          expect(propios).toEqual(['orden-otra-b', 'orden-otra-a'])
          await expect(page.getByText(sedeCancelada.name)).toHaveCount(0)
          await expect(page.getByText(sedeElegida.name)).toHaveCount(1)
          expect(turnoTerminado).toBeTruthy()
        })

        await test.step('el buscador filtra «Otras sedes» por cliente o sede y no toca «Mis sedes»', async () => {
          await page
            .getByLabel('Buscar por cliente o sede')
            .fill('orden-otra-a')
          const otras = page.getByRole('region', { name: 'Otras sedes' })
          await expect(otras).toContainText(sedeOtraTerminada.name)
          await expect(otras).not.toContainText(sedeOtraEnCurso.name)
          await expect(
            page.getByRole('region', { name: 'Mis sedes' }),
          ).toContainText(sedeEnCurso.name)
          await page
            .getByLabel('Buscar por cliente o sede')
            .fill('zzz-no-existe')
          await expect(
            page.getByText('No encontramos turnos con esa búsqueda.'),
          ).toBeVisible()
          await expectNoHorizontalScroll(page)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'CJ-24: al dar de baja la preferencia, la sede vuelve a «Otras sedes»',
    cubre('RB-S02', 'CJ-03', 'CJ-24'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('pref-baja')
        const sede = await sc.site(cliente.id, 'pref-baja')
        await sc.shift(cliente.id, sede.id, sc.today, FRANJAS_MOVIL.diaCompleto)
        const prioridad = await sc.prioridad('supervisor1', { siteId: sede.id })

        await page.goto('/sup')
        await expect(
          page
            .getByRole('region', { name: 'Mis sedes' })
            .getByRole('link')
            .filter({ hasText: sede.name }),
        ).toBeVisible()

        const dueno = await sessionClient('owner')
        const baja = await dueno.rpc('remove_supervisor_priority', {
          p_priority_id: prioridad,
        })
        expect(baja.error, baja.error?.message).toBeNull()

        await page.reload()
        await expect(
          page
            .getByRole('region', { name: 'Otras sedes' })
            .getByRole('link')
            .filter({ hasText: sede.name }),
        ).toBeVisible()
        await expect(
          page
            .getByRole('region', { name: 'Mis sedes' })
            .getByRole('link')
            .filter({ hasText: sede.name }),
        ).toHaveCount(0)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
