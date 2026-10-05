import { expect, test, type Page } from '@playwright/test'
import { nombreDe, reNombreDe } from '../../fixtures/accounts.ts'
import { addDays, FRANJAS, franjaYaEmpezo } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { pickMonth } from '../../fixtures/ui.ts'

// TEST-016 (P18.1): cronograma y asignaciones desde la administración (RB-A04, RB-A06).
//   - ADM-03 mes: chip por turno, filtro por cliente, feriado marcado (CB-09, P-050).
//   - ADM-08: asignar con advertencias que no bloquean (CB-25, P-033, P-034) y la grilla
//     semanal ADM-04 con el empleado de licencia atenuado.
//   - ADM-07: cambiar la franja de un turno que deja a un empleado superpuesto (CB-10, P-051).
//   - ADM-05: lista del día con dotación y navegación entre días.
// Empleados de este archivo: empleado1, empleado3 y empleado4.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

test.describe('cronograma (ADM-03, ADM-04, ADM-05)', () => {
  test(
    'el mes muestra el turno como chip, el filtro por cliente lo aísla y el feriado queda marcado',
    cubre('RB-A06', 'CB-09', 'P-050'),
    async ({ page }) => {
      const sc = new Scenario()
      // Un mes lejano propio de esta prueba (2193-05): no choca con los turnos reales del seed
      // ni con los feriados nacionales, que son los únicos de `App_dev`.
      const feriado = '2193-05-12'
      const otroDia = '2193-05-14'
      try {
        const client = await sc.client('mes')
        const site = await sc.site(client.id, 'mes')
        await sc.holiday(feriado, 'e2e-feriado-de-prueba')
        await sc.shift(client.id, site.id, feriado, {
          start: '08:00',
          end: '12:00',
        })
        await sc.shift(client.id, site.id, otroDia, {
          start: '14:00',
          end: '18:00',
        })

        // El calendario mensual guarda el mes en su estado (no en la URL): se llega con el selector.
        await page.goto('/admin/planificacion?vista=mes')
        await pickMonth(page, 'Elegir mes', 2193, 5)
        await expect(
          page.getByRole('button', { name: 'Elegir mes' }),
        ).toContainText('mayo 2193')

        await test.step('el feriado está marcado y el turno del día feriado se ve igual', async () => {
          await expect(
            page.getByRole('button', { name: /^12 Feriado/ }),
          ).toBeVisible()
          await expect(
            page.getByRole('link', {
              name: `Programado: ${client.name} · ${site.name} · 08:00–12:00`,
            }),
          ).toBeVisible()
          await expect(
            page.getByRole('link', {
              name: `Programado: ${client.name} · ${site.name} · 14:00–18:00`,
            }),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: /^14 Feriado/ }),
            'el día 14 no es feriado',
          ).toHaveCount(0)
        })

        await test.step('el filtro por cliente muestra solo sus turnos', async () => {
          await page
            .getByRole('combobox', { name: 'Filtrar por cliente' })
            .click()
          await page.getByRole('option', { name: client.name }).click()
          await expect(
            page.getByRole('link', { name: new RegExp(client.name) }),
          ).toHaveCount(2)
        })

        await test.step('el chip abre el detalle del turno', async () => {
          await page
            .getByRole('link', {
              name: `Programado: ${client.name} · ${site.name} · 14:00–18:00`,
            })
            .click()
          const detalle = page.getByRole('dialog', {
            name: 'Detalle del turno',
          })
          await expect(
            detalle.getByText(`${client.name} · ${site.name}`),
          ).toBeVisible()
          await expect(detalle.getByText('Dotación: 0/1')).toBeVisible()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'la lista del día muestra la dotación y se navega entre días',
    cubre('RB-A06'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const client = await sc.client('dia')
        const site = await sc.site(client.id, 'dia')
        const manana = addDays(sc.today, 1)
        const hoyId = await sc.shift(
          client.id,
          site.id,
          sc.today,
          { start: '14:00', end: '18:00' },
          2,
        )
        await sc.shift(client.id, site.id, manana, {
          start: '08:00',
          end: '12:00',
        })
        await sc.assign(hoyId, 'empleado1')

        await page.goto(`/admin/planificacion?vista=dia&fecha=${sc.today}`)
        const filaHoy = page.getByRole('row').filter({ hasText: client.name })
        await expect(filaHoy).toContainText('1/2')
        // "Programado" solo hasta que la franja empieza (después ya no lo es).
        if (!franjaYaEmpezo(FRANJAS.tarde)) {
          await expect(filaHoy).toContainText('Programado')
        }
        await expect(filaHoy).toContainText('14:00–18:00')

        await page.getByRole('button', { name: 'Día siguiente' }).click()
        await expect(page).toHaveURL(new RegExp(`fecha=${manana}`))
        const filaManana = page
          .getByRole('row')
          .filter({ hasText: client.name })
        await expect(filaManana).toContainText('0/1')
        await expect(filaManana).toContainText('08:00–12:00')

        await page.getByRole('button', { name: 'Hoy' }).click()
        await expect(page).toHaveURL(new RegExp(`fecha=${sc.today}`))
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('asignar con advertencias (ADM-08, ADM-04)', () => {
  test(
    'un empleado de licencia o no habilitado se asigna igual, con advertencia, y la grilla semanal lo atenúa',
    cubre('RB-A04', 'RB-A06', 'CB-25', 'P-033', 'P-034'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const client = await sc.client('adv')
        const otro = await sc.client('adv-otro')
        const site = await sc.site(client.id, 'adv')
        const shiftId = await sc.shift(
          client.id,
          site.id,
          sc.today,
          { start: '20:00', end: '23:00' },
          2,
        )
        // empleado3: licencia de hoy. empleado4: habilitado solo para OTRO cliente (si la lista
        // de habilitaciones está vacía, el empleado está habilitado para todos, P-034).
        await sc.leave('empleado3', sc.today, sc.today)
        await sc.enableForClient('empleado4', otro.id)

        await page.goto(`/admin/turnos/${shiftId}`)
        const detalle = page.getByRole('dialog', { name: 'Detalle del turno' })
        await expect(detalle.getByText('Dotación: 0/2')).toBeVisible()

        await test.step('ADM-08 marca el estado efectivo de cada candidato', async () => {
          await detalle
            .getByRole('button', { name: 'Asignar empleado' })
            .click()
          const hoja = page.getByRole('dialog', { name: 'Asignar empleado' })
          const licencia = hoja.getByRole('radio', {
            name: reNombreDe('empleado3'),
          })
          await expect(licencia).toContainText('De licencia')
          const noHabilitado = hoja.getByRole('radio', {
            name: reNombreDe('empleado4'),
          })
          await expect(noHabilitado).toContainText(
            'No habilitado para el cliente',
          )
          await expect(
            hoja.getByRole('radio', { name: reNombreDe('empleado1') }),
          ).toContainText('Habilitado y disponible')
        })

        await test.step('asigna al de licencia: se asigna igual y avisa (no bloquea)', async () => {
          const hoja = page.getByRole('dialog', { name: 'Asignar empleado' })
          await hoja
            .getByRole('radio', { name: reNombreDe('empleado3') })
            .click()
          await hoja
            .getByRole('button', { name: 'Asignar', exact: true })
            .click()
          await expect(
            page.getByText(
              'Asignamos igual, con advertencias: revisalas abajo.',
            ),
          ).toBeVisible()
          await expect(
            hoja.getByText(
              'Este empleado tiene una licencia cargada para la fecha del turno.',
            ),
          ).toBeVisible()
        })

        await test.step('asigna al no habilitado: se asigna igual y avisa', async () => {
          const hoja = page.getByRole('dialog', { name: 'Asignar empleado' })
          await hoja
            .getByRole('radio', { name: reNombreDe('empleado4') })
            .click()
          await hoja
            .getByRole('button', { name: 'Asignar', exact: true })
            .click()
          await expect(
            hoja.getByText(
              'Este empleado no figura habilitado para este cliente.',
            ),
          ).toBeVisible()
        })

        await test.step('quedaron las dos asignaciones y el turno pasó a Asignado', async () => {
          const { data: asignaciones } = await sc.db
            .from('assignments')
            .select('employee_id')
            .eq('shift_id', shiftId)
            .is('removed_at', null)
          expect(asignaciones).toHaveLength(2)
          const { data: turno } = await sc.db
            .from('shifts')
            .select('status')
            .eq('id', shiftId)
            .single()
          expect(turno?.status).toBe('assigned')
        })

        await test.step('ADM-04: la semana muestra al empleado de licencia atenuado, con su turno', async () => {
          await page.goto(`/admin/planificacion?vista=semana&fecha=${sc.today}`)
          const fila = page
            .getByRole('row')
            .filter({ hasText: nombreDe('empleado3') })
          await expect(fila).toContainText('(de licencia)')
          await expect(
            fila.getByRole('link', {
              name: new RegExp(`${site.name} 20:00–23:00`),
            }),
          ).toBeVisible()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('cambiar la franja de un turno con asignaciones (ADM-07)', () => {
  async function armar(sc: Scenario) {
    const client = await sc.client('solapa')
    const site = await sc.site(client.id, 'solapa')
    // Mismo empleado en dos turnos contiguos: A de 14:00 a 16:00 y B de 16:00 a 18:00.
    const turnoA = await sc.shift(client.id, site.id, sc.today, {
      start: '14:00',
      end: '16:00',
    })
    const turnoB = await sc.shift(client.id, site.id, sc.today, {
      start: '16:00',
      end: '18:00',
    })
    await sc.assign(turnoA, 'empleado1')
    await sc.assign(turnoB, 'empleado1')
    return { turnoB }
  }

  async function intentarSolapar(page: Page, turnoB: string) {
    await page.goto(`/admin/turnos/${turnoB}/editar`)
    await page.getByLabel('Desde').fill('15:00')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
  }

  test(
    'mover el inicio para pisar otro turno del mismo empleado se rechaza y no se aplica',
    cubre('RB-A04', 'CB-02', 'CB-10', 'P-051', 'P-053'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const { turnoB } = await armar(sc)
        await intentarSolapar(page, turnoB)
        await expect(
          page.getByText('El empleado ya tiene otro turno en ese horario.'),
        ).toBeVisible()
        await expect(page).toHaveURL(
          new RegExp(`/admin/turnos/${turnoB}/editar`),
        )
        const { data } = await sc.db
          .from('shifts')
          .select('start_time')
          .eq('id', turnoB)
          .single()
        expect(data?.start_time, 'el cambio rechazado no se aplica').toBe(
          '16:00:00',
        )
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  // DEF-03 (corregido en P18.6): `update_shift_time` nombra al empleado afectado (CB-10).
  test(
    'el mensaje del rechazo indica qué empleado queda superpuesto',
    cubre('RB-A04', 'CB-10'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const { turnoB } = await armar(sc)
        await intentarSolapar(page, turnoB)
        await expect(
          page.getByText(
            new RegExp(
              `El empleado ya tiene otro turno en ese horario[.] Afecta a: ${reNombreDe('empleado1').source}`,
            ),
          ),
        ).toBeVisible({ timeout: 5_000 })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
