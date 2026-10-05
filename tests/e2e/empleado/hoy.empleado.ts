import { expect, test } from '@playwright/test'
import {
  daysFromToday,
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { marcarCambiosVistos } from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// TEST-017 (P18.2): EMP-03 "Hoy" con los próximos días y los cambios (RB-E02, P-092, P-093) y
// los estados vacíos de EMP-14 y EMP-12. Cuenta de este archivo: empleado1 (sin servicios
// propios: cada test arma los suyos y los borra al final).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('empleado1') })

test(
  'sin servicios, Hoy, Fichar y Avisar muestran su estado vacío',
  cubre('RB-E02', 'RB-E04', 'RB-E07'),
  async ({ page }) => {
    await page.goto('/app')
    await expect(page.getByText('No tenés servicios hoy')).toBeVisible()
    await expectNoHorizontalScroll(page)

    // EMP-14: con nada para fichar el botón central avisa en vez de abrir un registro.
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByLabel('Fichar')
      .click()
    await expect(page).toHaveURL(/\/app\/fichar$/)
    await expect(
      page.getByText('No tenés servicios para fichar hoy'),
    ).toBeVisible()

    // EMP-12: nada para avisar.
    await page.goto('/app/avisar')
    await expect(page.getByText('No tenés servicios para avisar')).toBeVisible()
  },
)

test(
  'Hoy ordena el servicio destacado, el otro servicio de hoy y los próximos 7 días',
  cubre('RB-E02', 'P-093'),
  async ({ page }) => {
    const sc = new Scenario()
    try {
      const cliente = await sc.client('hoy-orden')
      const sedeA = await sc.site(cliente.id, 'hoy-a')
      const sedeB = await sc.site(cliente.id, 'hoy-b')
      const sedeManana = await sc.site(cliente.id, 'hoy-manana')
      const sedeSiete = await sc.site(cliente.id, 'hoy-siete')
      const sedeOcho = await sc.site(cliente.id, 'hoy-ocho')

      const turnoA = await sc.shift(
        cliente.id,
        sedeA.id,
        sc.today,
        FRANJAS.manana,
      )
      const turnoB = await sc.shift(
        cliente.id,
        sedeB.id,
        sc.today,
        FRANJAS.tarde,
      )
      const turnoManana = await sc.shift(
        cliente.id,
        sedeManana.id,
        daysFromToday(1),
        FRANJAS.manana,
      )
      const turnoSiete = await sc.shift(
        cliente.id,
        sedeSiete.id,
        daysFromToday(7),
        FRANJAS.manana,
      )
      // Fuera del rango de Hoy: `v_my_day` llega hasta hoy + 7.
      const turnoOcho = await sc.shift(
        cliente.id,
        sedeOcho.id,
        daysFromToday(8),
        FRANJAS.manana,
      )
      // Se asignan fuera de orden a propósito: el orden lo pone la pantalla, no la inserción.
      for (const turno of [
        turnoB,
        turnoA,
        turnoManana,
        turnoSiete,
        turnoOcho,
      ]) {
        await sc.assign(turno, 'empleado1')
      }
      await marcarCambiosVistos('empleado1')

      await page.goto('/app')
      await expect(page.getByText(sedeA.name)).toBeVisible()
      await expect(page.getByText(sedeB.name)).toBeVisible()
      await expect(page.getByText('Próximos días')).toBeVisible()
      await expect(page.getByText(sedeManana.name)).toBeVisible()
      await expect(page.getByText(sedeSiete.name)).toBeVisible()
      await expect(
        page.getByText(sedeOcho.name),
        'a ocho días ya no entra en Hoy (P-093)',
      ).toHaveCount(0)

      const y = async (nombre: string) =>
        (await page.getByText(nombre).boundingBox())!.y
      expect(await y(sedeA.name), 'el más temprano va primero').toBeLessThan(
        await y(sedeB.name),
      )
      expect(
        await y(sedeB.name),
        'hoy antes que los próximos días',
      ).toBeLessThan(await y(sedeManana.name))
      expect(await y(sedeManana.name)).toBeLessThan(await y(sedeSiete.name))

      // La tarjeta destacada lleva el estado propio y el horario del turno.
      const destacada = page.getByRole('link').filter({ hasText: sedeA.name })
      await expect(destacada).toContainText('Esperado')
      await expect(destacada).toContainText('08:00–12:00')
      await expectNoHorizontalScroll(page)

      // Cada servicio lleva a su detalle.
      await destacada.click()
      await expect(page).toHaveURL(/\/app\/servicio\//)
      await expect(
        page.getByRole('link', { name: 'Abrir en el mapa' }),
      ).toBeVisible()
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'el bloque "Cambios desde tu última visita" aparece con un cambio de administración y se apaga al verlo',
  cubre('RB-E02', 'P-092'),
  async ({ page }) => {
    const sc = new Scenario()
    try {
      const cliente = await sc.client('hoy-cambios')
      const sede = await sc.site(cliente.id, 'hoy-cambios')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS.manana,
      )
      await sc.assign(turno, 'empleado1')

      // Cada vez que Hoy carga, la propia pantalla llama a `mark_changes_seen` sin esperarlo: hay
      // que aguardar esa llamada (y que la tarjeta ya esté pintada) antes de seguir; si no, el
      // "visto" de una carga anterior puede llegar DESPUÉS del cambio de administración y
      // apagarlo (carrera que se vio en WebKit).
      const abrirHoy = async (recargar: boolean) => {
        const marcado = page.waitForResponse((r) =>
          r.url().includes('/rpc/mark_changes_seen'),
        )
        if (recargar) await page.reload()
        else await page.goto('/app')
        await expect(page.getByText(sede.name).first()).toBeVisible()
        await marcado
      }

      await test.step('la asignación nueva cuenta como cambio y, una vez vista, se apaga', async () => {
        await abrirHoy(false)
        await expect(
          page.getByText('Cambios desde tu última visita'),
        ).toBeVisible()
        await abrirHoy(true)
        await expect(
          page.getByText('Cambios desde tu última visita'),
        ).toHaveCount(0)
      })

      await test.step('un cambio de administración vuelve a encender el bloque con la sede', async () => {
        const owner = await sessionClient('owner')
        const cambio = await owner.rpc('update_shift_time', {
          p_shift_id: turno,
          p_start: '09:00',
          p_end: '13:00',
        })
        expect(cambio.error, cambio.error?.message).toBeNull()
        await abrirHoy(true)
        const bloque = page.getByRole('alert').filter({
          hasText: 'Cambios desde tu última visita',
        })
        await expect(bloque).toContainText(sede.name)
        await expect(page.getByText('09:00–13:00')).toBeVisible()
      })

      await test.step('en la visita siguiente ya no está', async () => {
        await abrirHoy(true)
        await expect(
          page.getByText('Cambios desde tu última visita'),
        ).toHaveCount(0)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

// DEF-01 (corregido en P18.6): el empleado ve el turno cancelado en Hoy (P-049, CB-03).
test(
  'Hoy muestra el turno cancelado con su indicador (P-049, CB-03)',
  {
    ...cubre('RB-E02', 'CB-03', 'P-049'),
  },
  async ({ page }) => {
    const sc = new Scenario()
    try {
      const cliente = await sc.client('hoy-cancelado')
      const sede = await sc.site(cliente.id, 'hoy-cancelado')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS.manana,
      )
      await sc.assign(turno, 'empleado1')
      const owner = await sessionClient('owner')
      const cancelado = await owner.rpc('cancel_shift', {
        p_shift_id: turno,
        p_reason: 'e2e: cancelado',
      })
      expect(cancelado.error, cancelado.error?.message).toBeNull()

      await page.goto('/app')
      await expect(page.getByRole('main')).toContainText(sede.name, {
        timeout: 8_000,
      })
      await expect(
        page.getByRole('main').getByText('Cancelado', { exact: true }),
      ).toBeVisible()
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
