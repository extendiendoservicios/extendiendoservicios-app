import { expect, test, type Page } from '@playwright/test'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { fijarConsentimiento, FRANJAS_MOVIL, TEXTO } from '../fixtures/movil.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import {
  consentimientoVencido,
  desplazar,
  distanciaM,
  fichajeSupervisionGuardado,
  redondear,
  SEDE_COORDS,
  sedeGeo,
  simularPosicion,
  type OpcionesSede,
} from './helpers/geo.ts'

// P22.5 · SUP-04 con validación por ubicación (B-07): el supervisor ficha el inicio y el fin de la
// supervisión en el celular (390 px) y se valida contra la sede supervisada, con la posición
// simulada de Playwright. Misma regla, mismo panel y misma pantalla de resultado que el empleado
// (B-03, B-04, B-06, B-18, B-22, B-23). Cuenta de este archivo: supervisor1.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('supervisor1') })

const RADIO = 100
const aviso = (page: Page) => page.getByTestId('geo-message')
const panel = (page: Page) => page.getByTestId('geo-panel')
const resultado = (page: Page) => page.getByTestId('attendance-result')

/** Supervisión de hoy (todo el día) en una sede con radio propio. */
async function supervisionDeHoy(
  sc: Scenario,
  slug: string,
  opciones: OpcionesSede = {},
) {
  const cliente = await sc.client(slug)
  const sede = await sedeGeo(sc, cliente, slug, { radio: RADIO, ...opciones })
  const turnoId = await sc.shift(
    cliente.id,
    sede.id,
    sc.today,
    FRANJAS_MOVIL.diaCompleto,
  )
  const supervisionId = await sc.assignSupervision(turnoId, 'supervisor1')
  return { cliente, sede, turnoId, supervisionId }
}

async function abrirRegistro(
  page: Page,
  supervisionId: string,
  precision?: number,
) {
  await page.goto(`/sup/supervisiones/${supervisionId}/registro`)
  await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
  if (precision !== undefined) {
    await expect(page.getByTestId('geo-accuracy')).toHaveText(
      `Precisión: ${precision} m`,
    )
  }
}

interface CasoSup {
  titulo: string
  norte: number
  precision: number
  estado: 'valid' | 'outside' | 'unvalidated'
  motivo: 'low_accuracy' | null
  ofreceEspera: boolean
  trazabilidad: Parameters<typeof cubre>
}

const CASOS: CasoSup[] = [
  {
    titulo: 'dentro del radio: verde y «Validado»',
    norte: 0,
    precision: 10,
    estado: 'valid',
    motivo: null,
    ofreceEspera: false,
    trazabilidad: ['RB-S01', 'B-03', 'B-06', 'B-07', 'B-37'],
  },
  {
    titulo:
      'precisión mala (200 m) con los círculos tocándose: gris «Sin validar (precisión insuficiente)»',
    norte: 50,
    precision: 200,
    estado: 'unvalidated',
    motivo: 'low_accuracy',
    ofreceEspera: true,
    trazabilidad: ['RB-S01', 'B-03', 'B-07', 'B-23'],
  },
  {
    titulo:
      'precisión mala (200 m) pero a 900 m de la sede: rojo «Fuera de zona»',
    norte: 900,
    precision: 200,
    estado: 'outside',
    motivo: null,
    ofreceEspera: true,
    trazabilidad: ['RB-S01', 'B-06', 'B-07', 'B-23'],
  },
]

