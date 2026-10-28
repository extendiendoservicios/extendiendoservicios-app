import { expect, test, type Page } from '@playwright/test'
import { FIXED_ACCOUNTS, nombreDe } from '../../fixtures/accounts.ts'
import {
  auditarEnAmbosTamanos,
  esperarPantallaLista,
} from '../../fixtures/axe.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { daysFromToday, todayAR } from '../../fixtures/dates.ts'
import { jpegDecodificable } from '../../fixtures/media.ts'
import { FRANJAS_MOVIL } from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { esperarMinutoNuevo, InsumosE2e } from '../../fixtures/stock.ts'
import {
  buscarEnStock,
  elegirDeLista,
  elegirSelect,
  filaDeStock,
} from '../../fixtures/stock-ui.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'
import { getAdminDb } from '../../fixtures/accounts.ts'

// P25.5c (módulo E, Insumos y control de stock): administración en escritorio. Alta de artículo
// con imagen, ingreso con proveedor y comprobante, ajuste con motivo, colores del stock (amarillo
// bajo el mínimo, rojo sin stock), «Cargar control» como ajuste, anulación con contramovimiento,
// retiro en nombre de otra persona (sus turnos primero), el administrador que también trabaja
// turnos (IS-35), resolver un faltante, la sección sin la capacidad «Gestionar stock» (IS-21) y las
// tarjetas del Resumen (IS-30). Cuentas: `admin` (todas las capacidades, incluida manage_stock),
// `adminSinCapacidades`, `adminOperativo` (administrador y empleado), `empleado1` y `empleado2`.
//
// Todo lo que crea lleva el prefijo `e2e-adm-` y se borra al final de cada test: primero lo de
// Insumos (los movimientos son inmutables y se purgan con `InsumosE2e.purgar`) y después los
// clientes. Las pruebas de este archivo corren en orden: el Resumen mira contadores globales y
// ningún otro archivo de esta suite mueve stock.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const ins = new InsumosE2e('adm')

/** Limpia en el orden que corresponde: Insumos primero, después los clientes del escenario. */
async function limpiar(sc: Scenario | null): Promise<void> {
  const notas = await ins.purgar()
  if (sc) notas.push(...(await sc.cleanup()))
  if (notas.length > 0) console.warn(`[insumos admin] ${notas.join(' | ')}`)
}

/** Espera a que la tabla de Stock termine de cargar. */
async function irAStock(page: Page, url = '/admin/insumos'): Promise<void> {
  await page.goto(url)
  await expect(
    page.getByRole('tab', { name: 'Stock', selected: true }),
  ).toBeVisible()
  await expect(page.getByText('Cargando…')).toHaveCount(0)
}

