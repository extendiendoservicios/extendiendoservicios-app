import { expect, test, type Page, type Response } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import {
  auditarEnAmbosTamanos,
  esperarPantallaLista,
} from '../../fixtures/axe.ts'
import { daysFromToday } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { FRANJAS_MOVIL } from '../../fixtures/movil.ts'
import { getAdminDb } from '../../fixtures/accounts.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { InsumosE2e } from '../../fixtures/stock.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'
import { jpegDecodificable } from '../../fixtures/media.ts'
import { randomUUID } from 'node:crypto'

// P25.5c (módulo E, Insumos y control de stock): el empleado en el celular (390 px). Retiro por
// turno, por sede con observación obligatoria, stock insuficiente sin cifras, artículos «Sin stock»
// que no se pueden elegir, atajo desde el detalle del servicio, aviso de faltante (catálogo y texto
// libre), «Mis retiros» (con lo que cargó la oficina y lo anulado) y «Mis avisos», y que el
// celular nunca muestre cantidades ni precios (IS-20). Cuenta: `empleado1`.
//
// Todo lo que crea lleva el prefijo `e2e-emp-` y se borra al final de cada test: primero lo de
// Insumos (los movimientos son inmutables) y después los clientes del escenario.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('empleado1') })

const ins = new InsumosE2e('emp')

async function limpiar(sc: Scenario | null): Promise<void> {
  const notas = await ins.purgar()
  if (sc) notas.push(...(await sc.cleanup()))
  if (notas.length > 0) console.warn(`[insumos empleado] ${notas.join(' | ')}`)
}

/** Texto que el celular jamás debe mostrar: precios, cantidades de stock y mínimos (IS-20). */
const PROHIBIDO =
  /\$\s?\d|\bCosto\b|\bVenta\b|\bPrecio|\bMínimo\b|Hay \d|Stock:|En stock/i

async function expectSinCantidadesNiPrecios(page: Page): Promise<void> {
  const texto = await page.locator('main').innerText()
  expect(texto).not.toMatch(PROHIBIDO)
}

/** Junta lo que devuelve la API del catálogo y de «mis retiros» para revisar sus columnas. */
function espiarRespuestas(page: Page) {
  const cuerpos: Array<{ url: string; filas: Array<Record<string, unknown>> }> =
    []
  const pendientes: Array<Promise<void>> = []
  page.on('response', (respuesta: Response) => {
    const url = respuesta.url()
    if (
      !/\/rest\/v1\/v_(supply_catalog|my_withdrawals|my_shortage_reports)/.test(
        url,
      )
    ) {
      return
    }
    pendientes.push(
      respuesta
        .json()
        .then((json) => {
          if (Array.isArray(json)) {
            cuerpos.push({ url, filas: json as Array<Record<string, unknown>> })
          }
        })
        .catch(() => undefined),
    )
  })
  return {
    cuerpos,
    async esperar() {
      await Promise.all(pendientes)
    },
  }
}

