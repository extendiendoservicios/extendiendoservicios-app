import { expect, test, type Page } from '@playwright/test'
import { getAdminDb } from '../../fixtures/accounts.ts'
import { addDays } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { signedClient, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-020 (P18.4): plantillas de tareas desde la administración (ADM-26).
//   - RB-A05 por interfaz: un administrador con `edit_checklists` crea la plantilla del cliente
//     y la de una sede, agrega, reordena, edita y da de baja ítems (P-058, P-059, P-064). Hasta
//     ahora la capacidad solo estaba probada por API (matriz de permisos) y con las acciones
//     ocultas para el administrador sin capacidades (`permisos-capacidades`).
//   - CB-11: la plantilla de una sede dada de baja lógica. Los turnos ya creados conservan sus
//     tareas (P-061) y los turnos nuevos usan la plantilla del cliente.
// Cuentas de este archivo: `admin` (con todas las capacidades). No usa empleados.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

async function agregarItem(
  page: Page,
  titulo: string,
  opcional: boolean,
): Promise<void> {
  await page.getByRole('button', { name: 'Agregar ítem' }).click()
  await page.getByLabel('Título').fill(titulo)
  if (opcional) await page.getByLabel('Tarea opcional').check()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Agregamos el ítem.').last()).toBeVisible()
}

/** Títulos de los ítems visibles, en orden (solo las filas con el botón "Editar"). */
async function titulosVisibles(page: Page): Promise<string[]> {
  const filas = page
    .locator('li')
    .filter({ has: page.getByRole('button', { name: /^Editar "/ }) })
  const textos = await filas.locator('p').allInnerTexts()
  return textos
    .map((t) => t.replace(/\s*Opcional\s*$/, '').trim())
    .filter(Boolean)
}

async function tareasDelTurno(shiftId: string): Promise<string[]> {
  const { data, error } = await getAdminDb()
    .from('shift_tasks')
    .select('title, position')
    .eq('shift_id', shiftId)
    .order('position')
  if (error) throw new Error(error.message)
  return (data ?? []).map((t) => t.title)
}

test.describe('plantillas de tareas (ADM-26)', () => {
  test(
    'un administrador con edit_checklists crea la plantilla del cliente y la de la sede, y ordena, edita y da de baja ítems',
    cubre('RB-A05', 'RB-A04', 'P-058', 'P-059', 'P-064'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const client = await sc.client('plan')
        const site = await sc.site(client.id, 'plan')

        await test.step('la plantilla del cliente: crear, agregar ítems (uno opcional) y reordenar', async () => {
          await page.goto(`/admin/tareas?cliente=${client.id}`)
          await page
            .getByRole('button', { name: 'Crear plantilla del cliente' })
            .click()
          await expect(
            page.getByText('Creamos la plantilla del cliente.').last(),
          ).toBeVisible()
          await agregarItem(page, 'Barrer', false)
          await agregarItem(page, 'Sacar la basura', true)
          await agregarItem(page, 'Trapear', false)
          await expect
            .poll(() => titulosVisibles(page))
            .toEqual(['Barrer', 'Sacar la basura', 'Trapear'])
          await page.getByRole('button', { name: 'Subir "Trapear"' }).click()
          await expect
            .poll(() => titulosVisibles(page))
            .toEqual(['Barrer', 'Trapear', 'Sacar la basura'])
        })

        await test.step('la plantilla propia de la sede es una copia editable (P-058)', async () => {
          await page.goto(`/admin/tareas?cliente=${client.id}&sede=${site.id}`)
          await expect(
            page.getByText('Esta sede usa la plantilla del cliente'),
          ).toBeVisible()
          await page
            .getByRole('button', {
              name: 'Crear plantilla propia para esta sede',
            })
            .click()
          await expect(
            page.getByText('Plantilla propia de la sede', { exact: true }),
          ).toBeVisible()
          await expect
            .poll(() => titulosVisibles(page))
            .toEqual(['Barrer', 'Trapear', 'Sacar la basura'])
          await agregarItem(page, 'Vaciar canastos', false)
        })

        await test.step('editar un ítem y darlo de baja con confirmación', async () => {
          await page.getByRole('button', { name: 'Editar "Barrer"' }).click()
          await page.getByLabel('Título').fill('Barrer todo')
          await page.getByRole('button', { name: 'Guardar' }).click()
          await expect
            .poll(() => titulosVisibles(page))
            .toContain('Barrer todo')

          await page
            .getByRole('button', { name: 'Dar de baja "Sacar la basura"' })
            .click()
          await page
            .getByRole('button', { name: 'Dar de baja', exact: true })
            .click()
          await expect
            .poll(() => titulosVisibles(page))
            .toEqual(['Barrer todo', 'Trapear', 'Vaciar canastos'])
        })

        await test.step('la plantilla del cliente no cambió con lo que se hizo en la de la sede', async () => {
          await page.goto(`/admin/tareas?cliente=${client.id}`)
          await expect
            .poll(() => titulosVisibles(page))
            .toEqual(['Barrer', 'Trapear', 'Sacar la basura'])
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'CB-11: con la plantilla de la sede dada de baja, los turnos ya creados conservan sus tareas y los nuevos usan la del cliente',
    cubre('RB-A05', 'CB-11', 'P-061', 'P-064'),
    async ({ page }) => {
      const sc = new Scenario()
      const db = getAdminDb()
      try {
        const client = await sc.client('cb11')
        const site = await sc.site(client.id, 'cb11')
        const fecha = addDays(sc.today, 3)

        // Las dos plantillas, con ítems distintos, por la base (la creación por pantalla ya la
        // prueba el test anterior).
        const plantilla = async (siteId: string | null, items: string[]) => {
          const { data, error } = await db
            .from('checklist_templates')
            .insert({
              client_id: client.id,
              site_id: siteId,
              name: siteId ? 'e2e-plantilla-sede' : 'e2e-plantilla-cliente',
            })
            .select('id')
            .single()
          if (error) throw new Error(error.message)
          const { error: e2 } = await db
            .from('checklist_template_items')
            .insert(
              items.map((title, position) => ({
                template_id: data.id,
                position,
                title,
              })),
            )
          if (e2) throw new Error(e2.message)
          return data.id
        }
        await plantilla(null, ['Cliente: ítem A', 'Cliente: ítem B'])
        const plantillaSede = await plantilla(site.id, [
          'Sede: ítem 1',
          'Sede: ítem 2',
          'Sede: ítem 3',
        ])

        // El administrador crea los turnos con la RPC real (copia el checklist vigente).
        const admin = await signedClient('admin')
        const crear = async () => {
          const { data, error } = await admin.rpc('create_shift', {
            p_client_id: client.id,
            p_site_id: site.id,
            p_date: fecha,
            p_start: '08:00',
            p_end: '09:00',
            p_required_staff: 1,
          })
          expect(error, error?.message).toBeNull()
          const id = (data as unknown as { shift: { id: string } }).shift.id
          sc.extraShiftIds.push(id)
          return id
        }

        const turnoAntes = await crear()
        expect(await tareasDelTurno(turnoAntes)).toEqual([
          'Sede: ítem 1',
          'Sede: ítem 2',
          'Sede: ítem 3',
        ])

        await test.step('el administrador da de baja la plantilla de la sede (baja lógica, con su propia sesión)', async () => {
          const { error } = await admin
            .from('checklist_templates')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', plantillaSede)
          expect(error, error?.message).toBeNull()
        })

        await test.step('ADM-26: la sede vuelve a "usar la plantilla del cliente"', async () => {
          await page.goto(`/admin/tareas?cliente=${client.id}&sede=${site.id}`)
          await expect(
            page.getByText('Esta sede usa la plantilla del cliente'),
          ).toBeVisible()
          await expect(
            page.getByText('Plantilla propia de la sede', { exact: true }),
          ).toHaveCount(0)
        })

        await test.step('el turno ya creado conserva sus tareas (P-061)', async () => {
          expect(await tareasDelTurno(turnoAntes)).toEqual([
            'Sede: ítem 1',
            'Sede: ítem 2',
            'Sede: ítem 3',
          ])
          await page.goto(`/admin/turnos/${turnoAntes}`)
          const detalle = page.getByRole('dialog', {
            name: 'Detalle del turno',
          })
          await expect(detalle.getByText('Sede: ítem 1')).toBeVisible()
        })

        await test.step('un turno nuevo para la misma sede toma la plantilla del cliente', async () => {
          const turnoNuevo = await crear()
          expect(await tareasDelTurno(turnoNuevo)).toEqual([
            'Cliente: ítem A',
            'Cliente: ítem B',
          ])
          // Y el anterior sigue igual: nada se reescribió.
          expect(await tareasDelTurno(turnoAntes)).toHaveLength(3)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
