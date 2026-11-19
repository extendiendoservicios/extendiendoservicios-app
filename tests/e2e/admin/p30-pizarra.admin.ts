import { expect, test, type Page } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { limpiarPersona } from '../../fixtures/p30.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P30.5 · OH-07 «Cronograma semanal (pizarra) en la cabecera de la ficha» (`employee_week_boards`,
// `save_employee_week_board`, `employee_fixed_pattern`, 0087), escritorio 1280 px. La primera vez se
// arma con el patrón fijo; se edita (hora, color, día) y se guarda sola en una tabla propia SIN
// tocar turnos ni asignaciones; «Volver a cargar desde los fijos» la rehace con confirmación.
// DEF-P30-09: «Cambiar color» y «Mover a» del menú del bloque tienen que guardar.
// Cuenta de este archivo: empleado2. La limpieza borra su fila de `employee_week_boards`.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

interface BloqueGuardado {
  id: string
  weekday: number
  start: string
  end: string | null
  label: string
  color_index: number | null
  service_id: string | null
}

async function pizarraGuardada(sc: Scenario): Promise<BloqueGuardado[] | null> {
  const { data } = await sc.db
    .from('employee_week_boards')
    .select('blocks')
    .eq('employee_id', readId('empleado2'))
    .maybeSingle()
  return (data?.blocks as unknown as BloqueGuardado[]) ?? null
}

/** Cliente, sede y un servicio con empleado2 como fijo los lunes y miércoles de 09:00 a 11:00. */
async function armarFijos(sc: Scenario) {
  const cliente = await sc.client('piz')
  const sede = await sc.site(cliente.id, 'piz')
  const servicio = await sc.service(cliente.id, sede.id, 'piz', {
    weekdays: [1, 3],
    start: '09:00',
    end: '11:00',
  })
  const { error } = await sc.db
    .from('service_fixed_employees')
    .insert({ service_id: servicio.id, employee_id: readId('empleado2') })
  expect(error, error?.message).toBeNull()
  return { cliente, sede, servicio }
}

const tabla = (page: Page) => page.getByTestId('cronograma-semanal')
const bloques = (page: Page, sede: string) =>
  tabla(page).getByTestId('bloque').filter({ hasText: sede.toUpperCase() })

async function abrirFicha(page: Page) {
  await page.goto(`/admin/empleados/${readId('empleado2')}`)
  await expect(tabla(page)).toBeVisible()
}

async function contarAsignaciones(sc: Scenario) {
  const { data } = await sc.db
    .from('assignments')
    .select('id')
    .eq('employee_id', readId('empleado2'))
    .is('removed_at', null)
  return data?.length ?? 0
}

