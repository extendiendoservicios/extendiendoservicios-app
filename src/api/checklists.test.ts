import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/checklists.ts` (TASK-003): mismo patrón sin red que
 * `clients.test.ts` -- se mockea `@/lib/supabase` entero. `makeChainable`
 * agrega `maybeSingle` (usado por `fetchChecklistTemplate`, que no debe
 * fallar cuando la plantilla todavía no existe) y `upsert` (usado por
 * `reorderTemplateItems`).
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    upsert: () => Promise.resolve(result),
    is: () => chain,
    eq: () => chain,
    order: () => chain,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (
      resolve: (value: PostgrestResult<T>) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  }
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
  fetchChecklistTemplate,
  createClientTemplate,
  cloneChecklistTemplate,
  fetchTemplateItems,
  createTemplateItem,
  updateTemplateItem,
  deactivateTemplateItem,
  reorderTemplateItems,
} = await import('./checklists')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

const TEMPLATE_ROW = {
  id: 't1',
  client_id: 'c1',
  site_id: null,
  name: 'Plantilla de tareas',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
  created_by: null,
  updated_by: null,
  deleted_at: null,
}

const ITEM_ROW = {
  id: 'i1',
  template_id: 't1',
  position: 0,
  title: 'Barrer el salón',
  description: null,
  is_required: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
  created_by: null,
  updated_by: null,
  deleted_at: null,
}

describe('fetchChecklistTemplate', () => {
  it('mapea la fila a camelCase cuando existe', async () => {
    fromMock.mockReturnValue(makeChainable({ data: TEMPLATE_ROW, error: null }))
    const result = await fetchChecklistTemplate('c1', null)
    expect(result).toEqual({
      id: 't1',
      clientId: 'c1',
      siteId: null,
      name: 'Plantilla de tareas',
      isActive: true,
    })
  })

  it('devuelve null cuando todavía no hay plantilla (sin lanzar)', async () => {
    fromMock.mockReturnValue(makeChainable({ data: null, error: null }))
    const result = await fetchChecklistTemplate('c1', 's1')
    expect(result).toBeNull()
  })
})

describe('createClientTemplate', () => {
  it('inserta con site_id null y devuelve la plantilla creada', async () => {
    fromMock.mockReturnValue(makeChainable({ data: TEMPLATE_ROW, error: null }))
    const result = await createClientTemplate('c1', 'admin-1')
    expect(result.siteId).toBeNull()
    expect(result.id).toBe('t1')
  })

  it('traduce un 23505 a un error de dominio en voseo', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: { message: 'duplicate key', code: '23505' },
      }),
    )
    await expect(createClientTemplate('c1', 'admin-1')).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) &&
        error.hint === 'TEMPLATE_EXISTS' &&
        error.message.includes('Ya existe'),
    )
  })
})

describe('cloneChecklistTemplate', () => {
  it('llama a la RPC y mapea el resultado', async () => {
    rpcMock.mockResolvedValue({
      data: { ...TEMPLATE_ROW, id: 't2', site_id: 's1' },
      error: null,
    })
    const result = await cloneChecklistTemplate('c1', 's1')
    expect(rpcMock).toHaveBeenCalledWith('clone_checklist_template', {
      p_client_id: 'c1',
      p_site_id: 's1',
    })
    expect(result.siteId).toBe('s1')
  })

  it('deja pasar el mensaje y el hint del servidor tal cual (por ejemplo CLIENT_TEMPLATE_NOT_FOUND)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message:
          'Este cliente todavía no tiene una plantilla de tareas para copiar.',
        hint: 'CLIENT_TEMPLATE_NOT_FOUND',
      },
    })
    await expect(cloneChecklistTemplate('c1', 's1')).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) && error.hint === 'CLIENT_TEMPLATE_NOT_FOUND',
    )
  })
})

describe('fetchTemplateItems', () => {
  it('mapea las filas ordenadas por position', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [ITEM_ROW], error: null }))
    const result = await fetchTemplateItems('t1')
    expect(result).toEqual([
      {
        id: 'i1',
        templateId: 't1',
        position: 0,
        title: 'Barrer el salón',
        description: null,
        isRequired: true,
      },
    ])
  })
})

describe('createTemplateItem', () => {
  it('inserta el ítem con la posición indicada', async () => {
    fromMock.mockReturnValue(makeChainable({ data: ITEM_ROW, error: null }))
    const result = await createTemplateItem(
      't1',
      0,
      { title: 'Barrer el salón', description: null, isRequired: true },
      'admin-1',
    )
    expect(result.title).toBe('Barrer el salón')
  })
})

describe('updateTemplateItem', () => {
  it('actualiza título, descripción y obligatoriedad', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: { ...ITEM_ROW, title: 'Trapear', is_required: false },
        error: null,
      }),
    )
    const result = await updateTemplateItem(
      'i1',
      { title: 'Trapear', description: null, isRequired: false },
      'admin-1',
    )
    expect(result.title).toBe('Trapear')
    expect(result.isRequired).toBe(false)
  })
})

describe('deactivateTemplateItem', () => {
  it('no lanza cuando la baja lógica sale bien', async () => {
    fromMock.mockReturnValue(makeChainable({ data: null, error: null }))
    await expect(
      deactivateTemplateItem('i1', 'admin-1'),
    ).resolves.toBeUndefined()
  })
})

describe('reorderTemplateItems', () => {
  it('hace un solo upsert con las posiciones nuevas, en el orden recibido', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    fromMock.mockReturnValue({ upsert: upsertMock })

    await reorderTemplateItems(
      [
        {
          id: 'i2',
          templateId: 't1',
          position: 5,
          title: 'B',
          description: null,
          isRequired: true,
        },
        {
          id: 'i1',
          templateId: 't1',
          position: 0,
          title: 'A',
          description: null,
          isRequired: true,
        },
      ],
      'admin-1',
    )

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const [rows, options] = upsertMock.mock.calls[0] as [
      Array<{ id: string; position: number }>,
      { onConflict: string },
    ]
    expect(options).toEqual({ onConflict: 'id' })
    expect(rows.map((row) => row.id)).toEqual(['i2', 'i1'])
    expect(rows.map((row) => row.position)).toEqual([0, 1])
  })
})
