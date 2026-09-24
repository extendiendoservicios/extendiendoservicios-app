import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as employeesApi from '@/api/employees'
import type {
  EmployeeCreateInput,
  EmployeeListFilters,
  EmployeeUpdateInput,
} from '@/api/employees'

/**
 * Hooks de TanStack Query de ADM-16, ADM-17 y ADM-18 (EMP-001). Patrón de
 * `src/api/README.md`, igual que `src/features/clients/queries.ts`.
 *
 * Polling: el listado de ADM-16 no es el tablero ni "Asistencia de hoy"
 * (`02_Decisiones.md` P-005: 30 s ahí, 60 s "en el resto de las listas") --
 * 60 s acá. La ficha (ADM-17) y el legajo sugerido son lecturas puntuales de
 * una pantalla que se abre a demanda: sin polling.
 */

const LIST_POLLING_MS = 60_000

export const employeesKeys = {
  all: ['employees'] as const,
  list: (filters: EmployeeListFilters) =>
    [...employeesKeys.all, 'list', filters] as const,
  clientPermissions: () => [...employeesKeys.all, 'clientPermissions'] as const,
  detail: (profileId: string) =>
    [...employeesKeys.all, 'detail', profileId] as const,
  suggestedNumber: () => [...employeesKeys.all, 'suggestedNumber'] as const,
}

// -------------------------------------------------------------------------
// Listado (ADM-16)
// -------------------------------------------------------------------------

export function useEmployeesQuery(filters: EmployeeListFilters) {
  return useQuery({
    queryKey: employeesKeys.list(filters),
    queryFn: () => employeesApi.fetchEmployees(filters),
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

/** EMP-002: alimenta el filtro "cliente habilitado" (`employeeListFilters.ts`). */
export function useEmployeeClientPermissionsQuery() {
  return useQuery({
    queryKey: employeesKeys.clientPermissions(),
    queryFn: employeesApi.fetchEmployeeClientPermissions,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

function useInvalidateEmployeesList() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: employeesKeys.all })
  }
}

// -------------------------------------------------------------------------
// Ficha (ADM-17)
// -------------------------------------------------------------------------

export function useEmployeeDetailQuery(profileId: string | undefined) {
  return useQuery({
    queryKey: employeesKeys.detail(profileId ?? ''),
    queryFn: () => employeesApi.fetchEmployeeDetail(profileId as string),
    enabled: profileId != null,
  })
}

// -------------------------------------------------------------------------
// Alta y edición (ADM-18)
// -------------------------------------------------------------------------

/** EMP-003: legajo sugerido, se vuelve a pedir cada vez que se abre el formulario de alta. */
export function useSuggestedEmployeeNumberQuery(enabled: boolean) {
  return useQuery({
    queryKey: employeesKeys.suggestedNumber(),
    queryFn: employeesApi.fetchSuggestedEmployeeNumber,
    enabled,
    staleTime: 0,
  })
}

export function useCreateEmployeeMutation() {
  const invalidate = useInvalidateEmployeesList()
  return useMutation({
    mutationFn: (input: EmployeeCreateInput) =>
      employeesApi.createEmployeeUser(input),
    onSuccess: invalidate,
  })
}

export function useUpdateEmployeeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      profileId,
      input,
      updatedBy,
    }: {
      profileId: string
      input: EmployeeUpdateInput
      updatedBy: string
    }) => employeesApi.updateEmployee(profileId, input, updatedBy),
    onSuccess: (employee) => {
      void queryClient.invalidateQueries({ queryKey: employeesKeys.all })
      queryClient.setQueryData(
        employeesKeys.detail(employee.profileId),
        employee,
      )
    },
  })
}

// -------------------------------------------------------------------------
// Acciones de cuenta (EMP-005)
// -------------------------------------------------------------------------

export function useResetEmployeePasswordMutation() {
  return useMutation({
    mutationFn: ({
      profileId,
      newPassword,
    }: {
      profileId: string
      newPassword: string
    }) => employeesApi.resetEmployeePassword(profileId, newPassword),
  })
}

export function useSignOutEmployeeMutation() {
  return useMutation({
    mutationFn: (profileId: string) => employeesApi.signOutEmployee(profileId),
  })
}

/** EMP-005: baja en dos pasos, con motivo obligatorio. */
export function useTerminateEmployeeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      profileId,
      reason,
      updatedBy,
    }: {
      profileId: string
      reason: string
      updatedBy: string
    }) => employeesApi.terminateEmployee(profileId, reason, updatedBy),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: employeesKeys.all })
      void queryClient.invalidateQueries({
        queryKey: employeesKeys.detail(variables.profileId),
      })
    },
  })
}
