import { expect, test, type Page } from '@playwright/test'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import {
  fijarConsentimiento,
  marcarCambiosVistos,
  TEXTO,
} from '../fixtures/movil.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import {
  consentimientoVencido,
  desplazar,
  distanciaM,
  fichajeGuardado,
  redondear,
  SEDE_COORDS,
  simularPosicion,
  turnoDeHoy,
} from './helpers/geo.ts'

// P22.5 · EMP-05 / EMP-10 con validación por ubicación (módulo B1): el empleado ficha en el celular
// (390 px) con la posición simulada de Playwright (`context.setGeolocation`, con precisión).
// Cubre B-03 (estados), B-04 (fuera de la zona no bloquea; motivo opcional), B-05 (la ubicación
// sigue siendo opcional), B-06 y B-23 (regla con precisión y tope de 150 m), B-18 (mini mapa),
// B-22 (re-consentimiento) y B-37 (lo que se muestra al fichar es lo que calculó la base).
// Cuenta de este archivo: empleado1 (las demás de empleado quedan para otros archivos).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('empleado1') })

const RADIO = 100
const aviso = (page: Page) => page.getByTestId('geo-message')
const panel = (page: Page) => page.getByTestId('geo-panel')
const resultado = (page: Page) => page.getByTestId('attendance-result')
const botonInicio = (page: Page, nombre = 'Registrar inicio') =>
  page.getByRole('button', { name: nombre })

/** Abre Fichar y espera a que el panel de ubicación muestre la lectura (`Precisión: N m`). */
async function abrirFicharConLectura(page: Page, precision: number) {
  await page.goto('/app/fichar')
  await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
  await expect(page.getByTestId('geo-accuracy')).toHaveText(
    `Precisión: ${precision} m`,
  )
}

/**
 * Color (computado) con el que está pintado el círculo de la sede, que es el primer trazo del mapa.
 * Se lee del estilo real y no de una clase: lo que importa es lo que ve la persona (B-18).
 */
async function colorDelCirculoDeLaSede(page: Page): Promise<string> {
  return panel(page)
    .locator('.leaflet-overlay-pane path')
    .first()
    .evaluate((trazo) => getComputedStyle(trazo).stroke)
}

/** Color computado de un token del design system (`bg-success`, `bg-danger`), para comparar. */
async function colorDeToken(
  page: Page,
  clase: 'bg-success' | 'bg-danger',
): Promise<string> {
  return page.evaluate((c) => {
    const sonda = document.createElement('span')
    sonda.className = c
    document.body.appendChild(sonda)
    const color = getComputedStyle(sonda).backgroundColor
    sonda.remove()
    return color
  }, clase)
}

interface CasoRegla {
  titulo: string
  norte: number
  precision: number
  /** Resultado que tiene que guardar la base. */
  esperado: {
    estado: 'valid' | 'outside' | 'unvalidated'
    motivo: 'low_accuracy' | null
  }
  /** Se ofrece «Esperar mejor señal» (precisión peor que el radio) y el botón pasa a «Fichar igual». */
  ofreceEspera: boolean
  trazabilidad: Parameters<typeof cubre>
}

