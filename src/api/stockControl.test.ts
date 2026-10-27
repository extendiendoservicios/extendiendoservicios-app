import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/stock.ts` (módulo E, P25.3): anulación, retiro en nombre de,
 * controles, avisos de faltante y consumo por cliente. Mismo patrón sin red
 * que `stock.test.ts`: se mockea `@/lib/supabase` entero.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

const calls: Array<[string, ...unknown[]]> = []

function makeChainable<T>(
  result: PostgrestResult<T> | (() => PostgrestResult<T>),
) {
  const chain: Record<string, unknown> = {}
  for (const method of [
    'select',
    'order',
    'limit',
    'range',
    'gte',
    'lte',
    'lt',
    'eq',
  ]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args])
      return chain
    }
  }
  chain.then = (
    resolve: (value: PostgrestResult<T>) => void,
    reject?: (reason: unknown) => void,
  ) =>
    Promise.resolve(typeof result === 'function' ? result() : result).then(
      resolve,
      reject,
    )
  return chain
}

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock, rpc: rpcMock },
}))

const {
  voidStockMovement,
  registerWithdrawalOnBehalf,
  parseWithdrawalResult,
  fetchWithdrawalShiftOptions,
  fetchWithdrawalSiteOptions,
  registerStockCount,
  parseStockCountResult,
  fetchStockCounts,
  fetchShortageReports,
  sortShortages,
  resolveSupplyShortage,
  fetchSupplyConsumption,
  fetchAllStockMovements,
  mapStockError,
  VOIDABLE_KINDS,
  STOCK_PAGE_SIZE,
} = await import('./stock')

beforeEach(() => {
  calls.length = 0
  fromMock.mockReset()
  rpcMock.mockReset()
})

describe('voidStockMovement (IS-27)', () => {
  it('llama a void_stock_movement con el movimiento y el motivo', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })
    await voidStockMovement('m1', 'Se cargó dos veces')
    expect(rpcMock).toHaveBeenCalledWith('void_stock_movement', {
      p_movement_id: 'm1',
      p_reason: 'Se cargó dos veces',
    })
  })

  it('solo se anulan ingresos, devoluciones y retiros', () => {
    expect([...VOIDABLE_KINDS]).toEqual(['entry', 'return', 'withdrawal'])
  })

  it.each([
    ['REASON_REQUIRED', 'Indicá el motivo de la anulación.'],
    ['MOVEMENT_NOT_FOUND', 'El movimiento no existe.'],
    [
      'MOVEMENT_NOT_VOIDABLE',
      'Un ajuste no se anula: corregilo con otro ajuste.',
    ],
    ['MOVEMENT_ALREADY_VOIDED', 'Ese movimiento ya está anulado.'],
    [
      'VOID_INSUFFICIENT_STOCK',
      'No se puede anular: el stock de ese ingreso ya se usó.',
    ],
  ])(
    'muestra tal cual el mensaje del servidor para %s',
    async (hint, message) => {
      rpcMock.mockResolvedValue({
        data: null,
        error: { code: 'P0001', message, hint },
      })
      const error = await voidStockMovement('m1', 'x').catch((e: unknown) => e)
      expect(isApiError(error)).toBe(true)
      expect((error as Error).message).toBe(message)
      expect((error as { hint: string }).hint).toBe(hint)
    },
  )
})

describe('registerWithdrawalOnBehalf (IS-11, IS-12)', () => {
  it('manda las líneas, la persona y el turno', async () => {
    rpcMock.mockResolvedValue({
      data: {
        movement: { id: 'm1', recorded_at: '2026-10-26T17:30:00Z' },
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
      },
      error: null,
    })
    const result = await registerWithdrawalOnBehalf({
      personId: 'p1',
      shiftId: 't1',
      note: 'Para el piso 3',
      lines: [{ supplyId: 's1', qty: 2 }],
    })
    expect(rpcMock).toHaveBeenCalledWith('register_withdrawal', {
      p_lines: [{ supply_id: 's1', qty: 2 }],
      p_person_id: 'p1',
      p_shift_id: 't1',
      p_site_id: undefined,
      p_note: 'Para el piso 3',
    })
    expect(result).toEqual({
      movementId: 'm1',
      recordedAt: '2026-10-26T17:30:00Z',
      lines: [
        {
          supplyId: 's1',
          code: 'QUI-001',
          name: 'Lavandina',
          presentation: '1 L',
          qty: 2,
        },
      ],
    })
  })

  it('con una sede manda la sede y la observación, sin turno', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })
    await registerWithdrawalOnBehalf({
      personId: 'p1',
      siteId: 'si1',
      note: 'Reposición',
      lines: [{ supplyId: 's1', qty: 1 }],
    })
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({
      p_site_id: 'si1',
      p_shift_id: undefined,
      p_note: 'Reposición',
    })
  })

  it('si falta la cantidad, usa el valor absoluto de qty_delta', () => {
    expect(
      parseWithdrawalResult({
        movement: { id: 'm1' },
        lines: [{ supply_id: 's1', qty_delta: -4 }],
      }).lines[0]?.qty,
    ).toBe(4)
  })

  it('el mensaje de «observación obligatoria» es el del servidor, no el del ajuste', () => {
    const error = mapStockError({
      code: 'P0001',
      message: 'Si no es de un turno, escribí una observación.',
      hint: 'NOTE_REQUIRED',
    })
    expect(error.message).toBe('Si no es de un turno, escribí una observación.')
  })

  it('el mensaje de stock insuficiente de la administración trae cuánto hay', () => {
    const error = mapStockError({
      code: 'P0001',
      message: 'No alcanza el stock de Lavandina: hay 1.',
      hint: 'INSUFFICIENT_STOCK',
    })
    expect(error.message).toBe('No alcanza el stock de Lavandina: hay 1.')
  })
})

describe('opciones de turno y sede del retiro (IS-28)', () => {
  it('lee los turnos elegibles, los más recientes primero', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            shift_id: 't1',
            shift_date: '2026-10-26',
            start_time: '08:00:00',
            end_time: '12:00:00',
            open_ended: false,
            client_id: 'c1',
            client_name: 'Banco Sur',
            site_id: 'si1',
            site_name: 'Casa Central',
            starts_at: '2026-10-26T11:00:00Z',
          },
        ],
        error: null,
      }),
    )
    const [option] = await fetchWithdrawalShiftOptions()
    expect(fromMock).toHaveBeenCalledWith('v_withdrawal_shift_options')
    expect(calls).toContainEqual(['order', 'starts_at', { ascending: false }])
    expect(option).toEqual({
      shiftId: 't1',
      shiftDate: '2026-10-26',
      startTime: '08:00:00',
      endTime: '12:00:00',
      openEnded: false,
      clientId: 'c1',
      clientName: 'Banco Sur',
      siteId: 'si1',
      siteName: 'Casa Central',
    })
  })

  it('lee las sedes elegibles', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            site_id: 'si1',
            site_name: 'Casa Central',
            client_id: 'c1',
            client_name: 'Banco Sur',
          },
        ],
        error: null,
      }),
    )
    expect(await fetchWithdrawalSiteOptions()).toEqual([
      {
        siteId: 'si1',
        siteName: 'Casa Central',
        clientId: 'c1',
        clientName: 'Banco Sur',
      },
    ])
    expect(fromMock).toHaveBeenCalledWith('v_withdrawal_site_options')
  })
})

describe('registerStockCount (IS-16, IS-31)', () => {
  const payload = {
    count: { id: 'k1', counted_at: '2026-10-26T13:00:00Z' },
    movement: { id: 'm1' },
    lines: [
      {
        supply_id: 's1',
        code: 'QUI-001',
        name: 'Lavandina',
        presentation: '1 L',
        system_qty: 10,
        counted_qty: 8,
        difference: -2,
      },
    ],
  }

  it('manda la fecha, el revisor como persona y solo las líneas contadas', async () => {
    rpcMock.mockResolvedValue({ data: payload, error: null })
    const result = await registerStockCount({
      countedAt: '2026-10-26T10:00:00-03:00',
      reviewerId: 'u1',
      reviewerName: null,
      notes: 'Depósito',
      lines: [{ supplyId: 's1', countedQty: 8 }],
    })
    expect(rpcMock).toHaveBeenCalledWith('register_stock_count', {
      p_counted_at: '2026-10-26T10:00:00-03:00',
      p_lines: [{ supply_id: 's1', counted_qty: 8 }],
      p_reviewer_id: 'u1',
      p_reviewer_name: undefined,
      p_notes: 'Depósito',
    })
    expect(result).toEqual({
      countId: 'k1',
      countedAt: '2026-10-26T13:00:00Z',
      movementId: 'm1',
      lines: [
        {
          supplyId: 's1',
          code: 'QUI-001',
          name: 'Lavandina',
          presentation: '1 L',
          systemQty: 10,
          countedQty: 8,
          difference: -2,
        },
      ],
    })
  })

  it('con un nombre escrito manda el nombre y no la persona', async () => {
    rpcMock.mockResolvedValue({ data: payload, error: null })
    await registerStockCount({
      countedAt: '2026-10-26T10:00:00-03:00',
      reviewerName: 'Marta (proveedor)',
      lines: [{ supplyId: 's1', countedQty: 0 }],
    })
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({
      p_reviewer_id: undefined,
      p_reviewer_name: 'Marta (proveedor)',
      p_lines: [{ supply_id: 's1', counted_qty: 0 }],
    })
  })

  it('un control sin diferencias no trae movimiento', () => {
    expect(
      parseStockCountResult({ count: { id: 'k1' }, movement: null, lines: [] }),
    ).toMatchObject({
      movementId: null,
      lines: [],
    })
  })

  it.each([
    [
      'COUNT_IN_FUTURE',
      'La fecha y la hora del control no pueden ser futuras.',
    ],
    ['REVIEWER_REQUIRED', 'Indicá quién revisó: una persona o un nombre.'],
    [
      'COUNT_INCONSISTENT',
      'Los movimientos posteriores dejarían el stock negativo.',
    ],
  ])('muestra el mensaje del servidor para %s', async (hint, message) => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message, hint },
    })
    const error = await registerStockCount({
      countedAt: 'x',
      reviewerName: 'x',
      lines: [],
    }).catch((e: unknown) => e)
    expect((error as Error).message).toBe(message)
  })
})

describe('fetchStockCounts', () => {
  it('mapea el historial con sus diferencias', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            count_id: 'k1',
            counted_at: '2026-10-24T13:00:00Z',
            reviewer_id: null,
            reviewer_name: 'Marta Ruiz',
            notes: null,
            created_at: '2026-10-24T18:00:00Z',
            created_by_name: 'Ana Gómez',
            movement_id: 'm1',
            lines_count: 3,
            differences_count: 1,
            lines: [
              {
                supply_id: 's1',
                code: 'QUI-001',
                name: 'Lavandina',
                presentation: null,
                system_qty: 5,
                counted_qty: 4,
                difference: -1,
              },
            ],
          },
        ],
        error: null,
      }),
    )
    const [count] = await fetchStockCounts()
    expect(fromMock).toHaveBeenCalledWith('v_stock_counts_admin')
    expect(count).toMatchObject({
      countId: 'k1',
      reviewerName: 'Marta Ruiz',
      createdByName: 'Ana Gómez',
      linesCount: 3,
      differencesCount: 1,
    })
    expect(count?.lines[0]?.difference).toBe(-1)
  })
})

describe('avisos de faltante (IS-29)', () => {
  const baseRow = {
    id: 'r1',
    status: 'open',
    created_at: '2026-10-25T13:00:00Z',
    supply_id: 's1',
    description: null,
    shift_id: null,
    comment: 'Queda un solo bidón',
    resolved_at: null,
    resolution_note: null,
    reporter: { first_name: 'Lucía', last_name: 'Pérez' },
    resolver: null,
    supply: { code: 'QUI-001', name: 'Lavandina', presentation: '1 L' },
    shift: null,
    site: {
      name: 'Casa Central',
      client: { legal_name: 'Banco Sur S.A.', trade_name: 'Banco Sur' },
    },
  }

  it('mapea quién avisó, el artículo, la sede y el comentario', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [baseRow], error: null }))
    const [report] = await fetchShortageReports()
    expect(fromMock).toHaveBeenCalledWith('supply_shortage_reports')
    expect(report).toMatchObject({
      id: 'r1',
      status: 'open',
      reportedByName: 'Lucía Pérez',
      supplyName: 'Lavandina',
      supplyPresentation: '1 L',
      siteName: 'Casa Central',
      clientName: 'Banco Sur',
      comment: 'Queda un solo bidón',
    })
  })

  it('con turno, trae el día, la franja, el cliente y la sede del turno', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            ...baseRow,
            shift_id: 't1',
            site: null,
            shift: {
              shift_date: '2026-10-26',
              start_time: '08:00:00',
              end_time: '12:00:00',
              site: { name: 'Sucursal Norte' },
              client: { legal_name: 'Colegio Mayor S.R.L.', trade_name: null },
            },
          },
        ],
        error: null,
      }),
    )
    const [report] = await fetchShortageReports()
    expect(report).toMatchObject({
      shiftId: 't1',
      shiftDate: '2026-10-26',
      startTime: '08:00:00',
      siteName: 'Sucursal Norte',
      clientName: 'Colegio Mayor S.R.L.',
    })
  })

  it('un aviso de texto libre trae la descripción y ningún artículo', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            ...baseRow,
            supply_id: null,
            supply: null,
            description: 'Guantes M',
          },
        ],
        error: null,
      }),
    )
    const [report] = await fetchShortageReports()
    expect(report).toMatchObject({
      supplyId: null,
      supplyName: null,
      description: 'Guantes M',
    })
  })

  it('ordena abiertos primero y, dentro de cada estado, lo más reciente arriba', () => {
    const base = {
      supplyId: null,
      supplyCode: null,
      supplyName: null,
      supplyPresentation: null,
      description: 'x',
      shiftId: null,
      shiftDate: null,
      startTime: null,
      endTime: null,
      clientName: null,
      siteName: null,
      comment: null,
      reportedByName: null,
      resolvedByName: null,
      resolutionNote: null,
    }
    const sorted = sortShortages([
      {
        ...base,
        id: 'resuelto-viejo',
        status: 'resolved',
        createdAt: '2026-10-01T10:00:00Z',
        resolvedAt: '2026-10-02T10:00:00Z',
      },
      {
        ...base,
        id: 'abierto-viejo',
        status: 'open',
        createdAt: '2026-10-10T10:00:00Z',
        resolvedAt: null,
      },
      {
        ...base,
        id: 'resuelto-nuevo',
        status: 'resolved',
        createdAt: '2026-10-05T10:00:00Z',
        resolvedAt: '2026-10-20T10:00:00Z',
      },
      {
        ...base,
        id: 'abierto-nuevo',
        status: 'open',
        createdAt: '2026-10-25T10:00:00Z',
        resolvedAt: null,
      },
    ])
    expect(sorted.map((report) => report.id)).toEqual([
      'abierto-nuevo',
      'abierto-viejo',
      'resuelto-nuevo',
      'resuelto-viejo',
    ])
  })

  it('resolveSupplyShortage manda el aviso y la nota', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })
    await resolveSupplyShortage('r1', 'Se compró')
    expect(rpcMock).toHaveBeenCalledWith('resolve_supply_shortage', {
      p_report_id: 'r1',
      p_note: 'Se compró',
    })
  })

  it.each([
    ['NOTE_REQUIRED', 'Escribí una nota para resolver el aviso.'],
    ['SHORTAGE_NOT_FOUND', 'El aviso no existe.'],
    ['SHORTAGE_ALREADY_RESOLVED', 'Ese aviso ya está resuelto.'],
  ])('muestra el mensaje del servidor para %s', async (hint, message) => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message, hint },
    })
    const error = await resolveSupplyShortage('r1', '').catch((e: unknown) => e)
    expect((error as Error).message).toBe(message)
  })
})

describe('consumo por cliente (IS-24)', () => {
  it('filtra por días, cliente y sede, y mapea cantidades y totales', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            day: '2026-10-05',
            client_id: 'c1',
            client_name: 'Banco Sur',
            site_id: 'si1',
            site_name: 'Casa Central',
            supply_id: 's1',
            supply_code: 'QUI-001',
            supply_name: 'Lavandina',
            supply_presentation: '1 L',
            qty: 2,
            cost_total: '200.00',
            sale_total: '300.00',
          },
        ],
        error: null,
      }),
    )
    const rows = await fetchSupplyConsumption({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-26',
      clientId: 'c1',
      siteId: 'si1',
    })
    expect(fromMock).toHaveBeenCalledWith('v_supply_consumption_by_client')
    expect(calls).toContainEqual(['gte', 'day', '2026-10-01'])
    expect(calls).toContainEqual(['lte', 'day', '2026-10-26'])
    expect(calls).toContainEqual(['eq', 'client_id', 'c1'])
    expect(calls).toContainEqual(['eq', 'site_id', 'si1'])
    expect(rows[0]).toMatchObject({
      qty: 2,
      costTotal: 200,
      saleTotal: 300,
      supplyName: 'Lavandina',
    })
  })

  it('sin cliente ni sede no los filtra', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))
    await fetchSupplyConsumption({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-26',
    })
    expect(
      calls.some(
        ([method, column]) => method === 'eq' && column === 'client_id',
      ),
    ).toBe(false)
  })

  it('pide la página siguiente mientras la anterior venga llena', async () => {
    const full = Array.from({ length: STOCK_PAGE_SIZE }, (_, index) => ({
      day: '2026-10-05',
      client_id: 'c1',
      client_name: 'Banco Sur',
      site_id: 'si1',
      site_name: 'Casa Central',
      supply_id: `s${index}`,
      supply_code: 'X',
      supply_name: 'X',
      supply_presentation: null,
      qty: 1,
      cost_total: 1,
      sale_total: 1,
    }))
    fromMock
      .mockReturnValueOnce(makeChainable({ data: full, error: null }))
      .mockReturnValueOnce(
        makeChainable({ data: full.slice(0, 5), error: null }),
      )
    const rows = await fetchSupplyConsumption({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-26',
    })
    expect(rows).toHaveLength(STOCK_PAGE_SIZE + 5)
    expect(calls).toContainEqual(['range', 0, STOCK_PAGE_SIZE - 1])
    expect(calls).toContainEqual([
      'range',
      STOCK_PAGE_SIZE,
      2 * STOCK_PAGE_SIZE - 1,
    ])
  })
})

describe('fetchAllStockMovements: el Excel trae todo lo filtrado (IS-18)', () => {
  function rawLine(index: number) {
    return {
      movement_id: `m${index}`,
      line_id: `l${index}`,
      kind: 'entry',
      recorded_at: '2026-10-20T15:00:00Z',
      supply_id: 's1',
      supply_code: 'QUI-001',
      supply_name: 'Lavandina',
      qty_delta: 1,
    }
  }

  it('aplica los mismos filtros y sigue de a páginas de 1000, sin el tope de 500', async () => {
    const full = Array.from({ length: STOCK_PAGE_SIZE }, (_, index) =>
      rawLine(index),
    )
    fromMock
      .mockReturnValueOnce(makeChainable({ data: full, error: null }))
      .mockReturnValueOnce(
        makeChainable({ data: [rawLine(9999)], error: null }),
      )
    const lines = await fetchAllStockMovements({
      personId: 'p1',
      kind: 'withdrawal',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    })
    expect(lines).toHaveLength(STOCK_PAGE_SIZE + 1)
    expect(calls).toContainEqual(['eq', 'person_id', 'p1'])
    expect(calls).toContainEqual(['eq', 'kind', 'withdrawal'])
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
    expect(calls.some(([method]) => method === 'limit')).toBe(false)
  })

  it('con una sola página corta, no pide más', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [rawLine(1)], error: null }))
    const lines = await fetchAllStockMovements({})
    expect(lines).toHaveLength(1)
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('propaga el error del servidor', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          code: 'P0001',
          message: 'No tenés permiso.',
          hint: 'FORBIDDEN',
        },
      }),
    )
    const error = await fetchAllStockMovements({}).catch((e: unknown) => e)
    expect(isApiError(error)).toBe(true)
  })
})