test.describe('cronograma semanal de la ficha (OH-07)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'la primera vez se arma con el patrón fijo; editar la hora lo guarda en la tabla propia («Editado por…») sin tocar turnos',
    cubre('RB-A05', 'OH-07', 'DEF-P30-05'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const { sede } = await armarFijos(sc)
        const antes = await contarAsignaciones(sc)
        expect(await pizarraGuardada(sc), 'sin pizarra guardada').toBeNull()

        await abrirFicha(page)
        await test.step('armado desde los fijos: lunes y miércoles, sin guardar todavía', async () => {
          await expect(
            tabla(page).getByTestId('columna-1').getByTestId('bloque'),
          ).toContainText(sede.name.toUpperCase())
          await expect(
            tabla(page).getByTestId('columna-3').getByTestId('bloque'),
          ).toContainText(sede.name.toUpperCase())
          await expect(page.getByTestId('cronograma-estado')).toContainText(
            'Armado desde los fijos',
          )
          expect(await pizarraGuardada(sc)).toBeNull()
        })

        await test.step('escribir «0930» en el inicio del lunes: se guarda sola y dice quién y cuándo', async () => {
          const lunes = tabla(page)
            .getByTestId('columna-1')
            .getByTestId('bloque')
          await lunes
            .getByRole('button', { name: /^Hora de inicio de / })
            .click()
          const campo = lunes.getByRole('textbox', {
            name: /^Hora de inicio de /,
          })
          await campo.fill('0930')
          await page.keyboard.press('Enter')
          await expect(page.getByTestId('cronograma-estado')).toContainText(
            /^Editado por .* el /,
          )
          const guardada = await pizarraGuardada(sc)
          expect(guardada).not.toBeNull()
          const delLunes = guardada!.find(
            (b) =>
              b.weekday === 1 && b.label.startsWith(sede.name.toUpperCase()),
          )
          expect(delLunes?.start).toBe('09:30')
          expect(delLunes?.end).toBe('11:00')
          // El miércoles sigue como en el patrón.
          const delMiercoles = guardada!.find((b) => b.weekday === 3)
          expect(delMiercoles?.start).toBe('09:00')
        })

        await test.step('sigue ahí al recargar y NO cambió ningún turno ni asignación', async () => {
          await page.reload()
          await expect(
            bloques(page, sede.name)
              .first()
              .getByRole('button', { name: /^Hora de inicio de / }),
          ).toHaveText('09:30')
          expect(await contarAsignaciones(sc)).toBe(antes)
        })
        await expectNoHorizontalScroll(page)
      } finally {
        // Se cierra la página antes de limpiar: el guardado automático de la pizarra no puede reescribirla.
        await page.close()
        await sc.db
          .from('service_fixed_employees')
          .delete()
          .in('service_id', sc.extraServiceIds)
        expect(
          await limpiarPersona(sc, 'empleado2'),
          'limpieza persona',
        ).toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    '«Cambiar color» y «Mover a» del menú del bloque guardan (DEF-P30-09) y no tocan turnos',
    cubre('RB-A05', 'OH-07', 'DEF-P30-09'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const { sede } = await armarFijos(sc)
        const antes = await contarAsignaciones(sc)
        await abrirFicha(page)
        const lunes = () =>
          tabla(page)
            .getByTestId('columna-1')
            .getByTestId('bloque')
            .filter({ hasText: sede.name.toUpperCase() })

        await test.step('«Cambiar color» → Violeta (índice 1)', async () => {
          await lunes()
            .getByRole('button', { name: /^Opciones del bloque / })
            .click()
          await page.getByRole('menuitem', { name: 'Cambiar color' }).click()
          await page.getByRole('menuitem', { name: 'Violeta' }).click()
          await expect(page.getByTestId('cronograma-estado')).toContainText(
            /^Editado/,
          )
          const guardada = await pizarraGuardada(sc)
          expect(
            guardada!.find(
              (b) =>
                b.weekday === 1 && b.label.startsWith(sede.name.toUpperCase()),
            )?.color_index,
            'el color elegido se guardó',
          ).toBe(1)
        })

        await test.step('«Mover a» → Viernes: el bloque cambia de columna y se guarda', async () => {
          await lunes()
            .getByRole('button', { name: /^Opciones del bloque / })
            .click()
          await page.getByRole('menuitem', { name: 'Mover a' }).click()
          await page.getByRole('menuitem', { name: 'Viernes' }).click()
          await expect(
            tabla(page)
              .getByTestId('columna-5')
              .getByTestId('bloque')
              .filter({ hasText: sede.name.toUpperCase() }),
          ).toHaveCount(1)
          await expect(lunes()).toHaveCount(0)
          await expect
            .poll(async () => {
              const guardada = await pizarraGuardada(sc)
              return guardada?.some(
                (b) => b.weekday === 5 && b.color_index === 1,
              )
            })
            .toBe(true)
        })
        expect(await contarAsignaciones(sc)).toBe(antes)
      } finally {
        // Se cierra la página antes de limpiar: el guardado automático de la pizarra no puede reescribirla.
        await page.close()
        await sc.db
          .from('service_fixed_employees')
          .delete()
          .in('service_id', sc.extraServiceIds)
        expect(
          await limpiarPersona(sc, 'empleado2'),
          'limpieza persona',
        ).toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    '«Volver a cargar desde los fijos» pide confirmar: Cancelar no cambia nada y «Volver a cargar» rehace la pizarra',
    cubre('RB-A05', 'OH-07'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const { sede } = await armarFijos(sc)
        await abrirFicha(page)
        const lunes = tabla(page).getByTestId('columna-1').getByTestId('bloque')
        await lunes.getByRole('button', { name: /^Hora de fin de / }).click()
        await lunes
          .getByRole('textbox', { name: /^Hora de fin de / })
          .fill('1200')
        await page.keyboard.press('Enter')
        await expect(page.getByTestId('cronograma-estado')).toContainText(
          /^Editado/,
        )
        expect(
          (await pizarraGuardada(sc))!.find((b) => b.weekday === 1)?.end,
        ).toBe('12:00')

        await page
          .getByRole('button', { name: 'Volver a cargar desde los fijos' })
          .click()
        const dialogo = page.getByRole('dialog')
        await expect(
          dialogo.getByRole('heading', {
            name: 'Volver a cargar desde los fijos',
          }),
        ).toBeVisible()
        await dialogo.getByRole('button', { name: 'Cancelar' }).click()
        expect(
          (await pizarraGuardada(sc))!.find((b) => b.weekday === 1)?.end,
        ).toBe('12:00')

        await page
          .getByRole('button', { name: 'Volver a cargar desde los fijos' })
          .click()
        await dialogo.getByRole('button', { name: 'Volver a cargar' }).click()
        await expect
          .poll(async () => {
            const guardada = await pizarraGuardada(sc)
            return guardada?.find(
              (b) =>
                b.weekday === 1 && b.label.startsWith(sede.name.toUpperCase()),
            )?.end
          })
          .toBe('11:00')
      } finally {
        // Se cierra la página antes de limpiar: el guardado automático de la pizarra no puede reescribirla.
        await page.close()
        await sc.db
          .from('service_fixed_employees')
          .delete()
          .in('service_id', sc.extraServiceIds)
        expect(
          await limpiarPersona(sc, 'empleado2'),
          'limpieza persona',
        ).toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('quién ve y edita el cronograma semanal (OH-07)', () => {
  for (const cuenta of ['admin', 'adminSinCapacidades'] as const) {
    test.describe(`administrador (${cuenta})`, () => {
      test.use({ storageState: storageStatePath(cuenta) })
      test(
        `[${cuenta}] ve la pizarra y puede editarla (rol «O, A» sin capacidad propia)`,
        cubre('RB-A05', 'OH-07'),
        async ({ page }) => {
          await abrirFicha(page)
          await expect(
            tabla(page).getByRole('button', {
              name: /^Agregar un bloque el lunes/,
            }),
          ).toBeVisible()
        },
      )
    })
  }

  test.describe('el coordinador no la ve', () => {
    test.use({ storageState: storageStatePath('supervisor1') })
    test(
      '[supervisor1] la ficha no muestra el cronograma semanal (la tabla es solo de la dirección y la administración)',
      cubre('RB-X02', 'CB-17', 'OH-07'),
      async ({ page }) => {
        await page.goto(`/admin/empleados/${readId('empleado2')}`)
        await expect(page.getByRole('main')).toBeVisible()
        await expect(page.getByTestId('cronograma-semanal')).toHaveCount(0)
      },
    )
  })
})