// Radio de la sede: 100 m. Las distancias salen del mismo haversine de la base.
const CASOS: CasoRegla[] = [
  {
    titulo: 'en la sede, precisión buena: verde y «Validado»',
    norte: 0,
    precision: 10,
    esperado: { estado: 'valid', motivo: null },
    ofreceEspera: false,
    trazabilidad: ['RB-E04', 'B-03', 'B-06', 'B-37', 'CB-21'],
  },
  {
    titulo:
      'precisión 120 m (peor que el radio, dentro del tope): valida y ofrece esperar',
    norte: 0,
    precision: 120,
    esperado: { estado: 'valid', motivo: null },
    ofreceEspera: true,
    trazabilidad: ['RB-E04', 'B-06', 'B-23'],
  },
  {
    titulo:
      'precisión justo en el tope (150 m) con los círculos tocándose: valida',
    norte: 0,
    precision: 150,
    esperado: { estado: 'valid', motivo: null },
    ofreceEspera: true,
    trazabilidad: ['RB-E04', 'B-23'],
  },
  {
    titulo:
      'precisión 151 m con los círculos tocándose: gris «Sin validar (precisión insuficiente)»',
    norte: 50,
    precision: 151,
    esperado: { estado: 'unvalidated', motivo: 'low_accuracy' },
    ofreceEspera: true,
    trazabilidad: ['RB-E04', 'B-03', 'B-23'],
  },
  {
    titulo:
      'precisión mala (200 m) pero a 900 m de la sede: los círculos no se tocan, queda rojo',
    norte: 900,
    precision: 200,
    esperado: { estado: 'outside', motivo: null },
    ofreceEspera: true,
    trazabilidad: ['RB-E04', 'B-06', 'B-23'],
  },
  {
    titulo: 'borde exacto: a 0,1 m de adentro de «radio + precisión» valida',
    // radio 100 + precisión 50 = 150 m; se queda 0,1 m antes.
    norte: 149.9,
    precision: 50,
    esperado: { estado: 'valid', motivo: null },
    ofreceEspera: false,
    trazabilidad: ['RB-E04', 'B-06'],
  },
  {
    titulo: 'borde exacto: a 0,1 m de afuera de «radio + precisión» queda rojo',
    norte: 150.1,
    precision: 50,
    esperado: { estado: 'outside', motivo: null },
    ofreceEspera: false,
    trazabilidad: ['RB-E04', 'B-06'],
  },
]

