import { expect, test } from '@playwright/test'
import { getAdminDb, nombreDe } from '../../fixtures/accounts.ts'
import { todayAR } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { pickDate } from '../../fixtures/ui.ts'

// TEST-016 (P18.1): configuración del dueño, ADM-28 a ADM-31 (RB-A01, P-104, P-117, P-050, P-087).
// Se recorren los CAMBIOS: dato de la empresa que se ve en el ingreso, alta y baja de un feriado,
// alta y cierre de un criterio, los filtros de eventos de seguridad y, desde P18.4, lo que traía
// `e2e-users/owner-config-screens.spec.ts` (borrado: la estructura de ADM-28, los feriados
// nacionales cargados dos veces sin duplicar y la vista previa del supervisor).
// Todo lo que cambia se repone al terminar. Va en el proyecto `dueno-config` (al final): edita la
// configuración de la empresa, que la matriz de permisos también toca y repone.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('owner') })

test.describe('configuración del dueño (ADM-28 a ADM-31)', () => {
  test(
    'ADM-28: el teléfono de soporte que carga el dueño se ve en la pantalla de ingreso',
    cubre('RB-A01', 'P-117'),
    async ({ page, browser }) => {
      const db = getAdminDb()
      const { data: antes } = await db
        .from('company_settings')
        .select('support_phone')
        .eq('id', 1)
        .single()
      const telefonoNuevo = '1155550199'
      try {
        await page.goto('/admin/configuracion/empresa')
        const campo = page.getByRole('textbox', { name: 'Teléfono de soporte' })
        await expect(campo).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Guardar cambios' }),
        ).toBeDisabled()
        await campo.fill(telefonoNuevo)
        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        await expect(
          page.getByText('Guardamos los datos de la empresa.'),
        ).toBeVisible()

        // Sin sesión: la pantalla de ingreso lee `v_public_branding`.
        // `test.use` aplica la sesión del dueño a todo contexto nuevo: hay que vaciarla a propósito.
        const anonimo = await browser.newContext({
          storageState: { cookies: [], origins: [] },
        })
        const ingreso = await anonimo.newPage()
        try {
          await ingreso.goto('/ingresar')
          await expect(
            ingreso.getByText(new RegExp(telefonoNuevo)),
          ).toBeVisible()
        } finally {
          await anonimo.close()
        }
      } finally {
        await db
          .from('company_settings')
          .update({ support_phone: antes?.support_phone ?? null })
          .eq('id', 1)
      }
    },
  )

  test(
    'ADM-29: el dueño agrega un feriado y lo da de baja',
    cubre('RB-A01', 'P-050'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      const db = getAdminDb()
      // Una fecha libre de fin de año, del año en curso (la pantalla abre en el año actual).
      const hoy = todayAR()
      const anio = hoy.slice(0, 4)
      let fecha = ''
      for (let dia = 20; dia <= 31 && !fecha; dia++) {
        const candidata = `${anio}-12-${dia}`
        const { data } = await db
          .from('holidays')
          .select('id')
          .eq('holiday_date', candidata)
          .maybeSingle()
        if (!data) fecha = candidata
      }
      expect(
        fecha,
        'tiene que haber una fecha libre entre el 20 y el 31 de diciembre',
      ).not.toBe('')
      sc.extraHolidayDates.push(fecha) // la limpieza lo borra aunque el test se corte
      const nombre = 'e2e-feriado-de-prueba-config'
      try {
        await page.goto('/admin/configuracion/feriados')
        await page.getByRole('button', { name: 'Nuevo feriado' }).click()
        const dialogo = page.getByRole('dialog', { name: 'Nuevo feriado' })
        await pickDate(page, 'Fecha del feriado', {
          year: Number(anio),
          month: 12,
          day: Number(fecha.slice(8)),
        })
        await dialogo.getByLabel('Nombre').fill(nombre)
        await dialogo.getByRole('button', { name: 'Agregar feriado' }).click()
        await expect(page.getByText('Agregamos el feriado.')).toBeVisible()
        await expect(
          page.getByRole('row').filter({ hasText: nombre }),
        ).toBeVisible()

        await page
          .getByRole('button', { name: `Dar de baja el feriado ${nombre}` })
          .click()
        await page
          .getByRole('dialog', { name: 'Dar de baja este feriado' })
          .getByRole('button', { name: 'Dar de baja' })
          .click()
        await expect(page.getByText('Dimos de baja el feriado.')).toBeVisible()
        await expect(
          page.getByRole('row').filter({ hasText: nombre }),
        ).toHaveCount(0)
        const { data: fila } = await db
          .from('holidays')
          .select('deleted_at')
          .eq('holiday_date', fecha)
          .single()
        expect(fila?.deleted_at, 'baja lógica, no borrado').not.toBeNull()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'ADM-30: el dueño agrega un criterio de calificación y lo cierra',
    cubre('RB-A01', 'RB-X04', 'P-087'),
    async ({ page }) => {
      const db = getAdminDb()
      const titulo = `e2e-criterio-${Date.now().toString(36)}`
      try {
        await page.goto('/admin/configuracion/criterios')
        await page.getByRole('button', { name: 'Nuevo criterio' }).click()
        await page.getByLabel('Título').fill(titulo)
        await page
          .getByLabel('Descripción')
          .fill('e2e: criterio de prueba, se cierra al terminar')
        await page
          .getByRole('button', { name: /^(Agregar|Guardar)/ })
          .last()
          .click()
        await expect(page.getByText('Agregamos el criterio.')).toBeVisible()
        const fila = page.getByRole('row').filter({ hasText: titulo })
        await expect(fila).toContainText('Vigente')

        await page.getByRole('button', { name: `Cerrar "${titulo}"` }).click()
        await page.getByRole('button', { name: 'Cerrar criterio' }).click()
        await expect(page.getByText('Cerramos el criterio.')).toBeVisible()
        const { data } = await db
          .from('rating_criteria')
          .select('valid_to')
          .eq('title', titulo)
          .single()
        expect(
          data?.valid_to,
          'cerrar pone la fecha de fin de vigencia',
        ).not.toBeNull()
      } finally {
        await db.from('rating_criteria').delete().eq('title', titulo)
      }
    },
  )

  test(
    'ADM-31: los eventos de seguridad se filtran por persona y por tipo',
    cubre('RB-A01', 'P-104'),
    async ({ page }) => {
      await page.goto('/admin/configuracion/seguridad')
      await expect(
        page.getByRole('table', { name: 'Eventos de seguridad' }),
      ).toBeVisible()

      await page.getByRole('combobox', { name: 'Filtrar por usuario' }).click()
      await page
        .getByRole('option', { name: nombreDe('admin'), exact: true })
        .click()
      const filas = page
        .getByRole('table', { name: 'Eventos de seguridad' })
        .getByRole('row')
      await expect(filas.nth(1)).toContainText(nombreDe('admin'))
      for (const fila of (await filas.all()).slice(1)) {
        await expect(fila).toContainText(nombreDe('admin'))
      }

      await page
        .getByRole('combobox', { name: 'Filtrar por tipo de evento' })
        .click()
      await page
        .getByRole('option', { name: 'Inicio de sesión', exact: true })
        .click()
      await expect(filas.nth(1)).toContainText('Inicio de sesión')
      for (const fila of (await filas.all()).slice(1)) {
        await expect(fila).toContainText('Inicio de sesión')
      }
    },
  )

  test(
    'ADM-28: la pantalla ofrece logo, datos generales, teléfono de soporte y texto de consentimiento',
    cubre('RB-A01', 'P-117'),
    async ({ page }) => {
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
    },
  )

  test(
    'ADM-29: cargar los feriados nacionales dos veces seguidas no duplica',
    cubre('RB-A01', 'P-050'),
    async ({ page }) => {
      const anio = Number(todayAR().slice(0, 4))
      const db = getAdminDb()
      const contar = async (): Promise<number> => {
        const { count, error } = await db
          .from('holidays')
          .select('id', { count: 'exact', head: true })
          .gte('holiday_date', `${anio}-01-01`)
          .lte('holiday_date', `${anio}-12-31`)
          .is('deleted_at', null)
        if (error) throw new Error(error.message)
        return count ?? 0
      }
      const aviso = new RegExp(
        `Feriados nacionales de ${anio}|No agregamos feriados nuevos`,
      )

      await page.goto('/admin/configuracion/feriados')
      const cargar = page.getByRole('button', {
        name: `Cargar feriados nacionales de ${anio}`,
      })
      await expect(cargar).toBeVisible()
      // La primera carga puede crear filas o no, según lo que hubiera: no se asume el estado.
      await cargar.click()
      await expect(page.getByText(aviso)).toBeVisible()
      const tras1 = await contar()
      // La segunda, enseguida, no tiene que agregar ni una fila (por conteo, no por texto).
      await cargar.click()
      await expect(page.getByText(aviso).last()).toBeVisible()
      expect(
        await contar(),
        'la segunda carga no tiene que agregar filas nuevas',
      ).toBe(tras1)
    },
  )

  test(
    'ADM-30: la lista de criterios ofrece la vista previa "Ver como supervisor"',
    cubre('RB-A01', 'RB-X04', 'P-087'),
    async ({ page }) => {
      await page.goto('/admin/configuracion/criterios')
      await expect(
        page.getByRole('button', { name: 'Nuevo criterio' }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Ver como supervisor' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  )
})
