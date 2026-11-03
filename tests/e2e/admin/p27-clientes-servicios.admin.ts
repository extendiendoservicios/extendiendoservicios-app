import { expect, test } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import { addDays } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario, uniqueName } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { pickDate } from '../../fixtures/ui.ts'

// P27.8: categorías de clientes (OD-20, OD-21), empleados fijos en lote (OD-11) y «Generar los
// turnos de este mes» al crear un servicio (OD-27), desde la administración (1280 px).
// Empleado de este archivo: empleado2. Los turnos de OD-11 son de dentro de 2 y 3 días: no
// dependen de la hora en que corre la prueba.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

test.describe('categorías de clientes (OD-20, OD-21)', () => {
  test(
    'crear una categoría en Configuración, asignarla a un cliente, ver el listado agrupado, filtrar y el total de activos',
    cubre('RB-A03', 'RB-A10', 'OD-20', 'OD-21'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      const nombreCategoria = uniqueName('categoria')
      try {
        const cliente = await sc.client('categorizado')
        const sinCategoria = await sc.client('sin-categoria')

        await test.step('OD-20: Configuración > Empresa > «Categorías de clientes»: alta de la categoría', async () => {
          await page.goto('/admin/configuracion/empresa')
          const seccion = page.locator('section').filter({
            has: page.getByRole('heading', { name: 'Categorías de clientes' }),
          })
          // La lista inicial del seed está.
          for (const inicial of [
            'Edificio',
            'Empresa',
            'Casa',
            'Final de obra',
          ]) {
            await expect(seccion).toContainText(inicial)
          }
          await seccion.getByRole('button', { name: 'Nueva categoría' }).click()
          await page.locator('#client-category-name').fill(nombreCategoria)
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Guardar' })
            .click()
          await expect(page.getByText('Creamos la categoría.')).toBeVisible()
          await expect(seccion).toContainText(nombreCategoria)
        })

        await test.step('OD-20: se elige de un desplegable en el cliente (opcional)', async () => {
          await page.goto(`/admin/clientes/${cliente.id}/editar`)
          await page
            .getByRole('combobox', { name: 'Categoría (opcional)' })
            .click()
          await page.getByRole('option', { name: nombreCategoria }).click()
          await page.getByRole('button', { name: 'Guardar cambios' }).click()
          await expect(
            page.getByText('Guardamos los cambios del cliente.'),
          ).toBeVisible()
          const { data } = await sc.db
            .from('clients')
            .select('category_id, client_categories(name)')
            .eq('id', cliente.id)
            .single()
          expect(
            (data?.client_categories as unknown as { name: string } | null)
              ?.name,
          ).toBe(nombreCategoria)
        })

        await test.step('OD-21: el listado agrupa por categoría y deja «Sin categoría» al final', async () => {
          await page.goto('/admin/clientes')
          await page.getByPlaceholder(/Buscar/).fill('e2e-')
          const grupo = page.getByRole('region', { name: nombreCategoria })
          await expect(grupo).toBeVisible()
          await expect(
            grupo.getByRole('row').filter({ hasText: cliente.name }),
          ).toBeVisible()
          const sin = page.getByRole('region', { name: 'Sin categoría' })
          await expect(
            sin.getByRole('row').filter({ hasText: sinCategoria.name }),
          ).toBeVisible()
          // «Sin categoría» es el último grupo.
          const titulos = await page
            .locator('section[aria-label] > h2')
            .allTextContents()
          expect(titulos.at(-1)).toMatch(/^Sin categoría \(\d+\)$/)
          expect(
            titulos.findIndex((t) => t.startsWith(nombreCategoria)),
          ).toBeLessThan(titulos.length - 1)
        })

        await test.step('OD-21: el filtro por categoría deja solo a ese cliente', async () => {
          await page
            .getByRole('combobox', { name: 'Filtrar por categoría' })
            .click()
          await page.getByRole('option', { name: nombreCategoria }).click()
          await expect(
            page.getByRole('row').filter({ hasText: cliente.name }),
          ).toBeVisible()
          await expect(
            page.getByRole('row').filter({ hasText: sinCategoria.name }),
          ).toHaveCount(0)
          // «Sin categoría» lo invierte.
          await page
            .getByRole('combobox', { name: 'Filtrar por categoría' })
            .click()
          await page.getByRole('option', { name: 'Sin categoría' }).click()
          await expect(
            page.getByRole('row').filter({ hasText: sinCategoria.name }),
          ).toBeVisible()
          await expect(
            page.getByRole('row').filter({ hasText: cliente.name }),
          ).toHaveCount(0)
        })

        await test.step('OD-21: el total de clientes activos, arriba, en el listado y en el mapa', async () => {
          const { count } = await sc.db
            .from('clients')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'active')
            .is('deleted_at', null)
          const texto = `${count} ${count === 1 ? 'cliente activo' : 'clientes activos'}`
          await page.goto('/admin/clientes')
          await expect(page.getByText(texto, { exact: true })).toBeVisible()
          await page.goto('/admin/clientes?pestana=mapa')
          await expect(page.getByText(texto, { exact: true })).toBeVisible()
        })
      } finally {
        // La categoría de la prueba se da de baja del todo con la clave de servicio (no se puede
        // borrar de otra forma): primero se suelta a los clientes.
        const { data: categoria } = await sc.db
          .from('client_categories')
          .select('id')
          .eq('name', nombreCategoria)
        for (const c of categoria ?? []) {
          await sc.db
            .from('clients')
            .update({ category_id: null })
            .eq('category_id', c.id)
          await sc.db.from('client_categories').delete().eq('id', c.id)
        }
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('servicios (OD-11, OD-27)', () => {
  test(
    'cambiar los empleados fijos pregunta desde qué fecha aplicar y actualiza los turnos ya creados',
    cubre('RB-A04', 'AJ2-17', 'OD-11'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('fijos-lote')
        const sede = await sc.site(cliente.id, 'fijos-lote')
        const servicio = await sc.service(cliente.id, sede.id, 'fijos-lote', {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          staff: 2,
        })
        const turnos: string[] = []
        for (const dias of [2, 3]) {
          turnos.push(
            await sc.shift(
              cliente.id,
              sede.id,
              addDays(sc.today, dias),
              { start: '08:00', end: '12:00' },
              2,
              { serviceId: servicio.id },
            ),
          )
        }
        // Un empleado agregado a mano en el primer turno: no se toca.
        const aMano = await sc.assign(turnos[0], 'empleado3')

        await page.goto(`/admin/servicios/${servicio.id}/editar`)
        await expect(page.getByLabel('Nombre')).toHaveValue(servicio.name)
        await page.getByRole('combobox', { name: 'Empleados fijos' }).click()
        await page
          .getByPlaceholder('Buscar por nombre o legajo…')
          .fill(nombreDe('empleado2'))
        await page
          .getByRole('option', { name: new RegExp(nombreDe('empleado2')) })
          .click()
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Guardar cambios' }).click()

        await test.step('OD-11: el diálogo pregunta «¿Aplicar a los turnos?» con la fecha por defecto hoy', async () => {
          const dialogo = page.getByRole('dialog')
          await expect(
            dialogo.getByRole('heading', { name: '¿Aplicar a los turnos?' }),
          ).toBeVisible()
          await expect(dialogo).toContainText(
            'No se tocan los turnos que ya empezaron',
          )
          await expect(
            dialogo.getByRole('button', {
              name: 'Aplicar a los turnos desde el',
            }),
          ).toBeVisible()
          await dialogo
            .getByRole('button', { name: 'Aplicar', exact: true })
            .click()
        })

        await test.step('OD-11: el resultado informa cuántas asignaciones se hicieron', async () => {
          const dialogo = page.getByRole('dialog')
          await expect(
            dialogo.getByRole('heading', { name: 'Resultado' }),
          ).toBeVisible()
          await expect(dialogo).toContainText('Asignaciones nuevas: 2')
          await dialogo.getByRole('button', { name: 'Listo' }).click()
        })

        await test.step('OD-11: los dos turnos tienen al fijo; el empleado de a mano sigue en el primero', async () => {
          const { data } = await sc.db
            .from('assignments')
            .select('shift_id, employee_id, from_fixed')
            .in('shift_id', turnos)
          const del = (turno: string) =>
            (data ?? []).filter((a) => a.shift_id === turno)
          for (const turno of turnos) {
            expect(
              del(turno).some((a) => a.from_fixed),
              'cada turno recibió al fijo',
            ).toBe(true)
          }
          expect(
            del(turnos[0]).some((a) => !a.from_fixed),
            'el empleado agregado a mano sigue',
          ).toBe(true)
          expect(aMano).toBeTruthy()
        })
      } finally {
        // Los fijos cuelgan del servicio y el armador no los borra.
        await sc.db
          .from('service_fixed_employees')
          .delete()
          .in('service_id', sc.extraServiceIds)
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'crear un servicio nuevo ofrece «¿Generar los turnos de este mes ahora?» y, aceptado, informa cuántos creó',
    cubre('RB-A04', 'RB-A05', 'OD-27', 'P-044'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('genera-mes')
        const sede = await sc.site(cliente.id, 'genera-mes')
        const nombre = uniqueName('servicio-mes')
        const [anio, mes, dia] = sc.today.split('-').map(Number)

        await page.goto(`/admin/servicios/nuevo?cliente=${cliente.id}`)
        await page.getByRole('combobox', { name: 'Sede' }).click()
        await page.getByRole('option', { name: sede.name }).click()
        await page.getByLabel('Nombre').fill(nombre)
        for (const d of [
          'Lunes',
          'Martes',
          'Miércoles',
          'Jueves',
          'Viernes',
          'Sábado',
          'Domingo',
        ]) {
          await page.getByLabel(d).check()
        }
        await page.getByLabel('Desde').first().fill('08:00')
        await page.getByLabel('Hasta').first().fill('12:00')
        await pickDate(page, 'Vigente desde', {
          year: anio,
          month: mes,
          day: dia,
        })
        await page.getByRole('button', { name: 'Crear servicio' }).click()
        await expect(page.getByText('Creamos el servicio.')).toBeVisible()

        const dialogo = page.getByRole('dialog')
        await expect(
          dialogo.getByRole('heading', {
            name: '¿Generar los turnos de este mes ahora?',
          }),
        ).toBeVisible()
        await dialogo.getByRole('button', { name: 'Generar turnos' }).click()
        await expect(
          dialogo.getByRole('heading', { name: 'Turnos generados' }),
        ).toBeVisible()
        await expect(dialogo).toContainText(/Creamos \d+ turnos? de /)

        const { data: creado } = await sc.db
          .from('services')
          .select('id')
          .eq('name', nombre)
          .single()
        sc.extraServiceIds.push(creado!.id)
        const { data: turnos } = await sc.db
          .from('shifts')
          .select('shift_date')
          .eq('service_id', creado!.id)
        expect(turnos?.length).toBeGreaterThan(0)
        // Desde la fecha de inicio (hoy) hasta fin de mes, ni antes ni en otro mes.
        for (const t of turnos ?? []) {
          expect(t.shift_date >= sc.today).toBe(true)
          expect(t.shift_date.slice(0, 7)).toBe(sc.today.slice(0, 7))
        }
        const informado = Number(
          (await dialogo.textContent())?.match(/Creamos (\d+)/)?.[1],
        )
        expect(informado).toBe(turnos?.length)
        await dialogo.getByRole('button', { name: 'Listo' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/admin/clientes/${cliente.id}\\?pestana=servicios`),
        )
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
