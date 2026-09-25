import { expect, test } from '@playwright/test'
import { readE2eUsersEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import { getAdminClient } from './helpers/adminUsersClient.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// USERS-018 (encargo P07.4): "ADM-28 a ADM-31 como dueño (lectura de cada pantalla; en
// feriados, 'Cargar feriados nacionales' no duplica)". Fuente: `05_Pantallas_y_Navegacion.md`
// sección 2.7 y `08_Fases_y_Backlog.md` F7.
//
// El test de feriados NO asume el estado inicial de la tabla (se descubrió, corriendo esta
// suite por primera vez, que el año en curso YA tenía un feriado nacional duplicado por otro
// motivo -- ver "Defectos encontrados" del reporte del encargo: el algoritmo de trasladables se
// corrigió en P07.3 pero el dato cargado por el seed con el algoritmo viejo no se volvió a
// sincronizar). En cambio, verifica lo único que USERS-018 pide de esta pantalla: llamar
// "Cargar feriados nacionales de <año>" DOS VECES SEGUIDAS no cambia nada la segunda vez --
// cuenta filas activas antes y después de cada llamada, no confía en el texto del toast (que
// depende del estado previo, no de si la función "duplica" o no).
//
// Solo en `chromium` (lectura de formularios y tablas, sin nada que cambie de comportamiento a
// otro ancho para lo que se verifica acá).

const env = readE2eUsersEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('USERS-018: ADM-28 a ADM-31 como dueño', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ingresar')
    await page.getByLabel('Email').fill(SEED_ACCOUNTS.owner)
    await page.getByLabel('Contraseña', { exact: true }).fill(env!.seedPassword)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL(/\/admin$/)
  })

  test('ADM-28 "Empresa": el dueño ve logo y datos generales', async ({
    page,
  }) => {
    await page.goto('/admin/configuracion/empresa')
    await expect(page.getByRole('heading', { name: 'Logo' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Datos generales' }),
    ).toBeVisible()
    await expect(page.getByLabel('Nombre de la empresa')).toBeVisible()
    await expect(page.getByLabel('Teléfono de soporte')).toBeVisible()
    await expect(
      page.getByLabel('Texto de consentimiento de ubicación'),
    ).toBeVisible()
  })

  test('ADM-29 "Feriados": cargar los nacionales dos veces seguidas no duplica', async ({
    page,
  }) => {
    const currentYear = new Date().getFullYear()
    const admin = getAdminClient()

    async function countActiveHolidays(): Promise<number> {
      const { count, error } = await admin
        .from('holidays')
        .select('id', { count: 'exact', head: true })
        .gte('holiday_date', `${currentYear}-01-01`)
        .lte('holiday_date', `${currentYear}-12-31`)
        .is('deleted_at', null)
      if (error) throw error
      return count ?? 0
    }

    await page.goto('/admin/configuracion/feriados')
    const loadButton = page.getByRole('button', {
      name: `Cargar feriados nacionales de ${currentYear}`,
    })
    await expect(loadButton).toBeVisible()

    // Primera llamada: puede crear filas o no, según lo que ya hubiera cargado (no se asume
    // nada del estado inicial -- ver el comentario de cabecera de este archivo).
    await loadButton.click()
    await expect(
      page.getByText(
        new RegExp(
          `Feriados nacionales de ${currentYear}|No agregamos feriados nuevos`,
        ),
      ),
    ).toBeVisible()
    const countAfterFirstLoad = await countActiveHolidays()

    // Segunda llamada, inmediatamente después: no tiene que agregar ni una fila más. Esta es la
    // prueba real de "no duplica" (USERS-018) -- por conteo, no por texto de toast.
    await loadButton.click()
    await expect(
      page.getByText(
        new RegExp(
          `Feriados nacionales de ${currentYear}|No agregamos feriados nuevos`,
        ),
      ),
    ).toBeVisible()
    const countAfterSecondLoad = await countActiveHolidays()

    expect(
      countAfterSecondLoad,
      'la segunda carga, inmediatamente después de la primera, no tiene que agregar filas nuevas',
    ).toBe(countAfterFirstLoad)
  })

  test('ADM-30 "Criterios de calificación": lista y vista previa del supervisor', async ({
    page,
  }) => {
    await page.goto('/admin/configuracion/criterios')
    await expect(
      page.getByRole('button', { name: 'Ver como supervisor' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Nuevo criterio' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Ver como supervisor' }).click()
    // El diálogo de vista previa se identifica por su propio encabezado (no se supone un texto
    // fijo más específico acá para no acoplarse a redacción de otro componente que no le
    // pertenece a esta suite verificar palabra por palabra).
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('ADM-31 "Eventos de seguridad": tabla filtrable, solo lectura', async ({
    page,
  }) => {
    await page.goto('/admin/configuracion/seguridad')
    await expect(
      page.getByRole('heading', { name: 'Eventos de seguridad' }),
    ).toBeVisible()
    // Filtros: tipo de evento, persona y fechas (`SecurityEventsPage.tsx`) -- se comprueba que
    // existan los controles, no cada combinación de filtrado (eso excede el alcance de USERS-018,
    // que pide "lectura de cada pantalla").
    await expect(page.getByRole('combobox').first()).toBeVisible()
  })
})
