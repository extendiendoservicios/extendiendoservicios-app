import { expect, test } from '@playwright/test'
import { expectHint } from '../../fixtures/api.ts'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  fichar,
  FRANJAS_MOVIL,
  fijarConsentimiento,
  marcarCambiosVistos,
  tareasDelTurno,
  TEXTO,
} from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-017 (P18.2): el servicio en curso (EMP-07), las tareas (EMP-08), la observación (EMP-09),
// finalizar y el resumen (EMP-10, EMP-11), el inicio después del fin del turno (CB-04) y la
// falta de conexión (CB-22). Cuenta de este archivo: empleado3. El consentimiento se deja dado
// (el flujo del consentimiento se prueba en `fichar.empleado.ts`) y se ficha por la pantalla
// solo cuando el fichaje es parte de lo que se prueba; para llegar a "en curso" se usa la RPC.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('empleado3') })
// Sin permiso de ubicación: acá no se prueba la posición (el consentimiento queda dado y el
// navegador la niega, el registro sigue sin coordenadas).
test.use({ permissions: [] })

test(
  'las tareas se marcan entre el inicio y el fin; "no realizada" exige motivo (CB-12) y fuera de la ventana el servidor las bloquea',
  cubre('RB-E05', 'CB-12', 'P-060', 'P-063'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('en-curso-tareas')
      const sede = await sc.site(cliente.id, 'en-curso-tareas')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      await tareasDelTurno(turno, [
        { title: 'e2e-tareas: obligatoria', required: true },
        { title: 'e2e-tareas: opcional', required: false },
        { title: 'e2e-tareas: tercera', required: true },
      ])
      const asignacion = await sc.assign(turno, 'empleado3')
      await fijarConsentimiento('empleado3', true)
      await marcarCambiosVistos('empleado3')
      await fichar('empleado3', asignacion, 'inicio')
      const { data: tareas } = await sc.db
        .from('shift_tasks')
        .select('id, title')
        .eq('shift_id', turno)
      const idDe = (titulo: string) =>
        tareas!.find((t) => t.title === titulo)!.id

      await test.step('EMP-07: el progreso arranca en 0 de 3', async () => {
        await page.goto(`/app/en-curso/${asignacion}`)
        await expect(page.getByText('0 de 3')).toBeVisible()
      })

      await test.step('EMP-08: obligatorias y opcionales se distinguen y se completan con un toque', async () => {
        await page.getByRole('link', { name: /Tareas/ }).click()
        await expect(page.getByText('e2e-tareas: obligatoria')).toBeVisible()
        await expect(page.getByText('e2e-tareas: opcional')).toBeVisible()
        await page
          .getByRole('checkbox', {
            name: 'Marcar "e2e-tareas: obligatoria" como completada',
          })
          .click()
        await expect(page.getByText(/Completada \d{2}:\d{2}/)).toBeVisible()
        await page
          .getByRole('checkbox', {
            name: 'Marcar "e2e-tareas: opcional" como completada',
          })
          .click()
        await expect(page.getByText(/Completada \d{2}:\d{2}/)).toHaveCount(2)
      })

      await test.step('CB-12: "no realizada" sin motivo no se puede confirmar', async () => {
        await page.getByRole('button', { name: 'No realizada' }).click()
        const confirmar = page.getByRole('button', {
          name: 'Marcar no realizada',
        })
        await expect(confirmar).toBeDisabled()
        await page.getByLabel('Motivo').fill('e2e: puerta cerrada con llave')
        await expect(confirmar).toBeEnabled()
        await confirmar.click()
        await expect(
          page.getByText('No realizada · e2e: puerta cerrada con llave'),
        ).toBeVisible()
      })

      await test.step('CB-12 en el servidor: sin motivo, REASON_REQUIRED', async () => {
        const api = await sessionClient('empleado3')
        expectHint(
          await api.rpc('update_task_status', {
            p_task_id: idDe('e2e-tareas: obligatoria'),
            p_status: 'not_done',
          }),
          'REASON_REQUIRED',
        )
      })

      await test.step('EMP-07 refleja el avance: 2 de 3 hechas', async () => {
        await page.goto(`/app/en-curso/${asignacion}`)
        await expect(page.getByText('2 de 3')).toBeVisible()
      })

      await test.step('con el fin registrado, el servidor rechaza cambiar tareas (TASK_LOCKED)', async () => {
        await fichar('empleado3', asignacion, 'fin')
        const api = await sessionClient('empleado3')
        expectHint(
          await api.rpc('update_task_status', {
            p_task_id: idDe('e2e-tareas: tercera'),
            p_status: 'done',
          }),
          'TASK_LOCKED',
        )
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'la observación se guarda, se ve en el detalle y se bloquea cuando el turno ya terminó',
  cubre('RB-E06', 'P-062'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('en-curso-notas')
      const sede = await sc.site(cliente.id, 'en-curso-notas')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      const asignacion = await sc.assign(turno, 'empleado3')
      await fijarConsentimiento('empleado3', true)
      await marcarCambiosVistos('empleado3')
      await fichar('empleado3', asignacion, 'inicio')

      const nota = 'e2e-notas: el cliente pidió reforzar los baños.'
      await test.step('EMP-09: se escribe, se guarda y se conserva al volver', async () => {
        await page.goto(`/app/en-curso/${asignacion}/observaciones`)
        await page
          .getByPlaceholder('Escribí tu observación (opcional)…')
          .fill(nota)
        await page.getByRole('button', { name: 'Guardar' }).click()
        await expect(page.getByText('Observación guardada.')).toBeVisible()
        await page.goto(`/app/en-curso/${asignacion}/observaciones`)
        await expect(
          page.getByPlaceholder('Escribí tu observación (opcional)…'),
        ).toHaveValue(nota)
      })

      await test.step('EMP-04 la muestra como "Tu observación"', async () => {
        await page.goto(`/app/servicio/${asignacion}`)
        await expect(page.getByText('Tu observación')).toBeVisible()
        await expect(page.getByText(nota)).toBeVisible()
      })

      await test.step('EMP-10 la cuenta como cargada y EMP-11 la muestra', async () => {
        await page.goto(`/app/en-curso/${asignacion}/finalizar`)
        await expect(page.getByText('Cargada')).toBeVisible()
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await expect(page).toHaveURL(new RegExp(`/app/resumen/${asignacion}$`))
        await expect(page.getByText(nota)).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Volver a Hoy' }),
        ).toBeVisible()
      })

      await test.step('terminado el turno, ya no se puede cambiar (SHIFT_COMPLETED)', async () => {
        await page.goto(`/app/en-curso/${asignacion}/observaciones`)
        await page
          .getByPlaceholder('Escribí tu observación (opcional)…')
          .fill(`${nota} Agregado tarde.`)
        await page.getByRole('button', { name: 'Guardar' }).click()
        await expect(page.getByText('Este turno ya terminó.')).toBeVisible()
        const { data } = await sc.db
          .from('assignments')
          .select('notes')
          .eq('id', asignacion)
          .single()
        expect(data?.notes).toBe(nota)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'CB-04: registrar el inicio después de la hora de fin del turno está permitido y no avisa salida anticipada',
  cubre('CB-04', 'RB-E04', 'P-068'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('cb04')
      const sede = await sc.site(cliente.id, 'cb04')
      // 00:00–00:01: a cualquier hora del día el fin del turno ya pasó; es el mismo caso que
      // "23:59 para un turno de 22:00 a 23:30" (mismo día, el inicio llega después del fin).
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS.madrugada,
      )
      const asignacion = await sc.assign(turno, 'empleado3')
      await fijarConsentimiento('empleado3', true)
      await marcarCambiosVistos('empleado3')

      await test.step('se puede registrar el inicio por la pantalla', async () => {
        await page.goto('/app/fichar')
        await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(page).toHaveURL(new RegExp(`/app/en-curso/${asignacion}$`))
      })

      await test.step('al finalizar no hay aviso de salida anticipada (no aplica)', async () => {
        await page.goto(`/app/en-curso/${asignacion}/finalizar`)
        await expect(
          page.getByRole('button', { name: 'Registrar fin' }),
        ).toBeEnabled()
        await expect(page.getByText(TEXTO.salidaAnticipada)).toHaveCount(0)
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await expect(page).toHaveURL(new RegExp(`/app/resumen/${asignacion}$`))
      })

      await test.step('en la Base: el inicio es posterior al fin previsto y la asignación termina finished', async () => {
        const { data: inicio } = await sc.db
          .from('attendance_records')
          .select('recorded_at')
          .eq('assignment_id', asignacion)
          .eq('kind', 'check_in')
          .single()
        const finPrevisto = new Date(`${sc.today}T00:01:00-03:00`).getTime()
        expect(new Date(inicio!.recorded_at).getTime()).toBeGreaterThan(
          finPrevisto,
        )
        const { data: a } = await sc.db
          .from('assignments')
          .select('status')
          .eq('id', asignacion)
          .single()
        expect(a?.status).toBe('finished')
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'CB-22: sin conexión, fichar y los botones que escriben quedan deshabilitados con su aviso y vuelven al reconectar',
  cubre('CB-22', 'RB-E04', 'P-077'),
  async ({ page, context }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('offline')
      const sede = await sc.site(cliente.id, 'offline')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      await tareasDelTurno(turno, [
        { title: 'e2e-offline: tarea', required: true },
      ])
      const asignacion = await sc.assign(turno, 'empleado3')
      await fijarConsentimiento('empleado3', true)
      await marcarCambiosVistos('empleado3')

      try {
        await test.step('Fichar sin conexión: "Registrar inicio" deshabilitado con mensaje', async () => {
          await page.goto('/app/fichar')
          await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
          await context.setOffline(true)
          await expect(
            page.getByText('Estás sin conexión. Conectate para poder fichar.'),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: 'Registrar inicio' }),
          ).toBeDisabled()
          await context.setOffline(false)
          await expect(
            page.getByRole('button', { name: 'Registrar inicio' }),
          ).toBeEnabled()
          await page.getByRole('button', { name: 'Registrar inicio' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/app/en-curso/${asignacion}$`),
          )
        })

        // Se precalientan con conexión las pantallas que se van a visitar sin red: los trozos
        // de código de cada pantalla se bajan la primera vez que se entra, y la lectura sin
        // red queda fuera del alcance (no hay cola ni sincronización, P-077). Lo que se prueba
        // es que ESCRIBIR se bloquea.
        for (const enlace of [
          /Tareas/,
          /Observaciones/,
          /Finalizar servicio/,
        ]) {
          await page.getByRole('link', { name: enlace }).click()
          await page.getByRole('button', { name: 'Volver' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/app/en-curso/${asignacion}$`),
          )
        }
        await page.getByRole('link', { name: /Tareas/ }).click()
        await expect(page.getByText('e2e-offline: tarea')).toBeVisible()
        await page.getByRole('button', { name: 'Volver' }).click()
        await expect(page).toHaveURL(new RegExp(`/app/en-curso/${asignacion}$`))

        await context.setOffline(true)

        await test.step('en curso, tareas, observaciones y finalizar avisan y bloquean', async () => {
          await expect(
            page.getByText(
              'Estás sin conexión. Vas a poder seguir viendo tu servicio, pero registrar cosas nuevas va a esperar a que vuelvas a tener señal.',
            ),
          ).toBeVisible()

          await page.getByRole('link', { name: /Tareas/ }).click()
          await expect(
            page.getByText(
              'Estás sin conexión: no podés marcar tareas hasta que vuelvas a tener señal.',
            ),
          ).toBeVisible()
          await expect(
            page.getByRole('checkbox', { name: /e2e-offline: tarea/ }),
          ).toBeDisabled()
          await page.getByRole('button', { name: 'Volver' }).click()

          await page.getByRole('link', { name: /Observaciones/ }).click()
          await expect(
            page.getByText(
              'Estás sin conexión: no podés guardar la observación hasta que vuelvas a tener señal.',
            ),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: 'Guardar' }),
          ).toBeDisabled()
          await page.getByRole('button', { name: 'Volver' }).click()

          await page.getByRole('link', { name: /Finalizar servicio/ }).click()
          await expect(
            page.getByText(
              'Estás sin conexión. Conectate para poder registrar el fin.',
            ),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: 'Registrar fin' }),
          ).toBeDisabled()
        })

        await test.step('al volver la conexión se puede finalizar', async () => {
          await context.setOffline(false)
          await expect(
            page.getByRole('button', { name: 'Registrar fin' }),
          ).toBeEnabled()
          await page.getByRole('button', { name: 'Registrar fin' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/app/resumen/${asignacion}$`),
          )
        })
      } finally {
        await context.setOffline(false)
      }
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
