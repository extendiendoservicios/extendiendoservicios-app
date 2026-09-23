import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as usersApi from '@/api/users'
import type { AdminCapability, Role } from '@/api/users'

/**
 * Hooks de TanStack Query de ADM-27 (USERS-007 a USERS-011). Patrón de
 * `src/api/README.md`: claves estables por función (`usersKeys`), un hook
 * por lectura y un hook por acción, todas las mutaciones invalidan la lista
 * al terminar bien.
 *
 * Polling: la lista de usuarios no es un tablero ni "Asistencia de hoy"
 * (regla común: 30 s ahí, 60 s "en el resto de las listas") -- 60 s acá.
 * `useLastSignInsQuery` sigue el mismo intervalo porque alimenta la misma
 * tabla. `useAdminCapabilitiesQuery` es el contenido de un panel que se
 * abre a demanda (no una lista permanente en pantalla): sin polling.
 */

const LIST_POLLING_MS = 60_000

export const usersKeys = {
  all: ['users'] as const,
  list: () => [...usersKeys.all, 'list'] as const,
  lastSignIns: () => [...usersKeys.all, 'lastSignIns'] as const,
  capabilities: (profileId: string) =>
    [...usersKeys.all, 'capabilities', profileId] as const,
}

/** USERS-008: lista de usuarios con sus roles. */
export function useUsersQuery() {
  return useQuery({
    queryKey: usersKeys.list(),
    queryFn: usersApi.fetchUsers,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

/**
 * USERS-008: último inicio de sesión por persona. Solo tiene sentido
 * pedirlo si la sesión es del dueño (`security_events` es de lectura solo
 * del owner, `04` sección 7.2) -- `enabled` lo controla quien usa el hook
 * (`UsersPage`, con `useAuth()`), así se evita una consulta que RLS va a
 * vaciar de todos modos para un administrador.
 */
export function useLastSignInsQuery(enabled: boolean) {
  return useQuery({
    queryKey: usersKeys.lastSignIns(),
    queryFn: usersApi.fetchLastSignIns,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
    enabled,
  })
}

/** USERS-010: capacidades de un administrador puntual (panel del dueño). */
export function useAdminCapabilitiesQuery(
  profileId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: usersKeys.capabilities(profileId ?? ''),
    queryFn: () => usersApi.fetchAdminCapabilities(profileId as string),
    enabled: enabled && profileId != null,
  })
}

function useInvalidateUsers() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: usersKeys.list() })
    void queryClient.invalidateQueries({ queryKey: usersKeys.lastSignIns() })
  }
}

/** USERS-009: alta de un usuario administrativo. */
export function useCreateAdminUserMutation() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: usersApi.createAdminUser,
    onSuccess: invalidate,
  })
}

/**
 * USERS-010: reemplaza el conjunto de roles. Si el conjunto nuevo le saca
 * un rol a la persona, después cierra sus sesiones (`06_API.md` sección
 * 2.2: "Si se quita un rol, el frontend llama sign_out_user para que el
 * JWT viejo no siga valiendo" -- la RPC no lo hace por sí sola).
 */
export function useSetUserRolesMutation() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async ({
      profileId,
      previousRoles,
      roles,
    }: {
      profileId: string
      previousRoles: Role[]
      roles: Role[]
    }) => {
      const result = await usersApi.setUserRoles(profileId, roles)
      const lostARole = previousRoles.some((role) => !roles.includes(role))
      if (lostARole) {
        await usersApi.signOutUser(profileId)
      }
      return result
    },
    onSuccess: invalidate,
  })
}

/** USERS-010: activa o desactiva una capacidad de un administrador. */
export function useSetAdminCapabilityMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      profileId,
      capability,
      enabled,
    }: {
      profileId: string
      capability: AdminCapability
      enabled: boolean
    }) => usersApi.setAdminCapability(profileId, capability, enabled),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: usersKeys.capabilities(variables.profileId),
      })
    },
  })
}

/** USERS-011: resetear contraseña (revoca sesiones del lado del servidor). */
export function useResetPasswordMutation() {
  return useMutation({
    mutationFn: ({
      profileId,
      newPassword,
    }: {
      profileId: string
      newPassword: string
    }) => usersApi.resetPassword(profileId, newPassword),
  })
}

/** USERS-011: cambiar el email de login. */
export function useUpdateEmailMutation() {
  return useMutation({
    mutationFn: ({ profileId, email }: { profileId: string; email: string }) =>
      usersApi.updateEmail(profileId, email),
  })
}

/** USERS-011: cerrar todas las sesiones. */
export function useSignOutUserMutation() {
  return useMutation({
    mutationFn: (profileId: string) => usersApi.signOutUser(profileId),
  })
}

/** USERS-011: desactivar, con motivo obligatorio. */
export function useDeactivateUserMutation() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: ({
      profileId,
      reason,
    }: {
      profileId: string
      reason: string
    }) => usersApi.deactivateUser(profileId, reason),
    onSuccess: invalidate,
  })
}

/** USERS-011: reactivar (solo el dueño). */
export function useReactivateUserMutation() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: (profileId: string) => usersApi.reactivateUser(profileId),
    onSuccess: invalidate,
  })
}
