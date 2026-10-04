import { expect, test } from '@playwright/test'
import {
  FIXED_ACCOUNTS,
  getAdminDb,
  OWNER_EMAIL,
  nombreDe,
  reNombreDe,
} from '../../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { anonClient, readId, signInSession } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import {
  chooseMenuItem,
  expectNoHorizontalScroll,
  loginByForm,
} from '../../fixtures/ui.ts'

// TEST-016 (P18.1): RECORRIDO DE PUNTA A PUNTA DEL DUEÑO, empezando por el ingreso real por la
// pantalla (sin sesión previa): tablero -> usuarios y capacidades (ADM-27) -> empleados y
// buscador global (ADM-16/17) -> configuración (ADM-28 a ADM-31, con su propio ingreso como
// evento de seguridad) -> cierre de sesión y rutas protegidas.
// El recorrido operativo (clientes, servicios, generación, asignación, asistencia, supervisión)
// lo hace el administrador en `recorrido-administrador.admin.ts`: el dueño puede todo lo mismo.
// La capacidad que se apaga y se prende es de `adminCapacidades`, que se repone al terminar.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

// Sin sesión previa: el test ingresa por la pantalla COM-01.
test.use({ storageState: { cookies: [], origins: [] } })

test(
  'el dueño ingresa, gestiona capacidades, busca personas, revisa la configuración y cierra la sesión',
  cubre('RB-A01', 'RB-A02', 'RB-A07', 'RB-X02', 'P-017', 'P-022', 'P-104'),
  async ({ page }) => {
    test.setTimeout(240_000)
    const db = getAdminDb()
    const desde = new Date().toISOString()
    const objetivo = FIXED_ACCOUNTS.adminCapacidades
    const nombreObjetivo = `${objetivo.firstName} ${objetivo.lastName}`

    try {
      await test.step('COM-01: ingresa con su email y cae en el tablero', async () => {
        await loginByForm(page, OWNER_EMAIL, /\/admin$/)
        await expect(
          page.getByRole('heading', { name: 'Resumen', level: 1 }),
        ).toBeVisible()
        await expect(
          page.getByRole('region', { name: 'Indicadores de hoy' }),
        ).toBeVisible()
        await expect(
          page.getByRole('region', { name: 'Requiere atención' }),
        ).toBeVisible()
        await expect(
          page.getByRole('region', { name: 'Servicios de hoy' }),
        ).toBeVisible()
      })

      await test.step('ADM-27: ve a todos los usuarios y apaga y prende una capacidad de un administrador', async () => {
        await page.goto('/admin/configuracion/usuarios')
        await expect(
          page.getByRole('heading', { name: 'Usuarios y roles' }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Nuevo administrador' }),
        ).toBeVisible()
        await chooseMenuItem(
          page,
          `Acciones para ${nombreObjetivo}`,
          'Editar roles y capacidades',
        )
        await expect(page.getByRole('switch').first()).toBeVisible()
        await expect(page.getByRole('switch')).toHaveCount(7)

        const asistencia = page.getByRole('switch', {
          name: /Registrar asistencia por otros/i,
        })
        await expect(asistencia).toBeChecked()
        await asistencia.click()
        await expect(asistencia).not.toBeChecked()
        await expect
          .poll(async () => {
            const { data } = await db
              .from('admin_capabilities')
              .select('enabled')
              .eq('profile_id', readId('adminCapacidades'))
              .eq('capability', 'manage_attendance')
              .single()
            return data?.enabled
          })
          .toBe(false)
        await asistencia.click()
        await expect(asistencia).toBeChecked()
        await expect
          .poll(async () => {
            const { data } = await db
              .from('admin_capabilities')
              .select('enabled')
              .eq('profile_id', readId('adminCapacidades'))
              .eq('capability', 'manage_attendance')
              .single()
            return data?.enabled
          })
          .toBe(true)
        await page.getByRole('button', { name: 'Cerrar' }).first().click()
      })

      await test.step('ADM-16/17: el buscador global lleva a la ficha de un empleado', async () => {
        await page.goto('/admin')
        await page.getByRole('button', { name: /^Buscar/ }).click()
        await page
          .getByPlaceholder('Buscar empleados, clientes o sedes…')
          .fill(nombreDe('empleado1'))
        await page
          .getByRole('option', { name: reNombreDe('empleado1') })
          .click()
        await expect(page).toHaveURL(/\/admin\/empleados\/[0-9a-f-]+$/)
        await expect(
          page.getByRole('heading', { name: nombreDe('empleado1'), level: 2 }),
        ).toBeVisible()
        for (const pestana of [
          'Datos',
          'Habilitaciones',
          'Disponibilidad',
          'Licencias',
          'Próximos turnos',
          'Asistencia',
          'Calificaciones',
        ]) {
          await expect(page.getByRole('tab', { name: pestana })).toBeVisible()
        }
        await expect(
          page.getByRole('button', { name: 'Dar de baja' }),
        ).toBeVisible()
      })

      await test.step('ADM-28 a ADM-31: las cuatro pantallas de configuración del dueño cargan', async () => {
        await page.goto('/admin/configuracion/empresa')
        await expect(
          page.getByRole('heading', { name: 'Datos generales' }),
        ).toBeVisible()
        await page.goto('/admin/configuracion/feriados')
        await expect(
          page.getByRole('button', { name: 'Nuevo feriado' }),
        ).toBeVisible()
        await page.goto('/admin/configuracion/criterios')
        await expect(
          page.getByRole('button', { name: 'Nuevo criterio' }),
        ).toBeVisible()
        await page.goto('/admin/configuracion/seguridad')
        await expect(
          page.getByRole('table', { name: 'Eventos de seguridad' }),
        ).toBeVisible()
      })

      await test.step('ADM-31: el ingreso de este recorrido y el cambio de capacidades quedaron registrados', async () => {
        const { data } = await db
          .from('security_events')
          .select('event_type, actor_id, target_id')
          .gte('created_at', desde)
          .in('event_type', ['sign_in', 'capabilities_changed'])
        const ingreso = data?.some(
          (e) => e.event_type === 'sign_in' && e.actor_id === readId('owner'),
        )
        expect(ingreso, 'el ingreso del dueño queda como sign_in').toBe(true)
        const cambios = data?.filter(
          (e) =>
            e.event_type === 'capabilities_changed' &&
            e.target_id === readId('adminCapacidades'),
        )
        expect(
          cambios?.length,
          'apagar y prender la capacidad deja dos eventos',
        ).toBeGreaterThanOrEqual(2)

        await page.goto('/admin/configuracion/seguridad')
        await page
          .getByRole('combobox', { name: 'Filtrar por tipo de evento' })
          .click()
        await page
          .getByRole('option', { name: 'Capacidades modificadas' })
          .click()
        await expect(
          page
            .getByRole('table', { name: 'Eventos de seguridad' })
            .getByRole('row')
            .nth(1),
        ).toContainText(nombreObjetivo)
      })

      await test.step('cierra la sesión y las rutas de administración ya no abren', async () => {
        await page.goto('/admin')
        await expectNoHorizontalScroll(page)
        await page.getByRole('button', { name: /Menú de usuario/ }).click()
        await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
        await expect(page).toHaveURL(/\/ingresar/)
        await page.goto('/admin/configuracion/usuarios')
        await expect(page).toHaveURL(/\/ingresar/)
      })
    } finally {
      // Repone la cuenta fija: las siete capacidades habilitadas.
      await db
        .from('admin_capabilities')
        .update({ enabled: true })
        .eq('profile_id', readId('adminCapacidades'))
    }
  },
)

// DEF-04 (defecto de la app, severidad menor): `AuthProvider.signOut` llama a
// `supabase.auth.signOut()` sin `scope`, y el alcance por omisión de supabase-js es 'global': el
// "Cerrar sesión" de un dispositivo cierra TODAS las sesiones de la cuenta. `06_API.md` sección 1
// dice "Cerrar sesión | auth.signOut() | propio" y el comentario del propio código habla de
// "cierre local". Cuando se corrija (`signOut({ scope: 'local' })`) este test pasa y hay que
// sacarle el `test.fail`.
test(
  'cerrar la sesión en un dispositivo no cierra la sesión de la misma cuenta en otro dispositivo',
  cubre('RB-X02', 'P-015'),
  async ({ page }) => {
    test.fail(
      true,
      'DEF-04: el cierre de sesión de la app es global (supabase.auth.signOut() sin scope local)',
    )
    // Segundo dispositivo: una sesión independiente de la misma cuenta, abierta por API.
    const otroDispositivo = await signInSession(OWNER_EMAIL)

    await loginByForm(page, OWNER_EMAIL, /\/admin$/)
    await page.getByRole('button', { name: /Menú de usuario/ }).click()
    await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
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
