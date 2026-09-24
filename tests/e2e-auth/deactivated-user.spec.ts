import { expect, test } from '@playwright/test'
import { readE2eAuthEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  getAdminClient,
  createDisposableUser,
  deleteDisposableUser,
  disposableEmail,
} from './helpers/adminClient.ts'

// AUTH-012: "usuario desactivado (no puede entrar / no ve datos)".
//
// Lo que hoy garantiza el sistema (F7, la Edge Function `admin-users`, todavía no existe —
// 08_Fases_y_Backlog.md, fila USERS-001 en adelante) es el baneo de Auth
// (`auth.admin.updateUserById(id, { ban_duration })`): `signInWithPassword` lo rechaza con el
// código `user_banned`, que `authErrors.ts` ya traduce. `profiles.is_active = false` por sí
// solo NO bloquea nada hoy (pendiente documentado en `12_Registro_de_Progreso.md`: el hook le
// sigue entregando roles a una cuenta inactiva) — no se prueba acá como si fuera equivalente,
// porque no lo es todavía; ver el reporte del encargo para el detalle de esta distinción y de
// la ventana de revocación de hasta una hora (P06.2).
const env = readE2eAuthEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test('una cuenta baneada no puede iniciar sesión y ve el mensaje en español, sin detalle técnico', async ({
  page,
}) => {
  const admin = getAdminClient()
  const email = disposableEmail('desactivado')
  const password = `${env!.seedPassword}-desactivado`
  const userId = await createDisposableUser(admin, email, password)

  try {
    const { error: banError } = await admin.auth.admin.updateUserById(
      userId,
      // Duración larga a propósito ("desactivado" no tiene fecha de fin desde la UI hoy): el
      // valor exacto no importa para este test, que termina y borra la cuenta en el mismo
      // bloque `finally`.
      { ban_duration: '876000h' },
    )
    expect(banError).toBeNull()

    await page.goto('/ingresar')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Contraseña', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Ingresar' }).click()

    await expect(page.getByText('No pudimos iniciar sesión')).toBeVisible()
    await expect(
      page.getByText(
        'Esta cuenta está desactivada. Comunicate con Administración.',
      ),
    ).toBeVisible()

    // No entró a ninguna vía protegida.
    await expect(page).toHaveURL(/\/ingresar$/)
  } finally {
    await deleteDisposableUser(admin, userId)
  }
})
