import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/mediaAdmin.ts` (módulo H, P21.4): mismo patrón sin red que
 * `services.test.ts`: se mockea `@/lib/supabase` entero.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

const calls: Array<[string, ...unknown[]]> = []

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {}
  for (const method of [
    'select',
    'order',
    'range',
    'limit',
    'gte',
    'lte',
    'eq',
  ]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args])
      return chain
    }
  }
  chain.single = () => Promise.resolve(result)
  chain.then = (
    resolve: (value: PostgrestResult<T>) => void,
    reject?: (reason: unknown) => void,
  ) => Promise.resolve(result).then(resolve, reject)
  return chain
}

const { fromMock, rpcMock, storageFromMock, createSignedUrlsMock, removeMock } =
  vi.hoisted(() => ({
    removeMock: vi.fn(),
    fromMock: vi.fn(),
    rpcMock: vi.fn(),
    storageFromMock: vi.fn(),
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
  fetchShiftMediaPage,
  fetchShiftMediaByShift,
  fetchShiftMediaBySupervision,
  createEvidenceSignedUrls,
  createThumbSignedUrls,
  createOriginalSignedUrl,
  setShiftMediaKeep,
  setShiftMediaKeepMany,
  deleteShiftMedia,
  chunkItems,
  fetchStorageUsage,
  parseStorageUsage,
  fetchMediaRetention,
  setMediaRetention,
  mapMediaAdminError,
  storageBucketLabel,
  MEDIA_PAGE_SIZE,
} = await import('./mediaAdmin')

beforeEach(() => {
  calls.length = 0
  fromMock.mockReset()
  rpcMock.mockReset()
  storageFromMock.mockReset()
  createSignedUrlsMock.mockReset()
  removeMock.mockReset()
  storageFromMock.mockReturnValue({
    createSignedUrls: createSignedUrlsMock,
    remove: removeMock,
  })
})

function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    shift_id: 'sh1',
    shift_date: '2026-10-13',
    client_id: 'c1',
    client_name: 'Limpia Ya',
    site_id: 'si1',
    site_name: 'Sede Centro',
    assignment_id: 'a1',
    supervision_id: null,
    uploaded_by: 'p1',
    uploader_first_name: 'Ana',
    uploader_last_name: 'Pérez',
    uploader_role: 'employee',
    kind: 'photo',
    storage_path: 'sh1/m1.jpg',
    thumb_path: 'sh1/m1_thumb.jpg',
    size_bytes: 170000,
    width: 1280,
    height: 960,
    duration_s: null,
    captured_at: null,
    created_at: '2026-10-13T11:00:00Z',
    keep: false,
    has_file: true,
    expires_on: '2026-12-12',
    retention_days: 60,
    ...overrides,
  }
}

describe('fetchShiftMediaPage', () => {
  it('lee v_shift_media, pasa los nombres a camelCase y arma el nombre de la persona', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [rawRow()], error: null }))
    const page = await fetchShiftMediaPage({}, 0)
    expect(fromMock).toHaveBeenCalledWith('v_shift_media')
    expect(page.hasMore).toBe(false)
    expect(page.rows[0]).toMatchObject({
      id: 'm1',
      shiftId: 'sh1',
      shiftDate: '2026-10-13',
      clientName: 'Limpia Ya',
      uploaderName: 'Ana Pérez',
      kind: 'photo',
      storagePath: 'sh1/m1.jpg',
      thumbPath: 'sh1/m1_thumb.jpg',
      hasFile: true,
      expiresOn: '2026-12-12',
      keep: false,
    })
  })

  it('pide una fila de más para saber si hay otra página, y no la devuelve', async () => {
    const rows = Array.from({ length: MEDIA_PAGE_SIZE + 1 }, (_, i) =>
      rawRow({ id: `m${i}` }),
    )
    fromMock.mockReturnValue(makeChainable({ data: rows, error: null }))
    const page = await fetchShiftMediaPage({}, 2)
    expect(page.rows).toHaveLength(MEDIA_PAGE_SIZE)
    expect(page.hasMore).toBe(true)
    expect(page.page).toBe(2)
    expect(calls).toContainEqual([
      'range',
      2 * MEDIA_PAGE_SIZE,
      2 * MEDIA_PAGE_SIZE + MEDIA_PAGE_SIZE,
    ])
  })

  it('aplica los filtros', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))
    await fetchShiftMediaPage(
      {
        dateFrom: '2026-09-13',
        dateTo: '2026-10-13',
        clientId: 'c1',
        siteId: 'si1',
        uploadedBy: 'p1',
        kind: 'video',
        keepOnly: true,
      },
      0,
    )
    expect(calls).toContainEqual(['gte', 'shift_date', '2026-09-13'])
    expect(calls).toContainEqual(['lte', 'shift_date', '2026-10-13'])
    expect(calls).toContainEqual(['eq', 'client_id', 'c1'])
    expect(calls).toContainEqual(['eq', 'site_id', 'si1'])
    expect(calls).toContainEqual(['eq', 'uploaded_by', 'p1'])
    expect(calls).toContainEqual(['eq', 'kind', 'video'])
    expect(calls).toContainEqual(['eq', 'keep', true])
  })

  it('«por vencer» pide lo que tiene archivo, no se conserva y vence hasta la fecha', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))
    await fetchShiftMediaPage({ expiresBy: '2026-10-20' }, 0)
    expect(calls).toContainEqual(['eq', 'keep', false])
    expect(calls).toContainEqual(['eq', 'has_file', true])
    expect(calls).toContainEqual(['lte', 'expires_on', '2026-10-20'])
  })

  it('ordena de lo más reciente a lo más antiguo, con las filas de un turno juntas', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))
    await fetchShiftMediaPage({}, 0)
    const orders = calls.filter(([method]) => method === 'order')
    expect(orders.map(([, column]) => column)).toEqual([
      'shift_date',
      'shift_id',
      'created_at',
      'id',
    ])
    expect(orders[0]?.[2]).toEqual({ ascending: false })
  })

  it('traduce el error del servidor con el mensaje del hint', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: { message: 'x', code: 'P0001', hint: 'FORBIDDEN' },
      }),
    )
    await expect(fetchShiftMediaPage({}, 0)).rejects.toMatchObject({
      hint: 'FORBIDDEN',
      message: expect.stringContaining('dueña o un administrador') as string,
    })
  })
})

describe('fetchShiftMediaByShift y BySupervision', () => {
  it('filtran por turno', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [rawRow()], error: null }))
    const rows = await fetchShiftMediaByShift('sh1')
    expect(rows).toHaveLength(1)
    expect(calls).toContainEqual(['eq', 'shift_id', 'sh1'])
  })

  it('filtran por supervisión', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [rawRow({ supervision_id: 'sp1', uploader_role: 'supervisor' })],
        error: null,
      }),
    )
    const rows = await fetchShiftMediaBySupervision('sp1')
    expect(rows[0]?.uploaderRole).toBe('supervisor')
    expect(calls).toContainEqual(['eq', 'supervision_id', 'sp1'])
  })
})

describe('URL firmadas', () => {
  it('firma en lote, sin duplicados ni rutas vacías', async () => {
    createSignedUrlsMock.mockResolvedValue({
      data: [
        { path: 'a.jpg', signedUrl: 'https://s/a', error: null },
        { path: 'b.jpg', signedUrl: 'https://s/b', error: null },
      ],
      error: null,
    })
    const urls = await createEvidenceSignedUrls(
      ['a.jpg', 'b.jpg', 'a.jpg', ''],
      600,
    )
    expect(storageFromMock).toHaveBeenCalledWith('evidence')
    expect(createSignedUrlsMock).toHaveBeenCalledWith(['a.jpg', 'b.jpg'], 600)
    expect(urls.get('a.jpg')).toBe('https://s/a')
    expect(urls.size).toBe(2)
  })

  it('no llama a Storage si no hay rutas', async () => {
    const urls = await createEvidenceSignedUrls([], 600)
    expect(urls.size).toBe(0)
    expect(createSignedUrlsMock).not.toHaveBeenCalled()
  })

  it('una ruta que Storage rechaza queda sin URL y el resto sigue', async () => {
    createSignedUrlsMock.mockResolvedValue({
      data: [
        { path: 'a.jpg', signedUrl: 'https://s/a', error: null },
        { path: 'b.jpg', signedUrl: null, error: 'Object not found' },
      ],
      error: null,
    })
    const urls = await createEvidenceSignedUrls(['a.jpg', 'b.jpg'], 600)
    expect(urls.has('a.jpg')).toBe(true)
    expect(urls.has('b.jpg')).toBe(false)
  })

  it('un error de Storage sale como ApiError en español', async () => {
    createSignedUrlsMock.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })
    const error = await createEvidenceSignedUrls(['a.jpg'], 600).catch(
      (e: unknown) => e,
    )
    expect(isApiError(error)).toBe(true)
    expect((error as Error).message).toContain('No pudimos cargar')
  })

  it('las miniaturas se firman solo para lo que tiene archivo', async () => {
    createSignedUrlsMock.mockResolvedValue({ data: [], error: null })
    const base = (await fetchRow()) as never
    await createThumbSignedUrls([
      base,
      {
        ...(base as object),
        thumbPath: 'old_thumb.jpg',
        hasFile: false,
      } as never,
    ])
    expect(createSignedUrlsMock).toHaveBeenCalledWith(
      ['sh1/m1_thumb.jpg'],
      30 * 60,
    )
  })

  it('el original falla con MEDIA_EXPIRED si no se pudo firmar', async () => {
    createSignedUrlsMock.mockResolvedValue({ data: [], error: null })
    await expect(createOriginalSignedUrl('x.jpg')).rejects.toMatchObject({
      hint: 'MEDIA_EXPIRED',
    })
  })

  it('el original vive 5 minutos', async () => {
    createSignedUrlsMock.mockResolvedValue({
      data: [{ path: 'x.jpg', signedUrl: 'https://s/x', error: null }],
      error: null,
    })
    expect(await createOriginalSignedUrl('x.jpg')).toBe('https://s/x')
    expect(createSignedUrlsMock).toHaveBeenCalledWith(['x.jpg'], 300)
  })
})

async function fetchRow() {
  fromMock.mockReturnValue(makeChainable({ data: [rawRow()], error: null }))
  const page = await fetchShiftMediaPage({}, 0)
  return page.rows[0]
}

describe('setShiftMediaKeep', () => {
  it('llama a la RPC y devuelve el estado', async () => {
    rpcMock.mockResolvedValue({ data: { id: 'm1', keep: true }, error: null })
    expect(await setShiftMediaKeep('m1', true)).toEqual({
      id: 'm1',
      keep: true,
    })
    expect(rpcMock).toHaveBeenCalledWith('set_shift_media_keep', {
      p_media_id: 'm1',
      p_keep: true,
    })
  })

  it.each([
    ['FORBIDDEN', 'dueña o un administrador'],
    ['KEEP_REQUIRED', 'Falta indicar'],
    ['MEDIA_NOT_FOUND', 'No encontramos el archivo'],
    ['MEDIA_EXPIRED', 'ya venció'],
  ])('mapea el hint %s a un mensaje en español', async (hint, fragment) => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'raw', code: 'P0001', hint },
    })
    const error = await setShiftMediaKeep('m1', true).catch((e: unknown) => e)
    expect(isApiError(error)).toBe(true)
    expect((error as Error).message).toContain(fragment)
    expect((error as { hint: string }).hint).toBe(hint)
  })
})

describe('storage_usage', () => {
  const PAYLOAD = {
    total_bytes: 805306368,
    limit_bytes: 1073741824,
    percent: 75,
    level: 'warning',
    buckets: [
      { bucket: 'evidence', bytes: 700000000, objects: 4000 },
      { bucket: 'avatars', bytes: 105306368, objects: 50 },
    ],
  }

  it('lee el total, el nivel y el desglose por bucket', async () => {
    rpcMock.mockResolvedValue({ data: PAYLOAD, error: null })
    const usage = await fetchStorageUsage()
    expect(rpcMock).toHaveBeenCalledWith('storage_usage')
    expect(usage.level).toBe('warning')
    expect(usage.percent).toBe(75)
    expect(usage.limitBytes).toBe(1073741824)
    expect(usage.buckets).toEqual([
      { bucket: 'evidence', bytes: 700000000, objects: 4000 },
      { bucket: 'avatars', bytes: 105306368, objects: 50 },
    ])
  })

  it('si el nivel viene raro lo deduce del porcentaje (70 y 90)', () => {
    const base = { total_bytes: 1, limit_bytes: 100 }
    expect(parseStorageUsage({ ...base, percent: 69.9 }).level).toBe('ok')
    expect(parseStorageUsage({ ...base, percent: 70 }).level).toBe('warning')
    expect(parseStorageUsage({ ...base, percent: 90 }).level).toBe('critical')
  })

  it('FORBIDDEN para quien no es dueño ni administrador', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'x', code: 'P0001', hint: 'FORBIDDEN' },
    })
    await expect(fetchStorageUsage()).rejects.toMatchObject({
      hint: 'FORBIDDEN',
    })
  })

  it('traduce el nombre de cada bucket', () => {
    expect(storageBucketLabel('evidence')).toBe('Fotos y videos de los turnos')
    expect(storageBucketLabel('otro')).toBe('otro')
  })
})

describe('plazos de vencimiento', () => {
  it('lee los dos plazos de company_settings', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: { photo_retention_days: 60, video_retention_days: 30 },
        error: null,
      }),
    )
    expect(await fetchMediaRetention()).toEqual({
      photoDays: 60,
      videoDays: 30,
    })
    expect(fromMock).toHaveBeenCalledWith('company_settings')
  })

  it('los cambia con set_media_retention', async () => {
    rpcMock.mockResolvedValue({
      data: { photo_retention_days: 90, video_retention_days: 30 },
      error: null,
    })
    expect(await setMediaRetention({ photoDays: 90 })).toEqual({
      photoDays: 90,
      videoDays: 30,
    })
    expect(rpcMock).toHaveBeenCalledWith('set_media_retention', {
      p_photo_days: 90,
      p_video_days: undefined,
    })
  })

  it('RETENTION_OUT_OF_RANGE sale con el rango en español', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'raw', code: 'P0001', hint: 'RETENTION_OUT_OF_RANGE' },
    })
    await expect(setMediaRetention({ photoDays: 3 })).rejects.toMatchObject({
      hint: 'RETENTION_OUT_OF_RANGE',
      message: 'Los plazos tienen que ser de 7 a 365 días.',
    })
  })
})

describe('mapMediaAdminError', () => {
  it('un error sin hint conocido cae en el genérico, nunca en inglés', () => {
    const error = mapMediaAdminError({
      message: 'permission denied',
      code: '42501',
    })
    expect(error.message).not.toMatch(/permission/i)
  })
})

describe('conservar y eliminar de a varias (P21.8b)', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`)

  it('chunkItems parte en lotes', () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkItems([], 2)).toEqual([])
  })

  it('setShiftMediaKeepMany parte en lotes de 200 y suma los cambios', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: 200, error: null })
      .mockResolvedValueOnce({ data: 50, error: null })
    const changed = await setShiftMediaKeepMany(ids(250), true)
    expect(changed).toBe(250)
    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect(
      (rpcMock.mock.calls[0]?.[1] as { p_ids: string[] }).p_ids,
    ).toHaveLength(200)
    expect(rpcMock.mock.calls[1]?.[1]).toMatchObject({ p_keep: true })
    expect(
      (rpcMock.mock.calls[1]?.[1] as { p_ids: string[] }).p_ids,
    ).toHaveLength(50)
  })

  it('traduce el hint de las RPC a un mensaje en español', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'x', hint: 'FORBIDDEN' },
    })
    await expect(setShiftMediaKeepMany(['a'], false)).rejects.toSatisfy(
      (error) =>
        isApiError(error) &&
        error.hint === 'FORBIDDEN' &&
        error.message.startsWith('Solo la dueña'),
    )
    expect(
      mapMediaAdminError({ message: 'x', hint: 'MEDIA_TOO_MANY' }).message,
    ).toMatch(/demasiados/)
    expect(
      mapMediaAdminError({ message: 'x', hint: 'MEDIA_IDS_REQUIRED' }).message,
    ).toBe('Elegí al menos un archivo.')
  })

  it('deleteShiftMedia elimina en lotes y borra los objetos de Storage después', async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: {
          requested_count: 200,
          deleted_count: 199,
          ignored_count: 1,
          bytes_freed_estimate: 1000,
          deleted_ids: ['a'],
          paths: ['p1', 'p2'],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          requested_count: 5,
          deleted_count: 5,
          ignored_count: 0,
          bytes_freed_estimate: 500,
          deleted_ids: ['b'],
          paths: ['p3'],
        },
        error: null,
      })
    removeMock.mockResolvedValue({ data: [], error: null })
    const result = await deleteShiftMedia(ids(205))
    expect(result).toMatchObject({
      requestedCount: 205,
      deletedCount: 204,
      ignoredCount: 1,
      bytesFreedEstimate: 1500,
      storageFailedCount: 0,
    })
    expect(result.paths).toEqual(['p1', 'p2', 'p3'])
    expect(storageFromMock).toHaveBeenCalledWith('evidence')
    expect(removeMock).toHaveBeenCalledTimes(2)
    expect(removeMock).toHaveBeenNthCalledWith(1, ['p1', 'p2'])
  })

  it('si Storage falla, no lanza: lo cuenta para el barrido nocturno', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { deleted_count: 1, paths: ['p1', 'p2'] },
      error: null,
    })
    removeMock.mockResolvedValue({ data: null, error: { message: 'caído' } })
    const result = await deleteShiftMedia(['a'])
    expect(result.deletedCount).toBe(1)
    expect(result.storageFailedCount).toBe(2)
  })

  it('si la RPC falla, no toca Storage', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'x', hint: 'FORBIDDEN' },
    })
    await expect(deleteShiftMedia(['a'])).rejects.toBeDefined()
    expect(removeMock).not.toHaveBeenCalled()
  })
})
