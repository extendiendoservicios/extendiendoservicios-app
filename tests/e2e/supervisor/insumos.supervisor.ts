import { expect, test, type Page } from '@playwright/test'
import { daysFromToday } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { getAdminDb } from '../../fixtures/accounts.ts'
import { FRANJAS_MOVIL } from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { InsumosE2e } from '../../fixtures/stock.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P25.5c (módulo E, Insumos y control de stock): el coordinador en el celular (390 px). Ve TODOS
// los turnos de hoy y de los próximos 7 días con «Mis sedes» primero (IS-28, CJ-25), retira para un
// turno que no es suyo o por sede con observación obligatoria, avisa un faltante, mira «Mis retiros»
// y «Mis avisos», y entra al retiro con el turno ya elegido desde el detalle de SUP-03.
// Cuenta: `supervisor1`.
//
// Todo lo que crea lleva el prefijo `e2e-sup-` (insumos) y se borra al final de cada test.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('supervisor1') })

const ins = new InsumosE2e('sup')

async function limpiar(sc: Scenario | null): Promise<void> {
  const notas = await ins.purgar()
  if (sc) notas.push(...(await sc.cleanup()))
  if (notas.length > 0)
    console.warn(`[insumos coordinador] ${notas.join(' | ')}`)
}

/** Posición vertical de un elemento en la página (para comprobar el orden en que se ven). */
async function arriba(locator: ReturnType<Page['locator']>): Promise<number> {
  const caja = await locator.boundingBox()
  if (!caja) throw new Error('El elemento no tiene caja (no está visible).')
  return caja.y
}

