import { expect, test, type Page } from '@playwright/test'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { fijarConsentimiento, TEXTO } from '../fixtures/movil.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import { fichajeGuardado, turnoDeHoy } from '../e2e-geo/helpers/geo.ts'

// P31.6 · D-14 (OI-11), celular del empleado a 390 px. La ubicación se simula reemplazando
// `navigator.geolocation` (la API real de Playwright no sabe fallar con un código, y acá hace falta
// PERMISSION_DENIED, POSITION_UNAVAILABLE y TIMEOUT por separado):
//   - el aviso, la ayuda según el celular (Android, iPhone, otro) y «Reintentar»;
//   - «Reintentar» recupera cuando la lectura por fin llega;
//   - a los 8 s sin lectura se pide además una de baja precisión (respaldo);
//   - el fichaje de inicio y de fin SIN coordenadas guarda el motivo técnico (`permission_denied`,
//     `position_unavailable`, `timeout`) en `geo_unvalidated_reason`; con coordenadas no se manda.
// Cuenta de este archivo: empleado1 con el consentimiento de ubicación dado.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('empleado1') })

interface EstadoGeo {
  modo: 'ok' | 'error' | 'silencio' | 'respaldo'
  codigo: 1 | 2 | 3
  lat: number
  lng: number
  acc: number
}

declare global {
  interface Window {
    __geo: EstadoGeo
    __geoLlamadas: Array<{ api: 'watch' | 'current'; alta: boolean }>
  }
}

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

/** Reemplaza la API de ubicación del navegador por una que falla o responde según `window.__geo`. */
async function simularGeolocalizacion(
  page: Page,
  inicial: Partial<EstadoGeo> = {},
): Promise<void> {
  await page.addInitScript((estado) => {
    window.__geo = {
      modo: 'error',
      codigo: 2,
      lat: -34.6037,
      lng: -58.3816,
      acc: 10,
      ...estado,
    }
    window.__geoLlamadas = []
    const responder = (
      api: 'watch' | 'current',
      ok: (p: unknown) => void,
      fail: ((e: unknown) => void) | undefined,
      opciones?: { enableHighAccuracy?: boolean },
    ) => {
      window.__geoLlamadas.push({
        api,
        alta: opciones?.enableHighAccuracy === true,
      })
      setTimeout(() => {
        const g = window.__geo
        const responde =
          g.modo === 'ok' ||
          (g.modo === 'respaldo' &&
            api === 'current' &&
            !opciones?.enableHighAccuracy)
        if (responde) {
          ok({
            coords: { latitude: g.lat, longitude: g.lng, accuracy: g.acc },
            timestamp: Date.now(),
          })
        } else if (g.modo === 'error') {
          fail?.({
            code: g.codigo,
            message: 'e2e',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          })
        }
      }, 30)
    }
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (
          ok: (p: unknown) => void,
          fail?: (e: unknown) => void,
          opciones?: { enableHighAccuracy?: boolean },
        ) => {
          responder('watch', ok, fail, opciones)
          return 1
        },
        getCurrentPosition: (
          ok: (p: unknown) => void,
          fail?: (e: unknown) => void,
          opciones?: { enableHighAccuracy?: boolean },
        ) => responder('current', ok, fail, opciones),
        clearWatch: () => undefined,
      },
    })
  }, inicial)
}

const aviso = (page: Page) => page.getByTestId('geo-message')
const ayuda = (page: Page) => page.getByTestId('geo-help')
const reintentar = (page: Page) =>
  page.getByRole('button', { name: 'Reintentar', exact: true })
const resultado = (page: Page) => page.getByTestId('attendance-result')

