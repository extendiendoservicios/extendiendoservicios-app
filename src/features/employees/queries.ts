import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as employeesApi from '@/api/employees'
import type {
  EmployeeAvailabilitySlotInput,
  EmployeeCreateInput,
  EmployeeLeaveInput,
  EmployeeListFilters,
  EmployeeUpdateInput,
} from '@/api/employees'
import { setUserRoles, signOutUser, type Role } from '@/api/users'

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
  clientPermissionsFor: (profileId: string) =>
    [...employeesKeys.all, 'clientPermissionsFor', profileId] as const,
  availability: (profileId: string) =>
    [...employeesKeys.all, 'availability', profileId] as const,
  leaves: (profileId: string) =>
    [...employeesKeys.all, 'leaves', profileId] as const,
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

// -------------------------------------------------------------------------
// Habilitaciones por cliente (EMP-006)
// -------------------------------------------------------------------------

export function useEmployeeClientPermissionsForQuery(profileId: string) {
  return useQuery({
    queryKey: employeesKeys.clientPermissionsFor(profileId),
    queryFn: () => employeesApi.fetchEmployeeClientPermissionsFor(profileId),
  })
}

function useInvalidateEmployeeClientPermissions(profileId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({
      queryKey: employeesKeys.clientPermissionsFor(profileId),
    })
    // El filtro "cliente habilitado" del listado (ADM-16) depende del mismo
    // dato: se invalida también para que no quede desactualizado si se
    // vuelve para atrás.
    void queryClient.invalidateQueries({
      queryKey: employeesKeys.clientPermissions(),
    })
  }
}

export function useAddEmployeeClientPermissionMutation(profileId: string) {
  const invalidate = useInvalidateEmployeeClientPermissions(profileId)
  return useMutation({
    mutationFn: ({
      clientId,
      createdBy,
    }: {
      clientId: string
      createdBy: string
    }) =>
      employeesApi.addEmployeeClientPermission(profileId, clientId, createdBy),
    onSuccess: invalidate,
  })
}

export function useRemoveEmployeeClientPermissionMutation(profileId: string) {
  const invalidate = useInvalidateEmployeeClientPermissions(profileId)
  return useMutation({
    mutationFn: (clientId: string) =>
      employeesApi.removeEmployeeClientPermission(profileId, clientId),
    onSuccess: invalidate,
  })
}

// -------------------------------------------------------------------------
// Disponibilidad declarada (EMP-007)
// -------------------------------------------------------------------------

export function useEmployeeAvailabilityQuery(profileId: string) {
  return useQuery({
    queryKey: employeesKeys.availability(profileId),
    queryFn: () => employeesApi.fetchEmployeeAvailability(profileId),
  })
}

export function useCreateEmployeeAvailabilityMutation(profileId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      input,
      createdBy,
    }: {
      input: EmployeeAvailabilitySlotInput
      createdBy: string
    }) => employeesApi.createEmployeeAvailability(profileId, input, createdBy),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: employeesKeys.availability(profileId),
      })
    },
  })
}

export function useDeleteEmployeeAvailabilityMutation(profileId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => employeesApi.deleteEmployeeAvailability(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: employeesKeys.availability(profileId),
      })
    },
  })
}

// -------------------------------------------------------------------------
// Licencias (EMP-008)
// -------------------------------------------------------------------------

/**
 * Las licencias cambian el estado efectivo de la persona ("De licencia",
 * `v_employees`): además de la propia lista, invalida la ficha (cabecera) y
 * el listado (ADM-16), igual que `useTerminateEmployeeMutation`.
 */
function useInvalidateEmployeeLeaves(profileId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({
      queryKey: employeesKeys.leaves(profileId),
    })
    void queryClient.invalidateQueries({
      queryKey: employeesKeys.detail(profileId),
    })
    void queryClient.invalidateQueries({ queryKey: employeesKeys.all })
  }
}

export function useEmployeeLeavesQuery(profileId: string) {
  return useQuery({
    queryKey: employeesKeys.leaves(profileId),
    queryFn: () => employeesApi.fetchEmployeeLeaves(profileId),
  })
}

export function useCreateEmployeeLeaveMutation(profileId: string) {
  const invalidate = useInvalidateEmployeeLeaves(profileId)
  return useMutation({
    mutationFn: ({
      input,
      createdBy,
    }: {
      input: EmployeeLeaveInput
      createdBy: string
    }) => employeesApi.createEmployeeLeave(profileId, input, createdBy),
    onSuccess: invalidate,
  })
}

export function useDeactivateEmployeeLeaveMutation(profileId: string) {
  const invalidate = useInvalidateEmployeeLeaves(profileId)
  return useMutation({
    mutationFn: ({ id, updatedBy }: { id: string; updatedBy: string }) =>
      employeesApi.deactivateEmployeeLeave(id, updatedBy),
    onSuccess: invalidate,
  })
}

// -------------------------------------------------------------------------
// Decisión de Mike (24 sep 2026): roles empleado/supervisor editables desde
// la ficha, con `set_user_roles` (owner siempre; admin con `manage_users`,
// ver la migración `0013_rpc_users.sql`).
// -------------------------------------------------------------------------

/**
 * Reemplaza el conjunto completo de roles de la persona (owner/admin
 * incluidos, si los tuviera -- `EmployeeRolesDialog.tsx` arma `roles` con
 * ellos preservados). Si el conjunto resultante le quita un rol, cierra sus
 * sesiones después (P-015, mismo criterio que `useSetUserRolesMutation` de
 * `features/users/queries.ts` para ADM-27) -- una copia corta y no una
 * reexportación porque acá hace falta invalidar las consultas de este
 * dominio (`employeesKeys`), no las de `usersKeys`.
 */
export function useSetEmployeeRolesMutation(profileId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      previousRoles,
      roles,
    }: {
      previousRoles: Role[]
      roles: Role[]
    }) => {
      const result = await setUserRoles(profileId, roles)
      const lostARole = previousRoles.some((role) => !roles.includes(role))
      if (lostARole) {
        await signOutUser(profileId)
      }
      return result
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: employeesKeys.detail(profileId),
      })
      void queryClient.invalidateQueries({ queryKey: employeesKeys.all })
    },
  })
}
