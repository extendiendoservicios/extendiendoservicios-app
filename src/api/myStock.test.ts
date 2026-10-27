import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/myStock.ts` (P25.4, módulo E): mismo patrón sin red que
 * `myWorkdays.test.ts` -- se mockea `@/lib/supabase` entero.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

const calls: { method: string; args: unknown[] }[] = []

function makeChainable<T>(result: PostgrestResult<T>) {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
      return chain
    }
  const chain: Record<string, unknown> = {
    select: record('select'),
    order: record('order'),
    limit: record('limit'),
    then: (
      resolve: (value: PostgrestResult<T>) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

const { fromMock, rpcMock, storageFromMock, createSignedUrlsMock } = vi.hoisted(
  () => {
    const createSignedUrlsMock = vi.fn()
    return {
      fromMock: vi.fn(),
      rpcMock: vi.fn(),
      createSignedUrlsMock,
      storageFromMock: vi.fn(() => ({
        createSignedUrls: createSignedUrlsMock,
      })),
    }
  },
)

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    storage: { from: storageFromMock },
  },
}))

const {
  fetchSupplyCatalog,
  fetchWithdrawalShiftOptions,
  fetchWithdrawalSiteOptions,
  fetchMyWithdrawals,
  fetchMyShortageReports,
  signSupplyImages,
  registerWithdrawal,
  reportSupplyShortage,
  stockErrorMessage,
  STOCK_HINT_MESSAGES,
} = await import('./myStock')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
  storageFromMock.mockClear()
  createSignedUrlsMock.mockReset()
  calls.length = 0
})

function rpcError(hint: string, message: string) {
  return { data: null, error: { code: 'P0001', hint, message } }
}

describe('lecturas', () => {
  it('fetchSupplyCatalog lee v_supply_catalog y no trae precios ni cantidades', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            id: 's1',
            code: 'QUI-001',
            name: 'Lavandina',
            presentation: '1 L',
            category_id: 'c1',
            category_name: 'Químicos',
            category_sort_order: 1,
            image_path: 's1/a.webp',
            out_of_stock: false,
          },
          {
            id: 's2',
            code: 'DES-002',
            name: 'Guantes',
            presentation: null,
            category_id: null,
            category_name: null,
            category_sort_order: null,
            image_path: null,
            out_of_stock: true,
          },
        ],
        error: null,
      }),
    )

    const items = await fetchSupplyCatalog()

    expect(fromMock).toHaveBeenCalledWith('v_supply_catalog')
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      id: 's1',
      code: 'QUI-001',
      name: 'Lavandina',
      presentation: '1 L',
      categoryId: 'c1',
      categoryName: 'Químicos',
      categorySortOrder: 1,
      imagePath: 's1/a.webp',
      outOfStock: false,
    })
    expect(items[1]?.outOfStock).toBe(true)
    expect(Object.keys(items[0] ?? {})).not.toContain('stockQty')
    expect(Object.keys(items[0] ?? {})).not.toContain('costPrice')
  })

  it('fetchWithdrawalShiftOptions mapea las opciones y marca «Mis sedes»', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            shift_id: 'sh1',
            shift_date: '2026-10-26',
            start_time: '08:00:00',
            end_time: '12:00:00',
            starts_at: '2026-10-26T11:00:00Z',
            open_ended: false,
            client_name: 'Limpiadora SRL',
            site_id: 'si1',
            site_name: 'Sede Centro',
            is_assigned: false,
            is_priority: true,
          },
        ],
        error: null,
      }),
    )

    const options = await fetchWithdrawalShiftOptions()

    expect(fromMock).toHaveBeenCalledWith('v_withdrawal_shift_options')
    expect(options).toEqual([
      {
        shiftId: 'sh1',
        shiftDate: '2026-10-26',
        startTime: '08:00:00',
        endTime: '12:00:00',
        startsAt: '2026-10-26T11:00:00Z',
        openEnded: false,
        clientName: 'Limpiadora SRL',
        siteId: 'si1',
        siteName: 'Sede Centro',
        isAssigned: false,
        isPriority: true,
      },
    ])
  })

  it('fetchWithdrawalSiteOptions lee v_withdrawal_site_options', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            site_id: 'si1',
            site_name: 'Sede Centro',
            client_id: 'c1',
            client_name: 'Limpiadora SRL',
            is_priority: false,
          },
        ],
        error: null,
      }),
    )

    const sites = await fetchWithdrawalSiteOptions()

    expect(fromMock).toHaveBeenCalledWith('v_withdrawal_site_options')
    expect(sites[0]).toMatchObject({
      siteId: 'si1',
      clientName: 'Limpiadora SRL',
      isPriority: false,
    })
  })

  it('fetchMyWithdrawals trae lo más reciente primero, con líneas y la marca de anulado', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            movement_id: 'm1',
            recorded_at: '2026-10-26T15:00:00Z',
            note: null,
            on_behalf: true,
            registered_by_name: 'Oficina',
            shift_id: 'sh1',
            shift_date: '2026-10-26',
            start_time: '08:00:00',
            end_time: '12:00:00',
            client_name: 'Limpiadora SRL',
            site_name: 'Sede Centro',
            total_qty: 3,
            voided_at: '2026-10-26T16:00:00Z',
            void_reason: 'Error de carga',
            lines: [
              {
                supply_id: 's1',
                code: 'QUI-001',
                name: 'Lavandina',
                presentation: '1 L',
                qty: 3,
              },
            ],
          },
        ],
        error: null,
      }),
    )

    const withdrawals = await fetchMyWithdrawals()

    expect(fromMock).toHaveBeenCalledWith('v_my_withdrawals')
    expect(calls).toContainEqual({
      method: 'order',
      args: ['recorded_at', { ascending: false }],
    })
    expect(withdrawals[0]).toMatchObject({
      movementId: 'm1',
      onBehalf: true,
      totalQty: 3,
      voidedAt: '2026-10-26T16:00:00Z',
      lines: [{ supplyId: 's1', qty: 3, presentation: '1 L' }],
    })
  })

  it('fetchMyShortageReports mapea estado y nota de resolución', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            id: 'r1',
            created_at: '2026-10-25T10:00:00Z',
            status: 'resolved',
            supply_name: 'Lavandina · 1 L',
            supply_code: 'QUI-001',
            description: null,
            comment: 'Queda poca',
            resolved_at: '2026-10-25T12:00:00Z',
            resolved_by_name: 'Ana',
            resolution_note: 'Se compró',
          },
          {
            id: 'r2',
            created_at: '2026-10-26T10:00:00Z',
            status: 'open',
            supply_name: null,
            description: 'Bolsas de 120 L',
          },
        ],
        error: null,
      }),
    )

    const reports = await fetchMyShortageReports()

    expect(fromMock).toHaveBeenCalledWith('v_my_shortage_reports')
    expect(reports[0]).toMatchObject({
      status: 'resolved',
      resolutionNote: 'Se compró',
      resolvedByName: 'Ana',
    })
    expect(reports[1]).toMatchObject({
      status: 'open',
      supplyName: null,
      description: 'Bolsas de 120 L',
    })
  })

  it('una lectura con error lanza ApiError', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: { message: 'boom', code: '42501' },
      }),
    )
    await expect(fetchSupplyCatalog()).rejects.toMatchObject({
      name: 'ApiError',
      hint: 'FORBIDDEN',
    })
  })
})

describe('signSupplyImages', () => {
  it('firma sin duplicados ni vacíos en el bucket privado supply-images', async () => {
    createSignedUrlsMock.mockResolvedValue({
      data: [
        { path: 's1/a.webp', signedUrl: 'https://x/a', error: null },
        { path: 's2/b.webp', signedUrl: null, error: 'no existe' },
      ],
      error: null,
    })

    const urls = await signSupplyImages([
      's1/a.webp',
      '',
      's1/a.webp',
      's2/b.webp',
    ])

    expect(storageFromMock).toHaveBeenCalledWith('supply-images')
    expect(createSignedUrlsMock).toHaveBeenCalledWith(
      ['s1/a.webp', 's2/b.webp'],
      3600,
    )
    expect(urls.get('s1/a.webp')).toBe('https://x/a')
    expect(urls.has('s2/b.webp')).toBe(false)
  })

  it('sin rutas no llama a Storage', async () => {
    const urls = await signSupplyImages([])
    expect(urls.size).toBe(0)
    expect(storageFromMock).not.toHaveBeenCalled()
  })
})

describe('registerWithdrawal', () => {
  const RESULT = {
    movement: {
      id: 'm9',
      recorded_at: '2026-10-26T15:07:00Z',
      shift_id: 'sh1',
      site_id: 'si1',
      note: null,
    },
    lines: [
      {
        supply_id: 's1',
        code: 'QUI-001',
        name: 'Lavandina',
        presentation: '1 L',
        qty: 2,
        qty_delta: -2,
      },
    ],
  }

  it('retira para un turno, sin p_person_id ni sede, y devuelve la hora del servidor', async () => {
    rpcMock.mockResolvedValue({ data: RESULT, error: null })

    const result = await registerWithdrawal({
      lines: [{ supplyId: 's1', qty: 2 }],
      shiftId: 'sh1',
      siteId: 'si-ignorada',
      note: '  ',
    })

    expect(rpcMock).toHaveBeenCalledWith('register_withdrawal', {
      p_lines: [{ supply_id: 's1', qty: 2 }],
      p_shift_id: 'sh1',
      p_site_id: undefined,
      p_note: undefined,
    })
    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect('p_person_id' in args).toBe(false)
    expect(result.recordedAt).toBe('2026-10-26T15:07:00Z')
    expect(result.lines[0]).toEqual({
      supplyId: 's1',
      code: 'QUI-001',
      name: 'Lavandina',
      presentation: '1 L',
      qty: 2,
    })
  })

  it('retira para una sede con la observación recortada', async () => {
    rpcMock.mockResolvedValue({ data: RESULT, error: null })

    await registerWithdrawal({
      lines: [{ supplyId: 's1', qty: 1 }],
      siteId: 'si1',
      note: ' reposición de la semana ',
    })

    expect(rpcMock).toHaveBeenCalledWith('register_withdrawal', {
      p_lines: [{ supply_id: 's1', qty: 1 }],
      p_shift_id: undefined,
      p_site_id: 'si1',
      p_note: 'reposición de la semana',
    })
  })

  it('INSUFFICIENT_STOCK muestra el mensaje del servidor (ya sin la cantidad)', async () => {
    rpcMock.mockResolvedValue(
      rpcError(
        'INSUFFICIENT_STOCK',
        'No alcanza el stock de Lavandina. Consultá en la oficina.',
      ),
    )

    await expect(
      registerWithdrawal({
        lines: [{ supplyId: 's1', qty: 99 }],
        shiftId: 'sh1',
      }),
    ).rejects.toMatchObject({
      hint: 'INSUFFICIENT_STOCK',
      message: 'No alcanza el stock de Lavandina. Consultá en la oficina.',
    })
  })

  it('NOTE_REQUIRED y SHIFT_NOT_ALLOWED llegan con el mensaje propio de la app', async () => {
    rpcMock.mockResolvedValueOnce(
      rpcError('NOTE_REQUIRED', 'texto del servidor'),
    )
    await expect(
      registerWithdrawal({
        lines: [{ supplyId: 's1', qty: 1 }],
        siteId: 'si1',
      }),
    ).rejects.toMatchObject({
      hint: 'NOTE_REQUIRED',
      message: STOCK_HINT_MESSAGES.NOTE_REQUIRED,
    })

    rpcMock.mockResolvedValueOnce(rpcError('SHIFT_NOT_ALLOWED', 'otro texto'))
    await expect(
      registerWithdrawal({
        lines: [{ supplyId: 's1', qty: 1 }],
        shiftId: 'sh2',
      }),
    ).rejects.toMatchObject({
      hint: 'SHIFT_NOT_ALLOWED',
      message: 'No podés elegir ese turno.',
    })
  })
})

describe('reportSupplyShortage', () => {
  const ROW = {
    id: 'r1',
    status: 'open',
    created_at: '2026-10-26T15:00:00Z',
    supply_id: 's1',
    description: null,
  }

  it('avisa con un artículo del catálogo y no manda la descripción', async () => {
    rpcMock.mockResolvedValue({ data: ROW, error: null })

    const result = await reportSupplyShortage({
      supplyId: 's1',
      description: 'ignorada',
      shiftId: 'sh1',
      comment: ' queda poco ',
    })

    expect(rpcMock).toHaveBeenCalledWith('report_supply_shortage', {
      p_supply_id: 's1',
      p_description: undefined,
      p_shift_id: 'sh1',
      p_site_id: undefined,
      p_comment: 'queda poco',
    })
    expect(result).toMatchObject({ id: 'r1', status: 'open' })
  })

  it('avisa con texto libre', async () => {
    rpcMock.mockResolvedValue({
      data: { ...ROW, supply_id: null, description: 'Bolsas de 120 L' },
      error: null,
    })

    await reportSupplyShortage({ description: ' Bolsas de 120 L ' })

    expect(rpcMock).toHaveBeenCalledWith('report_supply_shortage', {
      p_supply_id: undefined,
      p_description: 'Bolsas de 120 L',
      p_shift_id: undefined,
      p_site_id: undefined,
      p_comment: undefined,
    })
  })

  it('SHORTAGE_TARGET_REQUIRED llega con mensaje en español', async () => {
    rpcMock.mockResolvedValue(rpcError('SHORTAGE_TARGET_REQUIRED', 'x'))
    await expect(reportSupplyShortage({})).rejects.toMatchObject({
      hint: 'SHORTAGE_TARGET_REQUIRED',
      message: STOCK_HINT_MESSAGES.SHORTAGE_TARGET_REQUIRED,
    })
  })
})

describe('mensajes de error', () => {
  it('tiene mensaje propio para cada código de las dos RPC, salvo INSUFFICIENT_STOCK', () => {
    const codes = [
      'FORBIDDEN',
      'INVALID_LINES',
      'INVALID_QTY',
      'DUPLICATE_SUPPLY',
      'SUPPLY_NOT_FOUND',
      'SUPPLY_INACTIVE',
      'PERSON_REQUIRED',
      'PERSON_NOT_FOUND',
      'SHIFT_OR_SITE_REQUIRED',
      'SHIFT_NOT_FOUND',
      'SHIFT_NOT_AVAILABLE',
      'SHIFT_NOT_ALLOWED',
      'SITE_SHIFT_MISMATCH',
      'SITE_NOT_FOUND',
      'SITE_NOT_ALLOWED',
      'NOTE_REQUIRED',
      'SHORTAGE_TARGET_REQUIRED',
    ]
    for (const code of codes) {
      expect(stockErrorMessage(code), code).toBeTruthy()
    }
    expect(stockErrorMessage('INSUFFICIENT_STOCK')).toBeNull()
    expect(stockErrorMessage(null)).toBeNull()
  })
})
