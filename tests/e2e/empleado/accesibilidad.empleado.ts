import { expect, test } from '@playwright/test'
import {
  auditarEnAmbosTamanos,
  esperarPantallaLista,
} from '../../fixtures/axe.ts'
import {
  daysFromToday,
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
} from '../../fixtures/movil.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-023 (P18.4): accesibilidad con axe-core en las pantallas del empleado, en celular (390 px)
// y en escritorio (1280 px). Criterio: cero violaciones critical y serious (el contraste de los
// tokens se informa aparte: ver `fixtures/axe.ts`). COM-04 (perfil) está en
// `admin/accesibilidad.admin.ts`: es la misma pantalla para los tres roles.
// Cuenta de este archivo: empleado1 (un turno de hoy armado y borrado por el propio test).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('empleado1') })
// Acá no se prueba la posición: el navegador la niega y el registro sigue sin coordenadas.
test.use({ permissions: [] })

test(
  'EMP-03 a EMP-14: Hoy, detalle, fichar, consentimiento, avisar, Más, servicio en curso, tareas, observaciones, finalizar y resumen',
  cubre('RB-X01', 'RB-E02', 'RB-E03', 'RB-E04', 'RB-E05', 'RB-E06', 'RB-E07'),
  async ({ page }, testInfo) => {
    test.setTimeout(240_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('axe-emp')
      const sede = await sc.site(cliente.id, 'axe-emp', {
        lat: -34.6037,
        lng: -58.3816,
      })
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      await tareasDelTurno(turno, [
        { title: 'e2e-axe: barrer', required: true },
        { title: 'e2e-axe: sacar la basura', required: false },
      ])
      // Un turno de otro día para que Hoy muestre también "Próximos días".
      const proximo = await sc.shift(
        cliente.id,
        sede.id,
        daysFromToday(2),
        FRANJAS.manana,
      )
      const asignacion = await sc.assign(turno, 'empleado1')
      await sc.assign(proximo, 'empleado1')
      await marcarCambiosVistos('empleado1')

      const auditar = async (nombre: string, ruta: string) =>
        test.step(nombre, async () => {
          await page.goto(ruta)
          await auditarEnAmbosTamanos(page, testInfo, nombre, () =>
            esperarPantallaLista(page),
          )
        })

      await fijarConsentimiento('empleado1', false)
      await auditar('EMP-03 Hoy', '/app')
      await auditar(
        'EMP-04 Detalle del servicio',
        `/app/servicio/${asignacion}`,
      )
      await auditar(
        'EMP-06 Consentimiento de ubicación',
        '/app/fichar/consentimiento',
      )
      await auditar('EMP-12 Avisar demora o ausencia', '/app/avisar')
      await auditar('EMP-13 Más', '/app/mas')

      await fijarConsentimiento('empleado1', true)
      await auditar('EMP-05 Registrar inicio', '/app/fichar')

      await fichar('empleado1', asignacion, 'inicio')
      await auditar('EMP-07 Servicio en curso', `/app/en-curso/${asignacion}`)
      await auditar('EMP-08 Tareas', `/app/en-curso/${asignacion}/tareas`)
      await auditar(
        'EMP-09 Observaciones',
        `/app/en-curso/${asignacion}/observaciones`,
      )
      await auditar(
        'EMP-10 Finalizar servicio',
        `/app/en-curso/${asignacion}/finalizar`,
      )

      await fichar('empleado1', asignacion, 'fin')
      await auditar('EMP-11 Resumen del servicio', `/app/resumen/${asignacion}`)
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
