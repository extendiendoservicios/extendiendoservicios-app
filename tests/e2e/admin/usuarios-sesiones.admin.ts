import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { FIXED_ACCOUNTS, getAdminDb } from '../../fixtures/accounts.ts'
import {
  MISSING_ENV_MESSAGE,
  readE2eEnv,
  requireE2eEnv,
} from '../../fixtures/env.ts'
import {
  anonClient,
  signInSession,
  storageStatePath,
} from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { chooseMenuItem } from '../../fixtures/ui.ts'

// TEST-016 (P18.1): gestión de cuentas de empleados desde ADM-27 con `manage_users` (RB-A01,
// RB-A02; P-015 "cerrar sesiones ajenas", flujo de `reset_password`). La Edge Function
// `admin-users` se invoca desde el navegador, por eso la suite corre en el puerto 5173.
//   - Cerrar sesiones: el servidor revoca el refresh token; el access token ya emitido sigue
//     valiendo hasta que vence (documentado en 04 sección 7.1), pero no se puede renovar.
//   - Resetear contraseña: la anterior deja de servir, la nueva sí, y se cierran las sesiones.
// Cuenta de este archivo: la persona `dual` (empleado y supervisor), reservada a estas pruebas;
// el test deja su contraseña como estaba (la repone con la clave de servicio).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

const NUEVA_CLAVE = 'E2e-Fijo-Clave-Nueva-1'

test(
  'un administrador con manage_users cierra las sesiones de un empleado y resetea su contraseña',
  cubre('RB-A01', 'RB-A02', 'P-015'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const env = requireE2eEnv()
    const cuenta = FIXED_ACCOUNTS.dual
    const nombre = `${cuenta.firstName} ${cuenta.lastName}`
    const db = getAdminDb()
    const { data: lista } = await db
      .from('profiles')
      .select('id')
      .eq('first_name', cuenta.firstName)
      .eq('last_name', cuenta.lastName)
      .single()
    const perfilId = lista!.id
    const desde = new Date().toISOString()

    try {
      await page.goto('/admin/configuracion/usuarios')
      await expect(
        page.getByRole('heading', { name: 'Usuarios y roles' }),
      ).toBeVisible()

      await test.step('cerrar sesiones: el refresh token queda revocado', async () => {
        const antes = await signInSession(cuenta.email)
        await chooseMenuItem(page, `Acciones para ${nombre}`, 'Cerrar sesiones')
        await page
          .getByRole('dialog', { name: 'Cerrar sesiones' })
          .getByRole('button', { name: 'Cerrar sesiones' })
          .click()
        await expect(
          page.getByText(`Cerramos todas las sesiones de ${nombre}.`),
        ).toBeVisible()

        const cliente = anonClient()
        const renovada = await cliente.auth.refreshSession({
          refresh_token: antes.refresh_token,
        })
        expect(
          renovada.error,
          'con las sesiones cerradas no se puede renovar el token',
        ).not.toBeNull()
      })

      await test.step('resetear contraseña: la anterior deja de servir y la nueva funciona', async () => {
        await chooseMenuItem(
          page,
          `Acciones para ${nombre}`,
          'Resetear contraseña',
        )
        const dialogo = page.getByRole('dialog', {
          name: 'Resetear contraseña',
        })
        await dialogo.getByLabel('Contraseña nueva').fill(NUEVA_CLAVE)
        await dialogo
          .getByRole('button', { name: 'Resetear contraseña' })
          .click()
        await expect(
          page.getByText(
            `Restablecimos la contraseña de ${nombre} y cerramos sus sesiones.`,
          ),
        ).toBeVisible()

        const vieja = await anonClient().auth.signInWithPassword({
          email: cuenta.email,
          password: env.seedPassword,
        })
        expect(vieja.error, 'la contraseña anterior ya no sirve').not.toBeNull()
        const cliente = createClient(env.supabaseUrl, env.anonKey, {
          auth: { persistSession: false },
        })
        const nueva = await cliente.auth.signInWithPassword({
          email: cuenta.email,
          password: NUEVA_CLAVE,
        })
        expect(nueva.error, nueva.error?.message).toBeNull()
      })

      await test.step('queda el rastro en los eventos de seguridad', async () => {
        const { data: eventos } = await db
          .from('security_events')
          .select('event_type')
          .eq('target_id', perfilId)
          .gte('created_at', desde)
          .in('event_type', ['sessions_revoked', 'password_reset_by_admin'])
        const tipos = new Set((eventos ?? []).map((e) => e.event_type))
        expect(tipos.has('sessions_revoked')).toBe(true)
        expect(tipos.has('password_reset_by_admin')).toBe(true)
      })
    } finally {
      // Repone la contraseña de la cuenta fija pase lo que pase.
      await db.auth.admin.updateUserById(perfilId, {
        password: env.seedPassword,
      })
    }
  },
)
