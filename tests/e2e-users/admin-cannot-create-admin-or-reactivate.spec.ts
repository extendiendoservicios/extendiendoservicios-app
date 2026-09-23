import { expect, test } from '@playwright/test'
import { readE2eUsersEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  banDirectly,
  callAdminUsersFunction,
  disposableEmail,
  getAdminClient,
  signInForToken,
} from './helpers/adminUsersClient.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// USERS-018 (encargo P07.4): "un administrador no puede crear otro administrador ni reactivar a
// nadie" — por API directa, sin UI (la pantalla ya oculta los botones, `canCreateAdminUser` y
// `canReactivateUser` en `src/features/users/permissions.ts`; acá se comprueba que el SERVIDOR
// también lo rechaza, no solo la interfaz — regla de la suite de permisos: "por interfaz y por
// API directa"). Fuente: `12_Registro_de_Progreso.md`, fila del 23 sep 2026 ("El alta de
// administradores (ADM-27) es solo del dueño... porque le permitiría ampliar sus propios
// permisos") y `06_API.md` sección 2.1 ("reactivate_user | profile_id | O").
//
// Solo en `chromium` (prueba de API, sin nada visual).

const env = readE2eUsersEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test('un administrador con manage_users no puede crear otro administrador ni reactivar a nadie', async () => {
  const admin = getAdminClient()
  const actorEmail = disposableEmail('admin-actor')
  const password = `${env!.seedPassword}Cc3`
  let actorProfileId: string | null = null
  let deactivatedTargetProfileId: string | null = null

  try {
    // El dueño crea al administrador de prueba (con manage_users, activa por defecto).
    const { accessToken: ownerToken } = await signInForToken(
      SEED_ACCOUNTS.owner,
      env!.seedPassword,
    )
    const createResult = await callAdminUsersFunction(
      ownerToken,
      'create_user',
      {
        email: actorEmail,
        password,
        first_name: 'E2E',
        last_name: 'P074 Admin Actor',
        roles: ['admin'],
      },
    )
    expect(createResult.status, JSON.stringify(createResult.body)).toBe(200)
    actorProfileId = (createResult.body as { data: { profile_id: string } })
      .data.profile_id

    // Cuenta descartable ya desactivada, como blanco del intento de reactivación (no se toca a
    // nadie del seed). Se crea y se banea DIRECTO con la clave de servicio (no por la Edge
    // Function): lo único que hace falta acá es un `profile_id` desactivado cualquiera, no
    // probar `create_user`/`deactivate_user` en sí (eso ya lo cubren otros specs de esta
    // carpeta) -- así esta prueba gasta un solo cupo del límite de 10 acciones por minuto del
    // dueño en vez de tres, importante para poder correr la suite completa varias veces seguidas
    // (regla del encargo, TEST-029).
    const targetEmail = disposableEmail('blanco-reactivar')
    const { data: createdTarget, error: createTargetError } =
      await admin.auth.admin.createUser({
        email: targetEmail,
        password: `${env!.seedPassword}Dd4`,
        email_confirm: true,
        user_metadata: {
          first_name: 'E2E',
          last_name: 'P074 Blanco Reactivar',
        },
      })
    if (createTargetError || !createdTarget.user) {
      throw new Error(
        `No se pudo crear el blanco de reactivación: ${createTargetError?.message}`,
      )
    }
    const targetProfileId = createdTarget.user.id
    await banDirectly(admin, targetProfileId)
    deactivatedTargetProfileId = targetProfileId

    // El administrador de prueba (con manage_users) inicia sesión y prueba las dos acciones
    // fuera de su alcance.
    const { accessToken: actorToken } = await signInForToken(
      actorEmail,
      password,
    )

    const createAnotherAdminResult = await callAdminUsersFunction(
      actorToken,
      'create_user',
      {
        email: disposableEmail('otro-admin-rechazado'),
        password: `${env!.seedPassword}Ee5`,
        first_name: 'E2E',
        last_name: 'P074 No Debería Crearse',
        roles: ['admin'],
      },
    )
    expect(createAnotherAdminResult.status).toBe(403)
    expect(
      (createAnotherAdminResult.body as { error: { hint: string } }).error.hint,
    ).toBe('FORBIDDEN')

    const reactivateResult = await callAdminUsersFunction(
      actorToken,
      'reactivate_user',
      {
        profile_id: deactivatedTargetProfileId,
      },
    )
    expect(reactivateResult.status).toBe(403)
    expect(
      (reactivateResult.body as { error: { hint: string } }).error.hint,
    ).toBe('FORBIDDEN')

    // Confirmación de que ninguno de los dos intentos, aunque rechazados, dejó rastro: la cuenta
    // "otro-admin-rechazado" nunca se creó.
    const { data: usersList } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    const shouldNotExist = usersList.users.some((u) =>
      u.email?.includes('otro-admin-rechazado'),
    )
    expect(
      shouldNotExist,
      'el intento rechazado no tiene que haber creado nada',
    ).toBe(false)
  } finally {
    if (actorProfileId) {
      await banDirectly(admin, actorProfileId)
    }
    // `deactivatedTargetProfileId` ya quedó desactivado por el propio flujo de la prueba (era el
    // punto: nunca se reactivó de verdad); no hace falta tocarlo de nuevo.
  }
})
