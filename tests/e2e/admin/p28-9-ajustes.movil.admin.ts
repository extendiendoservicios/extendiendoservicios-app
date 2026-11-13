import { test } from '@playwright/test'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import {
  of05bDotacionYDia,
  of08bLicenciaConTurnos,
  of21CancelarYSinDuplicados,
  of21RepetirIgual,
  of21SacarFechas,
  of22DetalleDeAsistencia,
  of22ResumenDelCliente,
} from './p28-9-pasos.ts'

// P28.9c: los ajustes de P28.9 desde el celular (proyecto `mobile`, 390 px, táctil). El cronograma
// editable (OF-23) es de escritorio y no se repite acá. Los mismos pasos que en escritorio, más la
// comprobación de que ninguna pantalla desborda en horizontal (están dentro de los pasos).
// Empleados: empleado1 y empleado2.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.describe('OF-21 · repetir un turno avisa duplicados (390 px)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('«Sacar esas fechas»', cubre('RB-A04', 'OF-21'), async ({ page }) => {
    test.setTimeout(240_000)
    await of21SacarFechas(page)
  })

  test('«Repetir igual»', cubre('RB-A04', 'OF-21'), async ({ page }) => {
    test.setTimeout(240_000)
    await of21RepetirIgual(page)
  })

  test(
    '«Cancelar» y sede sin duplicados',
    cubre('RB-A04', 'OF-21'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await of21CancelarYSinDuplicados(page)
    },
  )
})

test.describe('OF-22 · hojas imprimibles con cierre automático (390 px)', () => {
  test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
  test.use({ storageState: storageStatePath('admin') })

  test(
    'detalle de asistencia de la persona',
    cubre('RB-A06', 'OF-22'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await of22DetalleDeAsistencia(page)
    },
  )

  test(
    'resumen de servicios del cliente',
    cubre('RB-A06', 'OF-22'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await of22ResumenDelCliente(page)
    },
  )
})

test.describe('OF-05b y OF-08b (390 px)', () => {
  test.describe('OF-05b', () => {
    test.use({ storageState: storageStatePath('owner') })
    test(
      'solo dotación no crea turnos',
      cubre('RB-A04', 'OF-05b'),
      async ({ page }) => {
        test.setTimeout(240_000)
        await of05bDotacionYDia(page)
      },
    )
  })

  test.describe('OF-08b', () => {
    test.use({ storageState: storageStatePath('admin') })
    test(
      'licencia sobre días con turnos: servicio y «Ver turno»',
      cubre('RB-A03', 'OF-08b'),
      async ({ page }) => {
        test.setTimeout(240_000)
        await of08bLicenciaConTurnos(page)
      },
    )
  })
})
