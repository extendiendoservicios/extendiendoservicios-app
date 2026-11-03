import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/ownerDelete.ts` (P27.7, OD-22 y OD-23): vistas previas y borrados
 * del dueño. Se mockea `@/lib/supabase` y `invokeAdminUsers`.
 */

const { rpcMock, removeMock, invokeMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  removeMock: vi.fn(),
  invokeMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
    storage: { from: () => ({ remove: removeMock }) },
  },
}))
vi.mock('./users', () => ({ invokeAdminUsers: invokeMock }))

const {
  fetchOwnerDeletePreview,
  ownerDelete,
  parseOwnerDeletePreview,
  isAuthDeleteFailed,
} = await import('./ownerDelete')
const { ApiError } = await import('./errors')

beforeEach(() => {
  rpcMock.mockReset()
  removeMock.mockReset()
  invokeMock.mockReset()
})

describe('parseOwnerDeletePreview', () => {
  it('mapea bloqueos, renglones y nombres alternativos', () => {
    const preview = parseOwnerDeletePreview({
      entity: 'client',
      id: 'c1',
      name: 'Fantasía SA',
      can_delete: false,
      blockers: [
        { code: 'HAS_SITES', count: 2, message: 'Todavía tiene 2 sedes.' },
      ],
      will_delete: [{ code: 'contacts', label: 'Contactos', count: 3 }],
      legal_name: 'Razón Social SRL',
      trade_name: 'Fantasía SA',
    })
    expect(preview.canDelete).toBe(false)
    expect(preview.blockers[0]?.message).toBe('Todavía tiene 2 sedes.')
    expect(preview.willDelete).toEqual([
      { code: 'contacts', label: 'Contactos', count: 3 },
    ])
    expect(preview.alternativeNames).toEqual([
      'Razón Social SRL',
      'Fantasía SA',
    ])
  })

  it('mapea los turnos salteados de «turnos desde una fecha»', () => {
    const preview = parseOwnerDeletePreview({
      entity: 'service_shifts',
      id: 's1',
      name: 'Limpieza',
      can_delete: true,
      from_date: '2026-11-02',
      deletable_count: 4,
      skipped: [
        {
          shift_id: 'sh1',
          shift_date: '2026-11-03',
          reasons: ['HAS_ATTENDANCE'],
          message: 'Tiene 1 fichaje.',
        },
      ],
    })
    expect(preview.deletableCount).toBe(4)
    expect(preview.skipped[0]).toEqual({
      shiftId: 'sh1',
      shiftDate: '2026-11-03',
      reasons: ['HAS_ATTENDANCE'],
      message: 'Tiene 1 fichaje.',
    })
    expect(preview.blockers).toEqual([])
  })
})

describe('fetchOwnerDeletePreview', () => {
  it.each([
    ['shift', 'owner_delete_preview_shift', { p_shift_id: 'x' }],
    ['service', 'owner_delete_preview_service', { p_service_id: 'x' }],
    ['site', 'owner_delete_preview_site', { p_site_id: 'x' }],
    ['client', 'owner_delete_preview_client', { p_client_id: 'x' }],
    ['employee', 'owner_delete_preview_employee', { p_employee_id: 'x' }],
  ] as const)('%s llama a %s', async (kind, fn, args) => {
    rpcMock.mockResolvedValue({
      data: { entity: kind, id: 'x', name: 'N', can_delete: true },
      error: null,
    })
    await fetchOwnerDeletePreview(kind, 'x')
    expect(rpcMock).toHaveBeenCalledWith(fn, args)
  })

  it('los turnos de un servicio llevan la fecha', async () => {
    rpcMock.mockResolvedValue({
      data: { entity: 'service_shifts', id: 'x', name: 'N', can_delete: true },
      error: null,
    })
    await fetchOwnerDeletePreview('service_shifts', 'x', '2026-11-02')
    expect(rpcMock).toHaveBeenCalledWith(
      'owner_delete_preview_service_shifts',
      { p_service_id: 'x', p_from_date: '2026-11-02' },
    )
  })

  it('traduce el error del servidor', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Solo el dueño puede hacer esto.',
        hint: 'FORBIDDEN',
        code: 'P0001',
      },
    })
    await expect(fetchOwnerDeletePreview('site', 'x')).rejects.toSatisfy(
      isApiError,
    )
  })
})

describe('ownerDelete', () => {
  it('el turno se borra sin nombre', async () => {
    rpcMock.mockResolvedValue({
      data: { entity: 'shift', id: 'sh1', deleted: { shifts: 1 } },
      error: null,
    })
    const result = await ownerDelete({
      kind: 'shift',
      id: 'sh1',
      confirmName: '',
    })
    expect(rpcMock).toHaveBeenCalledWith('owner_delete_shift', {
      p_shift_id: 'sh1',
    })
    expect(result.deleted.shifts).toBe(1)
  })

  it('el servicio manda el nombre escrito', async () => {
    rpcMock.mockResolvedValue({
      data: { entity: 'service', id: 's1', name: 'Limpieza', deleted: {} },
      error: null,
    })
    await ownerDelete({ kind: 'service', id: 's1', confirmName: 'Limpieza' })
    expect(rpcMock).toHaveBeenCalledWith('owner_delete_service', {
      p_service_id: 's1',
      p_confirm_name: 'Limpieza',
    })
  })

  it('borra de Storage la foto del cliente borrado', async () => {
    rpcMock.mockResolvedValue({
      data: { entity: 'client', id: 'c1', photo_path: 'c1/foto.jpg' },
      error: null,
    })
    removeMock.mockResolvedValue({ error: null })
    await ownerDelete({ kind: 'client', id: 'c1', confirmName: 'ACME' })
    expect(removeMock).toHaveBeenCalledWith(['c1/foto.jpg'])
  })

  it('no toca Storage si el cliente no tenía foto', async () => {
    rpcMock.mockResolvedValue({
      data: { entity: 'client', id: 'c1', photo_path: null },
      error: null,
    })
    await ownerDelete({ kind: 'client', id: 'c1', confirmName: 'ACME' })
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('un error de Storage no frena el borrado del cliente', async () => {
    rpcMock.mockResolvedValue({
      data: { entity: 'client', id: 'c1', photo_path: 'c1/foto.jpg' },
      error: null,
    })
    removeMock.mockResolvedValue({ error: { message: 'boom' } })
    await expect(
      ownerDelete({ kind: 'client', id: 'c1', confirmName: 'ACME' }),
    ).resolves.toBeTruthy()
  })

  it('el empleado se borra por admin-users delete_user, no por la RPC', async () => {
    invokeMock.mockResolvedValue({
      profile_id: 'p1',
      name: 'Ana Gómez',
      deleted: { assignments: 2 },
    })
    const result = await ownerDelete({
      kind: 'employee',
      id: 'p1',
      confirmName: 'Ana Gómez',
    })
    expect(invokeMock).toHaveBeenCalledWith('delete_user', {
      profile_id: 'p1',
      confirm_name: 'Ana Gómez',
    })
    expect(rpcMock).not.toHaveBeenCalled()
    expect(result.id).toBe('p1')
    expect(result.deleted.assignments).toBe(2)
  })

  it('AUTH_DELETE_FAILED se reconoce para ofrecer el reintento', async () => {
    invokeMock.mockRejectedValue(
      new ApiError('No pudimos borrar el acceso.', 'AUTH_DELETE_FAILED'),
    )
    const error = await ownerDelete({
      kind: 'employee',
      id: 'p1',
      confirmName: 'Ana',
    }).catch((failure: unknown) => failure)
    expect(isAuthDeleteFailed(error)).toBe(true)
    expect(isAuthDeleteFailed(new Error('otro'))).toBe(false)
  })

  it('los turnos de un servicio mandan la fecha y cuentan los salteados', async () => {
    rpcMock.mockResolvedValue({
      data: {
        entity: 'service_shifts',
        id: 's1',
        deleted: { shifts: 5 },
        skipped_count: 2,
      },
      error: null,
    })
    const result = await ownerDelete({
      kind: 'service_shifts',
      id: 's1',
      confirmName: 'Limpieza',
      fromDate: '2026-11-02',
    })
    expect(rpcMock).toHaveBeenCalledWith('owner_delete_service_shifts', {
      p_service_id: 's1',
      p_from_date: '2026-11-02',
      p_confirm_name: 'Limpieza',
    })
    expect(result.skippedCount).toBe(2)
  })
})
