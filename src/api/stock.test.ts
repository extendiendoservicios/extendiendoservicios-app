import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/stock.ts` (módulo E, P25.2): mismo patrón sin red que
 * `mediaAdmin.test.ts`: se mockea `@/lib/supabase` entero.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

const calls: Array<[string, ...unknown[]]> = []

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'limit', 'gte', 'lt', 'eq']) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args])
      return chain
    }
  }
  chain.maybeSingle = () => Promise.resolve(result)
  chain.then = (
    resolve: (value: PostgrestResult<T>) => void,
    reject?: (reason: unknown) => void,
  ) => Promise.resolve(result).then(resolve, reject)
  return chain
}

const {
  fromMock,
  rpcMock,
  storageFromMock,
  uploadMock,
  removeMock,
  createSignedUrlsMock,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  storageFromMock: vi.fn(),
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
  createSignedUrlsMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    storage: { from: storageFromMock },
  },
}))

const {
  mapStockError,
  fetchStockItems,
  fetchStockItem,
  fetchSupplyCategories,
  fetchSupplyPriceChanges,
  fetchStockMovements,
  fetchStockSummary,
  upsertSupplyCategory,
  saveSupply,
  setSupplyPrices,
  setSupplyActive,
  registerStockEntry,
  adjustStock,
  parseStockPostResult,
  argentinaDayStart,
  argentinaNextDayStart,
  createSupplyImageUrls,
  STOCK_ERROR_MESSAGES,
} = await import('./stock')

beforeEach(() => {
  calls.length = 0
  fromMock.mockReset()
  rpcMock.mockReset()
  storageFromMock.mockReset()
  uploadMock.mockReset()
  removeMock.mockReset()
  createSignedUrlsMock.mockReset()
  uploadMock.mockResolvedValue({ error: null })
  removeMock.mockResolvedValue({ error: null })
  storageFromMock.mockReturnValue({
    upload: uploadMock,
    remove: removeMock,
    createSignedUrls: createSignedUrlsMock,
  })
})

function stockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    code: 'QUI-001',
    name: 'Lavandina',
    presentation: '1 L',
    category_id: 'c1',
    category_name: 'Químicos',
    category_sort_order: 0,
    image_path: 's1/a.webp',
    min_qty: 5,
    cost_price: 1250.5,
    sale_price: 1800,
    stock_qty: 3,
    stock_value: 3751.5,
    status: 'low',
    active: true,
    notes: null,
    updated_at: '2026-10-20T12:00:00Z',
    ...overrides,
  }
}

describe('mapStockError', () => {
  it('traduce cada código conocido al mensaje en español', () => {
    const error = mapStockError({
      message: 'x',
      hint: 'CATEGORY_IN_USE',
      code: 'P0001',
    })
    expect(isApiError(error)).toBe(true)
    expect(error.hint).toBe('CATEGORY_IN_USE')
    expect(error.message).toBe(STOCK_ERROR_MESSAGES.CATEGORY_IN_USE)
  })

  it('en INSUFFICIENT_STOCK deja el texto del servidor, que trae las cantidades', () => {
    const error = mapStockError({
      message: 'No alcanza el stock de Lavandina: hay 2 y se quieren sacar 5.',
      hint: 'INSUFFICIENT_STOCK',
    })
    expect(error.message).toBe(
      'No alcanza el stock de Lavandina: hay 2 y se quieren sacar 5.',
    )
  })

  it('usa el mensaje propio si el texto dinámico llega vacío', () => {
    expect(
      mapStockError({ message: '', hint: 'INSUFFICIENT_STOCK' }).message,
    ).toBe(STOCK_ERROR_MESSAGES.INSUFFICIENT_STOCK)
  })

  it('sin hint conocido pasa por fromPostgrestError (nunca el texto crudo en inglés)', () => {
    const error = mapStockError({
      message: 'duplicate key value violates unique constraint',
      code: '23505',
    })
    expect(error.hint).toBe('DUPLICATE')
    expect(error.message).toBe('Ya existe un registro con esos datos.')
  })

  it('en los errores del retiro en nombre de otro deja el texto del servidor', () => {
    for (const hint of [
      'SHIFT_NOT_ALLOWED',
      'SITE_NOT_ALLOWED',
      'SHIFT_NOT_AVAILABLE',
      'SHIFT_NOT_FOUND',
      'SITE_NOT_FOUND',
      'PERSON_NOT_FOUND',
    ]) {
      const error = mapStockError({ message: 'Texto del servidor.', hint })
      expect(error.message, hint).toBe('Texto del servidor.')
      expect(error.hint).toBe(hint)
      expect(mapStockError({ message: '', hint }).message, hint).toBe(
        STOCK_ERROR_MESSAGES[hint],
      )
    }
  })

  it('TEXT_TOO_LONG y STOCK_LIMIT dejan el texto del servidor; los otros códigos nuevos tienen el propio (0073)', () => {
    for (const hint of ['TEXT_TOO_LONG', 'STOCK_LIMIT']) {
      const error = mapStockError({
        message: 'Nota: hasta 500 caracteres.',
        hint,
      })
      expect(error.message, hint).toBe('Nota: hasta 500 caracteres.')
      expect(error.hint).toBe(hint)
      expect(mapStockError({ message: '', hint }).message, hint).toBe(
        STOCK_ERROR_MESSAGES[hint],
      )
    }
    for (const hint of ['INVALID_SORT_ORDER', 'COUNTED_AT_OUT_OF_RANGE']) {
      expect(STOCK_ERROR_MESSAGES[hint], hint).toBeTruthy()
      expect(mapStockError({ message: 'x', hint }).hint).toBe(hint)
    }
  })

  it('tiene mensaje en español para todos los códigos del contrato', () => {
    const contract = [
      'FORBIDDEN',
      'INVALID_LINES',
      'INVALID_QTY',
      'INVALID_PRICE',
      'DUPLICATE_SUPPLY',
      'SUPPLY_NOT_FOUND',
      'SUPPLY_INACTIVE',
      'INSUFFICIENT_STOCK',
      'CODE_REQUIRED',
      'NAME_REQUIRED',
      'INVALID_MIN_QTY',
      'INVALID_IMAGE_PATH',
      'CATEGORY_NOT_FOUND',
      'CATEGORY_INACTIVE',
      'CODE_ALREADY_EXISTS',
      'INVALID_ACTIVE',
      'STOCK_NOT_ZERO',
      'INVALID_CATEGORY',
      'CATEGORY_IN_USE',
      'CATEGORY_NAME_EXISTS',
      'INVALID_KIND',
      'REASON_REQUIRED',
      'NOTE_REQUIRED',
      'PERSON_NOT_FOUND',
      'SHIFT_NOT_FOUND',
      'SHIFT_NOT_AVAILABLE',
      'SHIFT_NOT_ALLOWED',
      'SITE_NOT_FOUND',
      'SITE_NOT_ALLOWED',
    ]
    for (const hint of contract) {
      expect(STOCK_ERROR_MESSAGES[hint], hint).toBeTruthy()
    }
  })
})

describe('lecturas', () => {
  it('fetchStockItems lee v_stock_admin y pasa a camelCase', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [stockRow()], error: null }))
    const items = await fetchStockItems()
    expect(fromMock).toHaveBeenCalledWith('v_stock_admin')
    expect(items[0]).toMatchObject({
      id: 's1',
      code: 'QUI-001',
      categoryName: 'Químicos',
      minQty: 5,
      costPrice: 1250.5,
      stockValue: 3751.5,
      status: 'low',
      active: true,
    })
  })

  it('fetchStockItems traduce el error de la base', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: { message: 'permission denied', code: '42501' },
      }),
    )
    await expect(fetchStockItems()).rejects.toMatchObject({
      hint: 'FORBIDDEN',
    })
  })

  it('fetchStockItem lanza SUPPLY_NOT_FOUND si no existe', async () => {
    fromMock.mockReturnValue(makeChainable({ data: null, error: null }))
    await expect(fetchStockItem('nope')).rejects.toMatchObject({
      hint: 'SUPPLY_NOT_FOUND',
    })
  })

  it('fetchSupplyCategories pide todas, en su orden', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [{ id: 'c1', name: 'Químicos', sort_order: 0, active: false }],
        error: null,
      }),
    )
    const categories = await fetchSupplyCategories()
    expect(fromMock).toHaveBeenCalledWith('supply_categories')
    expect(categories).toEqual([
      { id: 'c1', name: 'Químicos', sortOrder: 0, active: false },
    ])
  })

  it('fetchSupplyPriceChanges arma quién cambió y deja null en el alta', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            id: 'h1',
            supply_id: 's1',
            changed_at: '2026-10-20T12:00:00Z',
            old_cost_price: 800,
            new_cost_price: 950,
            old_sale_price: 1000,
            new_sale_price: 1200,
            source: 'manual',
            profiles: { first_name: 'Ana', last_name: 'Gómez' },
          },
          {
            id: 'h0',
            supply_id: 's1',
            changed_at: '2026-10-01T12:00:00Z',
            old_cost_price: null,
            new_cost_price: 800,
            old_sale_price: null,
            new_sale_price: 1000,
            source: 'create',
            profiles: null,
          },
        ],
        error: null,
      }),
    )
    const changes = await fetchSupplyPriceChanges('s1')
    expect(calls).toContainEqual(['eq', 'supply_id', 's1'])
    expect(changes[0]).toMatchObject({
      changedByName: 'Ana Gómez',
      oldCostPrice: 800,
      newCostPrice: 950,
    })
    expect(changes[1]).toMatchObject({
      changedByName: null,
      oldCostPrice: null,
      oldSalePrice: null,
    })
  })

  it('fetchStockMovements filtra por artículo y por días de Argentina', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))
    await fetchStockMovements({
      supplyId: 's1',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    })
    expect(fromMock).toHaveBeenCalledWith('v_stock_movements_admin')
    expect(calls).toContainEqual(['eq', 'supply_id', 's1'])
    expect(calls).toContainEqual([
      'gte',
      'recorded_at',
      '2026-10-01T00:00:00-03:00',
    ])
    expect(calls).toContainEqual([
      'lt',
      'recorded_at',
      '2026-11-01T00:00:00-03:00',
    ])
  })

  it('fetchStockMovements mapea la línea con signo, anulación y precios', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            movement_id: 'm1',
            line_id: 'l1',
            kind: 'withdrawal',
            recorded_at: '2026-10-20T15:00:00Z',
            recorded_by_name: 'Ana Gómez',
            person_name: 'Luis Pérez',
            supply_id: 's1',
            supply_code: 'QUI-001',
            supply_name: 'Lavandina',
            qty_delta: -3,
            unit_cost: 100,
            unit_sale: 150,
            line_cost: -300,
            line_sale: -450,
            stock_after: 7,
            voided_at: '2026-10-21T10:00:00Z',
            void_reason: 'Error de carga',
          },
        ],
        error: null,
      }),
    )
    const [line] = await fetchStockMovements({ supplyId: 's1' })
    expect(line).toMatchObject({
      kind: 'withdrawal',
      qtyDelta: -3,
      stockAfter: 7,
      personName: 'Luis Pérez',
      voidedAt: '2026-10-21T10:00:00Z',
      voidReason: 'Error de carga',
      lineCost: -300,
    })
  })

  it('argentinaDayStart y argentinaNextDayStart (cruza el fin de mes y de año)', () => {
    expect(argentinaDayStart('2026-10-26')).toBe('2026-10-26T00:00:00-03:00')
    expect(argentinaNextDayStart('2026-10-31')).toBe(
      '2026-11-01T00:00:00-03:00',
    )
    expect(argentinaNextDayStart('2026-12-31')).toBe(
      '2027-01-01T00:00:00-03:00',
    )
  })

  it('fetchStockSummary normaliza los contadores', async () => {
    rpcMock.mockResolvedValue({
      data: {
        open_reports: 3,
        open_shortages: 2,
        out_of_stock: '1',
        below_min: 4,
      },
      error: null,
    })
    expect(await fetchStockSummary()).toEqual({
      openReports: 3,
      openShortages: 2,
      outOfStock: 1,
      belowMin: 4,
    })
  })
})

describe('categorías y activación', () => {
  it('upsertSupplyCategory manda nombre, orden, estado e id', async () => {
    rpcMock.mockResolvedValue({
      data: { id: 'c1', name: 'Químicos', sort_order: 2, active: true },
      error: null,
    })
    const category = await upsertSupplyCategory({
      id: 'c1',
      name: 'Químicos',
      sortOrder: 2,
      active: true,
    })
    expect(rpcMock).toHaveBeenCalledWith('upsert_supply_category', {
      p_name: 'Químicos',
      p_sort_order: 2,
      p_active: true,
      p_id: 'c1',
    })
    expect(category.sortOrder).toBe(2)
  })

  it('CATEGORY_IN_USE llega con el mensaje en español', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'x', code: 'P0001', hint: 'CATEGORY_IN_USE' },
    })
    await expect(
      upsertSupplyCategory({
        id: 'c1',
        name: 'A',
        sortOrder: 0,
        active: false,
      }),
    ).rejects.toMatchObject({
      hint: 'CATEGORY_IN_USE',
      message: STOCK_ERROR_MESSAGES.CATEGORY_IN_USE,
    })
  })

  it('setSupplyActive: STOCK_NOT_ZERO explica que primero hay que ajustar', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'x', code: 'P0001', hint: 'STOCK_NOT_ZERO' },
    })
    await expect(setSupplyActive('s1', false)).rejects.toMatchObject({
      hint: 'STOCK_NOT_ZERO',
      message: expect.stringContaining('ajustá el stock a cero') as string,
    })
    expect(rpcMock).toHaveBeenCalledWith('set_supply_active', {
      p_supply_id: 's1',
      p_active: false,
    })
  })

  it('setSupplyPrices llama a set_supply_prices', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })
    await setSupplyPrices('s1', 950, 1200.5)
    expect(rpcMock).toHaveBeenCalledWith('set_supply_prices', {
      p_supply_id: 's1',
      p_cost_price: 950,
      p_sale_price: 1200.5,
    })
  })
})

describe('saveSupply: imagen y alta', () => {
  const input = {
    code: 'QUI-001',
    name: 'Lavandina',
    presentation: '1 L',
    categoryId: 'c1',
    minQty: 5,
    costPrice: 100,
    salePrice: 150,
    notes: null,
  }

  it('alta con imagen: sube primero a {id}/…, después llama a upsert_supply con el mismo id', async () => {
    rpcMock.mockResolvedValue({
      data: { id: 'x', code: 'QUI-001', image_path: 'x/y.webp' },
      error: null,
    })
    const blob = new Blob(['img'], { type: 'image/webp' })
    await saveSupply(input, { action: 'replace', blob })

    expect(storageFromMock).toHaveBeenCalledWith('supply-images')
    const [path] = uploadMock.mock.calls[0] as [string]
    const [folder, file] = path.split('/')
    expect(file).toMatch(/\.webp$/)
    const args = rpcMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(args[0]).toBe('upsert_supply')
    expect(args[1].p_id).toBe(folder)
    expect(args[1].p_image_path).toBe(path)
    expect(args[1].p_cost_price).toBe(100)
    expect(args[1].p_sale_price).toBe(150)
    // La subida va antes que el alta.
    expect(uploadMock.mock.invocationCallOrder[0]).toBeLessThan(
      rpcMock.mock.invocationCallOrder[0] as number,
    )
  })

  it('si el alta falla, borra la imagen que acababa de subir', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'x', code: 'P0001', hint: 'CODE_ALREADY_EXISTS' },
    })
    const blob = new Blob(['img'], { type: 'image/webp' })
    await expect(
      saveSupply(input, { action: 'replace', blob }),
    ).rejects.toMatchObject({ hint: 'CODE_ALREADY_EXISTS' })
    const [path] = uploadMock.mock.calls[0] as [string]
    expect(removeMock).toHaveBeenCalledWith([path])
  })

  it('si la subida falla, no llama a upsert_supply', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'boom' } })
    const blob = new Blob(['img'], { type: 'image/webp' })
    await expect(
      saveSupply(input, { action: 'replace', blob }),
    ).rejects.toMatchObject({ hint: 'IMAGE_UPLOAD_FAILED' })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('un navegador sin WebP sube JPEG con extensión .jpg', async () => {
    rpcMock.mockResolvedValue({
      data: { id: 'x', code: 'A', image_path: 'x/y.jpg' },
      error: null,
    })
    await saveSupply(input, {
      action: 'replace',
      blob: new Blob(['img'], { type: 'image/jpeg' }),
    })
    const [path] = uploadMock.mock.calls[0] as [string]
    expect(path).toMatch(/\.jpg$/)
  })

  it('edición sin tocar la imagen: manda la ruta vigente y no los precios', async () => {
    rpcMock.mockResolvedValue({
      data: { id: 's1', code: 'QUI-001', image_path: 's1/a.webp' },
      error: null,
    })
    await saveSupply(
      { ...input, id: 's1' },
      { action: 'keep', currentPath: 's1/a.webp' },
    )
    const args = rpcMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(args[1].p_id).toBe('s1')
    expect(args[1].p_image_path).toBe('s1/a.webp')
    expect(args[1].p_cost_price).toBeUndefined()
    expect(args[1].p_sale_price).toBeUndefined()
    expect(uploadMock).not.toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('edición con imagen nueva: borra la anterior solo después de guardar', async () => {
    rpcMock.mockResolvedValue({
      data: { id: 's1', code: 'QUI-001', image_path: 'n' },
      error: null,
    })
    await saveSupply(
      { ...input, id: 's1' },
      {
        action: 'replace',
        blob: new Blob(['img'], { type: 'image/webp' }),
        currentPath: 's1/vieja.webp',
      },
    )
    expect(removeMock).toHaveBeenCalledWith(['s1/vieja.webp'])
    expect(rpcMock.mock.invocationCallOrder[0]).toBeLessThan(
      removeMock.mock.invocationCallOrder[0] as number,
    )
  })

  it('quitar la imagen manda null y borra el archivo', async () => {
    rpcMock.mockResolvedValue({
      data: { id: 's1', code: 'QUI-001', image_path: null },
      error: null,
    })
    await saveSupply(
      { ...input, id: 's1' },
      { action: 'remove', currentPath: 's1/a.webp' },
    )
    const args = rpcMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(args[1].p_image_path).toBeUndefined()
    expect(removeMock).toHaveBeenCalledWith(['s1/a.webp'])
  })

  it('si guardar la edición falla, conserva el archivo anterior', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'x', code: 'P0001', hint: 'NAME_REQUIRED' },
    })
    await expect(
      saveSupply(
        { ...input, id: 's1' },
        { action: 'remove', currentPath: 's1/a.webp' },
      ),
    ).rejects.toMatchObject({ hint: 'NAME_REQUIRED' })
    expect(removeMock).not.toHaveBeenCalled()
  })
})

describe('registerStockEntry y adjustStock', () => {
  const payload = {
    movement: { id: 'm1', kind: 'entry', recorded_at: '2026-10-26T12:00:00Z' },
    lines: [
      {
        supply_id: 's1',
        code: 'QUI-001',
        name: 'Lavandina',
        presentation: '1 L',
        qty_delta: 10,
        unit_cost: 120,
        unit_sale: 150,
        stock_after: 13,
      },
    ],
  }

  it('manda update_cost solo en la línea con costo cargado y respuesta «Sí»', async () => {
    rpcMock.mockResolvedValue({ data: payload, error: null })
    const result = await registerStockEntry({
      kind: 'entry',
      lines: [
        { supplyId: 's1', qty: 10, unitCost: 120, updateCost: true },
        { supplyId: 's2', qty: 2, unitCost: 50, updateCost: false },
        { supplyId: 's3', qty: 1, unitCost: null, updateCost: true },
      ],
      supplier: 'Distribuidora Sur',
      documentNumber: null,
      note: null,
    })
    expect(rpcMock).toHaveBeenCalledWith('register_stock_entry', {
      p_lines: [
        { supply_id: 's1', qty: 10, unit_cost: 120, update_cost: true },
        { supply_id: 's2', qty: 2, unit_cost: 50 },
        { supply_id: 's3', qty: 1 },
      ],
      p_kind: 'entry',
      p_supplier: 'Distribuidora Sur',
      p_document_number: undefined,
      p_note: undefined,
    })
    expect(result.lines[0]).toMatchObject({
      supplyId: 's1',
      qtyDelta: 10,
      stockAfter: 13,
    })
  })

  it('una devolución manda p_kind = return', async () => {
    rpcMock.mockResolvedValue({
      data: { ...payload, movement: { ...payload.movement, kind: 'return' } },
      error: null,
    })
    const result = await registerStockEntry({
      kind: 'return',
      lines: [{ supplyId: 's1', qty: 1 }],
    })
    expect(
      (rpcMock.mock.calls[0] as [string, Record<string, unknown>])[1].p_kind,
    ).toBe('return')
    expect(result.kind).toBe('return')
  })

  it('INVALID_LINES e INSUFFICIENT_STOCK pasan con su código', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Agregá al menos un artículo.', hint: 'INVALID_LINES' },
    })
    await expect(registerStockEntry({ lines: [] })).rejects.toMatchObject({
      hint: 'INVALID_LINES',
    })
  })

  it('adjustStock manda delta con signo, motivo y nota', async () => {
    rpcMock.mockResolvedValue({
      data: { ...payload, movement: { id: 'm2', kind: 'adjustment' } },
      error: null,
    })
    const result = await adjustStock({
      supplyId: 's1',
      delta: -2,
      reason: 'breakage',
      note: 'Se cayó el bidón',
    })
    expect(rpcMock).toHaveBeenCalledWith('adjust_stock', {
      p_supply_id: 's1',
      p_delta: -2,
      p_reason: 'breakage',
      p_note: 'Se cayó el bidón',
    })
    expect(result.kind).toBe('adjustment')
  })

  it('parseStockPostResult tolera un payload vacío', () => {
    expect(parseStockPostResult(null)).toMatchObject({
      movementId: '',
      lines: [],
    })
  })
})

describe('createSupplyImageUrls', () => {
  it('firma en una sola llamada, sin duplicados ni rutas vacías', async () => {
    createSignedUrlsMock.mockResolvedValue({
      data: [
        { path: 'a/1.webp', signedUrl: 'https://u/1', error: null },
        { path: 'b/2.webp', signedUrl: null, error: 'x' },
      ],
      error: null,
    })
    const urls = await createSupplyImageUrls([
      'a/1.webp',
      null,
      'a/1.webp',
      'b/2.webp',
      '',
    ])
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(1)
    expect(createSignedUrlsMock.mock.calls[0]?.[0]).toEqual([
      'a/1.webp',
      'b/2.webp',
    ])
    expect(urls.get('a/1.webp')).toBe('https://u/1')
    expect(urls.has('b/2.webp')).toBe(false)
  })

  it('sin rutas no llama a Storage', async () => {
    const urls = await createSupplyImageUrls([null, ''])
    expect(urls.size).toBe(0)
    expect(createSignedUrlsMock).not.toHaveBeenCalled()
  })
})
