import { expect, test } from '@playwright/test'
import { addDays, daysFromToday } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario, uniqueName } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// P30.5 · Clientes y servicios de P30, escritorio 1280 px:
//   - OH-12 «vigencia hasta» se puede borrar (✕ y «Sin fecha de fin»).
//   - OH-13 la categoría guardada se ve al editar el cliente.
//   - OH-14 las categorías de Clientes se contraen (y se recuerdan); DEF-P30-07 buscador y filtros en una línea.
//   - OH-11 editar el servicio: el último cambio gana (los turnos con horario cambiado a mano se actualizan).
// Todo con datos propios (prefijo `e2e-`); las categorías de la prueba se borran al final.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

/** Categoría propia de la prueba. */
async function categoria(sc: Scenario, slug: string) {
  const nombre = uniqueName(slug)
  const { data, error } = await sc.db
    .from('client_categories')
    .insert({ name: nombre })
    .select('id')
    .single()
  expect(error, error?.message).toBeNull()
  return { id: data!.id, nombre }
}

async function borrarCategorias(sc: Scenario, ids: string[]) {
  // Primero los clientes (la categoría no se puede borrar con clientes).
  expect(await sc.cleanup(), 'limpieza').toEqual([])
  if (ids.length > 0) {
    const { error } = await sc.db
      .from('client_categories')
      .delete()
      .in('id', ids)
    expect(error?.message, 'categorías').toBeUndefined()
  }
}

async function clienteDeCategoria(
  sc: Scenario,
  slug: string,
  categoryId: string,
) {
  const cliente = await sc.client(slug)
  const { error } = await sc.db
    .from('clients')
    .update({ category_id: categoryId })
    .eq('id', cliente.id)
  expect(error, error?.message).toBeNull()
  return cliente
}

test.describe('categoría del cliente al editar (OH-13)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'al editar un cliente con categoría, la casilla muestra la categoría guardada (no queda en blanco) y guardar no la pisa',
    cubre('RB-A02', 'OH-13'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      const categorias: string[] = []
      try {
        const cat = await categoria(sc, 'oh13')
        categorias.push(cat.id)
        const cliente = await clienteDeCategoria(sc, 'oh13', cat.id)

        await page.goto(`/admin/clientes/${cliente.id}/editar`)
        await expect(page.getByLabel('Razón social')).toHaveValue(cliente.name)
        const casilla = page.locator('#client-category')
        await expect(casilla).toHaveText(cat.nombre)

        // Guardar sin tocar la categoría la deja como estaba.
        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        await expect(page.getByText(/Guardamos los cambios/)).toBeVisible()
        const { data } = await sc.db
          .from('clients')
          .select('category_id')
          .eq('id', cliente.id)
          .single()
        expect(data?.category_id).toBe(cat.id)
      } finally {
        await borrarCategorias(sc, categorias)
      }
    },
  )
})

