import { expect, test } from '@playwright/test'
import { callAdminUsers } from '../../fixtures/api.ts'
import { getAdminDb, loadAuthUsers } from '../../fixtures/accounts.ts'
import {
  MISSING_ENV_MESSAGE,
  readE2eEnv,
  requireE2eEnv,
  authStorageKey,
} from '../../fixtures/env.ts'
import { signInSession } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { loginByForm } from '../../fixtures/ui.ts'

// TEST-017 (P18.2): CB-18, "usuario desactivado con la app abierta" (P-014). Es un test de baja
// y reactivación, así que NO usa una cuenta fija de empleado (desactivarla y reponerla pisaría
// las sesiones de las demás suites): usa una cuenta propia, `e2e-baja-cb18@example.com`, que se
// crea la primera vez y se reutiliza (se reactiva al empezar y queda desactivada al terminar,
// como pide la regla "nada se borra", P-014).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const EMAIL = 'e2e-baja-cb18@example.com'

test(
  'CB-18: con la app abierta, al desactivar la cuenta el siguiente refresco de la sesión deja a la persona fuera',
  cubre('CB-18', 'RB-E01', 'P-014'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const env = requireE2eEnv()
    const db = getAdminDb()
    const owner = await signInSession('extserviciosapp@gmail.com')
    let id = (await loadAuthUsers(db)).get(EMAIL)?.id ?? null

    try {
      await test.step('la cuenta existe, está activa y es de empleado', async () => {
        if (!id) {
          const { data, error } = await db.auth.admin.createUser({
            email: EMAIL,
            password: env.seedPassword,
            email_confirm: true,
            user_metadata: { first_name: 'E2E-Baja', last_name: 'CB18' },
          })
          expect(error, error?.message).toBeNull()
          id = data.user!.id
        } else {
          const reactivada = await callAdminUsers(
            owner.access_token,
            'reactivate_user',
            { profile_id: id },
          )
          expect(reactivada.status, JSON.stringify(reactivada.body)).toBe(200)
        }
        await db
          .from('profiles')
          .update({
            is_active: true,
            deleted_at: null,
            first_name: 'E2E-Baja',
            last_name: 'CB18',
          })
          .eq('id', id)
        await db
          .from('user_roles')
          .upsert(
            { profile_id: id, role: 'employee' },
            { onConflict: 'profile_id,role', ignoreDuplicates: true },
          )
      })

      await test.step('ingresa por la pantalla y trabaja con la app abierta', async () => {
        await loginByForm(page, EMAIL, /\/app$/)
        await expect(page.getByText('No tenés servicios hoy')).toBeVisible()
      })

      await test.step('el dueño la desactiva (se cierran las sesiones, P-014)', async () => {
        const baja = await callAdminUsers(
          owner.access_token,
          'deactivate_user',
          {
            profile_id: id,
            reason: 'e2e-cb18: prueba con la app abierta',
          },
        )
        expect(baja.status, JSON.stringify(baja.body)).toBe(200)
      })

      await test.step('al renovar la sesión, la app lo deja fuera', async () => {
        // Se vence a mano el `access_token` guardado: el siguiente arranque de la app tiene que
        // renovarlo (en uso real ocurre a la hora, `jwt_expiry`) y la renovación ya no existe.
        const clave = authStorageKey(env.supabaseUrl)
        await page.evaluate((k) => {
          const sesion = JSON.parse(localStorage.getItem(k) ?? '{}') as {
            expires_at?: number
          }
          sesion.expires_at = Math.floor(Date.now() / 1000) - 60
          localStorage.setItem(k, JSON.stringify(sesion))
        }, clave)
        await page.reload()
        // `08` CB-18 dice "ve COM-05" (`/sin-acceso`). Como la baja cierra las sesiones (P-014),
        // la renovación falla y la app lo manda a ingresar (COM-01); COM-05 solo se vería si la
        // renovación saliera bien con los permisos vacíos. Se acepta cualquiera de las dos
        // pantallas (la persona queda fuera) y la diferencia va como pregunta en el reporte.
        await expect(page).toHaveURL(/\/(ingresar|sin-acceso)$/)
      })

      await test.step('no puede volver a entrar a su vía ni iniciar sesión de nuevo', async () => {
        await page.goto('/app', { waitUntil: 'commit' })
        await expect(page).toHaveURL(/\/(ingresar|sin-acceso)$/)
        await page.goto('/ingresar')
        await page.getByLabel('Email').fill(EMAIL)
        await page
          .getByLabel('Contraseña', { exact: true })
          .fill(env.seedPassword)
        await page.getByRole('button', { name: 'Ingresar' }).click()
        await expect(
          page.getByText(
            'Esta cuenta está desactivada. Comunicate con Administración.',
          ),
        ).toBeVisible()
      })
    } finally {
      if (id) {
        await callAdminUsers(owner.access_token, 'deactivate_user', {
          profile_id: id,
          reason: 'e2e-cb18: fin de la prueba',
        })
      }
    }
  },
)
