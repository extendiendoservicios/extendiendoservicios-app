import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import { addDays, daysFromToday, mondayOf } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P28.7 · OF-10 «Cronograma arrastrable» (pestaña Cronograma del empleado, vista «Semana (editar)»),
// escritorio 1280 px. Mover (arrastre y teclado), estirar, turno de varias personas (diálogo),
// panel de turnos sin cubrir, choque con «Ver turno», «Deshacer» y quién no ve el selector.
// Cuenta de este archivo: empleado3 (y empleado4 como segundo asignado). Todo en la SEMANA
// SIGUIENTE para no depender del día en que corre; el eje arranca a las 06:00 y mide 40 px por hora.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const PX_POR_HORA = 40
const LUNES = mondayOf(daysFromToday(7))
const dia = (n: number) => addDays(LUNES, n)

async function abrirSemana(page: Page, quien: 'empleado3' | 'empleado4') {
  await page.goto(`/admin/empleados/${readId(quien)}?pestana=cronograma`)
  await page.getByRole('radio', { name: 'Semana (editar)' }).click()
  const editor = page.getByTestId('cronograma-semana')
  await expect(editor).toBeVisible()
  await page.getByRole('button', { name: 'Semana siguiente' }).click()
  return editor
}

const bloque = (page: Page, sitio: string) =>
  page
    .getByTestId('bloque')
    .filter({ has: page.getByText(sitio, { exact: true }) })

async function horario(sc: Scenario, turno: string) {
  const { data } = await sc.db
    .from('shifts')
    .select('shift_date, start_time, end_time')
    .eq('id', turno)
    .single()
  return {
    fecha: data!.shift_date,
    inicio: data!.start_time.slice(0, 5),
    fin: data!.end_time.slice(0, 5),
  }
}