test.describe('ubicación al fichar: avisos, ayuda y Reintentar (D-14)', () => {
  test.beforeEach(async () => {
    await fijarConsentimiento('empleado1', true)
  })

  test(
    'sin permiso: aviso, ayuda general y «Reintentar» visible; con la lectura por fin disponible, Reintentar la recupera',
    cubre('RB-E04', 'OI-11', 'D-14', 'B-05', 'CB-20'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        await turnoDeHoy(sc, 'd14-perm', 'empleado1')
        await simularGeolocalizacion(page, { modo: 'error', codigo: 1 })
        await page.goto('/app/fichar')
        await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()

        await expect(aviso(page)).toContainText(
          'No tenemos permiso para ver tu ubicación. Podés registrar igual: queda sin validar.',
        )
        await expect(ayuda(page)).toContainText(
          'Para validar el registro, permití la ubicación a este sitio.',
        )
        await expect(ayuda(page)).toContainText(
          'Habilitá la ubicación para este sitio en la configuración del navegador.',
        )
        await expect(reintentar(page)).toBeVisible()
        await expectNoHorizontalScroll(page)

        // Se concede el permiso (la lectura llega): «Reintentar» pide de nuevo y se recupera.
        await page.evaluate(() => {
          window.__geo = { ...window.__geo, modo: 'ok' }
        })
        await reintentar(page).click()
        await expect(aviso(page)).toContainText(
          'Estás dentro de la zona del servicio.',
        )
        await expect(reintentar(page)).toHaveCount(0)
        await expect(ayuda(page)).toHaveCount(0)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'sin señal (POSITION_UNAVAILABLE): «No pudimos obtener tu ubicación», ayuda de ubicación apagada y Reintentar',
    cubre('RB-E04', 'OI-11', 'D-14'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        await turnoDeHoy(sc, 'd14-sin', 'empleado1')
        await simularGeolocalizacion(page, { modo: 'error', codigo: 2 })
        await page.goto('/app/fichar')
        await expect(aviso(page)).toContainText(
          'No pudimos obtener tu ubicación. Podés registrar igual: queda sin validar.',
        )
        await expect(ayuda(page)).toContainText(
          'Revisá que la ubicación del teléfono esté encendida.',
        )
        await expect(reintentar(page)).toBeVisible()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  for (const [celular, userAgent, paso] of [
    [
      'Android',
      UA_ANDROID,
      'Bajá la barra de accesos rápidos y tocá Ubicación.',
    ],
    [
      'iPhone',
      UA_IPHONE,
      'Ajustes › Privacidad › Localización: que esté activada.',
    ],
  ] as const) {
    test.describe(`ayuda según el celular: ${celular}`, () => {
      test.use({ userAgent })

      test(
        `en ${celular} la ayuda trae los pasos de su sistema`,
        cubre('RB-E04', 'OI-11', 'D-14'),
        async ({ page }) => {
          test.setTimeout(180_000)
          const sc = new Scenario()
          try {
            await turnoDeHoy(sc, `d14-${celular.toLowerCase()}`, 'empleado1')
            await simularGeolocalizacion(page, { modo: 'error', codigo: 2 })
            await page.goto('/app/fichar')
            await expect(ayuda(page)).toContainText(
              'Revisá que la ubicación del teléfono esté encendida.',
            )
            await expect(ayuda(page)).toContainText(paso)
            await expect(reintentar(page)).toBeVisible()
          } finally {
            expect(await sc.cleanup(), 'limpieza').toEqual([])
          }
        },
      )
    })
  }

  test(
    'respaldo de baja precisión: sin lectura de alta precisión, a los 8 s se pide una de baja y se usa',
    cubre('RB-E04', 'OI-11', 'D-14'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        await turnoDeHoy(sc, 'd14-resp', 'empleado1')
        // El watch de alta precisión no responde nunca; solo contesta el pedido de baja precisión.
        await simularGeolocalizacion(page, { modo: 'respaldo', acc: 80 })
        await page.goto('/app/fichar')
        await expect(aviso(page)).toContainText('Buscando tu ubicación…')
        // Sin dormir: la lectura de respaldo llega cuando la app la pide (a los 8 s).
        await expect(page.getByTestId('geo-accuracy')).toHaveText(
          'Precisión: 80 m',
          { timeout: 20_000 },
        )
        // La alta precisión se pidió primero y la de baja después, una sola vez.
        const llamadas = await page.evaluate(() => window.__geoLlamadas)
        expect(llamadas[0]).toEqual({ api: 'watch', alta: true })
        expect(llamadas.filter((l) => l.api === 'current')).toEqual([
          { api: 'current', alta: false },
        ])
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

const MOTIVOS = [
  [1, 'permission_denied', 'sin permiso de ubicación'],
  [2, 'position_unavailable', 'sin señal de ubicación'],
  [3, 'timeout', 'tiempo de espera agotado'],
] as const

test.describe('el fichaje sin coordenadas guarda el motivo técnico (D-14)', () => {
  test.beforeEach(async () => {
    await fijarConsentimiento('empleado1', true)
  })

  for (const [codigo, motivo] of MOTIVOS) {
    test(
      `inicio con el error ${codigo}: queda sin validar con el motivo ${motivo}`,
      cubre('RB-E04', 'RB-E05', 'OI-11', 'D-14', 'B-05'),
      async ({ page }) => {
        test.setTimeout(180_000)
        const sc = new Scenario()
        try {
          const t = await turnoDeHoy(sc, `d14-i${codigo}`, 'empleado1')
          await simularGeolocalizacion(page, { modo: 'error', codigo })
          await page.goto('/app/fichar')
          await expect(reintentar(page)).toBeVisible()
          await page.getByRole('button', { name: 'Registrar inicio' }).click()
          await expect(resultado(page)).toBeVisible()

          const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
          expect(r.geo_status).toBe('unvalidated')
          expect(r.geo_unvalidated_reason).toBe(motivo)
          expect(r.latitude).toBeNull()
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  }

  test(
    'fin con tiempo agotado: el motivo técnico también se guarda en la salida',
    cubre('RB-E04', 'RB-E05', 'OI-11', 'D-14'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoDeHoy(sc, 'd14-fin', 'empleado1')
        await simularGeolocalizacion(page, { modo: 'ok' })
        await page.goto('/app/fichar')
        await expect(page.getByTestId('geo-accuracy')).toBeVisible()
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(resultado(page)).toBeVisible()
        const inicio = await fichajeGuardado(sc, t.asignacionId, 'check_in')
        // Con coordenadas no se manda ningún motivo técnico.
        expect(inicio.geo_status).not.toBe('unvalidated')
        expect(inicio.geo_unvalidated_reason).toBeNull()

        // La salida se registra con el GPS caído (tiempo agotado).
        await page.addInitScript(() => {
          window.__geo = { ...window.__geo, modo: 'error', codigo: 3 }
        })
        await page.goto(`/app/en-curso/${t.asignacionId}/finalizar`)
        await expect(reintentar(page)).toBeVisible()
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await expect(resultado(page)).toContainText('Fin registrado')
        const fin = await fichajeGuardado(sc, t.asignacionId, 'check_out')
        expect(fin.geo_status).toBe('unvalidated')
        expect(fin.geo_unvalidated_reason).toBe('timeout')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('permiso real del navegador negado (D-14)', () => {
  // Sin conceder la geolocalización: el navegador la deniega solo, sin simulación.
  test.use({ permissions: [] })

  test(
    'con el permiso negado por el navegador: aviso, «Reintentar» y el fichaje guarda permission_denied',
    cubre('RB-E04', 'RB-E05', 'OI-11', 'D-14', 'B-05'),
    async ({ page }) => {
      test.setTimeout(180_000)
      await fijarConsentimiento('empleado1', true)
      const sc = new Scenario()
      try {
        const t = await turnoDeHoy(sc, 'd14-real', 'empleado1')
        await page.goto('/app/fichar')
        await expect(aviso(page)).toContainText(
          'No tenemos permiso para ver tu ubicación.',
        )
        await expect(reintentar(page)).toBeVisible()
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(resultado(page)).toBeVisible()
        const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
        expect(r.geo_status).toBe('unvalidated')
        expect(r.geo_unvalidated_reason).toBe('permission_denied')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
