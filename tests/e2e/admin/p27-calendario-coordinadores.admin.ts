import { expect, test } from '@playwright/test'
import { nombreDe, reNombreDe } from '../../fixtures/accounts.ts'
import { addDays, FRANJAS } from '../../fixtures/dates.ts'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { fichar, FRANJAS_MOVIL } from '../../fixtures/movil.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// P27.8: calendario con filtro por empleado y licencias (OD-12, OD-14), ficha del empleado con la
// pestaña «Cronograma» (OD-01, OD-02), «Llegada tarde» (OD-17) y la jornada del coordinador desde
// la administración (OD-04 a OD-06), a 1280 px y con el administrador con todas las capacidades.
// Empleados de este archivo: empleado2 y empleado3. Coordinador: supervisor2 (los demás archivos
// de coordinadores usan supervisor1).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

const MOTIVO = 'e2e-franco'

test.describe('calendario (OD-12, OD-14)', () => {
  test(
    'el filtro por empleado se conserva entre semana y día y muestra sus turnos y su licencia con el motivo',
    cubre('RB-A06', 'OD-12', 'OD-14'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('cal-filtro')
        const sedeUno = await sc.site(cliente.id, 'cal-uno')
        const sedeDos = await sc.site(cliente.id, 'cal-dos')
        const turnoUno = await sc.shift(
          cliente.id,
          sedeUno.id,
          sc.today,
          FRANJAS.manana,
        )
        const turnoDos = await sc.shift(
          cliente.id,
          sedeDos.id,
          sc.today,
          FRANJAS.tarde,
        )
        await sc.assign(turnoUno, 'empleado2')
        await sc.assign(turnoDos, 'empleado3')
        // La licencia va DESPUÉS de asignar (con licencia vigente la asignación se rechaza).
        const { data: licencia, error } = await sc.db
          .from('employee_leaves')
          .insert({
            employee_id: readId('empleado2'),
            starts_on: sc.today,
            ends_on: sc.today,
            reason: MOTIVO,
          })
          .select('id')
          .single()
        expect(error, error?.message).toBeNull()
        sc.leaveIds.push(licencia!.id)

        await test.step('semana: se elige al empleado en el filtro y quedan sus turnos y su licencia con el motivo', async () => {
          await page.goto(`/admin/planificacion?vista=semana&fecha=${sc.today}`)
          await page
            .getByRole('combobox', { name: 'Filtrar por empleado' })
            .click()
          await page
            .getByRole('option', { name: reNombreDe('empleado2') })
            .click()
          await expect(page).toHaveURL(
            new RegExp(`empleado=${readId('empleado2')}`),
          )
          await expect(page.getByText(sedeUno.name).first()).toBeVisible()
          await expect(
            page.getByText(sedeDos.name),
            'el turno de otro empleado no se ve',
          ).toHaveCount(0)
          // La licencia muestra el motivo cargado (OD-02/OD-14), no solo «Licencia».
          await expect(page.getByTestId('leave-cell').first()).toContainText(
            MOTIVO,
          )
        })

        await test.step('día: el filtro viaja en la URL y la vista de día lo respeta, con la licencia', async () => {
          await page.getByRole('radio', { name: 'Día' }).click()
          await expect(page).toHaveURL(/vista=dia/)
          await expect(page).toHaveURL(
            new RegExp(`empleado=${readId('empleado2')}`),
          )
          await expect(page.getByText(sedeUno.name).first()).toBeVisible()
          await expect(page.getByText(sedeDos.name)).toHaveCount(0)
          await expect(page.getByTestId('day-leaves')).toContainText(
            nombreDe('empleado2'),
          )
        })

        await test.step('el otro empleado: sus turnos, sin la licencia de empleado2', async () => {
          await page.goto(
            `/admin/planificacion?vista=dia&fecha=${sc.today}&empleado=${readId('empleado3')}`,
          )
          await expect(page.getByText(sedeDos.name).first()).toBeVisible()
          await expect(page.getByText(sedeUno.name)).toHaveCount(0)
          await expect(page.getByTestId('day-leaves')).toHaveCount(0)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('ficha del empleado: Cronograma (OD-01, OD-02)', () => {
  test(
    'la pestaña «Cronograma» va después de «Datos» y muestra el turno con su sede y la licencia con el motivo',
    cubre('RB-A05', 'OD-01', 'OD-02', 'OD-03'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('cronograma')
        const sede = await sc.site(cliente.id, 'cronograma')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS.manana,
        )
        await sc.assign(turno, 'empleado2')
        // Otro día del MISMO mes para la licencia.
        const manana = addDays(sc.today, 1)
        const otroDia =
          manana.slice(0, 7) === sc.today.slice(0, 7)
            ? manana
            : addDays(sc.today, -1)
        const { data: licencia, error } = await sc.db
          .from('employee_leaves')
          .insert({
            employee_id: readId('empleado2'),
            starts_on: otroDia,
            ends_on: otroDia,
            reason: MOTIVO,
          })
          .select('id')
          .single()
        expect(error, error?.message).toBeNull()
        sc.leaveIds.push(licencia!.id)

        await page.goto(`/admin/empleados/${readId('empleado2')}`)
        const pestanas = page.getByRole('tab')
        await expect(pestanas.first()).toHaveText('Datos')
        await expect(pestanas.nth(1)).toHaveText('Cronograma')
        await pestanas.nth(1).click()
        await expect(page).toHaveURL(/pestana=cronograma/)

        const hoja = page.getByTestId('cronograma')
        await expect(hoja).toContainText('FIRMA DE EMPLEADO')
        await expect(hoja).toContainText('ACLARACIÓN')
        await expect(hoja).toContainText('DNI')
        await expect(hoja).toContainText(nombreDe('empleado2').toUpperCase())
        await expect(
          page.getByRole('button', { name: 'Imprimir' }),
        ).toBeVisible()

        // El turno de hoy: horario y, debajo, la sede.
        const hoy = hoja.getByTestId(`dia-${sc.today}`)
        await expect(hoy.getByTestId('sede')).toHaveText(
          sede.name.toUpperCase(),
        )
        await expect(hoy.getByTestId('turno')).toContainText(
          FRANJAS.manana.start,
        )
        // La licencia ocupa la celda entera con el motivo (OD-02).
        const celdaLicencia = hoja.getByTestId(`dia-${otroDia}`)
        await expect(celdaLicencia).toHaveAttribute('data-kind', 'leave')
        await expect(celdaLicencia).toContainText(MOTIVO.toUpperCase())
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('llegada tarde (OD-17)', () => {
  test(
    'un fichaje posterior al inicio programado muestra «Llegada tarde» en Asistencia de hoy',
    cubre('RB-A06', 'OD-17', 'AJ-03'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('tarde')
        const sede = await sc.site(cliente.id, 'tarde')
        // 00:00–23:59: el inicio programado ya pasó a cualquier hora del día.
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        const asignacion = await sc.assign(turno, 'empleado3')
        await fichar('empleado3', asignacion, 'inicio')

        await page.goto('/admin/asistencia')
        const fila = page.getByRole('row').filter({ hasText: sede.name })
        await expect(fila).toBeVisible()
        const celda = fila.getByTestId('late-arrival-cell')
        await expect(celda).toBeVisible()
        await expect(celda).toContainText('Llegada tarde')
        await expect(celda).toContainText(/\d{2}:\d{2}/)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('jornada del coordinador desde la administración (OD-04 a OD-06)', () => {
  test(
    'la tarjeta del Resumen finaliza la jornada con motivo y la pestaña Jornadas de Supervisiones la lista',
    cubre('RB-A07', 'OD-04', 'OD-05', 'OD-06', 'CJ-32'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        await sc.asegurarJornada('supervisor2')
        const nombre = nombreDe('supervisor2')

        await test.step('OD-04: la tarjeta del Resumen muestra el estado y ofrece «Finalizar jornada»', async () => {
          await page.goto('/admin')
          const tarjeta = page.getByRole('article', {
            name: `Coordinador ${nombre}`,
          })
          await expect(tarjeta).toBeVisible()
          await expect(
            tarjeta.getByRole('button', { name: 'Ver actividad' }),
          ).toBeVisible()
          await tarjeta
            .getByRole('button', { name: `Finalizar la jornada de ${nombre}` })
            .click()
        })

        await test.step('OD-06: el motivo es obligatorio; con motivo se finaliza y queda corregida', async () => {
          const dialogo = page.getByRole('dialog')
          await expect(
            dialogo.getByRole('heading', {
              name: `Finalizar la jornada de ${nombre}`,
            }),
          ).toBeVisible()
          const confirmar = dialogo.getByRole('button', {
            name: 'Finalizar jornada',
            exact: true,
          })
          await confirmar.click()
          await expect(dialogo, 'sin motivo no cierra').toBeVisible()
          const { data: sinCambio } = await sc.db
            .from('supervisor_workdays')
            .select('ended_at')
            .eq('supervisor_id', readId('supervisor2'))
            .eq('work_date', sc.today)
            .single()
          expect(sinCambio?.ended_at, 'sin motivo no se finalizó').toBeNull()

          await dialogo
            .getByLabel('Motivo')
            .fill('e2e-p27: se le trabó la app y no la cerró')
          await confirmar.click()
          await expect(
            page.getByText(`Finalizamos la jornada de ${nombre}.`),
          ).toBeVisible()
          const { data } = await sc.db
            .from('supervisor_workdays')
            .select('ended_at, corrected')
            .eq('supervisor_id', readId('supervisor2'))
            .eq('work_date', sc.today)
            .single()
          expect(data?.ended_at).not.toBeNull()
          expect(data?.corrected).toBe(true)
        })

        await test.step('OD-05: Supervisiones tiene la pestaña «Jornadas» después de «Calificaciones» y lista la jornada', async () => {
          await page.goto('/admin/supervisiones')
          const pestanas = page.getByRole('tab')
          await expect(pestanas).toHaveText([
            'Supervisiones',
            'Calificaciones',
            'Jornadas',
          ])
          await pestanas.nth(2).click()
          await expect(page).toHaveURL(/pestana=jornadas/)
          await expect(
            page.getByRole('combobox', { name: 'Filtrar por coordinador' }),
          ).toBeVisible()
          await expect(
            page.getByRole('combobox', { name: 'Filtrar por estado' }),
          ).toBeVisible()
          await expect(page.getByText(nombre).first()).toBeVisible()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