test.describe('con la ubicación concedida y el consentimiento dado', () => {
  for (const caso of CASOS) {
    test(
      `EMP-05: ${caso.titulo}`,
      cubre(...caso.trazabilidad),
      async ({ page, context }) => {
        test.setTimeout(180_000)
        const sc = new Scenario()
        try {
          const t = await turnoDeHoy(sc, 'geo-regla', 'empleado1', {
            radio: RADIO,
          })
          await fijarConsentimiento('empleado1', true)
          await marcarCambiosVistos('empleado1')
          const punto = desplazar(SEDE_COORDS, caso.norte)
          await simularPosicion(context, punto, caso.precision)

          await abrirFicharConLectura(page, caso.precision)
          const { estado, motivo } = caso.esperado

          await test.step('panel en vivo: mapa con el color del resultado, mensaje y botones', async () => {
            await expect(
              panel(page).getByRole('group', {
                name: new RegExp(
                  estado === 'valid'
                    ? 'dentro de la zona\\.$'
                    : estado === 'outside'
                      ? 'fuera de la zona\\.$'
                      : 'sin validar\\.$',
                ),
              }),
            ).toBeVisible()
            if (estado === 'valid') {
              await expect(aviso(page)).toHaveText(
                'Estás dentro de la zona del servicio.',
              )
            } else if (estado === 'outside') {
              await expect(aviso(page)).toHaveText(
                'Estás fuera de la zona del servicio.',
              )
            } else {
              await expect(aviso(page)).toHaveText(
                'La señal de ubicación es poco precisa para validar el registro.',
              )
            }
            await expect(
              page.getByLabel('¿Por qué estás fuera de la zona? (opcional)'),
            ).toHaveCount(estado === 'outside' ? 1 : 0)
            await expect(
              page.getByRole('button', { name: 'Esperar mejor señal' }),
            ).toHaveCount(caso.ofreceEspera ? 1 : 0)
            await expect(
              botonInicio(
                page,
                caso.ofreceEspera ? 'Fichar igual' : 'Registrar inicio',
              ),
            ).toBeVisible()
            await expectNoHorizontalScroll(page)
          })

          await test.step('al fichar, la pantalla de resultado muestra lo que calculó la base', async () => {
            await botonInicio(
              page,
              caso.ofreceEspera ? 'Fichar igual' : 'Registrar inicio',
            ).click()
            await expect(resultado(page)).toBeVisible()
            await expect(resultado(page)).toContainText('Inicio registrado')
            const distancia = redondear(distanciaM(SEDE_COORDS, punto))
            if (estado === 'valid') {
              await expect(resultado(page)).toContainText('Validado')
              await expect(resultado(page)).toContainText(
                'Tu ubicación coincide con la zona del servicio.',
              )
            } else if (estado === 'outside') {
              await expect(resultado(page)).toContainText(
                `Fuera de zona · ${distancia} m`,
              )
            } else {
              await expect(resultado(page)).toContainText(
                'Sin validar (precisión insuficiente)',
              )
            }
          })

          await test.step('en la Base: estado, motivo, distancia, radio vigente y precisión guardados', async () => {
            const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
            expect(r.geo_status).toBe(estado)
            expect(r.geo_unvalidated_reason).toBe(motivo)
            expect(r.site_distance_m).toBe(
              redondear(distanciaM(SEDE_COORDS, punto)),
            )
            expect(r.geofence_radius_m).toBe(RADIO)
            expect(Number(r.accuracy_m)).toBe(caso.precision)
            expect(r.source).toBe('employee_app')
          })
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  }

  test(
    'EMP-05 y EMP-10: fuera de la zona no bloquea; el motivo es opcional, se guarda recortado y solo si queda «Fuera de zona»',
    cubre('RB-E04', 'B-03', 'B-04', 'B-18', 'CB-21'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoDeHoy(sc, 'geo-fuera', 'empleado1', {
          radio: RADIO,
        })
        await fijarConsentimiento('empleado1', true)
        await marcarCambiosVistos('empleado1')
        const afuera = desplazar(SEDE_COORDS, 600)
        await simularPosicion(context, afuera, 10)

        await test.step('inicio: rojo, aparece el campo de motivo (hasta 300 caracteres) y se guarda el motivo', async () => {
          await abrirFicharConLectura(page, 10)
          await expect(
            panel(page).getByRole('group', { name: /fuera de la zona\.$/ }),
          ).toBeVisible()
          const motivo = page.getByLabel(
            '¿Por qué estás fuera de la zona? (opcional)',
          )
          await expect(motivo).toBeVisible()
          await expect(motivo).toHaveAttribute('maxlength', '300')
          await expect(
            page.getByPlaceholder('Por ejemplo: el GPS no anda en el subsuelo'),
          ).toBeVisible()
          const escrito = '  e2e: el GPS no anda en el subsuelo  '
          await motivo.fill(escrito)
          await expect(page.getByText(`${escrito.length}/300`)).toBeVisible()
          await botonInicio(page).click()
          await expect(resultado(page)).toContainText(
            `Fuera de zona · ${redondear(distanciaM(SEDE_COORDS, afuera))} m`,
          )
          await expect(resultado(page)).toContainText(
            'Quedó registrado fuera de la zona del servicio. El registro se hizo igual.',
          )
          await resultado(page)
            .getByRole('button', { name: 'Ir a mi servicio' })
            .click()
          await expect(page).toHaveURL(
            new RegExp(`/app/en-curso/${t.asignacionId}$`),
          )
          const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
          expect(r.geo_status).toBe('outside')
          expect(r.outside_reason).toBe('e2e: el GPS no anda en el subsuelo')
        })

        await test.step('fin: sin escribir motivo (es opcional) el fichaje se registra igual y no guarda motivo', async () => {
          await page.goto(`/app/en-curso/${t.asignacionId}/finalizar`)
          await expect(page.getByTestId('geo-accuracy')).toHaveText(
            'Precisión: 10 m',
          )
          await expect(
            panel(page).getByRole('group', { name: /fuera de la zona\.$/ }),
          ).toBeVisible()
          await page.getByRole('button', { name: 'Registrar fin' }).click()
          await expect(resultado(page)).toContainText('Fin registrado')
          await expect(resultado(page)).toContainText('Fuera de zona')
          const r = await fichajeGuardado(sc, t.asignacionId, 'check_out')
          expect(r.geo_status).toBe('outside')
          expect(r.outside_reason).toBeNull()
          await resultado(page)
            .getByRole('button', { name: 'Ver el resumen' })
            .click()
          await expect(page).toHaveURL(
            new RegExp(`/app/resumen/${t.asignacionId}$`),
          )
        })

        await test.step('EMP-11: el resumen muestra el estado de los dos fichajes, sin coordenadas ni el motivo de una corrección', async () => {
          const marcas = page.getByTestId('attendance-mark')
          await expect(marcas).toHaveCount(2)
          await expect(marcas.first()).toContainText('Fuera de zona')
          await expect(marcas.last()).toContainText('Fuera de zona')
          await expect(page.locator('body')).not.toContainText(
            String(afuera.lat).slice(0, 7),
          )
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'EMP-05: el círculo de la sede se pinta de verde dentro de la zona y de rojo fuera (B-18)',
    cubre('RB-E04', 'B-03', 'B-18'),
    async ({ page, context }) => {
      // DEF-B1-01: `circlePathOptions` pasa `className` con `pathOptions`, y react-leaflet lo aplica
      // con `setStyle` después de crear el trazo; Leaflet solo lee `className` al crearlo. El trazo
      // queda con el azul por omisión (#3388ff) y sin clase: nunca verde ni rojo.
      test.fail(
        true,
        'DEF-B1-01: el círculo de la sede queda azul por omisión en lugar de verde o rojo (circleStyles.ts / react-leaflet).',
      )
      test.setTimeout(120_000)
      const sc = new Scenario()
      try {
        await turnoDeHoy(sc, 'geo-color', 'empleado1', { radio: RADIO })
        await fijarConsentimiento('empleado1', true)
        await marcarCambiosVistos('empleado1')
        await simularPosicion(context, SEDE_COORDS, 10)
        await abrirFicharConLectura(page, 10)
        await expect(
          panel(page).getByRole('group', { name: /dentro de la zona\.$/ }),
        ).toBeVisible()
        expect(await colorDelCirculoDeLaSede(page)).toBe(
          await colorDeToken(page, 'bg-success'),
        )
        await simularPosicion(context, desplazar(SEDE_COORDS, 600), 10)
        await expect(
          panel(page).getByRole('group', { name: /fuera de la zona\.$/ }),
        ).toBeVisible()
        expect(await colorDelCirculoDeLaSede(page)).toBe(
          await colorDeToken(page, 'bg-danger'),
        )
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'EMP-05: un motivo escrito se descarta si la base calcula otro resultado (verde al fichar)',
    cubre('RB-E04', 'B-04', 'B-37'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoDeHoy(sc, 'geo-motivo', 'empleado1', {
          radio: RADIO,
        })
        await fijarConsentimiento('empleado1', true)
        await marcarCambiosVistos('empleado1')
        // Fuera de la zona al abrir; el motivo se escribe; la persona entra a la zona antes de
        // fichar: el panel pasa a verde, el campo desaparece y no se manda ningún motivo.
        await simularPosicion(context, desplazar(SEDE_COORDS, 600), 10)
        await abrirFicharConLectura(page, 10)
        await page
          .getByLabel('¿Por qué estás fuera de la zona? (opcional)')
          .fill('e2e: motivo que ya no corresponde')
        await simularPosicion(context, desplazar(SEDE_COORDS, 5), 5)
        await expect(page.getByTestId('geo-accuracy')).toHaveText(
          'Precisión: 5 m',
        )
        await expect(
          panel(page).getByRole('group', { name: /dentro de la zona\.$/ }),
        ).toBeVisible()
        await expect(
          page.getByLabel('¿Por qué estás fuera de la zona? (opcional)'),
        ).toHaveCount(0)
        await botonInicio(page).click()
        await expect(resultado(page)).toContainText('Validado')
        const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
        expect(r.geo_status).toBe('valid')
        expect(r.outside_reason).toBeNull()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'EMP-05: «Esperar mejor señal» cuenta hacia atrás, se corta al afinar y se manda la lectura nueva (B-06)',
    cubre('RB-E04', 'B-06', 'B-38'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoDeHoy(sc, 'geo-espera', 'empleado1', {
          radio: RADIO,
        })
        await fijarConsentimiento('empleado1', true)
        await marcarCambiosVistos('empleado1')
        await simularPosicion(context, SEDE_COORDS, 130)
        await abrirFicharConLectura(page, 130)
        await expect(
          page.getByText(
            'La señal todavía es poco precisa. Podés esperar hasta 30 segundos a que mejore, o registrar igual.',
          ),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Esperar mejor señal' }).click()
        await expect(
          page.getByText(/Esperando mejor señal… \d+ s/),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Esperar mejor señal' }),
        ).toHaveCount(0)

        await simularPosicion(context, SEDE_COORDS, 40)
        await expect(page.getByTestId('geo-accuracy')).toHaveText(
          'Precisión: 40 m',
        )
        await expect(page.getByText(/Esperando mejor señal/)).toHaveCount(0)
        await expect(botonInicio(page)).toBeVisible()
        await botonInicio(page).click()
        await expect(resultado(page)).toContainText('Validado')
        const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
        expect(r.geo_status).toBe('valid')
        expect(Number(r.accuracy_m)).toBe(40)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'EMP-05: se manda la MEJOR lectura aunque la última sea peor (B-38)',
    cubre('RB-E04', 'B-38'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoDeHoy(sc, 'geo-mejor', 'empleado1', {
          radio: RADIO,
        })
        await fijarConsentimiento('empleado1', true)
        await marcarCambiosVistos('empleado1')
        await simularPosicion(context, SEDE_COORDS, 30)
        await abrirFicharConLectura(page, 30)
        // Llega una lectura peor y más lejos: no pisa a la mejor.
        await simularPosicion(context, desplazar(SEDE_COORDS, 300), 300)
        await expect
          .poll(async () => page.getByTestId('geo-accuracy').textContent(), {
            message: 'la lectura peor no reemplaza a la mejor',
          })
          .toBe('Precisión: 30 m')
        await botonInicio(page).click()
        await expect(resultado(page)).toContainText('Validado')
        const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
        expect(Number(r.accuracy_m)).toBe(30)
        expect(r.geo_status).toBe('valid')
        expect(r.site_distance_m).toBe(0)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'EMP-05: si la espera de 30 s vence sin mejorar, avisa y «Fichar igual» sigue disponible (B-06)',
    cubre('RB-E04', 'B-06'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoDeHoy(sc, 'geo-vence', 'empleado1', {
          radio: RADIO,
        })
        await fijarConsentimiento('empleado1', true)
        await marcarCambiosVistos('empleado1')
        await simularPosicion(context, SEDE_COORDS, 130)
        await abrirFicharConLectura(page, 130)
        await page.getByRole('button', { name: 'Esperar mejor señal' }).click()
        await expect(
          page.getByText(/Esperando mejor señal… \d+ s/),
        ).toBeVisible()
        await expect(
          page.getByText('Terminó la espera. Podés registrar igual.'),
        ).toBeVisible({ timeout: 45_000 })
        await botonInicio(page, 'Fichar igual').click()
        await expect(resultado(page)).toContainText('Validado')
        const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
        expect(r.geo_status).toBe('valid')
        expect(Number(r.accuracy_m)).toBe(130)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'EMP-05 y EMP-10: sede sin coordenadas: sin mapa, aviso claro y gris «Sin validar (sede sin coordenadas)»',
    cubre('RB-E04', 'B-03', 'CB-20'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoDeHoy(sc, 'geo-sinsede', 'empleado1', {
          coords: null,
          radio: null,
        })
        await fijarConsentimiento('empleado1', true)
        await marcarCambiosVistos('empleado1')
        await simularPosicion(context, SEDE_COORDS, 20)

        await abrirFicharConLectura(page, 20)
        await expect(panel(page).getByRole('group')).toHaveCount(0)
        await expect(aviso(page)).toHaveText(
          'Esta sede todavía no tiene ubicación cargada. El registro se hace igual y queda sin validar.',
        )
        await botonInicio(page).click()
        await expect(resultado(page)).toContainText(
          'Sin validar (sede sin coordenadas)',
        )
        await expect(resultado(page)).toContainText(
          'La sede todavía no tiene ubicación cargada, así que no se pudo validar.',
        )
        const inicio = await fichajeGuardado(sc, t.asignacionId, 'check_in')
        expect(inicio.geo_status).toBe('unvalidated')
        expect(inicio.geo_unvalidated_reason).toBe('site_without_coords')
        expect(inicio.site_distance_m).toBeNull()

        await resultado(page)
          .getByRole('button', { name: 'Ir a mi servicio' })
          .click()
        await page.goto(`/app/en-curso/${t.asignacionId}/finalizar`)
        await expect(aviso(page)).toContainText('todavía no tiene ubicación')
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await expect(resultado(page)).toContainText(
          'Sin validar (sede sin coordenadas)',
        )
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('sin permiso de ubicación del navegador', () => {
  test.use({ permissions: [] })

  test(
    'EMP-05: el navegador niega la ubicación: aviso, sin mapa y gris «Sin validar (sin ubicación)»; se ficha igual',
    cubre('RB-E04', 'B-03', 'B-05', 'CB-21', 'P-091'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoDeHoy(sc, 'geo-sinpermiso', 'empleado1', {
          radio: RADIO,
        })
        await fijarConsentimiento('empleado1', true)
        await marcarCambiosVistos('empleado1')

        await page.goto('/app/fichar')
        await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
        await expect(aviso(page)).toHaveText(
          'No tenemos permiso para ver tu ubicación. Podés registrar igual: queda sin validar.',
        )
        await expect(page.getByTestId('geo-accuracy')).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: 'Esperar mejor señal' }),
        ).toHaveCount(0)
        await botonInicio(page).click()
        await expect(resultado(page)).toContainText(
          'Sin validar (sin ubicación)',
        )
        await expect(resultado(page)).toContainText(
          'No tuvimos tu ubicación, así que quedó sin validar. El registro se hizo igual.',
        )
        const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
        expect(r.latitude).toBeNull()
        expect(r.longitude).toBeNull()
        expect(r.accuracy_m).toBeNull()
        expect(r.geo_status).toBe('unvalidated')
        expect(r.geo_unvalidated_reason).toBe('no_location')
        expect(r.site_distance_m).toBeNull()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('sin consentimiento de la app, con el permiso del navegador concedido', () => {
  test(
    'EMP-06 y EMP-05: «Continuar sin ubicación» no pide ni guarda la posición aunque el navegador la tenga: gris «Sin validar (sin ubicación)»',
    cubre('RB-E04', 'B-03', 'B-05', 'B-38', 'CB-21', 'P-091'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoDeHoy(sc, 'geo-sinconsent', 'empleado1', {
          radio: RADIO,
        })
        await fijarConsentimiento('empleado1', false)
        await marcarCambiosVistos('empleado1')
        await simularPosicion(context, SEDE_COORDS, 10)

        await page.goto('/app/fichar')
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(page).toHaveURL(/\/app\/fichar\/consentimiento/)
        await page
          .getByRole('button', { name: 'Continuar sin ubicación' })
          .click()
        await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
        await expect(aviso(page)).toHaveText(
          'No vamos a usar tu ubicación. El registro se hace igual y queda sin validar.',
        )
        await expect(page.getByTestId('geo-accuracy')).toHaveCount(0)
        await expect(panel(page).getByRole('group')).toHaveCount(0)
        await botonInicio(page).click()
        await expect(resultado(page)).toContainText(
          'Sin validar (sin ubicación)',
        )
        const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
        expect(
          r.latitude,
          'sin consentimiento no se guarda la posición',
        ).toBeNull()
        expect(r.geo_status).toBe('unvalidated')
        expect(r.geo_unvalidated_reason).toBe('no_location')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('re-consentimiento cuando la empresa cambia el texto (B-22)', () => {
  test(
    'EMP-05: con el texto cambiado después de mi consentimiento, vuelve a pedirlo antes de fichar y después no insiste',
    cubre('RB-E04', 'B-22', 'P-108'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      let reponer: (() => Promise<void>) | null = null
      try {
        const t = await turnoDeHoy(sc, 'geo-reconsent', 'empleado1', {
          radio: RADIO,
        })
        await marcarCambiosVistos('empleado1')
        reponer = await consentimientoVencido('empleado1')
        await simularPosicion(context, SEDE_COORDS, 10)

        await page.goto('/app/fichar')
        await expect(
          page.getByText(
            'Actualizamos el texto del consentimiento de ubicación. Antes de registrar el inicio, te pedimos que lo leas de nuevo.',
          ),
        ).toBeVisible()
        await expect(page.getByText(TEXTO.horaReferencia)).toHaveCount(0)
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(page.getByText('Tu ubicación al fichar')).toBeVisible()
        await page.getByRole('button', { name: 'Aceptar y continuar' }).click()
        await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()

        await test.step('el consentimiento nuevo lo fecha el servidor y queda posterior al cambio de texto', async () => {
          const { data: perfil } = await sc.db
            .from('profiles')
            .select('location_consent_at')
            .eq('id', readId('empleado1'))
            .single()
          const { data: empresa } = await sc.db
            .from('company_settings')
            .select('location_consent_updated_at')
            .eq('id', 1)
            .single()
          expect(
            Date.parse(perfil!.location_consent_at!),
            'consentimiento nuevo posterior al cambio de texto',
          ).toBeGreaterThan(Date.parse(empresa!.location_consent_updated_at!))
          expect(
            Date.now() - Date.parse(perfil!.location_consent_at!),
            'fecha del servidor, de ahora',
          ).toBeLessThan(120_000)
        })

        await expect(page.getByTestId('geo-accuracy')).toHaveText(
          'Precisión: 10 m',
        )
        await botonInicio(page).click()
        await expect(resultado(page)).toContainText('Validado')
        const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
        expect(r.geo_status).toBe('valid')

        await test.step('con el consentimiento al día, EMP-10 no lo vuelve a pedir', async () => {
          await page.goto(`/app/en-curso/${t.asignacionId}/finalizar`)
          await expect(page).not.toHaveURL(/consentimiento/)
          await expect(page.getByTestId('geo-accuracy')).toBeVisible()
        })
      } finally {
        await reponer?.()
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'EMP-10: si el texto cambia con el servicio en curso, el fin vuelve a pedirlo y regresa a Finalizar',
    cubre('RB-E04', 'RB-E06', 'B-22'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      let reponer: (() => Promise<void>) | null = null
      try {
        const t = await turnoDeHoy(sc, 'geo-reconsent-fin', 'empleado1', {
          radio: RADIO,
        })
        await fijarConsentimiento('empleado1', true)
        await marcarCambiosVistos('empleado1')
        await simularPosicion(context, SEDE_COORDS, 10)
        await abrirFicharConLectura(page, 10)
        await botonInicio(page).click()
        await expect(resultado(page)).toContainText('Validado')

        reponer = await consentimientoVencido('empleado1')
        await page.goto(`/app/en-curso/${t.asignacionId}/finalizar`)
        await expect(page).toHaveURL(/\/app\/fichar\/consentimiento\?volver=/)
        await expect(page.getByText('Tu ubicación al fichar')).toBeVisible()
        await page.getByRole('button', { name: 'Aceptar y continuar' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/app/en-curso/${t.asignacionId}/finalizar$`),
        )
        await expect(page.getByTestId('geo-accuracy')).toHaveText(
          'Precisión: 10 m',
        )
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await expect(resultado(page)).toContainText('Fin registrado')
        const r = await fichajeGuardado(sc, t.asignacionId, 'check_out')
        expect(r.geo_status).toBe('valid')
      } finally {
        await reponer?.()
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'EMP-06: quien rechaza el texto nuevo queda sin consentimiento y ficha gris, sin que se le pida la ubicación',
    cubre('RB-E04', 'B-05', 'B-22'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      let reponer: (() => Promise<void>) | null = null
      try {
        const t = await turnoDeHoy(sc, 'geo-reconsent-no', 'empleado1', {
          radio: RADIO,
        })
        await marcarCambiosVistos('empleado1')
        reponer = await consentimientoVencido('empleado1')
        await simularPosicion(context, SEDE_COORDS, 10)

        await page.goto('/app/fichar')
        await page.getByRole('button', { name: 'Continuar' }).click()
        await page
          .getByRole('button', { name: 'Continuar sin ubicación' })
          .click()
        await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
        await expect(page.getByTestId('geo-accuracy')).toHaveCount(0)
        const { data: perfil } = await sc.db
          .from('profiles')
          .select('location_consent_at')
          .eq('id', readId('empleado1'))
          .single()
        expect(perfil?.location_consent_at).toBeNull()
        await botonInicio(page).click()
        await expect(resultado(page)).toContainText(
          'Sin validar (sin ubicación)',
        )
        const r = await fichajeGuardado(sc, t.asignacionId, 'check_in')
        expect(r.latitude).toBeNull()
      } finally {
        await reponer?.()
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