test.describe('Clientes: categorías que se contraen y filtros en una línea (OH-14, DEF-P30-07)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'tocar la categoría contrae y despliega su listado con el número de clientes; se recuerda al recargar; «Contraer todo» y «Desplegar todo»',
    cubre('RB-A02', 'OH-14'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      const categorias: string[] = []
      try {
        const a = await categoria(sc, 'oh14a')
        const b = await categoria(sc, 'oh14b')
        categorias.push(a.id, b.id)
        const ca = await clienteDeCategoria(sc, 'oh14a', a.id)
        await clienteDeCategoria(sc, 'oh14a2', a.id)
        const cb = await clienteDeCategoria(sc, 'oh14b', b.id)
        await page.goto('/admin/clientes?estado=all')
        await page.evaluate(() =>
          localStorage.removeItem('clients:collapsed-categories'),
        )
        await page.reload()

        const grupo = (nombre: string) =>
          page.getByRole('region', { name: nombre })
        const boton = (nombre: string) =>
          grupo(nombre).getByRole('button', { expanded: true }).first()

        await expect(grupo(a.nombre)).toBeVisible()
        await expect(grupo(a.nombre)).toContainText(ca.name)
        await expect(grupo(b.nombre)).toContainText(cb.name)
        // El número de clientes de la categoría va al lado del nombre.
        await expect(grupo(a.nombre).getByRole('button').first()).toContainText(
          '2',
        )

        await test.step('tocar el nombre contrae solo esa categoría', async () => {
          await boton(a.nombre).click()
          await expect(
            grupo(a.nombre).getByRole('button', { expanded: false }),
          ).toBeVisible()
          await expect(grupo(a.nombre).getByRole('table')).toHaveCount(0)
          await expect(grupo(b.nombre).getByRole('table')).toBeVisible()
        })

        await test.step('el estado se recuerda al recargar', async () => {
          await page.reload()
          await expect(
            grupo(a.nombre).getByRole('button', { expanded: false }),
          ).toBeVisible()
          await expect(grupo(a.nombre).getByRole('table')).toHaveCount(0)
        })

        await test.step('tocar de nuevo despliega', async () => {
          await grupo(a.nombre).getByRole('button', { expanded: false }).click()
          await expect(grupo(a.nombre).getByRole('table')).toBeVisible()
        })

        await test.step('«Contraer todo» y «Desplegar todo»', async () => {
          await page.getByRole('button', { name: 'Contraer todo' }).click()
          await expect(grupo(a.nombre).getByRole('table')).toHaveCount(0)
          await expect(grupo(b.nombre).getByRole('table')).toHaveCount(0)
          await expect(
            page.getByRole('button', { name: 'Contraer todo' }),
          ).toBeDisabled()
          await page.getByRole('button', { name: 'Desplegar todo' }).click()
          await expect(grupo(a.nombre).getByRole('table')).toBeVisible()
          await expect(grupo(b.nombre).getByRole('table')).toBeVisible()
        })
      } finally {
        await borrarCategorias(sc, categorias)
      }
    },
  )

  for (const ancho of [1024, 1440]) {
    test(
      `el buscador y los filtros de estado y categoría están en la misma línea a ${ancho} px (DEF-P30-07)`,
      cubre('RB-A02', 'OH-14', 'DEF-P30-07'),
      async ({ page }) => {
        await page.setViewportSize({ width: ancho, height: 900 })
        await page.goto('/admin/clientes')
        const buscador = page.getByPlaceholder('Buscar por nombre o CUIT…')
        const estado = page.getByRole('combobox', {
          name: 'Filtrar por estado',
        })
        const categoriaFiltro = page.getByRole('combobox', {
          name: 'Filtrar por categoría',
        })
        await expect(buscador).toBeVisible()
        await expect(estado).toHaveText(/\S/)
        await expect(categoriaFiltro).toHaveText(/\S/)
        const centro = (caja: { y: number; height: number } | null) =>
          caja!.y + caja!.height / 2
        // Misma línea: los centros verticales coinciden (se espera a que termine de acomodarse).
        await expect
          .poll(async () => {
            const [b, e, c] = await Promise.all(
              [buscador, estado, categoriaFiltro].map((x) => x.boundingBox()),
            )
            return Math.max(
              Math.abs(centro(b) - centro(e)),
              Math.abs(centro(b) - centro(c)),
            )
          })
          .toBeLessThanOrEqual(6)
        const [b, e] = await Promise.all(
          [buscador, estado].map((x) => x.boundingBox()),
        )
        // Los filtros quedan a la derecha del buscador, no debajo.
        expect(e!.x).toBeGreaterThan(b!.x + b!.width - 2)
        // «Contraer todo / Desplegar todo» va en su propia línea, debajo.
        const contraer = await page
          .getByRole('button', { name: 'Contraer todo' })
          .boundingBox()
        expect(contraer!.y).toBeGreaterThan(b!.y + b!.height)
      },
    )
  }
})

