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
  fichar,
  FRANJAS_MOVIL,
  fijarConsentimiento,
  tarjetaDeTurno,
  tareasDelTurno,
} from '../../fixtures/movil.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// TEST-018 (P18.2), reescrito en P24.5: «Hoy» con los turnos de todos los clientes (SUP-02), el
// detalle del turno (SUP-03), la supervisión (SUP-04), la lista de abiertas (SUP-07) y el historial
// de jornadas (SUP-08): RB-S01, RB-S02, RB-S03, RB-S05; CJ-02, CJ-13, CJ-14, CJ-32. Cuenta de este
// archivo: supervisor1; los empleados de los turnos son empleado1 y empleado2.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('supervisor1') })

test(
  'sin jornadas ni supervisiones abiertas, Supervisiones e Historial muestran su estado vacío',
  cubre('RB-S02', 'RB-S05', 'CJ-26'),
  async ({ page }) => {
    await page.goto('/sup/supervisiones')
    await expect(
      page.getByText('No tenés supervisiones abiertas'),
    ).toBeVisible()
    await expectNoHorizontalScroll(page)
    await page.goto('/sup/historial')
    await expect(page.getByText('Todavía no tenés jornadas')).toBeVisible()
  },
)

test(
  'CJ-02: Hoy lista los turnos de hoy de cualquier cliente (sin asignación previa), no los de otros días; el detalle trae sede, personal y quién más supervisa; la supervisión trae tareas y criterios',
  cubre('RB-S02', 'RB-S03', 'RB-S01', 'CJ-01', 'CJ-02', 'P-093'),
  async ({ page }) => {
    test.setTimeout(240_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('sup-hoy')
      const sedeHoy = await sc.site(cliente.id, 'sup-hoy', {
        lat: -34.6037,
        lng: -58.3816,
      })
      const sedeManana = await sc.site(cliente.id, 'sup-manana')
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
        FRANJAS_MOVIL.diaCompleto,
        2,
      )
      await tareasDelTurno(turnoHoy, [
        { title: 'e2e-sup: pasar el trapeador', required: true },
      ])
      const asignacionUno = await sc.assign(turnoHoy, 'empleado1')
      await sc.assign(turnoHoy, 'empleado2')
      // Un turno de mañana: Hoy no lo lista (no hay «Próximos días», CJ-02).
      await sc.shift(
        cliente.id,
        sedeManana.id,
        daysFromToday(1),
        FRANJAS.manana,
      )

      // El empleado1 ya empezó: el detalle tiene que mostrar su estado y su inicio real.
      await fijarConsentimiento('empleado1', true)
      await fichar('empleado1', asignacionUno, 'inicio')

      await test.step('SUP-02: el turno de hoy con cliente, sede, franja, estado y empleados; el de mañana no está', async () => {
        await page.goto('/sup')
        const tarjeta = tarjetaDeTurno(page, sedeHoy.name)
        await expect(tarjeta).toContainText(cliente.name)
        await expect(tarjeta).toContainText('00:00–23:59')
        await expect(tarjeta).toContainText('En curso')
        await expect(tarjeta).toContainText('2 empleados')
        await expect(page.getByText(sedeManana.name)).toHaveCount(0)
        await expect(page.getByText('Próximos días')).toHaveCount(0)
        await expectNoHorizontalScroll(page)
      })

      await test.step('SUP-03: sede, personal con su asistencia y nadie más supervisando', async () => {
        await tarjetaDeTurno(page, sedeHoy.name).click()
        await expect(page).toHaveURL(new RegExp(`/sup/turnos/${turnoHoy}$`))
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

        const filaUno = page
          .locator('div.flex.items-center.justify-between.gap-2')
          .filter({ hasText: nombreDe('empleado1') })
        await expect(filaUno).toContainText('Presente')
        await expect(filaUno).toContainText(/Inicio: \d{2}:\d{2}/)
        const filaDos = page
          .locator('div.flex.items-center.justify-between.gap-2')
          .filter({ hasText: nombreDe('empleado2') })
        await expect(filaDos).toContainText('Esperado')
        await expect(
          page.getByText('Ningún otro coordinador lo supervisa por ahora.'),
        ).toBeVisible()
        await expectNoHorizontalScroll(page)
      })

      await test.step('SUP-04: tomado el turno, la supervisión trae contacto de la sede, tareas, criterios y aparece en SUP-07', async () => {
        const supervision = await sc.tomarSupervision(turnoHoy, 'supervisor1')
        await page.goto(`/sup/supervisiones/${supervision}`)
        // El contacto y las indicaciones de acceso de la sede se ven en la supervisión (SUP-04).
        await expect(page.getByText('Entrar por el garage.')).toBeVisible()
        await expect(
          page.getByRole('link', { name: '+541155551111' }),
        ).toHaveAttribute('href', 'tel:+541155551111')
        await expect(page.getByText('Tareas del turno')).toBeVisible()
        await expect(
          page.getByText('e2e-sup: pasar el trapeador'),
        ).toBeVisible()
        await expect(page.getByText('Criterios de calificación')).toBeVisible()
        // El inicio ya no se registra acá (CJ-26): no hay «Registrar inicio».
        await expect(
          page.getByRole('link', { name: /Registrar (inicio|fin)/ }),
        ).toHaveCount(0)
        await expectNoHorizontalScroll(page)

        await page.goto('/sup/supervisiones')
        await expect(
          page.getByRole('link').filter({ hasText: sedeHoy.name }),
        ).toBeVisible()
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'CJ-13, CJ-14, CJ-32: el historial muestra las jornadas por día con horas netas, pausas y sus supervisiones; la corregida lo dice',
  cubre('RB-S05', 'RB-S04', 'P-081', 'CJ-13', 'CJ-14', 'CJ-32'),
  async ({ page }) => {
    test.setTimeout(240_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('sup-historial')
      const sedeAyer = await sc.site(cliente.id, 'sup-hist-ayer')
      const sedeHoy = await sc.site(cliente.id, 'sup-hist-hoy')
      const ayer = daysFromToday(-1)

      // Ayer: jornada registrada por la administración de 08:00 a 16:00 (8 h) con una supervisión.
      const jornadaAyer = await sc.jornadaPasada(
        'supervisor1',
        ayer,
        '08:00',
        '16:00',
      )
      const turnoAyer = await sc.shift(
        cliente.id,
        sedeAyer.id,
        ayer,
        FRANJAS.manana,
        1,
      )
      await sc.supervisionDirecta(turnoAyer, 'supervisor1', {
        estado: 'completada',
        jornadaId: jornadaAyer,
        inicio: `${ayer}T10:00:00-03:00`,
        fin: `${ayer}T10:45:00-03:00`,
      })

      // Hoy: supervisión por el flujo real, calificando a un empleado.
      const turnoHoy = await sc.shift(
        cliente.id,
        sedeHoy.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      const asignacion = await sc.assign(turnoHoy, 'empleado1')
      await fijarConsentimiento('empleado1', true)
      await fichar('empleado1', asignacion, 'inicio')
      const supHoy = await sc.tomarSupervision(turnoHoy, 'supervisor1')
      await calificar(
        'supervisor1',
        supHoy,
        asignacion,
        4,
        'e2e-hist: buen trabajo',
      )

      await test.step('SUP-08: dos jornadas, la de hoy primero; la de ayer con 8 h y la marca de corregida', async () => {
        await page.goto('/sup/historial')
        const tarjetas = page.locator('[data-slot="card"]')
        await expect(tarjetas).toHaveCount(2)
        await expect(tarjetas.nth(0)).toContainText(sedeHoy.name)
        const tarjetaAyer = tarjetas.nth(1)
        await expect(tarjetaAyer).toContainText('08:00 a 16:00')
        await expect(tarjetaAyer).toContainText('8 h')
        await expect(tarjetaAyer).toContainText('Sin pausas')
        await expect(tarjetaAyer).toContainText(
          'Corregida por la administración.',
        )
        await expect(tarjetaAyer).toContainText(sedeAyer.name)
        // CJ-14: la supervisión muestra su duración informativa (45 min) y no suma horas.
        await expect(tarjetaAyer).toContainText('45 min')
        await expectNoHorizontalScroll(page)
      })

      await test.step('SUP-08 → SUP-04: el detalle de una supervisión de hoy trae la calificación', async () => {
        await page.getByRole('link').filter({ hasText: sedeHoy.name }).click()
        await expect(page).toHaveURL(
          new RegExp(`/sup/supervisiones/${supHoy}$`),
        )
        const fila = page
          .locator('div.flex.items-center.justify-between.gap-2')
          .filter({ hasText: nombreDe('empleado1') })
        await expect(
          fila.getByRole('img', { name: '4 de 5 estrellas' }),
        ).toBeVisible()
      })

      await test.step('SUP-08 → SUP-04 de ayer: solo lectura, sin cerrar ni descartar', async () => {
        await page.goto('/sup/historial')
        await page.getByRole('link').filter({ hasText: sedeAyer.name }).click()
        await expect(
          page.getByRole('link', { name: 'Cerrar supervisión' }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: 'Descartar' }),
        ).toHaveCount(0)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
