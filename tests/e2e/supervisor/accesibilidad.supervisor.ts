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
  'SUP-02 a SUP-09: Hoy con la barra de jornada, detalle del turno, supervisión, calificar, cerrar, Supervisiones, historial y Más',
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
      await fijarConsentimiento('empleado1', true)
      await fichar('empleado1', asignacion, 'inicio')

      // Una jornada de ayer con una supervisión cerrada, para que el historial tenga filas.
      const sedeAyer = await sc.site(cliente.id, 'axe-sup-ayer')
      const ayer = daysFromToday(-1)
      const turnoAyer = await sc.shift(
        cliente.id,
        sedeAyer.id,
        ayer,
        FRANJAS.manana,
      )
      const jornadaAyer = await sc.jornadaPasada(
        'supervisor1',
        ayer,
        '08:00',
        '16:00',
      )
      await sc.supervisionDirecta(turnoAyer, 'supervisor1', {
        jornadaId: jornadaAyer,
      })
      await sc.asegurarJornada('supervisor1')

      const auditar = async (nombre: string, ruta: string) =>
        test.step(nombre, async () => {
          await page.goto(ruta)
          await auditarEnAmbosTamanos(page, testInfo, nombre, () =>
            esperarPantallaLista(page),
          )
        })

      await auditar('SUP-02 Hoy con la barra de jornada', '/sup')
      await auditar('SUP-03 Detalle del turno', `/sup/turnos/${turno}`)

      const supervision = await sc.tomarSupervision(turno, 'supervisor1')
      await auditar('SUP-02 Hoy supervisando', '/sup')
      await auditar('SUP-07 Supervisiones', '/sup/supervisiones')
      await auditar(
        'SUP-04 Supervisión en curso',
        `/sup/supervisiones/${supervision}`,
      )
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
