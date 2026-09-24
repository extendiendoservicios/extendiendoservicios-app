import { expect, test } from '@playwright/test'
import { readE2eUsersEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  getAdminClient,
  signInForToken,
  callAdminUsersFunction,
} from './helpers/adminUsersClient.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// USERS-018 (encargo P07.4): "el último dueño no se puede desactivar" — `06_API.md` sección 2.1
// (regla del último owner, P-017) y `supabase/functions/admin-users/index.ts`
// (`actionDeactivateUser`: cuenta owners ACTIVOS distintos del blanco, `LAST_OWNER` si da cero).
// El seed de `App_dev` tiene un solo dueño activo (Lucas Enriquez, `extserviciosapp@gmail.com`,
// `12_Registro_de_Progreso.md`), así que intentar desactivarlo A ÉL MISMO tiene que rechazarse
// antes de tocar nada -- por eso este test NUNCA debería dejar al owner real desactivado, ni
// siquiera un instante: `actionDeactivateUser` hace el conteo de "otros owners activos" ANTES de
// llamar a la Admin API para banear (ver el código de la función), así que un rechazo por
// `LAST_OWNER` no alcanza a banear a nadie.
//
// Por API directa, sin UI: `UserActionsMenu` ni siquiera ofrece "Desactivar" sobre la propia
// cuenta del dueño en la práctica (haría falta poder verse a sí mismo en la lista y clickear su
// propio menú, algo que ninguna pantalla de ADM-27 le impide explícitamente por interfaz hoy) —
// lo que importa para USERS-018 es que el SERVIDOR lo rechace, con o sin botón.
//
// Solo en `chromium` (prueba de API, sin nada visual).
//
// Historia: este test encontró en P07.4 que `actionDeactivateUser` respondía 500 INTERNAL_ERROR
// en vez de 409 LAST_OWNER al intentar desactivar a CUALQUIER dueño. El conteo de dueños activos
// embebía `profiles!inner(...)` sin indicar la FK, y `user_roles` tiene dos hacia `profiles`
// (`profile_id` y `granted_by`), así que PostgREST devolvía `PGRST201`. Corregido en P07.5 con
// `profiles!user_roles_profile_id_fkey!inner(...)`, el mismo patrón que `src/api/users.ts`.

const env = readE2eUsersEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test('el servidor rechaza desactivar al último dueño activo (LAST_OWNER)', async () => {
  const admin = getAdminClient()

  const { accessToken: ownerToken, userId: ownerProfileId } =
    await signInForToken(SEED_ACCOUNTS.owner, env!.seedPassword)

  const result = await callAdminUsersFunction(ownerToken, 'deactivate_user', {
    profile_id: ownerProfileId,
    reason:
      'e2e-p074: intento de desactivar al último dueño, tiene que rechazarse',
  })

  expect(result.status, JSON.stringify(result.body)).toBe(409)
  expect((result.body as { error: { hint: string } }).error.hint).toBe(
    'LAST_OWNER',
  )

  // Confirmación extra, con la clave de servicio: el dueño del seed sigue activo y sin banear
  // después del intento rechazado.
  const { data: ownerAuthUser, error } =
    await admin.auth.admin.getUserById(ownerProfileId)
  if (error || !ownerAuthUser.user) {
    throw new Error(
      `No se pudo verificar el estado del dueño después del intento: ${error?.message}`,
    )
  }
  expect(
    ownerAuthUser.user.banned_until == null ||
      ownerAuthUser.user.banned_until === 'none',
    'el dueño del seed no tiene que quedar baneado por el intento rechazado',
  ).toBe(true)

  const { data: ownerProfile, error: profileError } = await admin
    .from('profiles')
    .select('is_active, deleted_at')
    .eq('id', ownerProfileId)
    .single()
  if (profileError) {
    throw new Error(
      `No se pudo verificar profiles del dueño: ${profileError.message}`,
    )
  }
  expect(ownerProfile.is_active).toBe(true)
  expect(ownerProfile.deleted_at).toBeNull()
})
