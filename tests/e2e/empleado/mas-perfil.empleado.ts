import { expect, test } from '@playwright/test'
import { FIXED_ACCOUNTS, getAdminDb } from '../../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { fijarConsentimiento, pngSolido } from '../../fixtures/movil.ts'
import {
  anonClient,
  readId,
  signInSession,
  storageStatePath,
} from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll, loginByForm } from '../../fixtures/ui.ts'

// TEST-017 (P18.2): "Más" (EMP-13, P-122) y el perfil propio (COM-04): autogestión de contacto,
// foto de perfil (P-037) y consentimiento de ubicación (P-108). Cuenta de este archivo:
// empleado2. El test deja la cuenta como estaba (sin foto, sin teléfono ni email de contacto).
//
// "Cerrar sesión" (DEF-04, corregido en P18.6: el cierre es local) se prueba en un test aparte con
// un ingreso propio por la pantalla: así cierra SU sesión y no la del archivo de sesión compartido
// con los demás tests de la cuenta.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('empleado2') })

test(
  'Más ofrece perfil, avisar y cerrar sesión; un empleado sin el rol no ve "Supervisión"',
  cubre('RB-E01', 'RB-E07', 'P-122'),
  async ({ page }) => {
    await page.goto('/app')
    const tabbar = page.getByRole('navigation', {
      name: 'Navegación principal',
    })
    await expect(tabbar.getByRole('link', { name: 'Hoy' })).toBeVisible()
    await expect(tabbar.getByLabel('Fichar')).toBeVisible()
    await tabbar.getByRole('link', { name: 'Más' }).click()
    await expect(page).toHaveURL(/\/app\/mas$/)

    await expect(page.getByRole('link', { name: 'Mi perfil' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Avisar demora o ausencia' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Cerrar sesión' }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Supervisión' }),
      'sin el rol de supervisor no hay acceso cruzado',
    ).toHaveCount(0)
    await expectNoHorizontalScroll(page)

    await page.getByRole('link', { name: 'Mi perfil' }).click()
    await expect(page).toHaveURL(/\/perfil$/)
    // AJ-01 (reunión del 6 oct 2026): el nombre completo de solo lectura pasó a ser dos campos
    // editables, «Nombre» y «Apellido». La edición misma se prueba en `tests/e2e-ajustes-reunion/`.
    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue(
      FIXED_ACCOUNTS.empleado2.firstName,
    )
    await expect(page.getByLabel('Apellido', { exact: true })).toHaveValue(
      FIXED_ACCOUNTS.empleado2.lastName,
    )
    await expect(page.getByLabel('Email de login')).toHaveValue(
      FIXED_ACCOUNTS.empleado2.email,
    )
    await expect(page.getByText('Empleado', { exact: true })).toBeVisible()
  },
)

test(
  'el perfil permite editar teléfono y email de contacto, y dar o quitar el consentimiento de ubicación',
  cubre('RB-E01', 'P-037', 'P-108'),
  async ({ page }) => {
    const db = getAdminDb()
    const id = readId('empleado2')
    try {
      await fijarConsentimiento('empleado2', false)
      await page.goto('/perfil')

      await test.step('contacto: se guarda y queda en la Base', async () => {
        await page.getByLabel('Teléfono').fill('+5491155559999')
        await page
          .getByLabel('Email de contacto')
          .fill('e2e-contacto@example.com')
        await page.getByRole('button', { name: 'Guardar contacto' }).click()
        await expect(page.getByText('Guardamos los cambios.')).toBeVisible()
        const { data } = await db
          .from('profiles')
          .select('phone, contact_email')
          .eq('id', id)
          .single()
        expect(data).toEqual({
          phone: '+5491155559999',
          contact_email: 'e2e-contacto@example.com',
        })
      })

      await test.step('un email de contacto inválido no se guarda', async () => {
        const campo = page.getByLabel('Email de contacto')
        await campo.fill('no-es-un-email')
        await page.getByRole('button', { name: 'Guardar contacto' }).click()
        // El `<input type="email">` frena el envío con su validación nativa.
        expect(
          await campo.evaluate((el: HTMLInputElement) => el.checkValidity()),
        ).toBe(false)
        const { data } = await db
          .from('profiles')
          .select('contact_email')
          .eq('id', id)
          .single()
        expect(data?.contact_email).toBe('e2e-contacto@example.com')
      })

      await test.step('consentimiento de ubicación: dar y quitar', async () => {
        await expect(
          page.getByText('Todavía no diste tu consentimiento de ubicación.'),
        ).toBeVisible()
        await page
          .getByRole('button', { name: 'Dar mi consentimiento' })
          .click()
        await expect(page.getByText(/Diste tu consentimiento el/)).toBeVisible()
        await page
          .getByRole('button', { name: 'Quitar consentimiento' })
          .click()
        await expect(
          page.getByText('Todavía no diste tu consentimiento de ubicación.'),
        ).toBeVisible()
      })
    } finally {
      await db
        .from('profiles')
        .update({ phone: null, contact_email: null })
        .eq('id', id)
    }
  },
)

test(
  'P-037: el empleado sube su foto de perfil, la ve y la quita',
  cubre('P-037', 'RB-E01'),
  async ({ page }) => {
    test.setTimeout(120_000)
    const db = getAdminDb()
    const id = readId('empleado2')
    try {
      await db.from('profiles').update({ avatar_path: null }).eq('id', id)
      await page.goto('/perfil')
      await expect(
        page.getByRole('button', { name: 'Subir foto' }),
      ).toBeVisible()

      await test.step('elegir la imagen, ajustarla y subirla', async () => {
        await page.locator('input[type="file"]').setInputFiles({
          name: 'e2e-foto.png',
          mimeType: 'image/png',
          buffer: pngSolido(64),
        })
        await expect(page.getByText('Ajustar la foto')).toBeVisible()
        await page.getByRole('button', { name: 'Usar esta foto' }).click()
        await expect(
          page.getByRole('button', { name: 'Cambiar foto', exact: true }),
        ).toBeVisible()
      })

      await test.step('en la Base y en Storage: ruta propia y archivo subido', async () => {
        const { data } = await db
          .from('profiles')
          .select('avatar_path')
          .eq('id', id)
          .single()
        expect(data?.avatar_path).toMatch(new RegExp(`^${id}/`))
        const { data: archivos } = await db.storage.from('avatars').list(id)
        expect(archivos?.length).toBeGreaterThan(0)
      })

      await test.step('quitar la foto la borra del perfil y de Storage', async () => {
        await page.getByRole('button', { name: 'Quitar foto' }).click()
        await expect(
          page.getByRole('button', { name: 'Subir foto' }),
        ).toBeVisible()
        const { data } = await db
          .from('profiles')
          .select('avatar_path')
          .eq('id', id)
          .single()
        expect(data?.avatar_path).toBeNull()
        await expect
          .poll(
            async () =>
              (await db.storage.from('avatars').list(id)).data?.length,
          )
          .toBe(0)
      })
    } finally {
      const { data: archivos } = await db.storage.from('avatars').list(id)
      if (archivos?.length) {
        await db.storage
          .from('avatars')
          .remove(archivos.map((a) => `${id}/${a.name}`))
      }
      await db.from('profiles').update({ avatar_path: null }).eq('id', id)
    }
  },
)

test.describe('cerrar sesión', () => {
  // Ingreso propio por COM-01: la sesión que se cierra no es la de `storageState`.
  test.use({ storageState: { cookies: [], origins: [] } })

  test(
    'EMP-13 Cerrar sesión lleva a COM-01 y la ruta del empleado ya no abre; la otra sesión de la cuenta sigue viva (DEF-04)',
    cubre('RB-E01', 'RB-X02', 'P-015', 'P-122'),
    async ({ page }) => {
      // Otra sesión de la misma cuenta (otro dispositivo), abierta por API.
      const otroDispositivo = await signInSession(
        FIXED_ACCOUNTS.empleado2.email,
      )
      await loginByForm(page, FIXED_ACCOUNTS.empleado2.email, /\/app/)
      await page
        .getByRole('navigation', { name: 'Navegación principal' })
        .getByRole('link', { name: 'Más' })
        .click()
      await page.getByRole('button', { name: 'Cerrar sesión' }).click()
      await expect(page).toHaveURL(/\/ingresar/)
      await page.goto('/app')
      await expect(page).toHaveURL(/\/ingresar/)

      const renovada = await anonClient().auth.refreshSession({
        refresh_token: otroDispositivo.refresh_token,
      })
      expect(
        renovada.error,
        'la sesión del otro dispositivo sigue válida (cierre local)',
      ).toBeNull()
    },
  )
})