test.describe('Insumos del coordinador en el celular', () => {
  test.afterAll(async () => {
    await limpiar(null)
  })

  test(
    'retiro del coordinador: ve todos los turnos, con «Mis sedes» primero; retira para uno que no es suyo y queda a su nombre (IS-12, IS-28, CJ-25)',
    cubre('IS-11', 'IS-12', 'IS-28', 'CJ-25'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'retiro', stock: 8 })
        const preferido = await sc.client('insumos-sup-pref')
        const sedePreferida = await sc.site(preferido.id, 'pref')
        const turnoPreferido = await sc.shift(
          preferido.id,
          sedePreferida.id,
          daysFromToday(1),
          FRANJAS_MOVIL.diaCompleto,
        )
        const otro = await sc.client('insumos-sup-otro')
        const sedeOtra = await sc.site(otro.id, 'otra')
        const turnoOtro = await sc.shift(
          otro.id,
          sedeOtra.id,
          daysFromToday(2),
          FRANJAS_MOVIL.diaCompleto,
        )
        // Nadie está asignado: el coordinador igual los ve todos.
        await sc.prioridad('supervisor1', { clientId: preferido.id })

        await page.goto('/sup/insumos/retirar')
        await page.getByLabel('Buscar por cliente o sede').fill('insumos-sup')

        await test.step('«Mis sedes» (la preferida) va antes que «Otras sedes»', async () => {
          const mis = page.getByText('Mis sedes', { exact: true })
          const otras = page.getByText('Otras sedes', { exact: true })
          const delPreferido = page.getByRole('radio', {
            name: new RegExp(preferido.name),
          })
          const delOtro = page.getByRole('radio', {
            name: new RegExp(otro.name),
          })
          await expect(mis).toBeVisible()
          await expect(otras).toBeVisible()
          await expect(delPreferido).toBeVisible()
          await expect(delOtro).toBeVisible()
          const [yMis, yPreferido, yOtras, yOtro] = [
            await arriba(mis),
            await arriba(delPreferido),
            await arriba(otras),
            await arriba(delOtro),
          ]
          expect(yMis).toBeLessThan(yPreferido)
          expect(yPreferido).toBeLessThan(yOtras)
          expect(yOtras).toBeLessThan(yOtro)
          await expectNoHorizontalScroll(page)
        })

        await test.step('elige el turno de «Otras sedes» (no es de su preferencia ni suyo) y retira', async () => {
          await page.getByRole('radio', { name: new RegExp(otro.name) }).click()
          await page.getByRole('button', { name: 'Continuar' }).click()
          await page.getByLabel('Buscar insumos').fill(articulo.code)
          await page
            .getByRole('button', { name: `Agregar ${articulo.name}` })
            .click()
          await page
            .getByRole('button', {
              name: `Sumar una unidad de ${articulo.name}`,
            })
            .click()
          await page
            .getByRole('button', { name: /^Revisar retiro \(2 u\.\)/ })
            .click()
          await page.getByRole('button', { name: 'Confirmar retiro' }).click()
          await expect(page.getByText(/Retiro registrado el /)).toBeVisible()
        })

        expect(await ins.stock(articulo.id)).toBe(6)
        const { data } = await getAdminDb()
          .from('stock_movements')
          .select('kind, person_id, recorded_by, shift_id, site_id')
          .eq('shift_id', turnoOtro)
          .single()
        expect(data).toEqual({
          kind: 'withdrawal',
          person_id: readId('supervisor1'),
          recorded_by: readId('supervisor1'),
          shift_id: turnoOtro,
          site_id: sedeOtra.id,
        })
        expect(turnoPreferido).toBeTruthy()

        await test.step('aparece en «Mis retiros»', async () => {
          await page.getByRole('button', { name: 'Volver a Insumos' }).click()
          await expect(page).toHaveURL(/\/sup\/insumos$/)
          await page.getByRole('radio', { name: 'Mis retiros' }).click()
          await expect(
            page
              .getByRole('list', { name: 'Mis retiros' })
              .locator('li')
              .filter({ hasText: otro.name }),
          ).toContainText(`2 × ${articulo.name}`)
        })
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'retiro por sede: el coordinador ve todas las sedes (las preferidas primero) y la observación es obligatoria (IS-12, IS-28)',
    cubre('IS-12', 'IS-28', 'CJ-25'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'por-sede', stock: 5 })
        const preferido = await sc.client('insumos-sup-sede-pref')
        const sedePreferida = await sc.site(preferido.id, 'pref')
        const otro = await sc.client('insumos-sup-sede-otra')
        const sedeOtra = await sc.site(otro.id, 'otra')
        await sc.prioridad('supervisor1', { siteId: sedePreferida.id })

        await page.goto('/sup/insumos/retirar')
        await page.getByRole('radio', { name: 'Una sede' }).click()
        await page
          .getByLabel('Buscar por cliente o sede')
          .fill('insumos-sup-sede')
        await expect(page.getByText('Mis sedes', { exact: true })).toBeVisible()
        await expect(
          page.getByText('Otras sedes', { exact: true }),
        ).toBeVisible()
        const delPreferido = page.getByRole('radio', {
          name: new RegExp(sedePreferida.name),
        })
        const delOtro = page.getByRole('radio', {
          name: new RegExp(sedeOtra.name),
        })
        expect(await arriba(delPreferido)).toBeLessThan(await arriba(delOtro))

        await delOtro.click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(
          page.getByText(
            'Contanos para qué es: la observación es obligatoria.',
          ),
        ).toBeVisible()
        await page
          .getByLabel('Observación del retiro')
          .fill(ins.texto('reposición de la semana'))
        await page.getByRole('button', { name: 'Continuar' }).click()
        await page.getByLabel('Buscar insumos').fill(articulo.code)
        await page
          .getByRole('button', { name: `Agregar ${articulo.name}` })
          .click()
        await page.getByRole('button', { name: /^Revisar retiro/ }).click()
        await page.getByRole('button', { name: 'Confirmar retiro' }).click()
        await expect(page.getByText(/Retiro registrado el /)).toBeVisible()
        expect(await ins.stock(articulo.id)).toBe(4)
        const { data } = await getAdminDb()
          .from('stock_movements')
          .select('shift_id, site_id, person_id, note')
          .eq('site_id', sedeOtra.id)
          .single()
        expect(data).toEqual({
          shift_id: null,
          site_id: sedeOtra.id,
          person_id: readId('supervisor1'),
          note: ins.texto('reposición de la semana'),
        })
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'atajo desde el detalle del turno (SUP-03): «Retirar insumos» entra con el turno ya elegido (IS-28)',
    cubre('IS-28'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'atajo', stock: 3 })
        const cliente = await sc.client('insumos-sup-atajo')
        const sede = await sc.site(cliente.id, 'atajo')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        await page.goto(`/sup/turnos/${turno}`)
        await expect(page.getByText(cliente.name).first()).toBeVisible()
        await page.getByRole('link', { name: 'Retirar insumos' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/sup/insumos/retirar\\?turno=${turno}$`),
        )
        await page.getByLabel('Buscar insumos').fill(articulo.code)
        await page
          .getByRole('button', { name: `Agregar ${articulo.name}` })
          .click()
        await page.getByRole('button', { name: /^Revisar retiro/ }).click()
        await page.getByRole('button', { name: 'Confirmar retiro' }).click()
        await expect(page.getByText(/Retiro registrado el /)).toBeVisible()
        expect(await ins.stock(articulo.id)).toBe(2)
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'aviso de faltante del coordinador: de una sede cualquiera, con comentario; «Mis avisos» lo muestra Abierto y después Resuelto (IS-14, IS-29)',
    cubre('IS-14', 'IS-29'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'falta', stock: 1 })
        const cliente = await sc.client('insumos-sup-falta')
        const sede = await sc.site(cliente.id, 'falta')

        await page.goto('/sup/insumos/faltante')
        await page.getByLabel('Buscar insumos').fill(articulo.code)
        await page
          .getByRole('button', { name: new RegExp(articulo.name) })
          .click()
        await page.getByRole('radio', { name: 'Una sede' }).click()
        await page.getByLabel('Buscar por cliente o sede').fill(cliente.name)
        await page.getByRole('radio', { name: new RegExp(sede.name) }).click()
        await page
          .getByLabel('Comentario')
          .fill(ins.texto('queda un solo envase'))
        await page.getByRole('button', { name: 'Enviar aviso' }).click()
        await expect(
          page.getByText(`Avisaste que falta: ${articulo.name}`),
        ).toBeVisible()

        await page.getByRole('button', { name: 'Volver a Insumos' }).click()
        await page.getByRole('radio', { name: 'Mis avisos' }).click()
        const tarjeta = page
          .getByRole('list', { name: 'Mis avisos' })
          .locator('li')
          .filter({ hasText: articulo.name })
        await expect(tarjeta).toContainText('Abierto')
        await expect(tarjeta).toContainText(cliente.name)
        await expect(tarjeta).toContainText('queda un solo envase')

        const { data } = await getAdminDb()
          .from('supply_shortage_reports')
          .select('id, reported_by, site_id, status')
          .eq('supply_id', articulo.id)
          .single()
        expect(data).toMatchObject({
          reported_by: readId('supervisor1'),
          site_id: sede.id,
          status: 'open',
        })
        const dueno = await sessionClient('owner')
        const r = await dueno.rpc('resolve_supply_shortage', {
          p_report_id: data?.id ?? '',
          p_note: 'Hay en el depósito',
        })
        expect(r.error?.message).toBeUndefined()
        await page.reload()
        await page.getByRole('radio', { name: 'Mis avisos' }).click()
        await expect(
          page
            .getByRole('list', { name: 'Mis avisos' })
            .locator('li')
            .filter({ hasText: articulo.name }),
        ).toContainText('Respuesta: Hay en el depósito')
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'el catálogo del coordinador no muestra cantidades ni precios, marca «Sin stock» y la barra de abajo es Hoy, Supervisiones, Insumos, Historial, Más (IS-20, IS-33)',
    cubre('IS-20', 'IS-33'),
    async ({ page }) => {
      try {
        const agotado = await ins.insumo({ slug: 'agotado', stock: 0 })
        const conStock = await ins.insumo({
          slug: 'con-stock',
          stock: 7,
          cost: 321,
          sale: 456,
        })
        await page.goto('/sup/insumos')
        // Antes de escribir: con un campo en foco la barra se oculta (teclado abierto, RESP-008).
        const barra = page.getByRole('navigation')
        for (const nombre of [
          'Hoy',
          'Supervisiones',
          'Insumos',
          'Historial',
          'Más',
        ]) {
          await expect(barra.getByRole('link', { name: nombre })).toBeVisible()
        }
        await page.getByLabel('Buscar insumos').fill(ins.prefijo)
        const fila = (nombre: string) =>
          page.locator('li').filter({ hasText: nombre })
        await expect(fila(agotado.name)).toContainText('Sin stock')
        await expect(fila(conStock.name)).not.toContainText('Sin stock')
        const texto = await page.locator('main').innerText()
        expect(texto).not.toMatch(
          /\$\s?\d|\bCosto\b|\bVenta\b|\bPrecio|\bMínimo\b|Hay \d|Stock:/i,
        )
        expect(texto).not.toContain('321')
        expect(texto).not.toContain('456')
        await expectNoHorizontalScroll(page)
      } finally {
        await limpiar(null)
      }
    },
  )
})
