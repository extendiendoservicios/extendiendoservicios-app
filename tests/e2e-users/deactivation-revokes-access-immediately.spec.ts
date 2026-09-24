import { expect, test } from '@playwright/test'
import { readE2eUsersEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  banDirectly,
  callAdminUsersFunction,
  countOwnProfileRowsWithToken,
  disposableEmail,
  getAdminClient,
  signInForToken,
} from './helpers/adminUsersClient.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// USERS-018 (encargo P07.4): "que al desactivar a alguien su token vigente deja de leer datos
// al instante y que al reactivarlo vuelve" — por API directa con `supabase-js`/`fetch`, sin UI:
// lo que se prueba acá es la garantía del servidor (RLS + `app.current_uid()`,
// `0022_own_row_policies_active_check.sql`), no una pantalla. `04_Modelo_de_Datos.md` sección
// 7.1 y `12_Registro_de_Progreso.md` (decisión de Mike del 23 sep 2026, "Antes de F7") son la
// fuente: sin este cierre, un `access_token` ya emitido seguía leyendo hasta `jwt_expiry`
// (900 s desde P07.1) después de que a su dueño lo desactivaran.
//
// Solo corre en `chromium`: el proyecto `mobile` de `playwright.users.config.ts` limita su
// `testMatch` al recorrido principal (nada visual que cambie acá, es una prueba de API).

const env = readE2eUsersEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test('desactivar corta el acceso al instante con un token vigente, y reactivar lo devuelve', async () => {
  const admin = getAdminClient()
  const email = disposableEmail('revocacion')
  const password = `${env!.seedPassword}Bb2`
  let profileId: string | null = null

  try {
    // Cuenta descartable SIN rol (alcanza para esta prueba: la política de "fila propia" de
    // `profiles` no exige ningún rol, cualquier persona autenticada ve la suya).
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { first_name: 'E2E', last_name: 'P074 Revocación' },
      })
    if (createError || !created.user) {
      throw new Error(
        `No se pudo crear la cuenta descartable: ${createError?.message}`,
      )
    }
    profileId = created.user.id

    // Token vigente de la propia cuenta, ANTES de que nadie la toque.
    const { accessToken } = await signInForToken(email, password)
    const rowsBeforeDeactivation = await countOwnProfileRowsWithToken(
      accessToken,
      profileId,
    )
    expect(
      rowsBeforeDeactivation,
      'antes de desactivar tiene que ver su propia fila',
    ).toBe(1)

    // El dueño la desactiva por la Edge Function (la acción real de USERS-018, no un baneo
    // directo -- acá interesa probar `deactivate_user` en sí).
    const { accessToken: ownerToken } = await signInForToken(
      SEED_ACCOUNTS.owner,
      env!.seedPassword,
    )
    const deactivateResult = await callAdminUsersFunction(
      ownerToken,
      'deactivate_user',
      {
        profile_id: profileId,
        reason: 'e2e-p074: prueba de revocación inmediata',
      },
    )
    expect(deactivateResult.status, JSON.stringify(deactivateResult.body)).toBe(
      200,
    )

    // MISMO token, sin volver a iniciar sesión: la lectura tiene que dar CERO filas de inmediato
    // (no un error -- `app.current_uid()` devuelve `null` y `null = id` nunca matchea, así que
    // PostgREST responde 200 con un array vacío, no 403).
    const rowsAfterDeactivation = await countOwnProfileRowsWithToken(
      accessToken,
      profileId,
    )
    expect(
      rowsAfterDeactivation,
      'con el token vigente, después de desactivar tiene que dejar de ver su propia fila',
    ).toBe(0)

    // El dueño la reactiva.
    const reactivateResult = await callAdminUsersFunction(
      ownerToken,
      'reactivate_user',
      {
        profile_id: profileId,
      },
    )
    expect(reactivateResult.status, JSON.stringify(reactivateResult.body)).toBe(
      200,
    )

    // Con el MISMO token de siempre (nunca expiró, nunca se volvió a iniciar sesión), vuelve a
    // ver su propia fila.
    const rowsAfterReactivation = await countOwnProfileRowsWithToken(
      accessToken,
      profileId,
    )
    expect(
      rowsAfterReactivation,
      'con el mismo token, después de reactivar tiene que volver a ver su propia fila',
    ).toBe(1)
  } finally {
    // Regla del encargo: queda desactivada al terminar. Baneo directo (no por la Edge Function)
    // para no gastar más cupo del límite de 10 acciones por minuto del dueño -- ya usó dos en
    // este mismo test (deactivate_user, reactivate_user).
    if (profileId) {
      await banDirectly(admin, profileId)
    }
  }
})