test.describe('servicios: «vigencia hasta» borrable y editar gana el último cambio (OH-12, OH-11)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'la ✕ borra la fecha «hasta» y el servicio queda por tiempo indeterminado; «Sin fecha de fin» del calendario también',
    cubre('RB-A04', 'OH-12', 'OH-15'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('oh12')
        const sede = await sc.site(cliente.id, 'oh12')
        const hasta = daysFromToday(90)
        const servicio = await sc.service(cliente.id, sede.id, 'oh12', {
          validTo: hasta,
        })
        const validTo = async () =>
          (
            await sc.db
              .from('services')
              .select('valid_to')
              .eq('id', servicio.id)
              .single()
          ).data?.valid_to

        async function guardar() {
          await page.getByRole('button', { name: 'Guardar cambios' }).click()
          // Sin turnos futuros que cambiar puede no abrir el diálogo de aplicar.
          const aplicar = page.getByRole('dialog', {
            name: /¿Aplicar los cambios a los turnos/,
          })
          const toast = page.getByText('Guardamos los cambios del servicio.')
          await expect(toast).toBeVisible()
          // El diálogo puede cerrarse solo cuando no hay ningún turno para cambiar («Los turnos ya
          // estaban al día»): se lo cierra si sigue ahí y se espera a que no quede.
          if (await aplicar.isVisible()) {
            await aplicar
              .getByRole('button', { name: 'No aplicar' })
              .click({ timeout: 3_000 })
              .catch(() => undefined)
          }
          await expect(aplicar).toBeHidden()
        }

        await page.goto(`/admin/servicios/${servicio.id}/editar`)
        const picker = page.getByRole('button', {
          name: 'Vigente hasta',
          exact: true,
        })
        await expect(picker).toBeVisible()
        await expect(picker).not.toHaveText(/Elegí|Sin fecha|Seleccion/i)
        const borrar = page.getByRole('button', {
          name: 'Borrar la fecha: Vigente hasta',
        })
        await expect(borrar).toBeVisible()

        await test.step('la ✕ vacía la casilla y al guardar queda sin fecha de fin', async () => {
          await borrar.click()
          await expect(borrar).toHaveCount(0)
          await guardar()
          await expect.poll(validTo).toBeNull()
        })

        await test.step('«Sin fecha de fin» dentro del calendario desplegable', async () => {
          await sc.db
            .from('services')
            .update({ valid_to: addDays(hasta, 5) })
            .eq('id', servicio.id)
          await page.goto(`/admin/servicios/${servicio.id}/editar`)
          await page
            .getByRole('button', { name: 'Vigente hasta', exact: true })
            .click()
          await page.getByRole('button', { name: 'Sin fecha de fin' }).click()
          await expect(
            page.getByRole('button', {
              name: 'Borrar la fecha: Vigente hasta',
            }),
          ).toHaveCount(0)
          await guardar()
          await expect.poll(validTo).toBeNull()
        })
      } finally {
        await sc.db
          .from('service_fixed_employees')
          .delete()
          .in('service_id', sc.extraServiceIds)
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'editar el horario del servicio actualiza TODOS los turnos futuros, también los cambiados a mano: la vista previa lo dice y gana el último cambio',
    cubre('RB-A04', 'OH-11', 'P-044'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('oh11')
        const sede = await sc.site(cliente.id, 'oh11')
        const servicio = await sc.service(cliente.id, sede.id, 'oh11', {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          start: '08:00',
          end: '12:00',
          validFrom: daysFromToday(0),
        })
        const turnos: string[] = []
        for (const d of [4, 5, 6]) {
          turnos.push(
            await sc.shift(
              cliente.id,
              sede.id,
              daysFromToday(d),
              { start: '08:00', end: '12:00' },
              1,
              { serviceId: servicio.id },
            ),
          )
        }
        await sc.db.from('shifts').update({ generated: true }).in('id', turnos)
        // El del medio tiene el horario cambiado a mano (antes se conservaba: MANUAL_TIME).
        await sc.db
          .from('shifts')
          .update({ start_time: '09:30:00' })
          .eq('id', turnos[1])

        await page.goto(`/admin/servicios/${servicio.id}/editar`)
        await expect(page.getByLabel('Nombre')).toHaveValue(servicio.name)
        await page.getByLabel('Desde').first().fill('07:00')
        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        const dialogo = page.getByRole('dialog')
        await expect(
          dialogo.getByRole('heading', {
            name: /¿Aplicar los cambios a los turnos desde el/,
          }),
        ).toBeVisible()
        await expect(dialogo).toContainText(
          'Los turnos con cambios a mano en el horario, la dotación o las fotos se actualizan igual: gana el último cambio.',
        )
        await expect(dialogo).toContainText(
          /3 turnos, 1 de ellos tenía cambios a mano que se reemplazan/,
        )
        await dialogo
          .getByRole('button', { name: 'Aplicar', exact: true })
          .click()
        // Se espera el efecto en los turnos, no el diálogo de resultado (ver DEF-P30-10).
        await expect
          .poll(async () => {
            const { data: filas } = await sc.db
              .from('shifts')
              .select('start_time')
              .in('id', turnos)
            return filas?.map((t) => t.start_time.slice(0, 5)).sort()
          })
          .toEqual(['07:00', '07:00', '07:00'])

        const { data } = await sc.db
          .from('shifts')
          .select('id, start_time, end_time')
          .in('id', turnos)
        expect(
          data?.map((t) => t.start_time.slice(0, 5)),
          'los tres turnos, también el cambiado a mano, toman el horario nuevo',
        ).toEqual(['07:00', '07:00', '07:00'])
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'DEF-P30-10: tras «Aplicar» el diálogo muestra el «Resultado» y sigue abierto hasta «Listo», sin el aviso falso de que los turnos ya estaban al día',
    cubre('RB-A04', 'OH-11', 'DEF-P30-10'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('def10')
        const sede = await sc.site(cliente.id, 'def10')
        const servicio = await sc.service(cliente.id, sede.id, 'def10', {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          start: '08:00',
          end: '12:00',
          validFrom: daysFromToday(0),
        })
        const turnos: string[] = []
        for (const d of [4, 5, 6]) {
          turnos.push(
            await sc.shift(
              cliente.id,
              sede.id,
              daysFromToday(d),
              { start: '08:00', end: '12:00' },
              1,
              { serviceId: servicio.id },
            ),
          )
        }
        await sc.db.from('shifts').update({ generated: true }).in('id', turnos)

        await page.goto(`/admin/servicios/${servicio.id}/editar`)
        await expect(page.getByLabel('Nombre')).toHaveValue(servicio.name)
        await page.getByLabel('Dotación').fill('2')
        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        const dialogo = page.getByRole('dialog')
        await expect(
          dialogo.getByRole('heading', {
            name: /¿Aplicar los cambios a los turnos desde el/,
          }),
        ).toBeVisible()
        await expect(dialogo).toContainText(/Se actualizan 3 turnos/)

        // La vista previa se vuelve a pedir después de aplicar (se invalida la consulta).
        const nuevaVistaPrevia = page.waitForResponse(
          (r) => r.url().includes('preview_service_changes'),
          { timeout: 20_000 },
        )
        await dialogo
          .getByRole('button', { name: 'Aplicar', exact: true })
          .click()
        await nuevaVistaPrevia
        await page.evaluate(
          () => new Promise((resolver) => requestAnimationFrame(resolver)),
        )
        await expect(
          dialogo.getByRole('heading', { name: 'Resultado' }),
        ).toBeVisible()
        await expect(
          page.getByText(
            'Los turnos ya estaban al día: no hubo nada para cambiar.',
          ),
        ).toHaveCount(0)
        await dialogo.getByRole('button', { name: 'Listo' }).click()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
