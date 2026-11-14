import { test } from '@playwright/test'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import {
  cambiaDeModoYVuelve,
  coordinadorSigueEnSuApp,
  empleadoSigueEnSuApp,
  ingresaPorPantallaYVaAlPanel,
  miTurnoLlevaAlFichaje,
  sinTurnoNoHayTarjeta,
  soloAdminNoVeMiTurno,
  soloAdminSinCambioDeModo,
} from './p29-modo-panel-pasos.ts'

// P29.6 (P29.2 y P29.3: OG-06, OG-07, OG-08), celular 390 px táctil (proyecto `mobile`): antes de
// P29 la cuenta administración + empleado caía en /app en el celular; ahora entra al panel, cambia
// de modo desde el menú de usuario, vuelve con «Volver al panel» y «Mi turno» lleva al fichaje. Un
// empleado común sigue en /app y un coordinador en /sup. Los mismos pasos que en escritorio
// (p29-modo-panel.admin.ts), con la comprobación de que ninguna pantalla desborda en horizontal.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.describe('OG-06 · quien administra y es empleado entra al panel (390 px)', () => {
  test.describe('ingreso por la pantalla de ingreso', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test(
      'la cuenta administración + empleado cae en /admin al ingresar desde el celular',
      cubre('RB-X01', 'OG-06'),
      async ({ page }) => {
        await ingresaPorPantallaYVaAlPanel(page)
      },
    )
  })

  test.describe('con la sesión abierta', () => {
    test.use({ storageState: storageStatePath('adminOperativo') })

    test(
      'la raíz lleva al panel; «Ir a mi app de empleado» y «Volver al panel» van y vuelven (OG-08)',
      cubre('RB-X01', 'OG-06', 'OG-08'),
      async ({ page }) => {
        await cambiaDeModoYVuelve(page)
      },
    )
  })

  test.describe('administración sin rol de empleado', () => {
    test.use({ storageState: storageStatePath('admin') })

    test(
      'el menú de usuario no ofrece cambiar de modo (OG-08)',
      cubre('OG-08'),
      async ({ page }) => {
        await soloAdminSinCambioDeModo(page)
      },
    )
  })

  test.describe('empleado común', () => {
    test.use({ storageState: storageStatePath('empleado1') })

    test(
      'sigue entrando a /app y no pasa al panel',
      cubre('RB-X02', 'OG-06'),
      async ({ page }) => {
        await empleadoSigueEnSuApp(page)
      },
    )
  })

  test.describe('coordinador', () => {
    test.use({ storageState: storageStatePath('supervisor1') })

    test(
      'sigue entrando a /sup y no pasa al panel',
      cubre('RB-X02', 'OG-06'),
      async ({ page }) => {
        await coordinadorSigueEnSuApp(page)
      },
    )
  })
})

test.describe('OG-07 · «Mi turno» en el Resumen (390 px)', () => {
  test.describe('administración + empleado', () => {
    test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
    test.use({ storageState: storageStatePath('adminOperativo') })

    test(
      'con un turno hoy, «Mi turno» lleva al fichaje de la app del empleado',
      cubre('RB-E04', 'RB-X01', 'OG-07'),
      async ({ page }) => {
        test.setTimeout(240_000)
        await miTurnoLlevaAlFichaje(page)
      },
    )

    test('sin turno hoy no hay tarjeta', cubre('OG-07'), async ({ page }) => {
      await sinTurnoNoHayTarjeta(page)
    })
  })

  test.describe('administración sin rol de empleado', () => {
    test.use({ storageState: storageStatePath('admin') })

    test('nunca ve «Mi turno»', cubre('OG-07'), async ({ page }) => {
      test.setTimeout(240_000)
      await soloAdminNoVeMiTurno(page)
    })
  })
})
