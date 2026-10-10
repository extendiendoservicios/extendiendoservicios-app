import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as bankApi from '@/api/bankDetails'
import type { BankDetailsInput } from '@/api/bankDetails'

/**
 * Hooks de «Datos bancarios» (AJ2-04). Lecturas puntuales de una ficha o un
 * formulario: sin polling.
 */

export const bankKeys = {
  all: ['bank-details'] as const,
  client: (clientId: string) => [...bankKeys.all, 'client', clientId] as const,
  employee: (profileId: string) =>
    [...bankKeys.all, 'employee', profileId] as const,
}

export function useClientBankDetailsQuery(clientId: string | undefined) {
  return useQuery({
    queryKey: bankKeys.client(clientId ?? ''),
    queryFn: () => bankApi.fetchClientBankDetails(clientId as string),
    enabled: clientId != null,
    staleTime: 60_000,
  })
}

export function useEmployeeBankDetailsQuery(
  profileId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: bankKeys.employee(profileId ?? ''),
    queryFn: () => bankApi.fetchEmployeeBankDetails(profileId as string),
    enabled: enabled && profileId != null,
    staleTime: 60_000,
  })
}

export function useSetClientBankDetailsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      clientId,
      input,
    }: {
      clientId: string
      input: BankDetailsInput
    }) => bankApi.setClientBankDetails(clientId, input),
    onSuccess: (_details, { clientId }) => {
      void queryClient.invalidateQueries({
        queryKey: bankKeys.client(clientId),
      })
    },
  })
}

export function useSetEmployeeBankDetailsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      profileId,
      input,
    }: {
      profileId: string
      input: BankDetailsInput
    }) => bankApi.setEmployeeBankDetails(profileId, input),
    onSuccess: (_details, { profileId }) => {
      void queryClient.invalidateQueries({
        queryKey: bankKeys.employee(profileId),
      })
    },
  })
}