test.describe('administración con «Gestionar stock»', () => {
  test.use({ storageState: storageStatePath('admin') })

  test.afterAll(async () => {
    await limpiar(null)
  })

  test(
    'alta de un artículo con imagen: queda en el catálogo con su historial de precios y el código no se repite (IS-01, IS-02, IS-04, IS-05, IS-06, IS-26, IS-32)',
    cubre('IS-01', 'IS-02', 'IS-04', 'IS-05', 'IS-06', 'IS-26', 'IS-32'),
    async ({ page }) => {
      try {
        const categoria = await ins.categoria('alta')
        const codigo = `${ins.prefijo}alta-${Date.now().toString(36)}`
        const nombre = `${ins.prefijo}Lavandina ${Date.now().toString(36)}`

        await page.goto('/admin/insumos/nuevo')
        await expect(
          page.getByRole('button', { name: 'Cargar artículo' }),
        ).toBeVisible()

        await test.step('elige una imagen: se achica en el navegador (lado mayor de 1200 px)', async () => {
          const imagen = await jpegDecodificable(page, {
            ancho: 1600,
            alto: 1200,
          })
          await page
            .getByLabel('Elegir archivo de imagen del artículo')
            .setInputFiles({
              name: 'lavandina.jpg',
              mimeType: 'image/jpeg',
              buffer: imagen,
            })
          await expect(
            page.getByRole('button', { name: 'Cambiar imagen' }),
          ).toBeVisible()
          const lado = await page
            .getByRole('img', { name: 'Imagen del artículo' })
            .evaluate((el) =>
              Math.max(
                (el as HTMLImageElement).naturalWidth,
                (el as HTMLImageElement).naturalHeight,
              ),
            )
          expect(
            lado,
            'la vista previa es la imagen comprimida',
          ).toBeLessThanOrEqual(1200)
          expect(lado).toBeGreaterThan(0)
        })

        await test.step('completa el formulario y carga el artículo', async () => {
          await page.getByLabel('Código interno').fill(codigo)
          await elegirSelect(page, 'Categoría', categoria.name)
          await page.getByLabel('Artículo', { exact: true }).fill(nombre)
          await page.getByLabel(/Presentación/).fill('Bidón de 5 L')
          await page.getByLabel(/Stock mínimo/).fill('4')
          await page.getByLabel(/Precio de costo/).fill('1.250,50')
          await page.getByLabel(/Precio de venta/).fill('1800')
          await page.getByRole('button', { name: 'Cargar artículo' }).click()
          await expect(page).toHaveURL(/\/admin\/insumos\/[0-9a-f-]{36}$/)
        })

        const supplyId = page.url().split('/').pop() ?? ''

        await test.step('la ficha muestra el artículo, sin stock (rojo), con su imagen', async () => {
          await expect(
            page.getByRole('heading', { name: new RegExp(nombre) }),
          ).toBeVisible()
          await expect(page.getByText('Sin stock').first()).toBeVisible()
          await expect(page.getByText('Bidón de 5 L').first()).toBeVisible()
          const foto = page.getByRole('img', { name: /^Imagen de / })
          await expect(foto).toBeVisible()
          await expect
            .poll(() =>
              foto.evaluate((el) => (el as HTMLImageElement).naturalWidth),
            )
            .toBeGreaterThan(0)
        })

        await test.step('en la base: costo, venta y mínimo guardados, imagen en el bucket y el alta queda en el historial de precios', async () => {
          const db = getAdminDb()
          const { data: fila } = await db
            .from('supplies')
            .select(
              'code, cost_price, sale_price, min_qty, stock_qty, image_path',
            )
            .eq('id', supplyId)
            .single()
          expect(fila).toMatchObject({
            code: codigo,
            cost_price: 1250.5,
            sale_price: 1800,
            min_qty: 4,
            stock_qty: 0,
          })
          expect(fila?.image_path).toMatch(
            new RegExp(`^${supplyId}/[0-9a-f-]{36}\\.(webp|jpg|jpeg)$`),
          )
          const archivo = await db.storage
            .from('supply-images')
            .download(fila?.image_path ?? '')
          expect(archivo.error, archivo.error?.message).toBeNull()
          expect(archivo.data?.size ?? 0).toBeGreaterThan(0)
          expect(archivo.data?.size ?? 0).toBeLessThan(2_000_000)
          expect(['image/webp', 'image/jpeg']).toContain(archivo.data?.type)
          const { data: cambios } = await db
            .from('supply_price_changes')
            .select('source, new_cost_price, new_sale_price')
            .eq('supply_id', supplyId)
          expect(cambios).toEqual([
            { source: 'create', new_cost_price: 1250.5, new_sale_price: 1800 },
          ])
        })

        await test.step('un código repetido, aunque cambien mayúsculas y espacios, no se acepta (IS-26)', async () => {
          await page.goto('/admin/insumos/nuevo')
          await page
            .getByLabel('Código interno')
            .fill(` ${codigo.toUpperCase()} `)
          await elegirSelect(page, 'Categoría', categoria.name)
          await page
            .getByLabel('Artículo', { exact: true })
            .fill(`${nombre} bis`)
          await page.getByLabel(/Precio de costo/).fill('1')
          await page.getByLabel(/Precio de venta/).fill('2')
          await page.getByRole('button', { name: 'Cargar artículo' }).click()
          await expect(page.getByText(/código/i).first()).toBeVisible()
          await expect(page).toHaveURL(/\/admin\/insumos\/nuevo$/)
          const { data: repetidos } = await getAdminDb()
            .from('supplies')
            .select('id')
            .ilike('code', codigo)
          expect(repetidos).toHaveLength(1)
        })

        await test.step('sin imagen también se puede cargar (opcional) y el formulario pide lo obligatorio', async () => {
          await page.goto('/admin/insumos/nuevo')
          await page.getByRole('button', { name: 'Cargar artículo' }).click()
          await expect(page).toHaveURL(/\/admin\/insumos\/nuevo$/)
          await expect(
            page.locator('[aria-invalid="true"]').first(),
          ).toBeVisible()
        })
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'ingreso con proveedor, comprobante y observación: suma el stock, pregunta por el costo distinto y el precio de costo se actualiza (IS-09, IS-22, IS-23)',
    cubre('IS-09', 'IS-22', 'IS-23'),
    async ({ page }) => {
      try {
        const articulo = await ins.insumo({
          slug: 'ingreso',
          stock: 2,
          cost: 100,
          sale: 150,
        })
        await page.goto('/admin/insumos/ingreso')
        await elegirDeLista(
          page,
          'Agregar un artículo',
          articulo.code,
          new RegExp(articulo.code),
        )
        await page.getByLabel('Cantidad').fill('12')
        await page.getByLabel(/Costo unitario/).fill('125')
        await page.getByLabel(/Proveedor/).fill(ins.texto('Proveedor SA'))
        await page.getByLabel(/Remito o factura/).fill('R-0001-00012')
        await page
          .getByLabel(/Observación/)
          .fill(ins.texto('entrega de la semana'))
        await page.getByRole('button', { name: 'Registrar ingreso' }).click()

        await test.step('pregunta si actualiza el precio de costo; se contesta que sí', async () => {
          await expect(
            page.getByText(/¿Actualizar el precio de costo de/),
          ).toBeVisible()
          await expect(page.getByText(/Hoy figura en \$ 100,00/)).toBeVisible()
          await page.getByRole('radio', { name: 'Sí, actualizar' }).click()
          await page.getByRole('button', { name: 'Confirmar ingreso' }).click()
        })

        await test.step('el resumen muestra la cantidad y el stock resultante', async () => {
          const resumen = page.getByTestId('entry-summary')
          await expect(resumen).toContainText('Ingreso registrado')
          await expect(resumen).toContainText(articulo.code)
          await expect(resumen).toContainText('14')
        })

        await test.step('en la base: stock 14, costo vigente 125 y el comprobante en el movimiento; el precio guardado en la línea es el cargado', async () => {
          const db = getAdminDb()
          const { data: fila } = await db
            .from('supplies')
            .select('stock_qty, cost_price, sale_price')
            .eq('id', articulo.id)
            .single()
          expect(fila).toEqual({
            stock_qty: 14,
            cost_price: 125,
            sale_price: 150,
          })
          const { data: lineas } = await db
            .from('stock_movement_lines')
            .select(
              'qty_delta, unit_cost, unit_sale, stock_movements!inner(kind, supplier, document_number, note)',
            )
            .eq('supply_id', articulo.id)
            .eq('qty_delta', 12)
          expect(lineas).toHaveLength(1)
          expect(lineas?.[0]).toMatchObject({
            unit_cost: 125,
            unit_sale: 150,
            stock_movements: {
              kind: 'entry',
              supplier: ins.texto('Proveedor SA'),
              document_number: 'R-0001-00012',
            },
          })
          const { data: cambios } = await db
            .from('supply_price_changes')
            .select('source')
            .eq('supply_id', articulo.id)
            .order('changed_at')
          expect(cambios?.map((c) => c.source)).toEqual(['create', 'entry'])
        })
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'ingreso sin proveedor ni comprobante y con costo igual al vigente: se registra sin preguntar nada (IS-09)',
    cubre('IS-09'),
    async ({ page }) => {
      try {
        const articulo = await ins.insumo({ slug: 'sin-comprobante', cost: 80 })
        await page.goto('/admin/insumos/ingreso')
        await elegirDeLista(
          page,
          'Agregar un artículo',
          articulo.code,
          new RegExp(articulo.code),
        )
        await page.getByLabel('Cantidad').fill('5')
        await page.getByLabel(/Costo unitario/).fill('80')
        await page.getByRole('button', { name: 'Registrar ingreso' }).click()
        await expect(page.getByTestId('entry-summary')).toContainText(
          'Ingreso registrado',
        )
        expect(await ins.stock(articulo.id)).toBe(5)
        const { data } = await getAdminDb()
          .from('stock_movements')
          .select('supplier, document_number')
          .eq('kind', 'entry')
          .in(
            'id',
            (
              await getAdminDb()
                .from('stock_movement_lines')
                .select('movement_id')
                .eq('supply_id', articulo.id)
            ).data?.map((l) => l.movement_id) ?? [],
          )
        expect(data).toEqual([{ supplier: null, document_number: null }])
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'devolución: entra como ingreso de tipo «Devolución» (IS-08)',
    cubre('IS-08'),
    async ({ page }) => {
      try {
        const articulo = await ins.insumo({ slug: 'devolucion', stock: 1 })
        await page.goto('/admin/insumos/ingreso')
        await page.getByRole('radio', { name: 'Devolución' }).click()
        await elegirDeLista(
          page,
          'Agregar un artículo',
          articulo.code,
          new RegExp(articulo.code),
        )
        await page.getByLabel('Cantidad').fill('3')
        await page.getByRole('button', { name: 'Registrar devolución' }).click()
        await expect(page.getByTestId('entry-summary')).toContainText(
          'Devolución registrado',
        )
        expect(await ins.stock(articulo.id)).toBe(4)
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'ajuste con motivo: pide el motivo, la observación con «Otro», no deja el stock bajo cero y queda en el historial (IS-10, IS-27)',
    cubre('IS-10', 'IS-27'),
    async ({ page }) => {
      try {
        const articulo = await ins.insumo({ slug: 'ajuste', stock: 10 })
        await irAStock(page)
        await buscarEnStock(page, articulo.code)
        await page
          .getByRole('button', { name: /^Ajustar el stock de / })
          .click()
        const dialogo = page.getByRole('dialog', { name: 'Ajustar stock' })

        await test.step('sin motivo no registra', async () => {
          await dialogo.getByLabel('Cantidad').fill('3')
          await dialogo
            .getByRole('button', { name: 'Registrar ajuste' })
            .click()
          await expect(
            dialogo.locator('[aria-invalid="true"]').first(),
          ).toBeVisible()
          expect(await ins.stock(articulo.id)).toBe(10)
        })

        await test.step('con «Otro» pide una observación', async () => {
          await elegirSelect(page, 'Motivo', 'Otro', dialogo)
          await dialogo
            .getByRole('button', { name: 'Registrar ajuste' })
            .click()
          await expect(
            dialogo.locator('[aria-invalid="true"]').first(),
          ).toBeVisible()
          expect(await ins.stock(articulo.id)).toBe(10)
        })

        await test.step('restar más de lo que hay no se deja', async () => {
          await dialogo.getByRole('radio', { name: /Restar/ }).click()
          await dialogo.getByLabel('Cantidad').fill('11')
          await elegirSelect(page, 'Motivo', 'Rotura', dialogo)
          await dialogo
            .getByRole('button', { name: 'Registrar ajuste' })
            .click()
          await expect(dialogo).toBeVisible()
          expect(await ins.stock(articulo.id)).toBe(10)
        })

        await test.step('restar 3 por rotura: el stock queda en 7 y el aviso lo dice', async () => {
          await dialogo.getByLabel('Cantidad').fill('3')
          await dialogo
            .getByRole('button', { name: 'Registrar ajuste' })
            .click()
          await expect(
            page.getByText('Registramos el ajuste. El stock queda en 7.'),
          ).toBeVisible()
          await expect(dialogo).toHaveCount(0)
          expect(await ins.stock(articulo.id)).toBe(7)
        })

        await test.step('el ajuste aparece en Movimientos con su motivo', async () => {
          await page.goto('/admin/insumos?pestana=movimientos')
          await elegirDeLista(
            page,
            'Filtrar por artículo',
            articulo.code,
            new RegExp(articulo.code),
          )
          const tarjeta = page
            .getByTestId('movement-card')
            .filter({ hasText: /^Ajuste/ })
          await expect(tarjeta).toHaveCount(1)
          await expect(tarjeta).toContainText('−3')
          await expect(tarjeta).toContainText(/Rotura/)
        })
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'colores del stock: amarillo igual o bajo el mínimo, rojo sin stock (también sin mínimo), sin color arriba del mínimo o sin mínimo (IS-05, IS-25)',
    cubre('IS-05', 'IS-25'),
    async ({ page }) => {
      try {
        const categoria = await ins.categoria('colores')
        const mk = (slug: string, stock: number, minQty?: number) =>
          ins.insumo({ slug, stock, minQty, categoryId: categoria.id })
        const igualMinimo = await mk('igual-minimo', 3, 3)
        const bajoMinimo = await mk('bajo-minimo', 1, 5)
        const sinStockConMinimo = await mk('cero-con-minimo', 0, 2)
        const sinStockSinMinimo = await mk('cero-sin-minimo', 0)
        const sobreMinimo = await mk('sobre-minimo', 10, 3)
        const sinMinimo = await mk('sin-minimo', 2)

        await irAStock(page)
        await buscarEnStock(page, ins.prefijo)

        const fila = (a: { name: string }) => filaDeStock(page, a.name)
        await expect(fila(igualMinimo)).toHaveClass(/bg-warning-bg/)
        await expect(fila(igualMinimo)).toContainText('Bajo mínimo')
        await expect(fila(bajoMinimo)).toHaveClass(/bg-warning-bg/)
        await expect(fila(bajoMinimo)).toContainText('Bajo mínimo')
        await expect(fila(sinStockConMinimo)).toHaveClass(/bg-danger-bg/)
        await expect(fila(sinStockConMinimo)).toContainText('Sin stock')
        await expect(fila(sinStockSinMinimo)).toHaveClass(/bg-danger-bg/)
        await expect(fila(sinStockSinMinimo)).toContainText('Sin stock')
        await expect(fila(sobreMinimo)).not.toHaveClass(
          /bg-(warning|danger)-bg/,
        )
        await expect(fila(sobreMinimo)).not.toContainText(
          /Bajo mínimo|Sin stock/,
        )
        await expect(fila(sinMinimo)).not.toHaveClass(/bg-(warning|danger)-bg/)

        await test.step('«Solo con aviso» deja amarillos y rojos', async () => {
          await page.getByLabel('Solo con aviso').click()
          await expect(fila(igualMinimo)).toBeVisible()
          await expect(fila(sinStockSinMinimo)).toBeVisible()
          await expect(fila(sobreMinimo)).toHaveCount(0)
          await expect(fila(sinMinimo)).toHaveCount(0)
        })

        await test.step('al ajustar a la baja un artículo sobre el mínimo, pasa a amarillo', async () => {
          await page.getByLabel('Solo con aviso').click()
          await page
            .getByRole('button', {
              name: new RegExp(`^Ajustar el stock de ${sobreMinimo.name}`),
            })
            .click()
          const dialogo = page.getByRole('dialog', { name: 'Ajustar stock' })
          await dialogo.getByRole('radio', { name: /Restar/ }).click()
          await dialogo.getByLabel('Cantidad').fill('7')
          await elegirSelect(page, 'Motivo', 'Rotura', dialogo)
          await dialogo
            .getByRole('button', { name: 'Registrar ajuste' })
            .click()
          await expect(fila(sobreMinimo)).toHaveClass(/bg-warning-bg/)
          await expect(fila(sobreMinimo)).toContainText('Bajo mínimo')
        })

        await test.step('y a cero, a rojo', async () => {
          await page
            .getByRole('button', {
              name: new RegExp(`^Ajustar el stock de ${sobreMinimo.name}`),
            })
            .click()
          const dialogo = page.getByRole('dialog', { name: 'Ajustar stock' })
          await dialogo.getByRole('radio', { name: /Restar/ }).click()
          await dialogo.getByLabel('Cantidad').fill('3')
          await elegirSelect(page, 'Motivo', 'Vencimiento', dialogo)
          await dialogo
            .getByRole('button', { name: 'Registrar ajuste' })
            .click()
          await expect(fila(sobreMinimo)).toHaveClass(/bg-danger-bg/)
        })
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    '«Cargar control» registra las diferencias como un ajuste de control de stock, con el nombre de quien revisó; lo que se deja en blanco no se toca (IS-16, IS-31)',
    cubre('IS-15', 'IS-16', 'IS-31'),
    async ({ page }) => {
      try {
        const categoria = await ins.categoria('control')
        const faltan = await ins.insumo({
          slug: 'faltan',
          stock: 10,
          categoryId: categoria.id,
        })
        const igual = await ins.insumo({
          slug: 'igual',
          stock: 5,
          categoryId: categoria.id,
        })
        const enBlanco = await ins.insumo({
          slug: 'blanco',
          stock: 8,
          categoryId: categoria.id,
        })
        const sobran = await ins.insumo({
          slug: 'sobran',
          stock: 0,
          categoryId: categoria.id,
        })

        // La hora del control por omisión es el minuto actual con segundos en cero: los
        // movimientos de preparación tienen que quedar en un minuto anterior (IS-31).
        await esperarMinutoNuevo()
        await irAStock(page)
        await page.getByRole('link', { name: 'Cargar control' }).click()
        await expect(page).toHaveURL(/\/admin\/insumos\/control$/)

        await page.getByRole('radio', { name: 'Un nombre escrito' }).click()
        await page
          .getByLabel('Nombre de quien revisó')
          .fill(ins.texto('Revisora'))
        await page
          .getByLabel(/Observaciones/)
          .fill(ins.texto('control del depósito'))
        await page.getByLabel('Buscar artículo').fill(ins.prefijo)

        await page.getByLabel(`Contado de ${faltan.name}`).fill('7')
        await page.getByLabel(`Contado de ${igual.name}`).fill('5')
        await page.getByLabel(`Contado de ${sobran.name}`).fill('2')

        await page.getByRole('button', { name: 'Confirmar control' }).click()
        const resumen = page.getByTestId('count-summary')
        await expect(resumen).toContainText('Control cargado')
        await expect(resumen).toContainText('Hay 2 diferencias')

        const db = getAdminDb()
        await test.step('stock: baja el que faltaba, sube el que sobraba, el igual y el que quedó en blanco no cambian', async () => {
          expect(await ins.stock(faltan.id)).toBe(7)
          expect(await ins.stock(igual.id)).toBe(5)
          expect(await ins.stock(enBlanco.id)).toBe(8)
          expect(await ins.stock(sobran.id)).toBe(2)
        })

        await test.step('en la base: un solo movimiento «Control de stock» con las dos diferencias, enlazado al control', async () => {
          const { data: control } = await db
            .from('stock_counts')
            .select('id, reviewer_name, reviewer_id, created_by')
            .eq('reviewer_name', ins.texto('Revisora'))
            .single()
          expect(control?.reviewer_id).toBeNull()
          expect(control?.created_by).toBe(readId('admin'))
          const { data: lineasControl } = await db
            .from('stock_count_lines')
            .select('supply_id, system_qty, counted_qty, difference')
            .eq('count_id', control?.id ?? '')
          expect(lineasControl).toHaveLength(3)
          const { data: movimientos } = await db
            .from('stock_movements')
            .select('id, kind')
            .eq('count_id', control?.id ?? '')
          expect(movimientos).toHaveLength(1)
          expect(movimientos?.[0].kind).toBe('count')
          const { data: lineas } = await db
            .from('stock_movement_lines')
            .select('supply_id, qty_delta')
            .eq('movement_id', movimientos?.[0].id ?? '')
          expect(
            Object.fromEntries(
              (lineas ?? []).map((l) => [l.supply_id, l.qty_delta]),
            ),
          ).toEqual({ [faltan.id]: -3, [sobran.id]: 2 })
        })

        await test.step('el control queda en la pestaña Controles con sus diferencias', async () => {
          await page.goto('/admin/insumos?pestana=controles')
          await expect(page.getByText(ins.texto('Revisora'))).toBeVisible()
        })
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    '«Cargar control» con la hora del conteo anterior a un retiro: la diferencia se calcula contra el stock a esa hora y el retiro no se toma como faltante (IS-31)',
    cubre('IS-31'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'retroactivo', stock: 10 })
        const cliente = await sc.client('retro')
        const sede = await sc.site(cliente.id, 'retro')
        const dueno = await sessionClient('owner')
        // La hora del conteo sale del reloj del SERVIDOR (el de esta máquina puede estar
        // corrido): un milisegundo después del ingreso que dejó el stock en 10.
        const { data: ingreso } = await getAdminDb()
          .from('stock_movement_lines')
          .select('stock_movements!inner(recorded_at)')
          .eq('supply_id', articulo.id)
          .single()
        const conteo = new Date(
          Date.parse(ingreso?.stock_movements.recorded_at ?? '') + 1,
        )
        const retiro = await dueno.rpc('register_withdrawal', {
          p_lines: [{ supply_id: articulo.id, qty: 4 }],
          p_site_id: sede.id,
          p_person_id: readId('empleado1'),
          p_note: ins.texto('retiro posterior al conteo'),
        })
        expect(retiro.error?.message).toBeUndefined()
        expect(
          Date.parse(
            (retiro.data as unknown as { movement: { recorded_at: string } })
              .movement.recorded_at,
          ),
          'el retiro tiene que ser posterior al conteo',
        ).toBeGreaterThan(conteo.getTime())
        expect(await ins.stock(articulo.id)).toBe(6)

        // Se contó 10 a esa hora (nada faltaba): hoy hay 6 por el retiro.
        const r = await dueno.rpc('register_stock_count', {
          p_counted_at: conteo.toISOString(),
          p_lines: [{ supply_id: articulo.id, counted_qty: 10 }],
          p_reviewer_name: ins.texto('Revisor retroactivo'),
        })
        expect(r.error?.message).toBeUndefined()
        const resultado = r.data as unknown as {
          lines: Array<{ system_qty: number; difference: number }>
          movement: unknown
        }
        expect(resultado.lines[0]).toMatchObject({
          system_qty: 10,
          difference: 0,
        })
        expect(resultado.movement).toBeNull()
        expect(await ins.stock(articulo.id)).toBe(6)
        await page.goto('/admin/insumos?pestana=controles')
        await expect(
          page.getByText(ins.texto('Revisor retroactivo')),
        ).toBeVisible()
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'anular un retiro genera un contramovimiento enlazado, devuelve el stock y deja el original marcado «Anulado»; anular exige motivo (IS-13, IS-27)',
    cubre('IS-13', 'IS-18', 'IS-27'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'anular', stock: 10 })
        const cliente = await sc.client('anular')
        const sede = await sc.site(cliente.id, 'anular')
        const dueno = await sessionClient('owner')
        const retiro = await dueno.rpc('register_withdrawal', {
          p_lines: [{ supply_id: articulo.id, qty: 4 }],
          p_site_id: sede.id,
          p_person_id: readId('empleado1'),
          p_note: ins.texto('retiro a anular'),
        })
        expect(retiro.error?.message).toBeUndefined()
        expect(await ins.stock(articulo.id)).toBe(6)

        await page.goto('/admin/insumos?pestana=movimientos')
        await elegirDeLista(
          page,
          'Filtrar por artículo',
          articulo.code,
          new RegExp(articulo.code),
        )
        const retiros = page
          .getByTestId('movement-card')
          .filter({ hasText: /^Retiro/ })
        await expect(retiros).toHaveCount(1)
        await expect(retiros).toContainText('Persona')
        await expect(retiros).toContainText(nombreDe('empleado1'))
        await expect(retiros).toContainText(sede.name)

        await retiros.getByRole('button', { name: /^Anular retiro/ }).click()
        const dialogo = page.getByRole('dialog', { name: /Anular retiro/ })

        await test.step('sin motivo no se puede confirmar', async () => {
          await expect(
            dialogo.getByRole('button', { name: 'Anular' }),
          ).toBeDisabled()
        })

        await test.step('con motivo: se anula, el stock vuelve y aparece el contramovimiento', async () => {
          await dialogo
            .getByLabel('Motivo de la anulación')
            .fill(ins.texto('se cargó por error'))
          await dialogo.getByRole('button', { name: 'Anular' }).click()
          await expect(page.getByText('Retiro anulado.')).toBeVisible()
          expect(await ins.stock(articulo.id)).toBe(10)
          await expect(page.getByText('Anulado', { exact: true })).toBeVisible()
          await expect(
            page.getByText(/Anulado por .*se cargó por error/),
          ).toBeVisible()
          await expect(page.getByText('Anula otro movimiento')).toBeVisible()
        })

        await test.step('en la base: el contramovimiento apunta al original, con las cantidades opuestas y los precios del original', async () => {
          const db = getAdminDb()
          const { data: movimientos } = await db
            .from('stock_movements')
            .select('id, kind, reverses_id, voided_at, voided_by, void_reason')
            .in(
              'id',
              (
                await db
                  .from('stock_movement_lines')
                  .select('movement_id')
                  .eq('supply_id', articulo.id)
              ).data?.map((l) => l.movement_id) ?? [],
            )
          const original = movimientos?.find((m) => m.kind === 'withdrawal')
          const contra = movimientos?.find((m) => m.kind === 'reversal')
          expect(original?.voided_at).not.toBeNull()
          expect(original?.voided_by).toBe(readId('admin'))
          expect(original?.void_reason).toBe(ins.texto('se cargó por error'))
          expect(contra?.reverses_id).toBe(original?.id)
          const { data: lineas } = await db
            .from('stock_movement_lines')
            .select('movement_id, qty_delta, unit_cost, unit_sale')
            .eq('supply_id', articulo.id)
            .in('movement_id', [original?.id ?? '', contra?.id ?? ''])
          const a = lineas?.find((l) => l.movement_id === original?.id)
          const b = lineas?.find((l) => l.movement_id === contra?.id)
          expect(a?.qty_delta).toBe(-4)
          expect(b?.qty_delta).toBe(4)
          expect(b?.unit_cost).toBe(a?.unit_cost)
          expect(b?.unit_sale).toBe(a?.unit_sale)
        })

        await test.step('el retiro anulado ya no se puede anular de nuevo ni el contramovimiento tampoco', async () => {
          await expect(
            page.getByRole('button', { name: /^Anular retiro/ }),
          ).toHaveCount(0)
          await expect(
            page.getByRole('button', { name: /^Anular anulación/ }),
          ).toHaveCount(0)
        })
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'anular un ingreso cuyo stock ya se usó: el servidor lo rechaza con su mensaje y el stock no cambia (IS-27)',
    cubre('IS-27'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'anular-ingreso' })
        const cliente = await sc.client('anular-ingreso')
        const sede = await sc.site(cliente.id, 'anular-ingreso')
        const dueno = await sessionClient('owner')
        await ins.ingresar(articulo.id, 5)
        const retiro = await dueno.rpc('register_withdrawal', {
          p_lines: [{ supply_id: articulo.id, qty: 5 }],
          p_site_id: sede.id,
          p_person_id: readId('empleado1'),
          p_note: ins.texto('se usó todo'),
        })
        expect(retiro.error?.message).toBeUndefined()

        await page.goto('/admin/insumos?pestana=movimientos')
        await elegirDeLista(
          page,
          'Filtrar por artículo',
          articulo.code,
          new RegExp(articulo.code),
        )
        await page
          .getByTestId('movement-card')
          .filter({ hasText: /^Ingreso/ })
          .getByRole('button', { name: /^Anular ingreso/ })
          .click()
        const dialogo = page.getByRole('dialog', { name: /Anular ingreso/ })
        await dialogo
          .getByLabel('Motivo de la anulación')
          .fill(ins.texto('error'))
        await dialogo.getByRole('button', { name: 'Anular' }).click()
        await expect(
          page.getByText(/ya se usó|no alcanza|stock/i).first(),
        ).toBeVisible()
        expect(await ins.stock(articulo.id)).toBe(0)
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'retiro en nombre de otra persona: los turnos de la persona salen primero y marcados; el retiro queda a su nombre y a nombre de la administración como quien lo cargó (IS-11, IS-35)',
    cubre('IS-11', 'IS-21', 'IS-35'),
    async ({ page }) => {
      test.skip(
        daysFromToday(1) === daysFromToday(2),
        'fechas relativas inválidas',
      )
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'en-nombre', stock: 9 })
        const clienteSuyo = await sc.client('suyo')
        const sedeSuya = await sc.site(clienteSuyo.id, 'suya')
        const turnoSuyo = await sc.shift(
          clienteSuyo.id,
          sedeSuya.id,
          daysFromToday(2),
          FRANJAS_MOVIL.diaCompleto,
        )
        await sc.assign(turnoSuyo, 'empleado1')
        const clienteAjeno = await sc.client('ajeno')
        const sedeAjena = await sc.site(clienteAjeno.id, 'ajena')
        await sc.shift(
          clienteAjeno.id,
          sedeAjena.id,
          daysFromToday(1),
          FRANJAS_MOVIL.diaCompleto,
        )

        await page.goto('/admin/insumos/retiro')
        await elegirDeLista(
          page,
          'Quién retira',
          nombreDe('empleado1'),
          new RegExp(`${nombreDe('empleado1')} · Empleado`),
        )
        await expect(
          page.getByText(
            `Los turnos de ${FIXED_ACCOUNTS.empleado1.firstName} salen primero.`,
          ),
        ).toBeVisible()

        await test.step('al abrir los turnos, el primero es el de la persona y lleva «es su turno», aunque haya otros más próximos', async () => {
          await page.getByRole('combobox', { name: 'Turno' }).click()
          const primera = page.getByRole('option').first()
          await expect(primera).toContainText(clienteSuyo.name)
          await expect(primera).toContainText('es su turno')
          const ajeno = page
            .getByRole('option')
            .filter({ hasText: clienteAjeno.name })
          await expect(ajeno).toHaveCount(1)
          await expect(ajeno).not.toContainText('es su turno')
          await page.locator('[cmdk-input]').fill(clienteSuyo.name)
          await page.getByRole('option', { name: /es su turno/ }).click()
        })

        await page
          .getByRole('combobox', { name: 'Agregar un artículo' })
          .click()
        await page.locator('[cmdk-input]').fill(articulo.code)
        await page
          .getByRole('option', { name: new RegExp(articulo.code) })
          .click()
        await page.getByLabel('Cantidad').fill('3')
        await page
          .getByLabel(/Observación/)
          .fill(ins.texto('retiro cargado por la oficina'))
        await page.getByRole('button', { name: 'Registrar retiro' }).click()

        const resumen = page.getByTestId('withdrawal-summary')
        await expect(resumen).toContainText('Retiro registrado')
        await expect(resumen).toContainText(nombreDe('empleado1'))
        expect(await ins.stock(articulo.id)).toBe(6)

        const { data } = await getAdminDb()
          .from('stock_movements')
          .select('kind, person_id, recorded_by, shift_id, site_id')
          .eq('shift_id', turnoSuyo)
          .single()
        expect(data).toEqual({
          kind: 'withdrawal',
          person_id: readId('empleado1'),
          recorded_by: readId('admin'),
          shift_id: turnoSuyo,
          site_id: sedeSuya.id,
        })
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'retiro en nombre de otra persona por sede: la observación es obligatoria y no se puede pedir más de lo que hay (IS-12, IS-13)',
    cubre('IS-12', 'IS-13'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'por-sede', stock: 2 })
        const cliente = await sc.client('por-sede')
        const sede = await sc.site(cliente.id, 'por-sede')
        await page.goto('/admin/insumos/retiro')
        await elegirDeLista(
          page,
          'Quién retira',
          nombreDe('empleado2'),
          new RegExp(`${nombreDe('empleado2')} · Empleado`),
        )
        await page.getByRole('radio', { name: 'Una sede' }).click()
        await elegirDeLista(page, 'Sede', sede.name, new RegExp(sede.name))
        await elegirDeLista(
          page,
          'Agregar un artículo',
          articulo.code,
          new RegExp(articulo.code),
        )
        await test.step('sin observación no se registra (IS-12)', async () => {
          await page.getByLabel('Cantidad').fill('2')
          await page.getByRole('button', { name: 'Registrar retiro' }).click()
          await expect(
            page.locator('[aria-invalid="true"]').first(),
          ).toBeVisible()
          expect(await ins.stock(articulo.id)).toBe(2)
        })

        await page
          .getByLabel('Observación', { exact: true })
          .fill(ins.texto('reposición de la semana'))

        await test.step('más de lo que hay: avisa cuánto hay y no descuenta (IS-13)', async () => {
          await page.getByLabel('Cantidad').fill('5')
          await page.getByRole('button', { name: 'Registrar retiro' }).click()
          await expect(
            page.getByText(/No alcanza el stock: hay 2\./),
          ).toBeVisible()
          expect(await ins.stock(articulo.id)).toBe(2)
        })

        await page.getByLabel('Cantidad').fill('2')
        await page.getByRole('button', { name: 'Registrar retiro' }).click()
        await expect(page.getByTestId('withdrawal-summary')).toBeVisible()
        expect(await ins.stock(articulo.id)).toBe(0)
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'faltante: el aviso del empleado aparece en Faltantes; al resolverlo con una nota queda «Resuelto» y la nota la ve quien avisó (IS-14, IS-29)',
    cubre('IS-14', 'IS-29'),
    async ({ page }) => {
      try {
        const articulo = await ins.insumo({ slug: 'faltante', stock: 1 })
        const empleado = await sessionClient('empleado1')
        const aviso = await empleado.rpc('report_supply_shortage', {
          p_supply_id: articulo.id,
          p_comment: ins.texto('queda poco en el armario'),
        })
        expect(aviso.error?.message).toBeUndefined()

        await page.goto('/admin/insumos?pestana=faltantes')
        const tarjeta = page
          .getByTestId('shortage-card')
          .filter({ hasText: articulo.name })
        await expect(tarjeta).toHaveCount(1)
        await expect(tarjeta).toHaveAttribute('data-status', 'open')
        await expect(tarjeta).toContainText('Abierto')
        await expect(tarjeta).toContainText(nombreDe('empleado1'))
        await expect(tarjeta).toContainText('queda poco en el armario')

        await tarjeta
          .getByRole('button', { name: /^Resolver el aviso/ })
          .click()
        const dialogo = page.getByRole('dialog', {
          name: 'Resolver aviso de faltante',
        })
        await expect(
          dialogo.getByRole('button', { name: 'Resolver' }),
        ).toBeDisabled()
        await dialogo.getByLabel('Nota de resolución').fill('Se compró')
        await dialogo.getByRole('button', { name: 'Resolver' }).click()

        await expect(tarjeta).toHaveAttribute('data-status', 'resolved')
        await expect(tarjeta).toContainText('Resuelto')
        await expect(tarjeta).toContainText('Se compró')
        await expect(
          tarjeta.getByRole('button', { name: /^Resolver el aviso/ }),
        ).toHaveCount(0)

        const propios = await empleado
          .from('v_my_shortage_reports')
          .select('status, resolution_note')
          .eq('id', (aviso.data as unknown as { id: string }).id)
          .single()
        expect(propios.data).toEqual({
          status: 'resolved',
          resolution_note: 'Se compró',
        })
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'tarjetas del Resumen: «Faltantes avisados» y «Stock bajo» reflejan los contadores y llevan a Insumos con el filtro puesto (IS-30)',
    cubre('IS-30'),
    async ({ page }) => {
      try {
        const dueno = await sessionClient('owner')
        const empleado = await sessionClient('empleado1')
        const antes = (await dueno.rpc('get_stock_summary'))
          .data as unknown as {
          open_reports: number
          open_shortages: number
          out_of_stock: number
          below_min: number
        }
        const sinStock = await ins.insumo({ slug: 'resumen-rojo', minQty: 2 })
        await ins.insumo({ slug: 'resumen-amarillo', stock: 2, minQty: 2 })
        // Dos avisos del mismo artículo cuentan como un faltante pero dos avisos (IS-29).
        for (const n of [1, 2]) {
          const r = await empleado.rpc('report_supply_shortage', {
            p_supply_id: sinStock.id,
            p_comment: ins.texto(`resumen-${n}`),
          })
          expect(r.error?.message).toBeUndefined()
        }
        const despues = (await dueno.rpc('get_stock_summary'))
          .data as unknown as typeof antes
        expect(despues.open_reports).toBe(antes.open_reports + 2)
        expect(despues.open_shortages).toBe(antes.open_shortages + 1)
        expect(despues.out_of_stock).toBe(antes.out_of_stock + 1)
        expect(despues.below_min).toBe(antes.below_min + 1)

        await page.goto('/admin')
        const seccion = page.getByRole('region', { name: 'Insumos' })
        const faltantes = seccion.getByRole('link', {
          name: /Faltantes avisados/,
        })
        const bajo = seccion.getByRole('link', { name: /Stock bajo/ })
        await expect(faltantes).toContainText(String(despues.open_shortages))
        await expect(faltantes).toContainText(
          `${despues.open_reports} avisos abiertos`,
        )
        await expect(bajo).toContainText(
          String(despues.out_of_stock + despues.below_min),
        )
        await expect(bajo).toContainText(
          `${despues.out_of_stock} sin stock · ${despues.below_min} bajo mínimo`,
        )

        await bajo.click()
        await expect(page).toHaveURL(/\/admin\/insumos\?filtro=aviso$/)
        await expect(page.getByLabel('Solo con aviso')).toBeChecked()
        await buscarEnStock(page, ins.prefijo)
        await expect(filaDeStock(page, sinStock.name)).toHaveClass(
          /bg-danger-bg/,
        )

        await page.goto('/admin')
        // Mientras el resumen carga, la tarjeta lleva a `/admin/insumos` a secas: hay que esperar
        // a que traiga el contador antes de hacer clic.
        await expect(faltantes).toContainText(
          `${despues.open_reports} avisos abiertos`,
        )
        await faltantes.click()
        await expect(page).toHaveURL(/\/admin\/insumos\?pestana=faltantes$/)
        await expect(
          page.getByRole('tab', { name: 'Faltantes', selected: true }),
        ).toBeVisible()
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'la barra lateral lleva «Insumos» con el número de avisos abiertos (IS-33)',
    cubre('IS-33'),
    async ({ page }) => {
      try {
        const articulo = await ins.insumo({ slug: 'barra', stock: 1 })
        const empleado = await sessionClient('empleado1')
        const r = await empleado.rpc('report_supply_shortage', {
          p_supply_id: articulo.id,
          p_comment: ins.texto('barra'),
        })
        expect(r.error?.message).toBeUndefined()
        const dueno = await sessionClient('owner')
        const resumen = (await dueno.rpc('get_stock_summary'))
          .data as unknown as { open_reports: number }
        await page.goto('/admin')
        const enlace = page
          .getByRole('navigation')
          .getByRole('link', { name: /Insumos/ })
        await expect(enlace).toBeVisible()
        await expect(enlace).toContainText(String(resumen.open_reports))
        await enlace.click()
        await expect(page).toHaveURL(/\/admin\/insumos$/)
        for (const pestana of [
          'Stock',
          'Movimientos',
          'Faltantes',
          'Consumo por cliente',
          'Controles',
          'Categorías',
        ]) {
          await expect(page.getByRole('tab', { name: pestana })).toBeVisible()
        }
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'consumo por cliente: suma los retiros netos de anulaciones, a costo y a venta, por cliente y sede (IS-24)',
    cubre('IS-24'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({
          slug: 'consumo',
          stock: 20,
          cost: 10,
          sale: 15,
        })
        const cliente = await sc.client('consumo')
        const sede = await sc.site(cliente.id, 'consumo')
        const dueno = await sessionClient('owner')
        const retirar = async (qty: number) => {
          const r = await dueno.rpc('register_withdrawal', {
            p_lines: [{ supply_id: articulo.id, qty }],
            p_site_id: sede.id,
            p_person_id: readId('empleado1'),
            p_note: ins.texto('consumo'),
          })
          expect(r.error?.message).toBeUndefined()
          return (r.data as unknown as { movement: { id: string } }).movement.id
        }
        await retirar(3)
        const anulado = await retirar(5)
        const v = await dueno.rpc('void_stock_movement', {
          p_movement_id: anulado,
          p_reason: ins.texto('anulado'),
        })
        expect(v.error?.message).toBeUndefined()

        await page.goto('/admin/insumos?pestana=consumo')
        const bloque = page.getByText(cliente.name).first()
        await expect(bloque).toBeVisible()
        // 3 unidades a costo 10 y a venta 15: $ 30,00 y $ 45,00 (el retiro anulado no cuenta).
        await expect(page.getByText('$ 30,00').first()).toBeVisible()
        await expect(page.getByText('$ 45,00').first()).toBeVisible()
        await expectNoHorizontalScroll(page)
        const { data } = await dueno
          .from('v_supply_consumption_by_client')
          .select('qty, cost_total, sale_total')
          .eq('site_id', sede.id)
        expect(data).toEqual([{ qty: 3, cost_total: 30, sale_total: 45 }])
        expect(todayAR()).toBeTruthy()
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'Imprimir planilla: la planilla lleva fecha, quién revisa, los artículos con stock del sistema y espacio para contar, y el pie con firma (IS-15)',
    cubre('IS-15'),
    async ({ page }) => {
      try {
        const articulo = await ins.insumo({ slug: 'planilla', stock: 6 })
        await irAStock(page)
        await page.getByRole('button', { name: /Imprimir planilla/ }).click()
        await page.getByRole('button', { name: 'Ver planilla' }).click()
        const planilla = page.getByTestId('control-sheet')
        await expect(planilla).toBeVisible()
        await expect(planilla).toContainText(/Fecha/i)
        await expect(planilla).toContainText(/Revis/i)
        await expect(planilla).toContainText(articulo.code)
        await expect(
          planilla
            .getByTestId('control-sheet-row')
            .filter({ hasText: articulo.code }),
        ).toContainText('6')
        for (const columna of [
          'Código',
          'Artículo',
          'Presentación',
          'Stock del sistema',
          'Contado',
          '✓',
          '+ / −',
          'Observación',
        ]) {
          await expect(
            planilla.getByRole('columnheader', { name: columna, exact: true }),
          ).toBeVisible()
        }
        await expect(
          planilla
            .getByTestId('control-sheet-row')
            .filter({ hasText: articulo.code })
            .getByRole('cell'),
        ).toHaveCount(8)
        await expect(planilla).toContainText('Aclaración')
        await expect(planilla).toContainText(/Observaciones generales/i)
        await expect(planilla).toContainText(/Firma/i)
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'categorías: alta, orden y baja; no se desactiva una con artículos activos (IS-03)',
    cubre('IS-03', 'IS-26'),
    async ({ page }) => {
      try {
        const nombre = `${ins.prefijo}cat-ui-${Date.now().toString(36)}`
        await page.goto('/admin/insumos?pestana=categorias')
        await page.getByRole('button', { name: 'Nueva categoría' }).click()
        await page.getByLabel('Nombre').fill(nombre)
        await page.getByRole('button', { name: 'Guardar' }).click()
        await expect(page.getByText(nombre).first()).toBeVisible()
        const { data: creada } = await getAdminDb()
          .from('supply_categories')
          .select('id, sort_order, active')
          .eq('name', nombre)
          .single()
        expect(creada?.active).toBe(true)

        await test.step('el orden se mueve con «Subir» y «Bajar»', async () => {
          // Según dónde caiga la categoría nueva, una de las dos flechas está deshabilitada.
          const subir = page.getByRole('button', {
            name: `Subir la categoría ${nombre}`,
          })
          const bajar = page.getByRole('button', {
            name: `Bajar la categoría ${nombre}`,
          })
          await expect(subir.or(bajar).first()).toBeVisible()
          if (await subir.isEnabled()) await subir.click()
          else await bajar.click()
          await expect
            .poll(async () => {
              const { data } = await getAdminDb()
                .from('supply_categories')
                .select('sort_order')
                .eq('id', creada?.id ?? '')
                .single()
              return data?.sort_order
            })
            .not.toBe(creada?.sort_order)
        })

        const articulo = await ins.insumo({
          slug: 'en-categoria',
          categoryId: creada?.id,
        })

        await test.step('con un artículo activo, la baja se rechaza con el mensaje del servidor', async () => {
          await page
            .getByRole('button', { name: `Desactivar la categoría ${nombre}` })
            .click()
          await expect(
            page.getByText(
              'La categoría tiene artículos activos. Pasalos a otra categoría o desactivalos antes.',
            ),
          ).toBeVisible()
          const { data } = await getAdminDb()
            .from('supply_categories')
            .select('active')
            .eq('id', creada?.id ?? '')
            .single()
          expect(data?.active).toBe(true)
        })

        await test.step('desactivado el artículo, la categoría se puede dar de baja', async () => {
          const dueno = await sessionClient('owner')
          const baja = await dueno.rpc('set_supply_active', {
            p_supply_id: articulo.id,
            p_active: false,
          })
          expect(baja.error?.message).toBeUndefined()
          await page.reload()
          await page
            .getByRole('button', { name: `Desactivar la categoría ${nombre}` })
            .click()
          await expect(
            page.getByRole('button', {
              name: `Activar la categoría ${nombre}`,
            }),
          ).toBeVisible()
        })
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'ficha del artículo: cambiar precios deja el historial sin recalcular lo ya movido; desactivar exige stock en cero y el artículo sale del catálogo del celular; reactivarlo lo devuelve (IS-22, IS-26)',
    cubre('IS-06', 'IS-22', 'IS-26'),
    async ({ page }) => {
      try {
        const articulo = await ins.insumo({
          slug: 'ficha',
          stock: 5,
          cost: 10,
          sale: 15,
        })
        const empleado = await sessionClient('empleado1')
        const enCatalogo = async () => {
          const { data } = await empleado
            .from('v_supply_catalog')
            .select('id')
            .eq('id', articulo.id)
          return (data ?? []).length
        }
        expect(await enCatalogo()).toBe(1)

        await page.goto(`/admin/insumos/${articulo.id}`)
        await page.getByRole('button', { name: 'Cambiar precios' }).click()
        const precios = page.getByRole('dialog', { name: 'Cambiar precios' })
        await precios.getByLabel('Precio de costo ($)').fill('20')
        await precios.getByLabel('Precio de venta ($)').fill('30')
        await precios.getByRole('button', { name: 'Guardar precios' }).click()
        await expect(precios).toHaveCount(0)
        await expect(page.getByText('$ 20,00').first()).toBeVisible()

        await test.step('lo ya movido conserva el precio de su momento; el cambio queda en el historial', async () => {
          const db = getAdminDb()
          const { data: lineas } = await db
            .from('stock_movement_lines')
            .select('unit_cost, unit_sale')
            .eq('supply_id', articulo.id)
          expect(lineas).toEqual([{ unit_cost: 10, unit_sale: 15 }])
          const { data: cambios } = await db
            .from('supply_price_changes')
            .select('source, old_cost_price, new_cost_price, changed_by')
            .eq('supply_id', articulo.id)
            .order('changed_at')
          expect(cambios?.map((c) => c.source)).toEqual(['create', 'manual'])
          expect(cambios?.[1]).toMatchObject({
            old_cost_price: 10,
            new_cost_price: 20,
            changed_by: readId('admin'),
          })
        })

        await test.step('con stock no se desactiva: el diálogo manda a ajustar primero', async () => {
          await page.getByRole('button', { name: 'Desactivar' }).click()
          await expect(
            page.getByRole('dialog', {
              name: 'Primero ajustá el stock a cero',
            }),
          ).toBeVisible()
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Cancelar' })
            .click()
          expect(await enCatalogo()).toBe(1)
        })

        await test.step('con el stock en cero se desactiva y sale del catálogo del celular y del ingreso', async () => {
          const dueno = await sessionClient('owner')
          const ajuste = await dueno.rpc('adjust_stock', {
            p_supply_id: articulo.id,
            p_delta: -5,
            p_reason: 'expired',
          })
          expect(ajuste.error?.message).toBeUndefined()
          await page.reload()
          await page.getByRole('button', { name: 'Desactivar' }).click()
          await page
            .getByRole('dialog', { name: 'Desactivar el artículo' })
            .getByRole('button', { name: 'Desactivar' })
            .click()
          await expect(page.getByText('Inactivo').first()).toBeVisible()
          await expect.poll(enCatalogo).toBe(0)
          await page.goto('/admin/insumos/ingreso')
          await page
            .getByRole('combobox', { name: 'Agregar un artículo' })
            .click()
          await page.locator('[cmdk-input]').fill(articulo.code)
          await expect(page.getByRole('option')).toHaveCount(0)
        })

        await test.step('reactivarlo lo devuelve al catálogo', async () => {
          await page.goto(`/admin/insumos/${articulo.id}`)
          await page.getByRole('button', { name: 'Activar' }).click()
          await expect.poll(enCatalogo).toBe(1)
        })
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'Movimientos: filtro por tipo y «Exportar a Excel» baja un archivo con las líneas filtradas (IS-18, IS-24)',
    cubre('IS-18', 'IS-24'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({
          slug: 'excel',
          stock: 9,
          cost: 12,
          sale: 18,
        })
        const cliente = await sc.client('excel')
        const sede = await sc.site(cliente.id, 'excel')
        const dueno = await sessionClient('owner')
        const r = await dueno.rpc('register_withdrawal', {
          p_lines: [{ supply_id: articulo.id, qty: 2 }],
          p_site_id: sede.id,
          p_person_id: readId('empleado1'),
          p_note: ins.texto('para el excel'),
        })
        expect(r.error?.message).toBeUndefined()

        await page.goto('/admin/insumos?pestana=movimientos')
        await elegirDeLista(
          page,
          'Filtrar por artículo',
          articulo.code,
          new RegExp(articulo.code),
        )
        await expect(page.getByTestId('movement-card')).toHaveCount(2)
        await elegirSelect(page, 'Filtrar por tipo', 'Retiro')
        await expect(page.getByTestId('movement-card')).toHaveCount(1)
        await expect(page.getByTestId('movement-card')).toContainText(sede.name)

        const descarga = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Exportar a Excel' }).click()
        const archivo = await descarga
        expect(archivo.suggestedFilename()).toMatch(/\.xlsx$/)
        const ruta = await archivo.path()
        const ExcelJS = (await import('exceljs')).default
        const libro = new ExcelJS.Workbook()
        await libro.xlsx.readFile(ruta)
        const hoja = libro.getWorksheet('Movimientos')
        expect(hoja, 'falta la hoja «Movimientos»').toBeTruthy()
        const filas: string[][] = []
        hoja?.eachRow((fila) => {
          filas.push(
            (fila.values as unknown[])
              .slice(1)
              .map((v) =>
                v == null
                  ? ''
                  : typeof v === 'object'
                    ? JSON.stringify(v)
                    : String(v as string | number | boolean),
              ),
          )
        })
        const delArticulo = filas.filter((f) =>
          f.join('|').includes(articulo.code),
        )
        expect(
          delArticulo,
          'solo la línea del retiro (el filtro de tipo manda)',
        ).toHaveLength(1)
        expect(delArticulo[0].join('|')).toContain(sede.name)
        expect(filas[0].length, 'encabezados').toBeGreaterThan(5)
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'pestaña «Retiros» de la ficha del empleado y del coordinador: lista sus retiros, con lo anulado marcado (IS-18)',
    cubre('IS-18', 'IS-13'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'pestana', stock: 9 })
        const cliente = await sc.client('pestana')
        const sede = await sc.site(cliente.id, 'pestana')
        const dueno = await sessionClient('owner')
        const retirar = async (
          quien: 'empleado1' | 'supervisor1',
          qty: number,
        ) => {
          const r = await dueno.rpc('register_withdrawal', {
            p_lines: [{ supply_id: articulo.id, qty }],
            p_site_id: sede.id,
            p_person_id: readId(quien),
            p_note: ins.texto(`retiro-${quien}`),
          })
          expect(r.error?.message).toBeUndefined()
          return (r.data as unknown as { movement: { id: string } }).movement.id
        }
        const delEmpleado = await retirar('empleado1', 2)
        await retirar('supervisor1', 3)
        const anulado = await dueno.rpc('void_stock_movement', {
          p_movement_id: delEmpleado,
          p_reason: ins.texto('error'),
        })
        expect(anulado.error?.message).toBeUndefined()

        await page.goto(
          `/admin/empleados/${readId('empleado1')}?pestana=retiros`,
        )
        const retiroEmpleado = page
          .getByTestId('person-withdrawal')
          .filter({ hasText: articulo.name })
        await expect(retiroEmpleado).toHaveCount(1)
        await expect(retiroEmpleado).toContainText('Anulado')
        await page.goto(
          `/admin/empleados/${readId('supervisor1')}?pestana=retiros`,
        )
        const retiroCoordinador = page
          .getByTestId('person-withdrawal')
          .filter({ hasText: articulo.name })
        await expect(retiroCoordinador).toHaveCount(1)
        await expect(retiroCoordinador).not.toContainText('Anulado')
        await expect(retiroCoordinador).toContainText('3')
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'retiro en nombre de un coordinador: los turnos que supervisa salen primero y marcados (IS-35)',
    cubre('IS-11', 'IS-35'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'coordinador', stock: 3 })
        const suyo = await sc.client('coord-suyo')
        const sedeSuya = await sc.site(suyo.id, 'suya')
        const turnoSuyo = await sc.shift(
          suyo.id,
          sedeSuya.id,
          daysFromToday(3),
          FRANJAS_MOVIL.diaCompleto,
        )
        await sc.supervisionDirecta(turnoSuyo, 'supervisor1', {
          estado: 'en_curso',
        })
        const otro = await sc.client('coord-otro')
        const sedeOtra = await sc.site(otro.id, 'otra')
        await sc.shift(
          otro.id,
          sedeOtra.id,
          daysFromToday(1),
          FRANJAS_MOVIL.diaCompleto,
        )

        await page.goto('/admin/insumos/retiro')
        await elegirDeLista(
          page,
          'Quién retira',
          nombreDe('supervisor1'),
          new RegExp(`${nombreDe('supervisor1')} · Coordinador`),
        )
        await page.getByRole('combobox', { name: 'Turno' }).click()
        const primera = page.getByRole('option').first()
        await expect(primera).toContainText(suyo.name)
        await expect(primera).toContainText('es su turno')
        await page.locator('[cmdk-input]').fill(suyo.name)
        await page.getByRole('option', { name: /es su turno/ }).click()
        await page
          .getByRole('combobox', { name: 'Agregar un artículo' })
          .click()
        await page.locator('[cmdk-input]').last().fill(articulo.code)
        await page
          .getByRole('option', { name: new RegExp(articulo.code) })
          .click()
        await page.getByLabel('Cantidad').fill('1')
        await page.getByRole('button', { name: 'Registrar retiro' }).click()
        await expect(page.getByTestId('withdrawal-summary')).toContainText(
          nombreDe('supervisor1'),
        )
        expect(await ins.stock(articulo.id)).toBe(2)
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    'orden del stock por categoría y nombre, y filtro por categoría (IS-25)',
    cubre('IS-03', 'IS-25'),
    async ({ page }) => {
      try {
        const primera = await ins.categoria('orden-a')
        const segunda = await ins.categoria('orden-b')
        const mk = (slug: string, categoryId: string) =>
          ins.insumo({ slug, stock: 1, categoryId })
        // Se cargan desordenados a propósito.
        const b2 = await mk('b-segunda', segunda.id)
        const z1 = await mk('z-primera', primera.id)
        const a2 = await mk('a-segunda', segunda.id)
        const a1 = await mk('a-primera', primera.id)

        await irAStock(page)
        await buscarEnStock(page, ins.prefijo)
        await expect(filaDeStock(page, a1.name)).toBeVisible()
        const nombres = await page
          .getByRole('row')
          .filter({ hasText: ins.prefijo })
          .evaluateAll((filas) => filas.map((fila) => fila.textContent ?? ''))
        const posicion = (a: { name: string }) =>
          nombres.findIndex((texto) => texto.includes(a.name))
        // Dentro de cada categoría, por nombre; las categorías, en el orden en que se crearon
        // (mismo orden de lista: 900 y empate por nombre).
        expect(posicion(a1)).toBeLessThan(posicion(z1))
        expect(posicion(a2)).toBeLessThan(posicion(b2))
        expect(
          Math.max(posicion(a1), posicion(z1)) <
            Math.min(posicion(a2), posicion(b2)) ||
            Math.max(posicion(a2), posicion(b2)) <
              Math.min(posicion(a1), posicion(z1)),
          'cada categoría va junta',
        ).toBe(true)

        await elegirSelect(page, 'Filtrar por categoría', segunda.name)
        await expect(filaDeStock(page, a2.name)).toBeVisible()
        await expect(filaDeStock(page, b2.name)).toBeVisible()
        await expect(filaDeStock(page, a1.name)).toHaveCount(0)
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'el Resumen pinta «Stock bajo» en rojo si hay artículos sin stock y «Faltantes avisados» en amarillo si hay avisos abiertos (IS-30)',
    cubre('IS-30'),
    async ({ page }) => {
      try {
        const articulo = await ins.insumo({ slug: 'color-resumen', minQty: 1 })
        const empleado = await sessionClient('empleado1')
        const r = await empleado.rpc('report_supply_shortage', {
          p_supply_id: articulo.id,
          p_comment: ins.texto('color'),
        })
        expect(r.error?.message).toBeUndefined()
        await page.goto('/admin')
        const seccion = page.getByRole('region', { name: 'Insumos' })
        await expect(
          seccion
            .getByRole('link', { name: /Stock bajo/ })
            .locator('.text-danger')
            .first(),
        ).toBeVisible()
        await expect(
          seccion
            .getByRole('link', { name: /Faltantes avisados/ })
            .locator('.text-warning')
            .first(),
        ).toBeVisible()
      } finally {
        await limpiar(null)
      }
    },
  )

  test(
    'accesibilidad (axe) de las pantallas de administración de Insumos, en escritorio y en celular (RB-X01)',
    cubre('RB-X01', 'IS-33'),
    async ({ page }, testInfo) => {
      test.setTimeout(300_000)
      try {
        const articulo = await ins.insumo({ slug: 'axe', stock: 3, minQty: 5 })
        const empleado = await sessionClient('empleado1')
        const aviso = await empleado.rpc('report_supply_shortage', {
          p_supply_id: articulo.id,
          p_comment: ins.texto('axe'),
        })
        expect(aviso.error?.message).toBeUndefined()
        const pantallas: Array<[string, string]> = [
          ['INS-A01 Stock', '/admin/insumos'],
          ['INS-A02 Ficha del artículo', `/admin/insumos/${articulo.id}`],
          ['INS-A03 Nuevo artículo', '/admin/insumos/nuevo'],
          ['INS-A04 Ingreso', '/admin/insumos/ingreso'],
          ['INS-A05 Retiro en nombre de', '/admin/insumos/retiro'],
          ['INS-A06 Cargar control', '/admin/insumos/control'],
          ['INS-A07 Movimientos', '/admin/insumos?pestana=movimientos'],
          ['INS-A08 Faltantes', '/admin/insumos?pestana=faltantes'],
          ['INS-A09 Consumo por cliente', '/admin/insumos?pestana=consumo'],
          ['INS-A10 Controles', '/admin/insumos?pestana=controles'],
          ['INS-A11 Categorías', '/admin/insumos?pestana=categorias'],
        ]
        for (const [nombre, ruta] of pantallas) {
          await test.step(nombre, async () => {
            await page.goto(ruta)
            await auditarEnAmbosTamanos(page, testInfo, nombre, async () => {
              await esperarPantallaLista(page)
              await expect(page.getByText('Cargando…')).toHaveCount(0)
            })
          })
        }
      } finally {
        await limpiar(null)
      }
    },
  )
})

test.describe('el administrador que también trabaja turnos como empleado (IS-35)', () => {
  test.use({ storageState: storageStatePath('adminOperativo') })

  test.afterAll(async () => {
    await limpiar(null)
  })

  test(
    've las opciones de administración y, en nombre de otra persona, elige un turno de ayer que su propio rol de empleado no le mostraría',
    cubre('IS-11', 'IS-35'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const articulo = await ins.insumo({ slug: 'operativo', stock: 4 })
        const cliente = await sc.client('operativo')
        const sede = await sc.site(cliente.id, 'operativo')
        const ayer = await sc.shift(
          cliente.id,
          sede.id,
          daysFromToday(-1),
          FRANJAS_MOVIL.diaCompleto,
        )

        await test.step('la sección Insumos muestra las acciones de administración', async () => {
          await irAStock(page)
          for (const nombre of [
            'Ingreso',
            'Retiro en nombre de',
            'Cargar control',
            'Nuevo artículo',
          ]) {
            await expect(page.getByRole('link', { name: nombre })).toBeVisible()
          }
          await buscarEnStock(page, articulo.code)
          await expect(
            page.getByRole('button', {
              name: new RegExp(`^Ajustar el stock de ${articulo.name}`),
            }),
          ).toBeVisible()
        })

        await test.step('en nombre de otra persona, el turno de ayer está entre las opciones (de -30 a +7 días, todos los turnos)', async () => {
          await page.goto('/admin/insumos/retiro')
          await elegirDeLista(
            page,
            'Quién retira',
            nombreDe('empleado1'),
            new RegExp(`${nombreDe('empleado1')} · Empleado`),
          )
          await elegirDeLista(
            page,
            'Turno',
            cliente.name,
            new RegExp(cliente.name),
          )
          await page
            .getByRole('combobox', { name: 'Agregar un artículo' })
            .click()
          await page.locator('[cmdk-input]').fill(articulo.code)
          await page
            .getByRole('option', { name: new RegExp(articulo.code) })
            .click()
          await page.getByLabel('Cantidad').fill('1')
          await page.getByRole('button', { name: 'Registrar retiro' }).click()
          await expect(page.getByTestId('withdrawal-summary')).toBeVisible()
        })

        const { data } = await getAdminDb()
          .from('stock_movements')
          .select('person_id, recorded_by, shift_id')
          .eq('shift_id', ayer)
          .single()
        expect(data).toEqual({
          person_id: readId('empleado1'),
          recorded_by: readId('adminOperativo'),
          shift_id: ayer,
        })
        expect(await ins.stock(articulo.id)).toBe(3)
      } finally {
        await limpiar(sc)
      }
    },
  )
})

test.describe('administrador sin «Gestionar stock» (IS-21)', () => {
  test.use({ storageState: storageStatePath('adminSinCapacidades') })

  test.afterAll(async () => {
    await limpiar(null)
  })

  test(
    've toda la sección (stock, precios, movimientos) pero sin los botones que mueven stock, y puede resolver faltantes',
    cubre('IS-19', 'IS-21'),
    async ({ page }) => {
      try {
        const articulo = await ins.insumo({
          slug: 'sin-capacidad',
          stock: 5,
          cost: 40,
          sale: 60,
        })
        const empleado = await sessionClient('empleado1')
        const aviso = await empleado.rpc('report_supply_shortage', {
          p_supply_id: articulo.id,
          p_comment: ins.texto('sin capacidad'),
        })
        expect(aviso.error?.message).toBeUndefined()

        await irAStock(page)
        await buscarEnStock(page, articulo.code)
        const fila = filaDeStock(page, articulo.name)
        await expect(fila).toBeVisible()
        await expect(fila).toContainText('$ 40,00')
        await expect(fila).toContainText('$ 60,00')
        for (const nombre of [
          'Ingreso',
          'Retiro en nombre de',
          'Cargar control',
          'Nuevo artículo',
        ]) {
          await expect(page.getByRole('link', { name: nombre })).toHaveCount(0)
        }
        await expect(
          page.getByRole('button', { name: /^Ajustar el stock de / }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: /Imprimir planilla/ }),
        ).toHaveCount(0)

        await test.step('las pantallas que mueven stock avisan que falta el permiso', async () => {
          for (const ruta of [
            '/admin/insumos/nuevo',
            '/admin/insumos/ingreso',
            '/admin/insumos/retiro',
            '/admin/insumos/control',
          ]) {
            await page.goto(ruta)
            await expect(page.getByText(/No tenés permiso para/)).toBeVisible()
          }
        })

        await test.step('Movimientos se ve, pero sin «Anular»', async () => {
          await page.goto('/admin/insumos?pestana=movimientos')
          await expect(page.getByTestId('movement-card').first()).toBeVisible()
          await expect(
            page.getByRole('button', { name: /^Anular / }),
          ).toHaveCount(0)
        })

        await test.step('y resuelve un faltante (no exige la capacidad)', async () => {
          await page.goto('/admin/insumos?pestana=faltantes')
          const tarjeta = page
            .getByTestId('shortage-card')
            .filter({ hasText: articulo.name })
          await tarjeta
            .getByRole('button', { name: /^Resolver el aviso/ })
            .click()
          const dialogo = page.getByRole('dialog', {
            name: 'Resolver aviso de faltante',
          })
          await dialogo
            .getByLabel('Nota de resolución')
            .fill('Hay en el depósito')
          await dialogo.getByRole('button', { name: 'Resolver' }).click()
          await expect(tarjeta).toHaveAttribute('data-status', 'resolved')
        })
      } finally {
        await limpiar(null)
      }
    },
  )
})