test.describe('cronograma semanal editable (OF-10)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'único asignado: el teclado mueve el turno entero, Escape cancela, «Deshacer» lo repone; el borde inferior lo estira',
    cubre('RB-A04', 'RB-A06', 'OF-10', 'CB-02'),
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
        await abrirSemana(page, 'empleado3')
        const b = bloque(page, sede.name)
        await expect(b).toBeVisible()

        await test.step('flechas + Escape: el recuadro cambia pero no se guarda', async () => {
          await b.focus()
          await page.keyboard.press('ArrowDown')
          await page.keyboard.press('ArrowDown')
          await page.keyboard.press('Escape')
          expect(await horario(sc, turno)).toEqual({
            fecha: dia(1),
            inicio: '08:00',
            fin: '10:00',
          })
        })

        await test.step('4 × ↓ + Enter mueve el turno una hora (único asignado: sin diálogo)', async () => {
          await b.focus()
          for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
          await page.keyboard.press('Enter')
          await expect(
            page.getByText('Cambiamos el horario del turno.'),
          ).toBeVisible()
          await expect
            .poll(async () => (await horario(sc, turno)).inicio)
            .toBe('09:00')
          expect((await horario(sc, turno)).fin).toBe('11:00')
        })

        await test.step('«Deshacer» vuelve al horario anterior', async () => {
          await page.getByRole('button', { name: 'Deshacer' }).click()
          await expect(page.getByText('Deshicimos el cambio.')).toBeVisible()
          await expect
            .poll(async () => (await horario(sc, turno)).inicio)
            .toBe('08:00')
          expect((await horario(sc, turno)).fin).toBe('10:00')
        })

        await test.step('→ pasa el turno al día siguiente (mismo horario)', async () => {
          await b.focus()
          await page.keyboard.press('ArrowRight')
          await page.keyboard.press('Enter')
          await expect
            .poll(async () => (await horario(sc, turno)).fecha)
            .toBe(dia(2))
          expect((await horario(sc, turno)).inicio).toBe('08:00')
        })

        await test.step('Mayús + ↓ estira el fin 30 minutos', async () => {
          await page.reload()
          await page.getByRole('radio', { name: 'Semana (editar)' }).click()
          await page.getByRole('button', { name: 'Semana siguiente' }).click()
          const otra = bloque(page, sede.name)
          await otra.focus()
          await page.keyboard.press('Shift+ArrowDown')
          await page.keyboard.press('Shift+ArrowDown')
          await page.keyboard.press('Enter')
          await expect
            .poll(async () => (await horario(sc, turno)).fin)
            .toBe('10:30')
          expect((await horario(sc, turno)).inicio).toBe('08:00')
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'con el mouse: arrastrar el bloque lo mueve y arrastrar el borde inferior cambia el fin; el recuadro muestra el horario resultante',
    cubre('RB-A04', 'OF-10'),
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
        await abrirSemana(page, 'empleado3')
        const b = bloque(page, sede.name)
        await expect(b).toBeVisible()

        await test.step('arrastre vertical de 2 horas (80 px)', async () => {
          const caja = (await b.boundingBox())!
          const x = caja.x + caja.width / 2
          const y = caja.y + caja.height / 2
          await page.mouse.move(x, y)
          await page.mouse.down()
          await page.mouse.move(x, y + 20, { steps: 4 })
          await page.mouse.move(x, y + 2 * PX_POR_HORA, { steps: 8 })
          // Mientras se arrastra, el bloque muestra el horario nuevo.
          await expect(page.getByTestId('bloque').first()).toContainText(
            '10:00',
          )
          await page.mouse.up()
          await expect
            .poll(async () => (await horario(sc, turno)).inicio)
            .toBe('10:00')
          expect((await horario(sc, turno)).fin).toBe('12:00')
        })

        await test.step('arrastre del borde inferior: +1 hora de fin', async () => {
          const borde = page.getByTestId('borde-inferior').first()
          const caja = (await borde.boundingBox())!
          const x = caja.x + caja.width / 2
          const y = caja.y + caja.height / 2
          await page.mouse.move(x, y)
          await page.mouse.down()
          await page.mouse.move(x, y + 10, { steps: 3 })
          await page.mouse.move(x, y + PX_POR_HORA, { steps: 6 })
          await page.mouse.up()
          await expect
            .poll(async () => (await horario(sc, turno)).fin)
            .toBe('13:00')
          expect((await horario(sc, turno)).inicio).toBe('10:00')
        })

        await expectNoHorizontalScroll(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'turno con varias personas: pregunta si mover para todos o pasar solo a una; «Mover para todos» mueve a los dos y «Solo a…» le da horario propio',
    cubre('RB-A04', 'OF-10'),
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
        // La franja propia de empleado3 (08:00–10:00) deja lugar para correrla una hora dentro del
        // turno (08:00–12:00); la de empleado4 es la del turno.
        await sc.assign(turno, 'empleado3', { start: '08:00', end: '10:00' })
        await sc.assign(turno, 'empleado4')
        await abrirSemana(page, 'empleado3')
        const b = bloque(page, sede.name)
        await expect(b).toBeVisible()
        const nombre = nombreDe('empleado3')

        await test.step('el diálogo dice cuántas personas hay y el horario nuevo', async () => {
          await b.focus()
          for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
          await page.keyboard.press('Enter')
          const dialogo = page.getByRole('dialog')
          await expect(
            dialogo.getByRole('heading', {
              name: new RegExp(`¿Mover el turno para todos o pasar solo a`),
            }),
          ).toBeVisible()
          await expect(dialogo).toContainText(
            'El turno tiene 2 personas asignadas',
          )
          await expect(dialogo).toContainText('09:00')
          await dialogo.getByRole('button', { name: 'Cancelar' }).click()
          expect((await horario(sc, turno)).inicio).toBe('08:00')
        })

        await test.step('«Solo a …» con «Mismo turno, con horario propio» deja el turno y cambia solo su franja', async () => {
          await b.focus()
          for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
          await page.keyboard.press('Enter')
          const dialogo = page.getByRole('dialog')
          await dialogo
            .getByRole('button', { name: new RegExp(`^Solo a ${nombre}`) })
            .click()
          await expect(
            page.getByText(`Cambiamos el horario de ${nombre} en este turno.`),
          ).toBeVisible()
          expect(await horario(sc, turno)).toEqual({
            fecha: dia(1),
            inicio: '08:00',
            fin: '12:00',
          })
          const { data } = await sc.db
            .from('assignments')
            .select('start_time, end_time, employee_id')
            .eq('shift_id', turno)
            .eq('employee_id', readId('empleado3'))
            .is('removed_at', null)
            .single()
          expect(data?.start_time?.slice(0, 5)).toBe('09:00')
          expect(data?.end_time?.slice(0, 5)).toBe('11:00')
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'turno de varias personas: «Mover para todos» cambia el turno entero',
    cubre('RB-A04', 'OF-10'),
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
        await abrirSemana(page, 'empleado3')
        const b = bloque(page, sede.name)
        await b.focus()
        for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Mover para todos' })
          .click()
        await expect
          .poll(async () => (await horario(sc, turno)).inicio)
          .toBe('15:00')
        expect((await horario(sc, turno)).fin).toBe('17:00')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'DEF-P28-02: una persona con horario propio distinto del turno y mover el turno entero conserva el horario del turno',
    {
      ...cubre('RB-A04', 'OF-10'),
      annotation: [
        {
          type: 'defecto',
          description:
            'DEF-P28-02: con un solo asignado con franja propia, mover el bloque llama a update_shift_time con el horario del bloque (la franja propia) y achica el turno; ver el reporte de P28.7',
        },
      ],
    },
    async ({ page }) => {
      test.fail()
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
        await abrirSemana(page, 'empleado3')
        const b = bloque(page, sede.name)
        await expect(b).toBeVisible()
        // El bloque dibuja la franja propia (09:00–11:00).
        await expect(b).toContainText('09:00')

        // Mover al día siguiente con el teclado, sin tocar la hora: es mover el turno de día.
        await b.focus()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('Enter')
        await expect
          .poll(async () => (await horario(sc, turno)).fecha)
          .toBe(dia(2))

        // Esperado: el turno conserva su horario (08:00–12:00); solo cambia el día.
        const despues = await horario(sc, turno)
        expect(
          { inicio: despues.inicio, fin: despues.fin },
          'mover el turno de día no debería achicar su horario al de la franja propia del bloque',
        ).toEqual({ inicio: '08:00', fin: '12:00' })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'panel «Turnos sin cubrir»: el botón «Asignar» asigna; un choque dice dónde y ofrece «Ver turno»',
    cubre('RB-A04', 'CB-02', 'OF-08', 'OF-10'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of10s')
        const sedeA = await sc.site(cliente.id, 'of10s-a')
        const sedeB = await sc.site(cliente.id, 'of10s-b')
        const sedeC = await sc.site(cliente.id, 'of10s-c')
        const ocupado = await sc.shift(cliente.id, sedeA.id, dia(1), {
          start: '08:00',
          end: '10:00',
        })
        await sc.assign(ocupado, 'empleado3')
        const libre = await sc.shift(cliente.id, sedeB.id, dia(2), {
          start: '10:00',
          end: '12:00',
        })
        await sc.shift(cliente.id, sedeC.id, dia(3), {
          start: '10:00',
          end: '12:00',
        })
        const choca = await sc.shift(cliente.id, sedeB.id, dia(1), {
          start: '09:00',
          end: '11:00',
        })
        // Ventana muy alta: la grilla (16 h × 40 px) y todo el panel (en App_dev hay muchos turnos sin
        // cubrir esa semana) se ven sin desplazarse, así el mouse llega a cualquier ítem.
        await page.setViewportSize({ width: 1280, height: 1500 })
        await abrirSemana(page, 'empleado3')
        const panel = page.getByRole('complementary', {
          name: 'Turnos sin cubrir de la semana',
        })
        await expect(panel).toBeVisible()

        await test.step('«Asignar» del panel asigna y el bloque aparece en la grilla', async () => {
          const item = panel
            .getByRole('listitem')
            .filter({ hasText: sedeB.name })
            .filter({ hasText: '10:00' })
          await item
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
        })

        // El arrastre desde el panel con el mouse no se automatizó: ver el reporte de P28.7.

        await test.step('un turno que se pisa con otro de la persona: mensaje con el choque y «Ver turno»', async () => {
          const item = panel
            .getByRole('listitem')
            .filter({ hasText: sedeB.name })
            .filter({ hasText: '09:00' })
          await item
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
    'menú del bloque: «Mover o cambiar horario…» (sin arrastre) y «Quitar del turno» con motivo obligatorio',
    cubre('RB-A04', 'OF-10'),
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
        await abrirSemana(page, 'empleado3')
        const opciones = () =>
          page.getByRole('button', {
            name: `Opciones del turno de ${sede.name}`,
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
        await mover
          .getByRole('button', { name: /Mover|Guardar|Confirmar/ })
          .click()
        await expect
          .poll(async () => (await horario(sc, turno)).fin)
          .toBe('11:00')

        await opciones().click()
        await page.getByRole('menuitem', { name: 'Quitar del turno' }).click()
        const quitar = page.getByRole('dialog')
        await expect(quitar).toBeVisible()
        // Sin motivo no se puede confirmar (motivo obligatorio).
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

test.describe('quién ve el selector «Semana (editar)» (OF-10)', () => {
  test.describe('el coordinador no edita el cronograma', () => {
    test.use({ storageState: storageStatePath('supervisor1') })
    test(
      '[supervisor1] la pestaña Cronograma no ofrece «Semana (editar)»',
      cubre('RB-X02', 'CB-17', 'OF-10'),
      async ({ page }) => {
        await page.goto(
          `/admin/empleados/${readId('empleado3')}?pestana=cronograma`,
        )
        await expect(page.getByRole('main')).toBeVisible()
        await expect(
          page.getByRole('radio', { name: 'Semana (editar)' }),
        ).toHaveCount(0)
        await expect(page.getByTestId('cronograma-semana')).toHaveCount(0)
      },
    )
  })

  // `assign_employee`, `move_assignment` y `update_shift_time` son «O, A» sin capacidad propia
  // (06 sección 8): el administrador sin capacidades también edita el cronograma.
  for (const cuenta of ['admin', 'adminSinCapacidades'] as const) {
    test.describe(`administrador (${cuenta})`, () => {
      test.use({ storageState: storageStatePath(cuenta) })
      test(
        `[${cuenta}] la pestaña Cronograma ofrece «Mes» y «Semana (editar)»`,
        cubre('RB-A04', 'OF-10'),
        async ({ page }) => {
          await page.goto(
            `/admin/empleados/${readId('empleado3')}?pestana=cronograma`,
          )
          await expect(page.getByRole('radio', { name: 'Mes' })).toBeVisible()
          await expect(
            page.getByRole('radio', { name: 'Semana (editar)' }),
          ).toBeVisible()
        },
      )
    })
  }
})
