import { expect, test } from '@playwright/test'
import {
  auditarEnAmbosTamanos,
  esperarPantallaLista,
} from '../../fixtures/axe.ts'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  cerrarSupervision,
  fichar,
  FRANJAS_MOVIL,
  fijarConsentimiento,
  supervisionFichar,
  tareasDelTurno,
} from '../../fixtures/movil.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-023 (P18.4): accesibilidad con axe-core en las pantallas del supervisor, en celular
// (390 px) y en escritorio (1280 px). Criterio: cero violaciones critical y serious (el contraste
// de los tokens se informa aparte: ver `fixtures/axe.ts`). COM-04 (perfil) está en
// `admin/accesibilidad.admin.ts`.
// Cuentas de este archivo: supervisor1 y, como persona a supervisar, empleado1.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('supervisor1') })
test.use({ permissions: [] })

test(
  'SUP-02 a SUP-09: Hoy, Supervisiones, detalle, registro, calificar, cerrar, historial y Más',
  cubre('RB-X01', 'RB-S02', 'RB-S03', 'RB-S04', 'RB-S05'),
  async ({ page }, testInfo) => {
    test.setTimeout(240_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('axe-sup')
      const sede = await sc.site(cliente.id, 'axe-sup', {
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
        { title: 'e2e-axe: trapear', required: true },
      ])
      const asignacion = await sc.assign(turno, 'empleado1')
      const supervision = await sc.assignSupervision(turno, 'supervisor1')

      // Una supervisión ya cerrada (no realizada), en otra franja, para que el historial tenga
      // una fila.
      const turnoCerrado = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS.madrugada,
      )
      const supCerrada = await sc.assignSupervision(turnoCerrado, 'supervisor1')
      await cerrarSupervision('supervisor1', supCerrada, {
        noRealizada: 'e2e-axe: sin acceso a la sede',
      })

      await fijarConsentimiento('empleado1', true)
      await fichar('empleado1', asignacion, 'inicio')

      const auditar = async (nombre: string, ruta: string) =>
        test.step(nombre, async () => {
          await page.goto(ruta)
          await auditarEnAmbosTamanos(page, testInfo, nombre, () =>
            esperarPantallaLista(page),
          )
        })

      await auditar('SUP-02 Hoy', '/sup')
      await auditar('SUP-07 Supervisiones', '/sup/supervisiones')
      await auditar(
        'SUP-03 Detalle de la supervisión',
        `/sup/supervisiones/${supervision}`,
      )
      await auditar(
        'SUP-04 Inicio y fin de supervisión',
        `/sup/supervisiones/${supervision}/registro`,
      )

      await supervisionFichar('supervisor1', supervision, 'inicio')
      await auditar(
        'SUP-05 Calificar empleado',
        `/sup/supervisiones/${supervision}/calificar/${asignacion}`,
      )
      await auditar(
        'SUP-06 Cerrar supervisión',
        `/sup/supervisiones/${supervision}/cerrar`,
      )
      await auditar('SUP-08 Historial', '/sup/historial')
      await auditar('SUP-09 Más', '/sup/mas')
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
