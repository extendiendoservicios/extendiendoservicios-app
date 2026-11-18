import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import { addDays } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  abrirCalendario,
  bloqueDe,
  fechaDeMes,
  horarioDe,
} from '../../fixtures/p30.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P28.7 · OF-10 «Cronograma arrastrable», llevado en P30 al calendario mensual editable (OH-04,
// OH-05): pestaña «Calendario» de la ficha del empleado, escritorio 1280 px. La vista «Semana
// (editar)» desapareció: el mes es editable. Se prueba escribir la hora en el bloque, mover a otro
// día (arrastre y menú), turno de varias personas (diálogo), panel de turnos sin cubrir, choque con
// «Ver turno», «Deshacer» y quién edita.
// Cuenta de este archivo: empleado3 (y empleado4 como segundo asignado). Todo en un mes futuro,
// en días 3 a 24, para no depender del día en que corre.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const BASE = fechaDeMes(8)
const dia = (n: number) => addDays(BASE, n)

/** Escribe la hora del extremo del bloque con el teclado y confirma con Enter. */
async function escribirHora(
  page: Page,
  bloque: ReturnType<typeof bloqueDe>,
  extremo: 'inicio' | 'fin',
  texto: string,
) {
  await bloque
    .getByRole('button', {
      name: new RegExp(`^Hora de ${extremo} del turno de`),
    })
    .click()
  const campo = bloque.getByRole('textbox', {
    name: new RegExp(`^Hora de ${extremo} del turno de`),
  })
  await expect(campo).toBeFocused()
  await campo.fill(texto)
  await page.keyboard.press('Enter')
}