test.describe('con la ubicación concedida y el consentimiento dado', () => {
  for (const caso of CASOS) {
    test(
      `SUP-04: ${caso.titulo}`,
      cubre(...caso.trazabilidad),
      async ({ page, context }) => {
        test.setTimeout(180_000)
        const sc = new Scenario()
        try {
          const s = await supervisionDeHoy(sc, 'geo-sup-regla')
          await fijarConsentimiento('supervisor1', true)
          const punto = desplazar(SEDE_COORDS, caso.norte)
          await simularPosicion(context, punto, caso.precision)
          await abrirRegistro(page, s.supervisionId, caso.precision)

          await expect(
            panel(page).getByRole('group', {
              name: new RegExp(
                caso.estado === 'valid'
                  ? 'dentro de la zona\\.$'
                  : caso.estado === 'outside'
                    ? 'fuera de la zona\\.$'
                    : 'sin validar\\.$',
              ),
            }),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: 'Esperar mejor señal' }),
          ).toHaveCount(caso.ofreceEspera ? 1 : 0)
          await expectNoHorizontalScroll(page)

          const boton = page.getByRole('button', {
            name: caso.ofreceEspera ? 'Fichar igual' : 'Registrar inicio',
          })
          await boton.click()
          await expect(resultado(page)).toContainText('Inicio registrado')
          const distancia = redondear(distanciaM(SEDE_COORDS, punto))
          if (caso.estado === 'valid') {
            await expect(resultado(page)).toContainText('Validado')
          } else if (caso.estado === 'outside') {
            await expect(resultado(page)).toContainText(
              `Fuera de zona · ${distancia} m`,
            )
          } else {
            await expect(resultado(page)).toContainText(
              'Sin validar (precisión insuficiente)',
            )
          }

          const r = await fichajeSupervisionGuardado(
            sc,
            s.supervisionId,
            'check_in',
          )
          expect(r.geo_status).toBe(caso.estado)
          expect(r.geo_unvalidated_reason).toBe(caso.motivo)
          expect(r.site_distance_m).toBe(distancia)
          expect(r.geofence_radius_m).toBe(RADIO)
          expect(Number(r.accuracy_m)).toBe(caso.precision)
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  }

  test(
    'SUP-04: inicio y fin; fuera de la zona no bloquea y guarda el motivo opcional; el fin dentro de la zona vuelve a validar',
    cubre('RB-S01', 'B-03', 'B-04', 'B-07', 'B-18'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const s = await supervisionDeHoy(sc, 'geo-sup-fuera')
        await fijarConsentimiento('supervisor1', true)
        const afuera = desplazar(SEDE_COORDS, 450)
        await simularPosicion(context, afuera, 10)

        await test.step('inicio fuera de la zona: aparece el motivo y se guarda', async () => {
          await abrirRegistro(page, s.supervisionId, 10)
          await expect(aviso(page)).toHaveText(
            'Estás fuera de la zona del servicio.',
          )
          await page
            .getByLabel('¿Por qué estás fuera de la zona? (opcional)')
            .fill('e2e: el GPS no anda en el subsuelo')
          await page.getByRole('button', { name: 'Registrar inicio' }).click()
          await expect(resultado(page)).toContainText(
            `Fuera de zona · ${redondear(distanciaM(SEDE_COORDS, afuera))} m`,
          )
          const r = await fichajeSupervisionGuardado(
            sc,
            s.supervisionId,
            'check_in',
          )
          expect(r.geo_status).toBe('outside')
          expect(r.outside_reason).toBe('e2e: el GPS no anda en el subsuelo')
        })

        await test.step('fin dentro de la zona: verde, sin motivo', async () => {
          await resultado(page)
            .getByRole('button', { name: 'Seguir con la supervisión' })
            .click()
          await expect(
            page.getByText(/Supervisión iniciada a las/),
          ).toBeVisible()
          await simularPosicion(context, SEDE_COORDS, 8)
          await expect(page.getByTestId('geo-accuracy')).toHaveText(
            'Precisión: 8 m',
          )
          await expect(
            page.getByLabel('¿Por qué estás fuera de la zona? (opcional)'),
          ).toHaveCount(0)
          await page.getByRole('button', { name: 'Registrar fin' }).click()
          await expect(resultado(page)).toContainText('Fin registrado')
          await expect(resultado(page)).toContainText('Validado')
          await resultado(page)
            .getByRole('button', { name: 'Continuar' })
            .click()
          await expect(page).toHaveURL(
            new RegExp(`/sup/supervisiones/${s.supervisionId}$`),
          )
          const fin = await fichajeSupervisionGuardado(
            sc,
            s.supervisionId,
            'check_out',
          )
          expect(fin.geo_status).toBe('valid')
          expect(fin.outside_reason).toBeNull()
        })

        await test.step('SUP-03: el detalle muestra el estado de cada fichaje, sin coordenadas', async () => {
          const marcas = page.getByTestId('attendance-mark')
          await expect(marcas).toHaveCount(2)
          await expect(marcas.first()).toContainText('Fuera de zona')
          await expect(marcas.last()).toContainText('Validado')
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
    'SUP-04: sede sin coordenadas: sin mapa, aviso y gris «Sin validar (sede sin coordenadas)»',
    cubre('RB-S01', 'B-03', 'B-07', 'CB-20'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const s = await supervisionDeHoy(sc, 'geo-sup-sinsede', {
          coords: null,
          radio: null,
        })
        await fijarConsentimiento('supervisor1', true)
        await simularPosicion(context, SEDE_COORDS, 20)
        await abrirRegistro(page, s.supervisionId, 20)
        await expect(panel(page).getByRole('group')).toHaveCount(0)
        await expect(aviso(page)).toContainText('todavía no tiene ubicación')
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(resultado(page)).toContainText(
          'Sin validar (sede sin coordenadas)',
        )
        const r = await fichajeSupervisionGuardado(
          sc,
          s.supervisionId,
          'check_in',
        )
        expect(r.geo_status).toBe('unvalidated')
        expect(r.geo_unvalidated_reason).toBe('site_without_coords')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'SUP-04: «Esperar mejor señal» se corta al afinar y se manda la lectura nueva',
    cubre('RB-S01', 'B-06', 'B-07', 'B-38'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const s = await supervisionDeHoy(sc, 'geo-sup-espera')
        await fijarConsentimiento('supervisor1', true)
        await simularPosicion(context, SEDE_COORDS, 130)
        await abrirRegistro(page, s.supervisionId, 130)
        await page.getByRole('button', { name: 'Esperar mejor señal' }).click()
        await expect(
          page.getByText(/Esperando mejor señal… \d+ s/),
        ).toBeVisible()
        await simularPosicion(context, SEDE_COORDS, 35)
        await expect(page.getByTestId('geo-accuracy')).toHaveText(
          'Precisión: 35 m',
        )
        await expect(page.getByText(/Esperando mejor señal/)).toHaveCount(0)
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(resultado(page)).toContainText('Validado')
        const r = await fichajeSupervisionGuardado(
          sc,
          s.supervisionId,
          'check_in',
        )
        expect(Number(r.accuracy_m)).toBe(35)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('sin permiso de ubicación del navegador', () => {
  test.use({ permissions: [] })

  test(
    'SUP-04: el navegador niega la ubicación: se ficha igual y queda gris «Sin validar (sin ubicación)»',
    cubre('RB-S01', 'B-03', 'B-05', 'B-07', 'CB-21', 'P-091'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const s = await supervisionDeHoy(sc, 'geo-sup-sinpermiso')
        await fijarConsentimiento('supervisor1', true)
        await abrirRegistro(page, s.supervisionId)
        await expect(aviso(page)).toHaveText(
          'No tenemos permiso para ver tu ubicación. Podés registrar igual: queda sin validar.',
        )
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(resultado(page)).toContainText(
          'Sin validar (sin ubicación)',
        )
        const r = await fichajeSupervisionGuardado(
          sc,
          s.supervisionId,
          'check_in',
        )
        expect(r.latitude).toBeNull()
        expect(r.geo_status).toBe('unvalidated')
        expect(r.geo_unvalidated_reason).toBe('no_location')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('sin consentimiento de la app', () => {
  test(
    'SUP-04: «Continuar sin ubicación» ficha gris «Sin validar (sin ubicación)» aunque el navegador tenga la posición',
    cubre('RB-S01', 'B-05', 'B-07', 'B-38', 'CB-21', 'P-091'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const s = await supervisionDeHoy(sc, 'geo-sup-sinconsent')
        await fijarConsentimiento('supervisor1', false)
        await simularPosicion(context, SEDE_COORDS, 10)
        await page.goto(`/sup/supervisiones/${s.supervisionId}/registro`)
        await expect(page.getByText('Tu ubicación al fichar')).toBeVisible()
        await page
          .getByRole('button', { name: 'Continuar sin ubicación' })
          .click()
        await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
        await expect(page.getByTestId('geo-accuracy')).toHaveCount(0)
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(resultado(page)).toContainText(
          'Sin validar (sin ubicación)',
        )
        const r = await fichajeSupervisionGuardado(
          sc,
          s.supervisionId,
          'check_in',
        )
        expect(r.latitude).toBeNull()
        expect(r.geo_unvalidated_reason).toBe('no_location')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('re-consentimiento cuando la empresa cambia el texto (B-22)', () => {
  test(
    'SUP-04: con el texto cambiado después de mi consentimiento, vuelve a pedirlo antes del inicio y también antes del fin',
    cubre('RB-S01', 'B-07', 'B-22', 'P-108'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      let reponer: (() => Promise<void>) | null = null
      try {
        const s = await supervisionDeHoy(sc, 'geo-sup-reconsent')
        reponer = await consentimientoVencido('supervisor1')
        await simularPosicion(context, SEDE_COORDS, 10)

        await test.step('antes del inicio: muestra de nuevo el texto y, al aceptar, ficha con ubicación', async () => {
          await page.goto(`/sup/supervisiones/${s.supervisionId}/registro`)
          await expect(page.getByText('Tu ubicación al fichar')).toBeVisible()
          await expect(page.getByTestId('geo-panel')).toHaveCount(0)
          await page
            .getByRole('button', { name: 'Aceptar y continuar' })
            .click()
          await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
          const { data: perfil } = await sc.db
            .from('profiles')
            .select('location_consent_at')
            .eq('id', readId('supervisor1'))
            .single()
          const { data: empresa } = await sc.db
            .from('company_settings')
            .select('location_consent_updated_at')
            .eq('id', 1)
            .single()
          expect(Date.parse(perfil!.location_consent_at!)).toBeGreaterThan(
            Date.parse(empresa!.location_consent_updated_at!),
          )
          await expect(page.getByTestId('geo-accuracy')).toHaveText(
            'Precisión: 10 m',
          )
          await page.getByRole('button', { name: 'Registrar inicio' }).click()
          await expect(resultado(page)).toContainText('Validado')
          await resultado(page)
            .getByRole('button', { name: 'Seguir con la supervisión' })
            .click()
        })

        await test.step('antes del fin: si el texto vuelve a cambiar, lo pide otra vez', async () => {
          await reponer?.()
          reponer = await consentimientoVencido('supervisor1')
          await page.goto(`/sup/supervisiones/${s.supervisionId}/registro`)
          await expect(page.getByText('Tu ubicación al fichar')).toBeVisible()
          await page
            .getByRole('button', { name: 'Aceptar y continuar' })
            .click()
          await expect(
            page.getByText(/Supervisión iniciada a las/),
          ).toBeVisible()
          await expect(page.getByTestId('geo-accuracy')).toHaveText(
            'Precisión: 10 m',
          )
          await page.getByRole('button', { name: 'Registrar fin' }).click()
          await expect(resultado(page)).toContainText('Fin registrado')
          const fin = await fichajeSupervisionGuardado(
            sc,
            s.supervisionId,
            'check_out',
          )
          expect(fin.geo_status).toBe('valid')
        })
      } finally {
        await reponer?.()
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
