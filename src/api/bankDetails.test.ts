import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/bankDetails.ts` (AJ2-04): sin red, se mockea `@/lib/supabase`.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(result),
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
  fetchClientBankDetails,
  fetchEmployeeBankDetails,
  setClientBankDetails,
  setEmployeeBankDetails,
  isBankDetailsEmpty,
} = await import('./bankDetails')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

const ROW = {
  bank_name: 'Banco Nación',
  cbu: '0170099220000067797370',
  alias: 'mi.alias',
}

describe('lectura de datos bancarios', () => {
  it('trae los de un cliente de client_bank_details', async () => {
    fromMock.mockReturnValue(makeChainable({ data: ROW, error: null }))
    await expect(fetchClientBankDetails('c1')).resolves.toEqual({
      bankName: 'Banco Nación',
      cbu: '0170099220000067797370',
      alias: 'mi.alias',
    })
    expect(fromMock).toHaveBeenCalledWith('client_bank_details')
  })

  it('devuelve null si el cliente no tiene fila', async () => {
    fromMock.mockReturnValue(makeChainable({ data: null, error: null }))
    await expect(fetchClientBankDetails('c1')).resolves.toBeNull()
  })

  it('trae los de un empleado de employee_bank_details', async () => {
    fromMock.mockReturnValue(makeChainable({ data: ROW, error: null }))
    const details = await fetchEmployeeBankDetails('p1')
    expect(details?.alias).toBe('mi.alias')
    expect(fromMock).toHaveBeenCalledWith('employee_bank_details')
  })

  it('traduce un error de permisos a ApiError con hint FORBIDDEN', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: null, error: { message: 'x', code: '42501' } }),
    )
    await expect(fetchEmployeeBankDetails('p1')).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.hint === 'FORBIDDEN',
    )
  })
})

describe('escritura de datos bancarios', () => {
  it('set_client_bank_details manda los tres valores y traduce la fila', async () => {
    rpcMock.mockResolvedValue({
      data: { client_id: 'c1', ...ROW },
      error: null,
    })
    const result = await setClientBankDetails('c1', {
      bankName: 'Banco Nación',
      cbu: '0170099220000067797370',
      alias: 'mi.alias',
    })
    expect(rpcMock).toHaveBeenCalledWith('set_client_bank_details', {
      p_client_id: 'c1',
      p_bank_name: 'Banco Nación',
      p_cbu: '0170099220000067797370',
      p_alias: 'mi.alias',
    })
    expect(result.cbu).toBe('0170099220000067797370')
  })

  it('set_employee_bank_details manda los vacíos como undefined (la base los guarda en null)', async () => {
    rpcMock.mockResolvedValue({
      data: { profile_id: 'p1', bank_name: null, cbu: null, alias: null },
      error: null,
    })
    await setEmployeeBankDetails('p1', {
      bankName: null,
      cbu: null,
      alias: null,
    })
    expect(rpcMock).toHaveBeenCalledWith('set_employee_bank_details', {
      p_profile_id: 'p1',
      p_bank_name: undefined,
      p_cbu: undefined,
      p_alias: undefined,
    })
  })

  it('traduce INVALID_CBU a ApiError con el message del servidor', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'El CBU tiene que tener exactamente 22 dígitos.',
        code: 'P0001',
        hint: 'INVALID_CBU',
      },
    })
    await expect(
      setClientBankDetails('c1', { bankName: null, cbu: '1', alias: null }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) &&
        error.hint === 'INVALID_CBU' &&
        error.message === 'El CBU tiene que tener exactamente 22 dígitos.',
    )
  })
})

describe('isBankDetailsEmpty', () => {
  it('es true sin fila o con los tres datos vacíos', () => {
    expect(isBankDetailsEmpty(null)).toBe(true)
    expect(isBankDetailsEmpty({ bankName: null, cbu: null, alias: null })).toBe(
      true,
    )
    expect(
      isBankDetailsEmpty({ bankName: null, cbu: null, alias: 'x.y.z.w' }),
    ).toBe(false)
  })
})
