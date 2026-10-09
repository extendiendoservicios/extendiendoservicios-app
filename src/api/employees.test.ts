import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/employees.ts` (EMP-001): mismo patrón sin red que
 * `clients.test.ts`/`users.test.ts` -- se mockea `@/lib/supabase` entero.
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
    delete: () => chain,
    is: () => chain,
    eq: () => chain,
    or: () => chain,
    contains: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (
      resolve: (value: PostgrestResult<T>) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

const { fromMock, invokeMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  invokeMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock, functions: { invoke: invokeMock } },
}))

const {
  fetchEmployees,
  fetchEmployeeClientPermissions,
  fetchSuggestedEmployeeNumber,
  fetchEmployeeDetail,
  createEmployeeUser,
  updateEmployee,
  terminateEmployee,
  fetchEmployeeClientPermissionsFor,
  addEmployeeClientPermission,
  removeEmployeeClientPermission,
  fetchEmployeeAvailability,
  createEmployeeAvailability,
  deleteEmployeeAvailability,
  fetchEmployeeLeaves,
  createEmployeeLeave,
  updateEmployeeLeave,
  deactivateEmployeeLeave,
  fetchEmployeeDnisByIds,
} = await import('./employees')

beforeEach(() => {
  fromMock.mockReset()
  invokeMock.mockReset()
})

describe('fetchEmployees', () => {
  it('mapea v_employees a EmployeeListRow[]', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            profile_id: 'e1',
            first_name: 'Ana',
            last_name: 'Gómez',
            employee_number: 5,
            roles: ['employee'],
            effective_status: 'active',
            phone: '1122334455',
            avatar_path: null,
            dni: '30111222',
          },
        ],
        error: null,
      }),
    )
    const result = await fetchEmployees()
    expect(fromMock).toHaveBeenCalledWith('v_employees')
    expect(result).toEqual([
      {
        profileId: 'e1',
        firstName: 'Ana',
        lastName: 'Gómez',
        employeeNumber: 5,
        roles: ['employee'],
        effectiveStatus: 'active',
        phone: '1122334455',
        avatarPath: null,
        dni: '30111222',
      },
    ])
  })

  it('pide la lista ordenada por legajo ascendente (AJ2-01)', async () => {
    const chain = makeChainable({ data: [], error: null })
    const orderSpy = vi.fn(() => chain)
    chain.order = orderSpy
    fromMock.mockReturnValue(chain)
    await fetchEmployees({ text: 'ana' })
    expect(orderSpy).toHaveBeenCalledTimes(1)
    expect(orderSpy).toHaveBeenCalledWith('employee_number', {
      ascending: true,
    })
  })

  it('traduce un error de PostgREST a ApiError', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message: 'No tenés permiso para hacer esto.',
          hint: 'FORBIDDEN',
        },
      }),
    )
    await expect(fetchEmployees()).rejects.toMatchObject({ hint: 'FORBIDDEN' })
  })
})

describe('fetchEmployeeClientPermissions', () => {
  it('agrupa los clientes habilitados por empleado', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          { employee_id: 'e1', client_id: 'c1' },
          { employee_id: 'e1', client_id: 'c2' },
          { employee_id: 'e2', client_id: 'c1' },
        ],
        error: null,
      }),
    )
    const result = await fetchEmployeeClientPermissions()
    expect(result.get('e1')).toEqual(['c1', 'c2'])
    expect(result.get('e2')).toEqual(['c1'])
    expect(result.has('e3')).toBe(false)
  })
})

describe('fetchSuggestedEmployeeNumber', () => {
  it('sugiere el máximo cargado más uno', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: { employee_number: 12 }, error: null }),
    )
    await expect(fetchSuggestedEmployeeNumber()).resolves.toBe(13)
  })

  it('sugiere 1 si todavía no hay ningún empleado', async () => {
    fromMock.mockReturnValue(makeChainable({ data: null, error: null }))
    await expect(fetchSuggestedEmployeeNumber()).resolves.toBe(1)
  })
})

describe('fetchEmployeeDetail', () => {
  it('mapea la fila de v_employees a EmployeeDetail', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: {
          profile_id: 'e1',
          first_name: 'Ana',
          last_name: 'Gómez',
          employee_number: 5,
          roles: ['employee'],
          status: 'active',
          effective_status: 'on_leave',
          profile_is_active: true,
          deleted_at: null,
          avatar_path: null,
          dni: '30111222',
          cuil: null,
          address: null,
          birth_date: null,
          hire_date: null,
          terminated_at: null,
          phone: null,
          contact_email: null,
          emergency_contact_name: null,
          emergency_contact_phone: null,
          emergency_contact_relationship: null,
          notes: null,
        },
        error: null,
      }),
    )
    const result = await fetchEmployeeDetail('e1')
    expect(result.profileId).toBe('e1')
    expect(result.effectiveStatus).toBe('on_leave')
    expect(result.isActiveAccount).toBe(true)
  })
})

describe('createEmployeeUser', () => {
  const input = {
    firstName: 'Ana',
    lastName: 'Gómez',
    email: 'ana@extendiendoservicios.example',
    password: 'contraseña-larga',
    roles: ['employee'] as ('employee' | 'supervisor')[],
    employeeNumber: 5,
    phone: '2477 123456',
    dni: '30111222',
    cuil: null,
    address: null,
    birthDate: null,
    hireDate: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelationship: null,
    notes: null,
  }

  it('crea el usuario vía Edge Function con el legajo pedido, sin corregirlo después', async () => {
    invokeMock.mockResolvedValue({
      data: { data: { profile_id: 'e1', employee_number: 5 } },
      error: null,
    })

    const result = await createEmployeeUser(input)

    expect(invokeMock).toHaveBeenCalledWith('admin-users', {
      body: {
        action: 'create_user',
        email: 'ana@extendiendoservicios.example',
        password: 'contraseña-larga',
        first_name: 'Ana',
        last_name: 'Gómez',
        roles: ['employee'],
        phone: '2477 123456',
        employee: {
          dni: '30111222',
          employee_number: 5,
          cuil: null,
          address: null,
          birth_date: null,
          hire_date: null,
          emergency_contact_name: null,
          emergency_contact_phone: null,
          emergency_contact_relationship: null,
          notes: null,
        },
      },
    })
    expect(result).toEqual({ profileId: 'e1', employeeNumber: 5 })
    // Defecto del 9 oct 2026: ya no hay un segundo paso sobre employees.
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('legajo en uso: rechaza con EMPLOYEE_NUMBER_IN_USE (antes llegaba como DNI repetido)', async () => {
    invokeMock.mockResolvedValue({
      data: {
        error: {
          message: 'El legajo 5 ya es de Yesica A. Elegí otro.',
          hint: 'EMPLOYEE_NUMBER_IN_USE',
        },
      },
      error: null,
    })
    await expect(createEmployeeUser(input)).rejects.toMatchObject({
      hint: 'EMPLOYEE_NUMBER_IN_USE',
      message: 'El legajo 5 ya es de Yesica A. Elegí otro.',
    })
  })

  it('si la Edge Function rechaza la creación, no llega a tocar employees (el DNI repetido, EMAIL_IN_USE, etc. ya se prueban en users.test.ts)', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: new Error('la red se cortó'),
    })
    await expect(createEmployeeUser(input)).rejects.toBeTruthy()
    expect(fromMock).not.toHaveBeenCalled()
  })
})

describe('updateEmployee', () => {
  it('actualiza profiles y employees, y devuelve la ficha', async () => {
    fromMock
      .mockReturnValueOnce(makeChainable({ data: [], error: null })) // profiles.update
      .mockReturnValueOnce(makeChainable({ data: [], error: null })) // employees.update
      .mockReturnValueOnce(
        makeChainable({
          data: {
            profile_id: 'e1',
            first_name: 'Ana',
            last_name: 'Gómez',
            employee_number: 5,
            roles: ['employee'],
            status: 'active',
            effective_status: 'active',
            profile_is_active: true,
            deleted_at: null,
            avatar_path: null,
            dni: '30111222',
            cuil: null,
            address: null,
            birth_date: null,
            hire_date: null,
            terminated_at: null,
            phone: null,
            contact_email: null,
            emergency_contact_name: null,
            emergency_contact_phone: null,
            emergency_contact_relationship: null,
            notes: null,
          },
          error: null,
        }),
      ) // fetchEmployeeDetail

    const result = await updateEmployee(
      'e1',
      {
        firstName: 'Ana',
        lastName: 'Gómez',
        phone: null,
        contactEmail: null,
        employeeNumber: 5,
        dni: '30111222',
        cuil: null,
        address: null,
        birthDate: null,
        hireDate: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        emergencyContactRelationship: null,
        notes: null,
      },
      'admin-1',
    )
    expect(result.profileId).toBe('e1')
    expect(fromMock).toHaveBeenNthCalledWith(1, 'profiles')
    expect(fromMock).toHaveBeenNthCalledWith(2, 'employees')
  })
})

describe('terminateEmployee', () => {
  it('primero desactiva la cuenta (Edge) y después marca employees.status', async () => {
    invokeMock.mockResolvedValue({
      data: { data: { profile_id: 'e1' } },
      error: null,
    })
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))

    await terminateEmployee('e1', 'Renunció', 'admin-1')

    expect(invokeMock).toHaveBeenCalledWith('admin-users', {
      body: { action: 'deactivate_user', profile_id: 'e1', reason: 'Renunció' },
    })
    expect(fromMock).toHaveBeenCalledWith('employees')
  })

  it('si falla el paso de employees.status, avisa con un error propio sin deshacer la desactivación', async () => {
    invokeMock.mockResolvedValue({
      data: { data: { profile_id: 'e1' } },
      error: null,
    })
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: { message: 'algo falló', code: '500' },
      }),
    )

    const promise = terminateEmployee('e1', 'Renunció', 'admin-1')
    await expect(promise).rejects.toSatisfy((error: unknown) => {
      return isApiError(error) && error.hint === 'EMPLOYEE_STATUS_NOT_UPDATED'
    })
  })
})

describe('fetchEmployeeClientPermissionsFor', () => {
  it('mapea el cliente habilitado, prefiriendo el nombre de fantasía', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            client_id: 'c1',
            clients: { legal_name: 'Limpieza SA', trade_name: 'Limpieza' },
          },
          {
            client_id: 'c2',
            clients: { legal_name: 'Otro SA', trade_name: null },
          },
        ],
        error: null,
      }),
    )
    const result = await fetchEmployeeClientPermissionsFor('e1')
    expect(result).toEqual([
      { clientId: 'c1', clientName: 'Limpieza' },
      { clientId: 'c2', clientName: 'Otro SA' },
    ])
  })
})

describe('addEmployeeClientPermission', () => {
  it('avisa con un mensaje claro si el cliente ya estaba habilitado (23505)', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: { message: 'duplicate key', code: '23505' },
      }),
    )
    await expect(
      addEmployeeClientPermission('e1', 'c1', 'admin-1'),
    ).rejects.toMatchObject({ hint: 'DUPLICATE' })
  })
})

describe('removeEmployeeClientPermission', () => {
  it('borra la fila de employee_client_permissions', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))
    await removeEmployeeClientPermission('e1', 'c1')
    expect(fromMock).toHaveBeenCalledWith('employee_client_permissions')
  })
})

describe('fetchEmployeeAvailability', () => {
  it('mapea las franjas de employee_availability', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            id: 's1',
            weekday: 1,
            start_time: '08:00:00',
            end_time: '12:00:00',
          },
        ],
        error: null,
      }),
    )
    const result = await fetchEmployeeAvailability('e1')
    expect(result).toEqual([
      { id: 's1', weekday: 1, startTime: '08:00:00', endTime: '12:00:00' },
    ])
  })
})

describe('createEmployeeAvailability', () => {
  it('traduce el check de end_time > start_time a un mensaje claro', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message:
            'new row for relation "employee_availability" violates check constraint',
          code: '23514',
        },
      }),
    )
    await expect(
      createEmployeeAvailability(
        'e1',
        { weekday: 1, startTime: '12:00', endTime: '08:00' },
        'admin-1',
      ),
    ).rejects.toMatchObject({ hint: 'VALIDATION_ERROR' })
  })
})

describe('deleteEmployeeAvailability', () => {
  it('borra la franja por id', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))
    await deleteEmployeeAvailability('s1')
    expect(fromMock).toHaveBeenCalledWith('employee_availability')
  })
})

describe('fetchEmployeeLeaves', () => {
  it('mapea las licencias, incluidas las dadas de baja', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          {
            id: 'l1',
            starts_on: '2026-01-10',
            ends_on: null,
            reason: 'Vacaciones',
            deleted_at: null,
          },
        ],
        error: null,
      }),
    )
    const result = await fetchEmployeeLeaves('e1')
    expect(result).toEqual([
      {
        id: 'l1',
        startsOn: '2026-01-10',
        endsOn: null,
        reason: 'Vacaciones',
        deletedAt: null,
      },
    ])
  })
})

describe('createEmployeeLeave', () => {
  it('traduce la exclusión de solapamiento (23P01) a LEAVE_OVERLAP', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message:
            'conflicting key value violates exclusion constraint "employee_leaves_no_overlap"',
          code: '23P01',
        },
      }),
    )
    await expect(
      createEmployeeLeave(
        'e1',
        { startsOn: '2026-01-10', endsOn: null, reason: null },
        'admin-1',
      ),
    ).rejects.toMatchObject({ hint: 'LEAVE_OVERLAP' })
  })

  it('traduce el check de ends_on >= starts_on a un mensaje claro', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message:
            'new row for relation "employee_leaves" violates check constraint "employee_leaves_ends_on_check"',
          code: '23514',
        },
      }),
    )
    await expect(
      createEmployeeLeave(
        'e1',
        { startsOn: '2026-01-10', endsOn: '2026-01-01', reason: null },
        'admin-1',
      ),
    ).rejects.toMatchObject({ hint: 'VALIDATION_ERROR' })
  })
})

describe('deactivateEmployeeLeave', () => {
  it('marca deleted_at en vez de borrar la fila (baja lógica)', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [], error: null }))
    await deactivateEmployeeLeave('l1', 'admin-1')
    expect(fromMock).toHaveBeenCalledWith('employee_leaves')
  })
})

describe('updateEmployeeLeave (AJ2-08)', () => {
  it('actualiza fechas y motivo de la misma fila', async () => {
    const chain = makeChainable({ data: null, error: null })
    const updateSpy = vi.fn(() => chain)
    const eqSpy = vi.fn(() => chain)
    chain.update = updateSpy
    chain.eq = eqSpy
    fromMock.mockReturnValue(chain)
    await updateEmployeeLeave(
      'l1',
      { startsOn: '2026-01-10', endsOn: '2026-01-20', reason: 'Viaje' },
      'admin-1',
    )
    expect(fromMock).toHaveBeenCalledWith('employee_leaves')
    expect(updateSpy).toHaveBeenCalledWith({
      starts_on: '2026-01-10',
      ends_on: '2026-01-20',
      reason: 'Viaje',
      updated_by: 'admin-1',
    })
    expect(eqSpy).toHaveBeenCalledWith('id', 'l1')
  })

  it('traduce la superposición con otra licencia a LEAVE_OVERLAP', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: null,
        error: {
          message:
            'conflicting key value violates exclusion constraint "employee_leaves_no_overlap"',
          code: '23P01',
        },
      }),
    )
    await expect(
      updateEmployeeLeave(
        'l1',
        { startsOn: '2026-01-10', endsOn: null, reason: null },
        'admin-1',
      ),
    ).rejects.toMatchObject({ hint: 'LEAVE_OVERLAP' })
  })
})

describe('fetchEmployeeDnisByIds (AJ2-16)', () => {
  it('devuelve un mapa id -> DNI y no consulta si no hay ids', async () => {
    expect((await fetchEmployeeDnisByIds([])).size).toBe(0)
    expect(fromMock).not.toHaveBeenCalled()

    fromMock.mockReturnValue(
      makeChainable({
        data: [
          { profile_id: 'e1', dni: '30111222' },
          { profile_id: 'e2', dni: '28999888' },
        ],
        error: null,
      }),
    )
    const result = await fetchEmployeeDnisByIds(['e1', 'e2'])
    expect(fromMock).toHaveBeenCalledWith('employees')
    expect(result.get('e2')).toBe('28999888')
  })
})
