import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/tasks.ts` (TASK-003): mismo patrón sin red que
 * `assignments.test.ts` -- se mockea `@/lib/supabase` entero.
 */

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock, rpc: rpcMock },
}))

const { updateTaskStatus, reloadShiftTasks, fetchShiftTasksReadOnly } =
  await import('./tasks')

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    then: (
      resolve: (value: PostgrestResult<T>) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

const TASK_ROW = {
  id: 'task-1',
  shift_id: 'shift-1',
  position: 0,
  title: 'Barrer el salón',
  description: null,
  is_required: true,
  status: 'pending' as const,
  not_done_reason: null,
  status_changed_at: null,
  status_changed_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
  created_by: null,
  updated_by: null,
}

describe('updateTaskStatus', () => {
  it('llama a la RPC con los parámetros esperados y mapea el resultado', async () => {
    rpcMock.mockResolvedValue({
      data: { ...TASK_ROW, status: 'done' },
      error: null,
    })
    const result = await updateTaskStatus('task-1', 'done')
    expect(rpcMock).toHaveBeenCalledWith('update_task_status', {
      p_task_id: 'task-1',
      p_status: 'done',
      p_reason: undefined,
    })
    expect(result.status).toBe('done')
  })

  it('manda el motivo cuando el nuevo estado es not_done', async () => {
    rpcMock.mockResolvedValue({
      data: {
        ...TASK_ROW,
        status: 'not_done',
        not_done_reason: 'Faltó insumo',
      },
      error: null,
    })
    const result = await updateTaskStatus('task-1', 'not_done', 'Faltó insumo')
    expect(rpcMock).toHaveBeenCalledWith('update_task_status', {
      p_task_id: 'task-1',
      p_status: 'not_done',
      p_reason: 'Faltó insumo',
    })
    expect(result.notDoneReason).toBe('Faltó insumo')
  })

  it('deja pasar el mensaje y el hint del servidor (por ejemplo REASON_REQUIRED)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Indicá el motivo.', hint: 'REASON_REQUIRED' },
    })
    await expect(updateTaskStatus('task-1', 'not_done')).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) &&
        error.hint === 'REASON_REQUIRED' &&
        error.message === 'Indicá el motivo.',
    )
  })
})

describe('reloadShiftTasks', () => {
  it('se reexporta desde src/api/shifts.ts, sin duplicar la RPC', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })
    await reloadShiftTasks('shift-1')
    expect(rpcMock).toHaveBeenCalledWith('reload_shift_tasks', {
      p_shift_id: 'shift-1',
    })
  })
})

describe('fetchShiftTasksReadOnly', () => {
  it('trae las tareas del turno ordenadas por posición (EMP-04)', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [TASK_ROW], error: null }))

    const tasks = await fetchShiftTasksReadOnly('shift-1')

    expect(fromMock).toHaveBeenCalledWith('shift_tasks')
    expect(tasks).toEqual([
      expect.objectContaining({ id: 'task-1', title: 'Barrer el salón' }),
    ])
  })

  it('propaga el error traducido si la consulta falla', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: null, error: { message: 'boom', code: '500' } }),
    )

    await expect(fetchShiftTasksReadOnly('shift-1')).rejects.toThrow()
  })
})
