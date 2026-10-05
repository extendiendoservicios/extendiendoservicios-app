import { expect, test } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import {
  daysFromToday,
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  calificar,
  cerrarSupervision,
  fichar,
  FRANJAS_MOVIL,
  fijarConsentimiento,
  supervisionFichar,
  tareasDelTurno,
} from '../../fixtures/movil.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// TEST-018 (P18.2): las supervisiones del día y su detalle (SUP-02, SUP-03, SUP-07) y el
// historial (SUP-08): RB-S01, RB-S02, RB-S03, RB-S05. Cuenta de este archivo: supervisor1
// (supervisor2 aparece solo como "la otra persona" cuyas supervisiones no se tienen que ver);
// los empleados de los turnos son empleado1 y empleado2.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('supervisor1') })

test(
  'sin supervisiones, Hoy, Supervisiones e Historial muestran su estado vacío',
  cubre('RB-S02', 'RB-S05'),
  async ({ page }) => {
    await page.goto('/sup')
    await expect(page.getByText('No tenés supervisiones hoy')).toBeVisible()
    await expectNoHorizontalScroll(page)
    await page.goto('/sup/supervisiones')
    await expect(
      page.getByText('No tenés supervisiones asignadas'),
    ).toBeVisible()
    await page.goto('/sup/historial')
    await expect(
      page.getByText('Todavía no cerraste ninguna supervisión'),
    ).toBeVisible()
  },
)