test.describe('Insumos del empleado en el celular', () => {
  test.afterAll(async () => {
    await limpiar(null)
  })

  test(
    'retiro por turno: elige su turno, agrega artículos y cantidades, confirma, ve el resumen y lo encuentra en «Mis retiros»; el stock baja en el momento (IS-11, IS-13, IS-28)',
    cubre('IS-11', 'IS-12', 'IS-13', 'IS-20', 'IS-28'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const categoria = await ins.categoria('retiro')
        const lavandina = await ins.insumo({
          slug: 'lavandina',
          presentation: '1 L',
          stock: 10,
          categoryId: categoria.id,
        })
        const agotado = await ins.insumo({
          slug: 'agotado',
          stock: 0,
          categoryId: categoria.id,
        })
        const suyo = await sc.client('retiro-suyo')
        const sedeSuya = await sc.site(suyo.id, 'suya')
        const turnoSuyo = await sc.shift(
          suyo.id,
          sedeSuya.id,
          daysFromToday(1),
          FRANJAS_MOVIL.diaCompleto,
        )
        await sc.assign(turnoSuyo, 'empleado1')
        const ajeno = await sc.client('retiro-ajeno')
        const sedeAjena = await sc.site(ajeno.id, 'ajena')
        await sc.shift(
          ajeno.id,
          sedeAjena.id,
          daysFromToday(1),
          FRANJAS_MOVIL.diaCompleto,
        )

        const espia = espiarRespuestas(page)

        await test.step('Insumos: el catálogo con código, nombre y presentación; «Sin stock» en el agotado; nada de cantidades ni precios', async () => {
          await page.goto('/app/insumos')
          await expect(
            page.getByRole('link', { name: 'Retirar insumos' }),
          ).toBeVisible()
          await expect(
            page.getByRole('link', { name: 'Avisar faltante' }),
          ).toBeVisible()
          await page.getByLabel('Buscar insumos').fill(ins.prefijo)
          const fila = (nombre: string) =>
            page.locator('li').filter({ hasText: nombre })
          await expect(fila(lavandina.name)).toContainText(lavandina.code)
          await expect(fila(lavandina.name)).toContainText('1 L')
          await expect(fila(lavandina.name)).not.toContainText('Sin stock')
          await expect(fila(agotado.name)).toContainText('Sin stock')
          await expectSinCantidadesNiPrecios(page)
          await expectNoHorizontalScroll(page)
        })

        await test.step('Retirar insumos: solo ve sus turnos (no el de otro cliente) y elige el suyo', async () => {
          await page.getByRole('link', { name: 'Retirar insumos' }).click()
          await expect(page).toHaveURL(/\/app\/insumos\/retirar$/)
          await expect(
            page.getByRole('radio', { name: new RegExp(suyo.name) }),
          ).toBeVisible()
          await expect(
            page.getByRole('radio', { name: new RegExp(ajeno.name) }),
          ).toHaveCount(0)
          await page.getByRole('radio', { name: new RegExp(suyo.name) }).click()
          await page.getByRole('button', { name: 'Continuar' }).click()
        })

        await test.step('el artículo agotado no se puede elegir; el otro se agrega y se lleva a 2', async () => {
          await page.getByLabel('Buscar insumos').fill(ins.prefijo)
          await expect(
            page.getByRole('button', { name: `Agregar ${agotado.name}` }),
          ).toHaveCount(0)
          await expect(
            page.locator('li').filter({ hasText: agotado.name }),
          ).toContainText('Sin stock')
          await page
            .getByRole('button', {
              name: `Agregar ${lavandina.name} · 1 L`,
            })
            .click()
          await page
            .getByRole('button', {
              name: `Sumar una unidad de ${lavandina.name} · 1 L`,
            })
            .click()
          await expect(
            page.getByRole('button', { name: 'Revisar retiro (2 u.)' }),
          ).toBeVisible()
          await expectSinCantidadesNiPrecios(page)
          await page
            .getByRole('button', { name: 'Revisar retiro (2 u.)' })
            .click()
        })

        await test.step('revisa, deja una observación opcional y confirma', async () => {
          await expect(
            page.getByRole('list', { name: 'Artículos del retiro' }),
          ).toContainText(lavandina.name)
          await page
            .getByLabel('Observación del retiro')
            .fill(ins.texto('para el baño de planta baja'))
          await page.getByRole('button', { name: 'Confirmar retiro' }).click()
          await expect(page.getByText(/Retiro registrado el /)).toBeVisible()
          await expect(page.getByText(suyo.name).first()).toBeVisible()
          await expectSinCantidadesNiPrecios(page)
        })

        await test.step('el stock bajó en el momento y el retiro quedó a su nombre, con su turno', async () => {
          expect(await ins.stock(lavandina.id)).toBe(8)
          const { data } = await getAdminDb()
            .from('stock_movements')
            .select('kind, person_id, recorded_by, shift_id, site_id, note')
            .eq('shift_id', turnoSuyo)
            .single()
          expect(data).toEqual({
            kind: 'withdrawal',
            person_id: readId('empleado1'),
            recorded_by: readId('empleado1'),
            shift_id: turnoSuyo,
            site_id: sedeSuya.id,
            note: ins.texto('para el baño de planta baja'),
          })
        })

        await test.step('«Mis retiros» lo muestra', async () => {
          await page.getByRole('button', { name: 'Volver a Insumos' }).click()
          await expect(page).toHaveURL(/\/app\/insumos$/)
          await page.getByRole('radio', { name: 'Mis retiros' }).click()
          const lista = page.getByRole('list', { name: 'Mis retiros' })
          const tarjeta = lista.locator('li').filter({ hasText: suyo.name })
          await expect(tarjeta).toContainText(`2 × ${lavandina.name} · 1 L`)
          await expect(tarjeta).toContainText('Turno:')
          await expect(tarjeta).toContainText('para el baño de planta baja')
          await expectSinCantidadesNiPrecios(page)
          await expectNoHorizontalScroll(page)
        })

        await test.step('la API del celular nunca devolvió precios ni cantidades de stock (IS-20)', async () => {
          await espia.esperar()
          const claves = new Set(
            espia.cuerpos.flatMap((c) =>
              c.filas.flatMap((f) => Object.keys(f)),
            ),
          )
          expect(claves.size).toBeGreaterThan(0)
          for (const k of [
            'stock_qty',
            'cost_price',
            'sale_price',
            'min_qty',
            'unit_cost',
            'unit_sale',
            'stock_after',
            'stock_value',
          ]) {
            expect(claves.has(k), `la API devolvió ${k}`).toBe(false)
          }
          const catalogo = espia.cuerpos.filter((c) =>
            c.url.includes('v_supply_catalog'),
          )
          expect(catalogo.length).toBeGreaterThan(0)
          for (const c of catalogo) {
            for (const fila of c.filas) {
              expect(Object.keys(fila).sort()).toEqual([
                'category_id',
                'category_name',
                'category_sort_order',
                'code',
                'id',
                'image_path',
                'name',
                'out_of_stock',
                'presentation',
              ])
            }
          }
        })
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'retiro por sede: la observación es obligatoria y recién con ella se puede seguir (IS-12)',
    cubre('IS-12', 'IS-28'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'por-sede', stock: 6 })
        const cliente = await sc.client('por-sede')
        const sede = await sc.site(cliente.id, 'por-sede')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          daysFromToday(2),
          FRANJAS_MOVIL.diaCompleto,
        )
        await sc.assign(turno, 'empleado1')

        await page.goto('/app/insumos/retirar')
        await page.getByRole('radio', { name: 'Una sede' }).click()
        // Un empleado ve las sedes de sus asignaciones.
        await page.getByRole('radio', { name: new RegExp(sede.name) }).click()
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
        await expect(page.getByText('reposición de la semana')).toBeVisible()
        await page.getByRole('button', { name: 'Confirmar retiro' }).click()
        await expect(page.getByText(/Retiro registrado el /)).toBeVisible()

        expect(await ins.stock(articulo.id)).toBe(5)
        const { data } = await getAdminDb()
          .from('stock_movements')
          .select('shift_id, site_id, note, person_id')
          .eq('site_id', sede.id)
          .single()
        expect(data).toEqual({
          shift_id: null,
          site_id: sede.id,
          note: ins.texto('reposición de la semana'),
          person_id: readId('empleado1'),
        })
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'stock insuficiente: «No alcanza el stock de X. Consultá en la oficina.» sin decir cuánto hay; no descuenta nada (IS-13, IS-20, IS-28)',
    cubre('IS-13', 'IS-20', 'IS-28'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'poco', stock: 3 })
        const cliente = await sc.client('poco')
        const sede = await sc.site(cliente.id, 'poco')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          daysFromToday(1),
          FRANJAS_MOVIL.diaCompleto,
        )
        await sc.assign(turno, 'empleado1')

        await page.goto(`/app/insumos/retirar?turno=${turno}`)
        await page.getByLabel('Buscar insumos').fill(articulo.code)
        await page
          .getByRole('button', { name: `Agregar ${articulo.name}` })
          .click()
        const sumar = page.getByRole('button', {
          name: `Sumar una unidad de ${articulo.name}`,
        })
        for (let i = 0; i < 4; i++) await sumar.click()
        await page
          .getByRole('button', { name: /^Revisar retiro \(5 u\.\)/ })
          .click()
        await page.getByRole('button', { name: 'Confirmar retiro' }).click()

        const alerta = page.getByRole('alert').filter({ hasText: 'No alcanza' })
        await expect(alerta).toHaveText(
          `No alcanza el stock de ${articulo.name}. Consultá en la oficina.`,
        )
        expect(await ins.stock(articulo.id)).toBe(3)

        await test.step('con una cantidad que alcanza, el mismo retiro se confirma', async () => {
          await page.getByRole('button', { name: 'Atrás' }).click()
          const restar = page.getByRole('button', {
            name: `Restar una unidad de ${articulo.name}`,
          })
          await restar.click()
          await restar.click()
          await page
            .getByRole('button', { name: /^Revisar retiro \(3 u\.\)/ })
            .click()
          await page.getByRole('button', { name: 'Confirmar retiro' }).click()
          await expect(page.getByText(/Retiro registrado el /)).toBeVisible()
          expect(await ins.stock(articulo.id)).toBe(0)
        })
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'atajo «Retirar insumos» en el detalle del servicio: entra con el turno ya elegido, directo a los artículos (IS-28)',
    cubre('IS-28'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'atajo', stock: 4 })
        const cliente = await sc.client('atajo')
        const sede = await sc.site(cliente.id, 'atajo')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        const asignacion = await sc.assign(turno, 'empleado1')

        await page.goto(`/app/servicio/${asignacion}`)
        await page.getByRole('link', { name: 'Retirar insumos' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/app/insumos/retirar\\?turno=${turno}$`),
        )
        await expect(
          page.getByText(new RegExp(`Turno: .*${cliente.name}`)),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Continuar' }),
        ).toHaveCount(0)
        await page.getByLabel('Buscar insumos').fill(articulo.code)
        await page
          .getByRole('button', { name: `Agregar ${articulo.name}` })
          .click()
        await page.getByRole('button', { name: /^Revisar retiro/ }).click()
        await page.getByRole('button', { name: 'Confirmar retiro' }).click()
        await expect(page.getByText(/Retiro registrado el /)).toBeVisible()
        expect(await ins.stock(articulo.id)).toBe(3)
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'el atajo no aparece en el servicio de un turno cancelado (IS-28)',
    cubre('IS-28'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const cliente = await sc.client('cancelado')
        const sede = await sc.site(cliente.id, 'cancelado')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          daysFromToday(1),
          FRANJAS_MOVIL.diaCompleto,
        )
        const asignacion = await sc.assign(turno, 'empleado1')
        const dueno = await sessionClient('owner')
        const cancelado = await dueno.rpc('cancel_shift', {
          p_shift_id: turno,
          p_reason: ins.texto('cancelado'),
        })
        expect(cancelado.error?.message).toBeUndefined()
        await page.goto(`/app/servicio/${asignacion}`)
        await expect(page.getByText(cliente.name).first()).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Retirar insumos' }),
        ).toHaveCount(0)
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'aviso de faltante: del catálogo y con texto libre; queda «Abierto» en «Mis avisos» y, cuando la oficina lo resuelve, muestra la respuesta (IS-14, IS-29)',
    cubre('IS-14', 'IS-29'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'falta', stock: 0 })
        const cliente = await sc.client('falta')
        const sede = await sc.site(cliente.id, 'falta')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          daysFromToday(1),
          FRANJAS_MOVIL.diaCompleto,
        )
        await sc.assign(turno, 'empleado1')
        const libre = ins.texto('guantes talle XL')

        await page.goto('/app/insumos/faltante')

        await test.step('sin elegir nada pide el artículo', async () => {
          await page.getByRole('button', { name: 'Enviar aviso' }).click()
          await expect(
            page.getByText('Elegí el artículo que falta.'),
          ).toBeVisible()
        })

        await test.step('del catálogo (también uno «Sin stock»), con su turno y un comentario', async () => {
          await page.getByLabel('Buscar insumos').fill(articulo.code)
          await page
            .getByRole('button', { name: new RegExp(articulo.name) })
            .click()
          await expect(page.getByText('Cambiar')).toBeVisible()
          await page.getByRole('radio', { name: 'Un turno' }).click()
          await page
            .getByRole('radio', { name: new RegExp(cliente.name) })
            .click()
          await page.getByLabel('Comentario').fill(ins.texto('se terminó hoy'))
          await page.getByRole('button', { name: 'Enviar aviso' }).click()
          await expect(
            page.getByText(`Avisaste que falta: ${articulo.name}`),
          ).toBeVisible()
        })

        await test.step('texto libre, sin turno ni sede', async () => {
          await page.getByRole('button', { name: 'Volver a Insumos' }).click()
          await page.getByRole('link', { name: 'Avisar faltante' }).click()
          await page.getByRole('radio', { name: 'Otro insumo' }).click()
          await page.getByLabel('Qué insumo falta').fill(libre)
          await page.getByRole('button', { name: 'Enviar aviso' }).click()
          await expect(
            page.getByText(`Avisaste que falta: ${libre}`),
          ).toBeVisible()
          await page.getByRole('button', { name: 'Volver a Insumos' }).click()
        })

        await test.step('«Mis avisos»: los dos Abiertos', async () => {
          await page.getByRole('radio', { name: 'Mis avisos' }).click()
          const lista = page.getByRole('list', { name: 'Mis avisos' })
          const delCatalogo = lista
            .locator('li')
            .filter({ hasText: articulo.name })
          await expect(delCatalogo).toContainText('Abierto')
          await expect(delCatalogo).toContainText('se terminó hoy')
          await expect(delCatalogo).toContainText(cliente.name)
          const deTexto = lista.locator('li').filter({ hasText: libre })
          await expect(deTexto).toContainText('Abierto')
          await expectSinCantidadesNiPrecios(page)
        })

        await test.step('la oficina resuelve el del catálogo: el empleado ve «Resuelto» y la respuesta', async () => {
          const dueno = await sessionClient('owner')
          const { data: avisos } = await getAdminDb()
            .from('supply_shortage_reports')
            .select('id')
            .eq('supply_id', articulo.id)
          expect(avisos).toHaveLength(1)
          const r = await dueno.rpc('resolve_supply_shortage', {
            p_report_id: avisos?.[0].id ?? '',
            p_note: 'Se compró',
          })
          expect(r.error?.message).toBeUndefined()
          await page.reload()
          await page.getByRole('radio', { name: 'Mis avisos' }).click()
          const tarjeta = page
            .getByRole('list', { name: 'Mis avisos' })
            .locator('li')
            .filter({ hasText: articulo.name })
          await expect(tarjeta).toContainText('Resuelto')
          await expect(tarjeta).toContainText('Respuesta: Se compró')
          await expectNoHorizontalScroll(page)
        })
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    '«Mis retiros» muestra lo que la oficina cargó a su nombre y, si se anuló, la marca y el motivo (IS-13, IS-20)',
    cubre('IS-13', 'IS-20', 'IS-35'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'oficina', stock: 6 })
        const cliente = await sc.client('oficina')
        const sede = await sc.site(cliente.id, 'oficina')
        const dueno = await sessionClient('owner')
        const r = await dueno.rpc('register_withdrawal', {
          p_lines: [{ supply_id: articulo.id, qty: 2 }],
          p_site_id: sede.id,
          p_person_id: readId('empleado1'),
          p_note: ins.texto('cargado por la oficina'),
        })
        expect(r.error?.message).toBeUndefined()
        const movimiento = (r.data as unknown as { movement: { id: string } })
          .movement.id

        await page.goto('/app/insumos')
        await page.getByRole('radio', { name: 'Mis retiros' }).click()
        const lista = page.getByRole('list', { name: 'Mis retiros' })
        const tarjeta = lista.locator('li').filter({ hasText: cliente.name })
        await expect(tarjeta).toContainText('Lo cargó la oficina')
        await expect(tarjeta).toContainText(`2 × ${articulo.name}`)
        await expect(tarjeta).not.toContainText('Anulado')

        const anulado = await dueno.rpc('void_stock_movement', {
          p_movement_id: movimiento,
          p_reason: ins.texto('se cargó por error'),
        })
        expect(anulado.error?.message).toBeUndefined()
        await page.reload()
        await page.getByRole('radio', { name: 'Mis retiros' }).click()
        const despues = page
          .getByRole('list', { name: 'Mis retiros' })
          .locator('li')
          .filter({ hasText: cliente.name })
        await expect(despues).toContainText('Anulado')
        await expect(despues).toContainText('Motivo de la anulación:')
        await expectSinCantidadesNiPrecios(page)
        expect(nombreDe('empleado1')).toBeTruthy()
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'las pantallas de Insumos caben en 390 px sin scroll horizontal y la barra de abajo es Hoy, Insumos, Fichar, Más (IS-33)',
    cubre('IS-33'),
    async ({ page }) => {
      for (const ruta of [
        '/app/insumos',
        '/app/insumos/retirar',
        '/app/insumos/faltante',
      ]) {
        await page.goto(ruta)
        await expect(
          page
            .getByLabel('Buscar insumos')
            .or(page.getByRole('radio').first())
            .first(),
        ).toBeVisible()
        await expectNoHorizontalScroll(page)
      }
      await page.goto('/app/insumos')
      const barra = page.getByRole('navigation')
      for (const nombre of ['Hoy', 'Insumos', 'Más']) {
        await expect(barra.getByRole('link', { name: nombre })).toBeVisible()
      }
    },
  )

  test(
    'accesibilidad (axe) de las pantallas de Insumos del empleado: catálogo, mis retiros, mis avisos, retirar y avisar faltante, en celular y en escritorio (RB-X01)',
    cubre('RB-X01', 'IS-28'),
    async ({ page }, testInfo) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'axe', stock: 3 })
        const cliente = await sc.client('axe-ins')
        const sede = await sc.site(cliente.id, 'axe-ins')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          daysFromToday(1),
          FRANJAS_MOVIL.diaCompleto,
        )
        await sc.assign(turno, 'empleado1')
        const empleado = await sessionClient('empleado1')
        const retiro = await empleado.rpc('register_withdrawal', {
          p_lines: [{ supply_id: articulo.id, qty: 1 }],
          p_shift_id: turno,
        })
        expect(retiro.error?.message).toBeUndefined()
        const aviso = await empleado.rpc('report_supply_shortage', {
          p_supply_id: articulo.id,
          p_comment: ins.texto('axe'),
        })
        expect(aviso.error?.message).toBeUndefined()

        const auditar = (nombre: string, ruta: string, vista?: string) =>
          test.step(nombre, async () => {
            await page.goto(ruta)
            if (vista) await page.getByRole('radio', { name: vista }).click()
            await auditarEnAmbosTamanos(page, testInfo, nombre, async () => {
              await esperarPantallaLista(page)
              await expect(page.getByText('Cargando…')).toHaveCount(0)
            })
          })

        await auditar('INS-01 Insumos: catálogo', '/app/insumos')
        await auditar(
          'INS-01 Insumos: mis retiros',
          '/app/insumos',
          'Mis retiros',
        )
        await auditar(
          'INS-01 Insumos: mis avisos',
          '/app/insumos',
          'Mis avisos',
        )
        await auditar('INS-02 Retirar insumos', '/app/insumos/retirar')
        await auditar('INS-03 Avisar faltante', '/app/insumos/faltante')
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'el catálogo muestra la imagen del artículo (URL firmada por el celular) y el que no tiene imagen no lleva ninguna (IS-04, IS-20, IS-32)',
    cubre('IS-04', 'IS-20', 'IS-32'),
    async ({ page }) => {
      try {
        const conImagen = await ins.insumo({ slug: 'con-foto', stock: 2 })
        const sinImagen = await ins.insumo({ slug: 'sin-foto', stock: 2 })
        await page.goto('/app/insumos')
        const bytes = await jpegDecodificable(page, { ancho: 300, alto: 200 })
        const ruta = `${conImagen.id}/${randomUUID()}.jpg`
        const subida = await getAdminDb()
          .storage.from('supply-images')
          .upload(ruta, bytes, { contentType: 'image/jpeg' })
        expect(subida.error?.message).toBeUndefined()
        const dueno = await sessionClient('owner')
        const guardado = await dueno.rpc('upsert_supply', {
          p_id: conImagen.id,
          p_code: conImagen.code,
          p_name: conImagen.name,
          p_category_id: conImagen.categoryId,
          p_image_path: ruta,
        })
        expect(guardado.error?.message).toBeUndefined()

        await page.goto('/app/insumos')
        await page.getByLabel('Buscar insumos').fill(ins.prefijo)
        const fila = page.locator('li').filter({ hasText: conImagen.name })
        const foto = fila.locator('img')
        await expect(foto).toBeVisible()
        await expect
          .poll(() =>
            foto.evaluate((el) => (el as HTMLImageElement).naturalWidth),
          )
          .toBeGreaterThan(0)
        await expect(
          page.locator('li').filter({ hasText: sinImagen.name }).locator('img'),
        ).toHaveCount(0)
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'ventana de turnos: ofrece los suyos de hoy a +7 días y no el de ayer ni el de +8; las sedes son las de sus asignaciones (IS-28)',
    cubre('IS-12', 'IS-28'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const cliente = await sc.client('ventana')
        const sedeDentro = await sc.site(cliente.id, 'dentro')
        const sedeSinAsignar = await sc.site(cliente.id, 'sin-asignar')
        const turno = async (dias: number, sede: { id: string }) => {
          const id = await sc.shift(
            cliente.id,
            sede.id,
            daysFromToday(dias),
            FRANJAS_MOVIL.diaCompleto,
          )
          await sc.assign(id, 'empleado1')
          return id
        }
        await turno(0, sedeDentro)
        await turno(7, sedeDentro)
        const sedeAyer = await sc.site(cliente.id, 'ayer')
        const sedeLejos = await sc.site(cliente.id, 'lejos')
        await turno(-1, sedeAyer)
        await turno(8, sedeLejos)

        await page.goto('/app/insumos/retirar')
        await expect(
          page.getByRole('radio', { name: new RegExp(sedeDentro.name) }),
        ).toHaveCount(2)
        await expect(
          page.getByRole('radio', { name: new RegExp(sedeAyer.name) }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('radio', { name: new RegExp(sedeLejos.name) }),
        ).toHaveCount(0)

        await page.getByRole('radio', { name: 'Una sede' }).click()
        // Sedes: las de sus asignaciones (también las de turnos pasados o lejanos), no las demás.
        await expect(
          page.getByRole('radio', { name: new RegExp(sedeDentro.name) }),
        ).toBeVisible()
        await expect(
          page.getByRole('radio', { name: new RegExp(sedeAyer.name) }),
        ).toBeVisible()
        await expect(
          page.getByRole('radio', { name: new RegExp(sedeSinAsignar.name) }),
        ).toHaveCount(0)
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'sin conexión se puede mirar el catálogo pero no retirar ni avisar: los botones quedan deshabilitados y hay un aviso (IS-28)',
    cubre('IS-28'),
    async ({ page, context }) => {
      await page.goto('/app/insumos')
      await expect(
        page.getByRole('link', { name: 'Retirar insumos' }),
      ).toBeVisible()
      await context.setOffline(true)
      try {
        await expect(page.getByText(/Estás sin conexión/)).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Retirar insumos' }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: 'Retirar insumos' }),
        ).toBeDisabled()
        await expect(
          page.getByRole('button', { name: 'Avisar faltante' }),
        ).toBeDisabled()
      } finally {
        await context.setOffline(false)
      }
      await expect(
        page.getByRole('link', { name: 'Retirar insumos' }),
      ).toBeVisible()
    },
  )
})
