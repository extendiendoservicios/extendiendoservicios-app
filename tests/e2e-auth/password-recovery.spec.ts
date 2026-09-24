import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { readE2eAuthEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  getAdminClient,
  createDisposableUser,
  deleteDisposableUser,
  disposableEmail,
} from './helpers/adminClient.ts'
import { E2E_AUTH_BASE_URL } from './helpers/baseUrl.ts'

// AUTH-012: "recuperación de contraseña de punta a punta" + "comprobar que el formulario
// 'olvidé mi contraseña' dispara el envío, con verificar la respuesta de la UI alcanza; no
// generes muchos correos (Resend tiene límites)".
//
// Regla 3 del encargo: sin leer bandeja de entrada real. Se usa
// `auth.admin.generateLink({ type: 'recovery' })` para conseguir el enlace directamente (esa
// llamada NO manda ningún correo, solo lo genera) y se recorre COM-03 con él. El
// `redirect_to` va como PARÁMETRO DE CONSULTA (`options.redirectTo`, ver
// `node_modules/@supabase/auth-js/.../lib/fetch.js`, línea ~99: `qs['redirect_to']`), no en el
// cuerpo — el error que ya se cometió una vez en P06.3 y quedó documentado en
// `ResetPasswordPage.tsx`.
const env = readE2eAuthEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

const NUEVA_CONTRASENA = 'e2e-recuperacion-contrasena-nueva-9'

test('COM-02: el formulario "olvidé mi contraseña" muestra la confirmación genérica sin delatar la cuenta', async ({
  page,
}) => {
  // Email que no existe: `resetPasswordForEmail` no manda ningún correo en este caso (lo
  // verificó P06.3, ver el comentario de `ForgotPasswordPage.tsx`), así que este test no gasta
  // ninguna cuota de Resend y de todos modos comprueba que la UI responde con el mismo mensaje
  // que si la cuenta existiera.
  await page.goto('/recuperar')
  await page
    .getByLabel('Email')
    .fill(`e2e-auth-recuperar-inexistente-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Mandar instrucciones' }).click()

  await expect(
    page.getByRole('heading', { name: 'Revisá tu correo' }),
  ).toBeVisible()
  await expect(
    page.getByText(
      'Si ese email tiene una cuenta, te mandamos un correo con instrucciones para restablecer la contraseña.',
    ),
  ).toBeVisible()
})

test('COM-02 a COM-03: recuperación de punta a punta con el enlace generado por la Admin API', async ({
  page,
}) => {
  const admin = getAdminClient()
  const email = disposableEmail('recuperacion')
  const contrasenaInicial = `${env!.seedPassword}-inicial`
  const userId = await createDisposableUser(admin, email, contrasenaInicial)

  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${E2E_AUTH_BASE_URL}/restablecer` },
    })
    expect(error).toBeNull()
    const actionLink = data?.properties?.action_link
    expect(actionLink).toBeTruthy()

    // `detectSessionInUrl` (src/lib/supabase.ts) procesa el enlace apenas `supabase-js` se
    // inicializa, antes de que React monte nada (comentario grande de `ResetPasswordPage.tsx`):
    // navegar directo al enlace ya deja una sesión `PASSWORD_RECOVERY` armada para cuando la
    // pantalla se renderiza.
    await page.goto(actionLink!)

    await expect(
      page.getByRole('heading', { name: 'Elegí una contraseña nueva' }),
    ).toBeVisible()

    await page
      .getByLabel('Contraseña nueva', { exact: true })
      .fill(NUEVA_CONTRASENA)
    await page
      .getByLabel('Confirmar contraseña', { exact: true })
      .fill(NUEVA_CONTRASENA)
    await page.getByRole('button', { name: 'Guardar contraseña' }).click()

    // Esta cuenta descartable no tiene ningún rol (createDisposableUser no le asigna
    // `user_roles`): tras USER_UPDATED, homePathForRoles([]) da `null` → /sin-acceso. Es la
    // señal de que la contraseña se guardó y la sesión de recuperación se resolvió (si hubiera
    // fallado, seguiría en el formulario o mostraría el error de `updatePasswordErrorMessage`).
    await expect(page).toHaveURL(/\/sin-acceso$/)
    await expect(
      page.getByRole('heading', { name: 'Sin acceso' }),
    ).toBeVisible()

    // Verificación real del cambio, por fuera de la UI: la contraseña nueva permite entrar y la
    // vieja ya no sirve — sin esto, el test de arriba solo probaría la navegación, no que
    // `auth.updateUser` haya guardado algo distinto de lo que ya tenía.
    const anon = createClient(env!.supabaseUrl, env!.anonKey)
    const { error: loginNuevaError } = await anon.auth.signInWithPassword({
      email,
      password: NUEVA_CONTRASENA,
    })
    expect(loginNuevaError).toBeNull()
    await anon.auth.signOut()

    const { error: loginViejaError } = await anon.auth.signInWithPassword({
      email,
      password: contrasenaInicial,
    })
    expect(loginViejaError?.code).toBe('invalid_credentials')
  } finally {
    await deleteDisposableUser(admin, userId)
  }
})