test.describe('calendario mensual editable (OF-10, OH-05)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'único asignado: escribir «0830» cambia el turno entero sin diálogo, Escape cancela y «Deshacer» lo repone (DEF-P30-04, DEF-P30-05)',
    cubre(
      'RB-A04',
      'RB-A06',
      'OF-10',
      'OH-05',
      'DEF-P30-04',
      'DEF-P30-05',
      'CB-02',
    ),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of10a')
        const sede = await sc.site(cliente.id, 'of10a')
        const turno = await sc.shift(cliente.id, sede.id, dia(1), {
          start: '08:00',
          end: '10:00',
        })
        await sc.assign(turno, 'empleado3')
        await abrirCalendario(page, 'empleado3', dia(1))
        const b = bloqueDe(page, sede.name)
        await expect(b).toBeVisible()

        await test.step('escribir y Escape: la casilla vuelve a la hora anterior y no se guarda', async () => {
          await b
            .getByRole('button', { name: /^Hora de inicio del turno de/ })
            .click()
          const campo = b.getByRole('textbox', {
            name: /^Hora de inicio del turno de/,
          })
          await campo.fill('0900')
          await page.keyboard.press('Escape')
          await expect(
            b.getByRole('button', { name: /^Hora de inicio del turno de/ }),
          ).toHaveText('08:00')
          expect(await horarioDe(sc, turno)).toEqual({
            fecha: dia(1),
            inicio: '08:00',
            fin: '10:00',
          })
        })

        await test.step('«0830» + Enter cambia el inicio del turno (único asignado: sin diálogo)', async () => {
          await escribirHora(page, b, 'inicio', '0830')
          await expect(
            page.getByText('Cambiamos el horario del turno.'),
          ).toBeVisible()
          await expect
            .poll(async () => (await horarioDe(sc, turno)).inicio)
            .toBe('08:30')
          expect((await horarioDe(sc, turno)).fin).toBe('10:00')
        })

        await test.step('«Deshacer» vuelve a 08:00', async () => {
          await page.getByRole('button', { name: 'Deshacer' }).click()
          await expect(page.getByText('Deshicimos el cambio.')).toBeVisible()
          await expect
            .poll(async () => (await horarioDe(sc, turno)).inicio)
            .toBe('08:00')
          expect((await horarioDe(sc, turno)).fin).toBe('10:00')
        })

        await test.step('el fin se escribe igual; un inicio posterior al fin se rechaza sin guardar', async () => {
          await escribirHora(page, b, 'fin', '1100')
          await expect
            .poll(async () => (await horarioDe(sc, turno)).fin)
            .toBe('11:00')
          await escribirHora(page, b, 'inicio', '1200')
          await expect(
            page.getByText(
              'La hora de inicio tiene que ser anterior a la de fin.',
            ),
          ).toBeVisible()
          expect((await horarioDe(sc, turno)).inicio).toBe('08:00')
        })
        await expectNoHorizontalScroll(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'con el mouse: arrastrar el bloque a otro día lo mueve y conserva el horario; «Deshacer» lo devuelve',
    cubre('RB-A04', 'OF-10', 'OH-05'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of10m')
        const sede = await sc.site(cliente.id, 'of10m')
        const turno = await sc.shift(cliente.id, sede.id, dia(3), {
          start: '08:00',
          end: '10:00',
        })
        await sc.assign(turno, 'empleado3')
        await abrirCalendario(page, 'empleado3', dia(3))
        const b = bloqueDe(page, sede.name)
        await expect(b).toBeVisible()

        // El mouse solo llega a lo que se ve: el bloque al centro de la ventana.
        await b.evaluate((el) => el.scrollIntoView({ block: 'center' }))
        const origen = (await b.boundingBox())!
        const destino = (await page.getByTestId(`dia-${dia(2)}`).boundingBox())!
        const x0 = origen.x + origen.width / 2
        const y0 = origen.y + origen.height - 4
        await page.mouse.move(x0, y0)
        await page.mouse.down()
        await page.mouse.move(x0 - 15, y0, { steps: 4 })
        await page.mouse.move(destino.x + destino.width / 2, destino.y + 40, {
          steps: 10,
        })
        // Mientras se arrastra, el día de destino se marca.
        await expect(page.getByTestId(`dia-${dia(2)}`)).toHaveAttribute(
          'data-drop-target',
          'true',
        )
        await page.mouse.up()
        await expect
          .poll(async () => (await horarioDe(sc, turno)).fecha)
          .toBe(dia(2))
        const despues = await horarioDe(sc, turno)
        expect([despues.inicio, despues.fin]).toEqual(['08:00', '10:00'])

        await page.getByRole('button', { name: 'Deshacer' }).click()
        await expect(page.getByText('Deshicimos el cambio.')).toBeVisible()
        await expect
          .poll(async () => (await horarioDe(sc, turno)).fecha)
          .toBe(dia(3))
        await expectNoHorizontalScroll(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'turno con varias personas: pregunta si cambiar para todos o solo a una; «Solo a…» con horario propio',
    cubre('RB-A04', 'OF-10', 'OH-05'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of10v')
        const sede = await sc.site(cliente.id, 'of10v')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          dia(1),
          { start: '08:00', end: '12:00' },
          2,
        )
        await sc.assign(turno, 'empleado3', { start: '08:00', end: '10:00' })
        await sc.assign(turno, 'empleado4')
        await abrirCalendario(page, 'empleado3', dia(1))
        const b = bloqueDe(page, sede.name)
        await expect(b).toBeVisible()
        const nombre = nombreDe('empleado3')

        await test.step('el diálogo dice cuántas personas hay y el horario nuevo; Cancelar no cambia nada', async () => {
          await escribirHora(page, b, 'inicio', '0900')
          const dialogo = page.getByRole('dialog')
          await expect(
            dialogo.getByRole('heading', {
              name: /¿Mover el turno para todos o pasar solo a/,
            }),
          ).toBeVisible()
          await expect(dialogo).toContainText(
            'El turno tiene 2 personas asignadas',
          )
          await expect(dialogo).toContainText('09:00')
          await dialogo.getByRole('button', { name: 'Cancelar' }).click()
          expect((await horarioDe(sc, turno)).inicio).toBe('08:00')
        })

        await test.step('«Solo a …» con «Mismo turno, con horario propio» cambia solo su franja', async () => {
          await escribirHora(page, b, 'inicio', '0900')
          await page
            .getByRole('dialog')
            .getByRole('button', { name: new RegExp(`^Solo a ${nombre}`) })
            .click()
          await expect(
            page.getByText(`Cambiamos el horario de ${nombre} en este turno.`),
          ).toBeVisible()
          expect(await horarioDe(sc, turno)).toEqual({
            fecha: dia(1),
            inicio: '08:00',
            fin: '12:00',
          })
          const { data } = await sc.db
            .from('assignments')
            .select('start_time, end_time')
            .eq('shift_id', turno)
            .eq('employee_id', readId('empleado3'))
            .is('removed_at', null)
            .single()
          expect(data?.start_time?.slice(0, 5)).toBe('09:00')
          expect(data?.end_time?.slice(0, 5)).toBe('10:00')
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'turno de varias personas: «Mover para todos» cambia el turno entero',
    cubre('RB-A04', 'OF-10', 'OH-05'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of10t')
        const sede = await sc.site(cliente.id, 'of10t')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          dia(2),
          { start: '14:00', end: '16:00' },
          2,
        )
        await sc.assign(turno, 'empleado3')
        await sc.assign(turno, 'empleado4')
        await abrirCalendario(page, 'empleado3', dia(2))
        await escribirHora(page, bloqueDe(page, sede.name), 'fin', '1700')
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Mover para todos' })
          .click()
        await expect
          .poll(async () => (await horarioDe(sc, turno)).fin)
          .toBe('17:00')
        expect((await horarioDe(sc, turno)).inicio).toBe('14:00')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'DEF-P28-02: una persona con horario propio distinto del turno y mover el turno entero de día conserva el horario del turno',
    cubre('RB-A04', 'OF-10', 'OH-05'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of10p')
        const sede = await sc.site(cliente.id, 'of10p')
        // Turno 08:00–12:00 con UN solo asignado que tiene franja propia 09:00–11:00.
        const turno = await sc.shift(cliente.id, sede.id, dia(1), {
          start: '08:00',
          end: '12:00',
        })
        await sc.assign(turno, 'empleado3', { start: '09:00', end: '11:00' })
        await abrirCalendario(page, 'empleado3', dia(1))
        const b = bloqueDe(page, sede.name)
        await expect(b).toBeVisible()
        // El bloque dibuja la franja propia (09:00–11:00).
        await expect(b).toContainText('09:00')

        // Mover al día siguiente con el menú, sin tocar la hora: es mover el turno de día.
        await b.getByRole('button', { name: /^Opciones del turno de/ }).click()
        await page
          .getByRole('menuitem', { name: 'Mover o cambiar horario…' })
          .click()
        const mover = page.getByRole('dialog', {
          name: 'Mover o cambiar horario',
        })
        await mover.getByRole('combobox', { name: 'Día' }).click()
        await page
          // El día se muestra como «lun 7 dic».
          .getByRole('option', {
            name: new RegExp(`\\b${Number(dia(2).slice(8))} `),
          })
          .first()
          .click()
        await mover.getByRole('button', { name: 'Mover' }).click()
        await expect
          .poll(async () => (await horarioDe(sc, turno)).fecha)
          .toBe(dia(2))

        // Esperado: el turno conserva su horario (08:00–12:00); solo cambia el día.
        const despues = await horarioDe(sc, turno)
        expect(
          { inicio: despues.inicio, fin: despues.fin },
          'mover el turno de día no debería achicar su horario al de la franja propia del bloque',
        ).toEqual({ inicio: '08:00', fin: '12:00' })
        const { data } = await sc.db
          .from('assignments')
          .select('start_time, end_time')
          .eq('shift_id', turno)
          .is('removed_at', null)
        expect(data).toEqual([{ start_time: '09:00:00', end_time: '11:00:00' }])
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'panel «Turnos sin cubrir»: el botón «Asignar» asigna; un choque dice dónde y ofrece «Ver turno»',
    cubre('RB-A04', 'CB-02', 'OF-08', 'OF-10', 'OH-05'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of10s')
        const sedeA = await sc.site(cliente.id, 'of10s-a')
        const sedeB = await sc.site(cliente.id, 'of10s-b')
        const ocupado = await sc.shift(cliente.id, sedeA.id, dia(1), {
          start: '08:00',
          end: '10:00',
        })
        await sc.assign(ocupado, 'empleado3')
        const libre = await sc.shift(cliente.id, sedeB.id, dia(2), {
          start: '10:00',
          end: '12:00',
        })
        const choca = await sc.shift(cliente.id, sedeB.id, dia(1), {
          start: '09:00',
          end: '11:00',
        })
        await abrirCalendario(page, 'empleado3', dia(1))
        const panel = page.getByRole('complementary', {
          name: 'Turnos sin cubrir del mes',
        })
        await expect(panel).toBeVisible()
        // En 1280 px el panel va al costado y desplegado; se filtra por la sede de la prueba.
        await panel.getByLabel('Buscar por sede o cliente').fill(sedeB.name)

        await test.step('«Asignar» del panel asigna y el bloque aparece en el calendario', async () => {
          await panel
            .getByRole('listitem')
            .filter({ hasText: '10:00' })
            .getByRole('button', { name: /^Asignar el turno de/ })
            .click()
          await expect(
            page.getByText(/^Asignamos a .* al turno\.$/),
          ).toBeVisible()
          await expect
            .poll(async () => {
              const { data } = await sc.db
                .from('assignments')
                .select('id')
                .eq('shift_id', libre)
                .is('removed_at', null)
              return data?.length
            })
            .toBe(1)
          await expect(
            page.getByTestId(`dia-${dia(2)}`).getByTestId('turno'),
          ).toBeVisible()
        })

        await test.step('un turno que se pisa con otro de la persona: mensaje con el choque y «Ver turno»', async () => {
          await panel
            .getByRole('listitem')
            .filter({ hasText: '09:00' })
            .getByRole('button', { name: /^Asignar el turno de/ })
            .click()
          await expect(
            page.getByText(/ya está en .* de 08:00 a 10:00/),
          ).toBeVisible()
          const ver = page.getByRole('button', { name: 'Ver turno' })
          await expect(ver).toBeVisible()
          const { data } = await sc.db
            .from('assignments')
            .select('id')
            .eq('shift_id', choca)
            .is('removed_at', null)
          expect(data).toHaveLength(0)
          await ver.click()
          await expect(page).toHaveURL(new RegExp(`/admin/turnos/${ocupado}`))
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'panel «Turnos sin cubrir»: se filtra por texto y el arrastre con el mouse hasta el calendario asigna sin seleccionar texto (DEF-P28-03)',
    cubre('RB-A04', 'OF-10', 'OH-05'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of10d')
        const sede = await sc.site(cliente.id, 'of10d')
        const turno = await sc.shift(cliente.id, sede.id, dia(2), {
          start: '10:00',
          end: '12:00',
        })
        await page.setViewportSize({ width: 1440, height: 1000 })
        await abrirCalendario(page, 'empleado3', dia(2))
        const panel = page.getByRole('complementary', {
          name: 'Turnos sin cubrir del mes',
        })
        await expect(panel).toBeVisible()
        await panel.getByLabel('Buscar por sede o cliente').fill(sede.name)
        const item = panel.getByRole('listitem')
        await expect(item).toHaveCount(1)
        await expect(item).toContainText(sede.name)

        const origen = (await item.boundingBox())!
        const celda = (await page.getByTestId(`dia-${dia(2)}`).boundingBox())!
        await page.mouse.move(origen.x + 40, origen.y + 15)
        await page.mouse.down()
        await page.mouse.move(origen.x - 60, origen.y + 60, { steps: 5 })
        await page.mouse.move(celda.x + 30, celda.y + 40, { steps: 10 })
        expect(
          await page.evaluate(() => window.getSelection()?.toString() ?? ''),
        ).toBe('')
        await page.mouse.up()
        await expect
          .poll(async () => {
            const { data } = await sc.db
              .from('assignments')
              .select('id')
              .eq('shift_id', turno)
              .is('removed_at', null)
            return data?.length
          })
          .toBe(1)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'menú del bloque: «Mover o cambiar horario…» (sin arrastre) y «Quitar de este turno» con motivo obligatorio',
    cubre('RB-A04', 'OF-10', 'OH-05'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of10menu')
        const sede = await sc.site(cliente.id, 'of10menu')
        const turno = await sc.shift(cliente.id, sede.id, dia(1), {
          start: '08:00',
          end: '10:00',
        })
        const asignacion = await sc.assign(turno, 'empleado3')
        await abrirCalendario(page, 'empleado3', dia(1))
        const opciones = () =>
          bloqueDe(page, sede.name).getByRole('button', {
            name: /^Opciones del turno de/,
          })

        await opciones().click()
        await page
          .getByRole('menuitem', { name: 'Mover o cambiar horario…' })
          .click()
        const mover = page.getByRole('dialog', {
          name: 'Mover o cambiar horario',
        })
        await expect(mover).toBeVisible()
        await mover.getByLabel('Hasta').fill('11:00')
        await mover.getByRole('button', { name: 'Mover' }).click()
        await expect
          .poll(async () => (await horarioDe(sc, turno)).fin)
          .toBe('11:00')

        await opciones().click()
        await page
          .getByRole('menuitem', { name: 'Quitar de este turno' })
          .click()
        const quitar = page.getByRole('dialog')
        await expect(quitar).toBeVisible()
        await expect(
          quitar.getByRole('button', { name: /Quitar/ }),
        ).toBeDisabled()
        const { data: sigue } = await sc.db
          .from('assignments')
          .select('removed_at')
          .eq('id', asignacion)
          .single()
        expect(sigue?.removed_at).toBeNull()
        await quitar.getByLabel(/Motivo/).fill('e2e p28: motivo')
        await quitar.getByRole('button', { name: /Quitar/ }).click()
        await expect
          .poll(async () => {
            const { data } = await sc.db
              .from('assignments')
              .select('removed_at')
              .eq('id', asignacion)
              .single()
            return data?.removed_at != null
          })
          .toBe(true)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('quién edita el calendario del empleado (OF-10, OH-05)', () => {
  test.describe('el coordinador no edita', () => {
    test.use({ storageState: storageStatePath('supervisor1') })
    test(
      '[supervisor1] la pestaña «Calendario» (si la ve) no ofrece casillas editables ni el panel de sin cubrir',
      cubre('RB-X02', 'CB-17', 'OF-10', 'OH-05'),
      async ({ page }) => {
        await page.goto(
          `/admin/empleados/${readId('empleado3')}?pestana=calendario`,
        )
        await expect(page.getByRole('main')).toBeVisible()
        await expect(
          page.getByRole('button', { name: /^Hora de inicio del turno de/ }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('complementary', {
            name: 'Turnos sin cubrir del mes',
          }),
        ).toHaveCount(0)
      },
    )
  })

  // `assign_employee`, `move_assignment` y `update_shift_time` son «O, A» sin capacidad propia
  // (06 sección 8): el administrador sin capacidades también edita el calendario.
  for (const cuenta of ['admin', 'adminSinCapacidades'] as const) {
    test.describe(`administrador (${cuenta})`, () => {
      test.use({ storageState: storageStatePath(cuenta) })
      test(
        `[${cuenta}] la pestaña «Calendario» ofrece el panel de turnos sin cubrir (edición habilitada)`,
        cubre('RB-A04', 'OF-10', 'OH-05'),
        async ({ page }) => {
          await page.goto(
            `/admin/empleados/${readId('empleado3')}?pestana=calendario`,
          )
          await expect(page.getByTestId('calendario-mes')).toBeVisible()
          await expect(
            page.getByRole('complementary', {
              name: 'Turnos sin cubrir del mes',
            }),
          ).toBeVisible()
        },
      )
    })
  }

  test.describe('alias de URL (OH-04)', () => {
    test.use({ storageState: storageStatePath('owner') })
    test(
      '«?pestana=cronograma» abre la pestaña «Calendario»; ya no existe «Semana (editar)»',
      cubre('RB-A05', 'OH-04'),
      async ({ page }) => {
        await page.goto(
          `/admin/empleados/${readId('empleado3')}?pestana=cronograma`,
        )
        await expect(
          page.getByRole('tab', { name: 'Calendario', selected: true }),
        ).toBeVisible()
        await expect(page.getByTestId('calendario-mes')).toBeVisible()
        await expect(
          page.getByRole('radio', { name: 'Semana (editar)' }),
        ).toHaveCount(0)
        await expect(page.getByRole('tab', { name: 'Cronograma' })).toHaveCount(
          0,
        )
      },
    )
  })
})