test(
  'Hoy lista las supervisiones propias de hoy y los próximos 7 días; Supervisiones suma las futuras; el detalle trae sede, personal y tareas',
  cubre('RB-S02', 'RB-S03', 'RB-S01', 'P-093'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('sup-hoy')
      const sedeHoy = await sc.site(cliente.id, 'sup-hoy', {
        lat: -34.6037,
        lng: -58.3816,
      })
      const sedeTres = await sc.site(cliente.id, 'sup-tres')
      const sedeDiez = await sc.site(cliente.id, 'sup-diez')
      const sedeAjena = await sc.site(cliente.id, 'sup-ajena')
      const { error } = await sc.db
        .from('sites')
        .update({
          address: 'Calle de Supervisión 456',
          city: 'CABA',
          contact_name: 'Contacto Sup',
          contact_phone: '+541155551111',
          access_instructions: 'Entrar por el garage.',
        })
        .eq('id', sedeHoy.id)
      expect(error, error?.message).toBeNull()

      const turnoHoy = await sc.shift(
        cliente.id,
        sedeHoy.id,
        sc.today,
        FRANJAS.manana,
        2,
      )
      await tareasDelTurno(turnoHoy, [
        { title: 'e2e-sup: pasar el trapeador', required: true },
      ])
      const asignacionUno = await sc.assign(turnoHoy, 'empleado1')
      await sc.assign(turnoHoy, 'empleado2')
      const supHoy = await sc.assignSupervision(turnoHoy, 'supervisor1')

      const turnoTres = await sc.shift(
        cliente.id,
        sedeTres.id,
        daysFromToday(3),
        FRANJAS.manana,
      )
      await sc.assignSupervision(turnoTres, 'supervisor1')
      const turnoDiez = await sc.shift(
        cliente.id,
        sedeDiez.id,
        daysFromToday(10),
        FRANJAS.manana,
      )
      await sc.assignSupervision(turnoDiez, 'supervisor1')
      // La de otra supervisora no se ve en ninguna lista de supervisor1 (RB-S02).
      const turnoAjeno = await sc.shift(
        cliente.id,
        sedeAjena.id,
        sc.today,
        FRANJAS.tarde,
      )
      await sc.assignSupervision(turnoAjeno, 'supervisor2')

      // El empleado1 ya empezó: el detalle tiene que mostrar su estado y su inicio real.
      await fijarConsentimiento('empleado1', true)
      await fichar('empleado1', asignacionUno, 'inicio')

      await test.step('SUP-02: la de hoy con cliente, sede, franja, estado y empleados', async () => {
        await page.goto('/sup')
        const tarjeta = page.getByRole('link').filter({ hasText: sedeHoy.name })
        await expect(tarjeta).toContainText(cliente.name)
        await expect(tarjeta).toContainText('08:00–12:00')
        await expect(tarjeta).toContainText('Asignada')
        await expect(tarjeta).toContainText('2 empleados')
        await expect(tarjeta).toContainText(nombreDe('empleado1'))
        await expect(tarjeta).toContainText(nombreDe('empleado2'))
        await expectNoHorizontalScroll(page)
      })

      await test.step('SUP-02: "Próximos días" llega hasta 7 días; las ajenas no aparecen', async () => {
        await expect(page.getByText('Próximos días')).toBeVisible()
        await expect(page.getByText(sedeTres.name)).toBeVisible()
        await expect(page.getByText(sedeDiez.name)).toHaveCount(0)
        await expect(page.getByText(sedeAjena.name)).toHaveCount(0)
      })

      await test.step('SUP-07: todas las asignadas, futuras incluidas, por fecha', async () => {
        await page.goto('/sup/supervisiones')
        const hoy = page.getByText(sedeHoy.name)
        const tres = page.getByText(sedeTres.name)
        const diez = page.getByText(sedeDiez.name)
        await expect(hoy).toBeVisible()
        await expect(tres).toBeVisible()
        await expect(diez).toBeVisible()
        await expect(page.getByText(sedeAjena.name)).toHaveCount(0)
        const y = async (l: typeof hoy) => (await l.boundingBox())!.y
        expect(await y(hoy)).toBeLessThan(await y(tres))
        expect(await y(tres)).toBeLessThan(await y(diez))
      })

      await test.step('SUP-03: sede, contacto, personal con su asistencia, tareas y criterios', async () => {
        await page.goto(`/sup/supervisiones/${supHoy}`)
        await expect(page.getByText(cliente.name).first()).toBeVisible()
        await expect(
          page.getByText('Calle de Supervisión 456, CABA'),
        ).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Abrir en el mapa' }),
        ).toHaveAttribute(
          'href',
          'https://www.google.com/maps/search/?api=1&query=-34.6037,-58.3816',
        )
        await expect(page.getByText('Entrar por el garage.')).toBeVisible()
        await expect(
          page.getByRole('link', { name: '+541155551111' }),
        ).toHaveAttribute('href', 'tel:+541155551111')

        const filaUno = page
          .locator('div.flex.items-center.justify-between.gap-2')
          .filter({ hasText: nombreDe('empleado1') })
        await expect(filaUno).toContainText('Presente')
        await expect(filaUno).toContainText(/Inicio: \d{2}:\d{2}/)
        const filaDos = page
          .locator('div.flex.items-center.justify-between.gap-2')
          .filter({ hasText: nombreDe('empleado2') })
        await expect(filaDos).toContainText('Esperado')

        await expect(page.getByText('Tareas del turno')).toBeVisible()
        await expect(
          page.getByText('e2e-sup: pasar el trapeador'),
        ).toBeVisible()
        await expect(page.getByText('Criterios de calificación')).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Registrar inicio de supervisión' }),
        ).toBeVisible()
        await expectNoHorizontalScroll(page)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'el historial muestra las cerradas con puntajes y motivo, en solo lectura',
  cubre('RB-S05', 'RB-S04', 'P-081'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('sup-historial')
      const sedeA = await sc.site(cliente.id, 'sup-hist-a')
      const sedeB = await sc.site(cliente.id, 'sup-hist-b')
      // A: todo el día (la ventana de calificación sigue abierta); B: sin empleados y no realizada.
      const turnoA = await sc.shift(
        cliente.id,
        sedeA.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
        2,
      )
      const asignacionUno = await sc.assign(turnoA, 'empleado1')
      await sc.assign(turnoA, 'empleado2')
      const supA = await sc.assignSupervision(turnoA, 'supervisor1')
      const turnoB = await sc.shift(
        cliente.id,
        sedeB.id,
        daysFromToday(1),
        FRANJAS.manana,
      )
      const supB = await sc.assignSupervision(turnoB, 'supervisor1')

      await supervisionFichar('supervisor1', supA, 'inicio')
      await calificar(
        'supervisor1',
        supA,
        asignacionUno,
        4,
        'e2e-hist: buen trabajo',
      )
      await supervisionFichar('supervisor1', supA, 'fin')
      await cerrarSupervision('supervisor1', supA, { completar: true })
      await cerrarSupervision('supervisor1', supB, {
        noRealizada: 'e2e-hist: la sede estaba cerrada',
      })

      await test.step('SUP-08: completada con promedio y "1 de 2 calificados"; no realizada con motivo', async () => {
        await page.goto('/sup/historial')
        const completada = page
          .getByRole('link')
          .filter({ hasText: sedeA.name })
        await expect(completada).toContainText('Completada')
        await expect(completada).toContainText('1 de 2 calificados')
        await expect(
          completada.getByRole('img', { name: '4 de 5 estrellas' }),
        ).toBeVisible()
        const noRealizada = page
          .getByRole('link')
          .filter({ hasText: sedeB.name })
        await expect(noRealizada).toContainText('No realizada')
        await expect(noRealizada).toContainText(
          'Motivo: e2e-hist: la sede estaba cerrada',
        )
        await expectNoHorizontalScroll(page)
      })

      await test.step('SUP-08 → SUP-03: el detalle es de lectura (sin registrar ni cerrar) y trae la calificación', async () => {
        await page.getByRole('link').filter({ hasText: sedeA.name }).click()
        await expect(page).toHaveURL(new RegExp(`/sup/supervisiones/${supA}$`))
        await expect(page.getByText(/Iniciada a las/)).toContainText(
          'Finalizada a las',
        )
        await expect(
          page.getByRole('link', { name: /Registrar (inicio|fin)/ }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('link', { name: 'Cerrar supervisión' }),
        ).toHaveCount(0)
        const fila = page
          .locator('div.flex.items-center.justify-between.gap-2')
          .filter({ hasText: nombreDe('empleado1') })
        await expect(
          fila.getByRole('img', { name: '4 de 5 estrellas' }),
        ).toBeVisible()
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
