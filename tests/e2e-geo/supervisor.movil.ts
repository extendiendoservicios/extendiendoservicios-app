import { expect, test, type Page } from '@playwright/test'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { fijarConsentimiento, FRANJAS_MOVIL } from '../fixtures/movil.ts'
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

// P22.5 · «Supervisar» y «Cerrar» con validación por ubicación (B-07), reescrito en P24.5: el
// coordinador toma el turno en el celular (390 px) y la supervisión se valida contra la sede
// supervisada con la posición simulada de Playwright (SUP-03 registra el inicio, SUP-06 el fin).
// Misma regla, mismo panel y misma pantalla de resultado que el empleado (B-03, B-04, B-06, B-18,
// B-22, B-23). Cuenta de este archivo: supervisor1.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('supervisor1') })

const RADIO = 100

const aviso = (page: Page) => page.getByTestId('geo-message')
const panel = (page: Page) => page.getByTestId('geo-panel')
const resultado = (page: Page) => page.getByTestId('attendance-result')

/** Turno de hoy (todo el día) en una sede con radio propio y la jornada del coordinador en marcha. */
async function turnoParaSupervisar(
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
  await sc.asegurarJornada('supervisor1')
  return { cliente, sede, turnoId }
}

/** La supervisión que `supervisor1` tiene de ese turno (después de tomarla). */
async function supervisionDe(sc: Scenario, turnoId: string): Promise<string> {
  const { data, error } = await sc.db
    .from('supervisions')
    .select('id')
    .eq('shift_id', turnoId)
    .eq('supervisor_id', readId('supervisor1'))
    .single()
  expect(error?.message).toBeUndefined()
  return data!.id
}

/** Abre SUP-03 y espera el panel de ubicación con la precisión simulada. */
async function abrirTurno(page: Page, turnoId: string, precision?: number) {
  await page.goto(`/sup/turnos/${turnoId}`)
  await expect(panel(page)).toBeVisible()
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
    trazabilidad: ['RB-S01', 'B-03', 'B-06', 'B-07', 'B-37', 'CJ-20'],
  },
  {
    titulo:
      'precisión mala (200 m) con los círculos tocándose: gris «Sin validar (precisión insuficiente)»',
    norte: 50,
    precision: 200,
    estado: 'unvalidated',
    motivo: 'low_accuracy',
    ofreceEspera: true,
    trazabilidad: ['RB-S01', 'B-03', 'B-07', 'B-23', 'CJ-20'],
  },
  {
    titulo:
      'precisión mala (200 m) pero a 900 m de la sede: rojo «Fuera de zona»',
    norte: 900,
    precision: 200,
    estado: 'outside',
    motivo: null,
    ofreceEspera: true,
    trazabilidad: ['RB-S01', 'B-06', 'B-07', 'B-23', 'CJ-20'],
  },
]

test.describe('con la ubicación concedida y el consentimiento dado', () => {
  for (const caso of CASOS) {
    test(
      `SUP-03: ${caso.titulo}`,
      cubre(...caso.trazabilidad),
      async ({ page, context }) => {
        test.setTimeout(180_000)
        const sc = new Scenario()
        try {
          const s = await turnoParaSupervisar(sc, 'geo-sup-regla')
          await fijarConsentimiento('supervisor1', true)
          const punto = desplazar(SEDE_COORDS, caso.norte)
          await simularPosicion(context, punto, caso.precision)
          await abrirTurno(page, s.turnoId, caso.precision)

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
            name: caso.ofreceEspera ? 'Supervisar igual' : 'Supervisar',
            exact: true,
          })
          await boton.click()
          await expect(resultado(page)).toContainText('Supervisión iniciada')
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

          const supervisionId = await supervisionDe(sc, s.turnoId)
          const r = await fichajeSupervisionGuardado(
            sc,
            supervisionId,
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
    'SUP-03 y SUP-06: inicio y fin; fuera de la zona no bloquea y guarda el motivo opcional; el fin dentro de la zona vuelve a validar',
    cubre('RB-S01', 'B-03', 'B-04', 'B-07', 'B-18', 'CJ-20'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const s = await turnoParaSupervisar(sc, 'geo-sup-fuera')
        await fijarConsentimiento('supervisor1', true)
        const afuera = desplazar(SEDE_COORDS, 450)
        await simularPosicion(context, afuera, 10)
        let supervisionId = ''

        await test.step('inicio fuera de la zona: aparece el motivo y se guarda', async () => {
          await abrirTurno(page, s.turnoId, 10)
          await expect(aviso(page)).toHaveText(
            'Estás fuera de la zona del servicio.',
          )
          await page
            .getByLabel('¿Por qué estás fuera de la zona? (opcional)')
            .fill('e2e: el GPS no anda en el subsuelo')
          await page
            .getByRole('button', { name: 'Supervisar', exact: true })
            .click()
          await expect(resultado(page)).toContainText(
            `Fuera de zona · ${redondear(distanciaM(SEDE_COORDS, afuera))} m`,
          )
          supervisionId = await supervisionDe(sc, s.turnoId)
          const r = await fichajeSupervisionGuardado(
            sc,
            supervisionId,
            'check_in',
          )
          expect(r.geo_status).toBe('outside')
          expect(r.outside_reason).toBe('e2e: el GPS no anda en el subsuelo')
        })

        await test.step('fin dentro de la zona: verde, sin motivo', async () => {
          await resultado(page)
            .getByRole('button', { name: 'Seguir con la supervisión' })
            .click()
          await expect(page.getByText(/Iniciada a las/)).toBeVisible()
          await simularPosicion(context, SEDE_COORDS, 8)
          await page.goto(`/sup/supervisiones/${supervisionId}/cerrar`)
          await expect(page.getByTestId('geo-accuracy')).toHaveText(
            'Precisión: 8 m',
          )
          await expect(
            page.getByLabel('¿Por qué estás fuera de la zona? (opcional)'),
          ).toHaveCount(0)
          await page.getByRole('button', { name: 'Cerrar supervisión' }).click()
          await expect(page).toHaveURL(/\/sup$/)
          const fin = await fichajeSupervisionGuardado(
            sc,
            supervisionId,
            'check_out',
          )
          expect(fin.geo_status).toBe('valid')
          expect(fin.outside_reason).toBeNull()
        })

        await test.step('SUP-04: el detalle muestra el estado de cada fichaje, sin coordenadas', async () => {
          await page.goto(`/sup/supervisiones/${supervisionId}`)
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
    'SUP-03: sede sin coordenadas: sin mapa, aviso y gris «Sin validar (sede sin coordenadas)»',
    cubre('RB-S01', 'B-03', 'B-07', 'CB-20', 'CJ-20'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const s = await turnoParaSupervisar(sc, 'geo-sup-sinsede', {
          coords: null,
          radio: null,
        })
        await fijarConsentimiento('supervisor1', true)
        await simularPosicion(context, SEDE_COORDS, 20)
        await abrirTurno(page, s.turnoId, 20)
        await expect(panel(page).getByRole('group')).toHaveCount(0)
        await expect(aviso(page)).toContainText('todavía no tiene ubicación')
        await page
          .getByRole('button', { name: 'Supervisar', exact: true })
          .click()
        await expect(resultado(page)).toContainText(
          'Sin validar (sede sin coordenadas)',
        )
        const r = await fichajeSupervisionGuardado(
          sc,
          await supervisionDe(sc, s.turnoId),
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
    'SUP-03: «Esperar mejor señal» se corta al afinar y se manda la lectura nueva',
    cubre('RB-S01', 'B-06', 'B-07', 'B-38', 'CJ-20'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const s = await turnoParaSupervisar(sc, 'geo-sup-espera')
        await fijarConsentimiento('supervisor1', true)
        // 200 m es «mala» con el umbral por omisión que usa SUP-03 (no recibe el de la empresa).
        await simularPosicion(context, SEDE_COORDS, 200)
        await abrirTurno(page, s.turnoId, 200)
        await page.getByRole('button', { name: 'Esperar mejor señal' }).click()
        await expect(
          page.getByText(/Esperando mejor señal… \d+ s/),
        ).toBeVisible()
        await simularPosicion(context, SEDE_COORDS, 35)
        await expect(page.getByTestId('geo-accuracy')).toHaveText(
          'Precisión: 35 m',
        )
        await expect(page.getByText(/Esperando mejor señal/)).toHaveCount(0)
        await page
          .getByRole('button', { name: 'Supervisar', exact: true })
          .click()
        await expect(resultado(page)).toContainText('Validado')
        const r = await fichajeSupervisionGuardado(
          sc,
          await supervisionDe(sc, s.turnoId),
          'check_in',
        )
        expect(Number(r.accuracy_m)).toBe(35)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('radio propio de la sede', () => {
  test(
    'SUP-03: la sede con radio propio de 300 m: a 200 m el panel dice «dentro de la zona», igual que la base',
    cubre('RB-S01', 'B-07', 'B-08', 'CJ-20'),
    async ({ page, context }) => {
      // DEFECTO (menor, P24.2 pregunta 1): `v_supervisor_today` no trae el radio propio de la sede ni
      // la precisión máxima de la empresa; SUP-03 usa el radio general y el panel dice «fuera de la
      // zona» mientras la base, con el radio de la sede, valida «dentro». Se saca el `fail` cuando
      // la vista los traiga.
      test.fail(
        true,
        'Defecto: el panel de SUP-03 ignora el radio propio de la sede (v_supervisor_today no lo trae).',
      )
      test.info().annotations.push({
        type: 'defecto',
        description:
          'SUP-03 no usa el radio propio de la sede para el veredicto del panel; la base sí.',
      })
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const s = await turnoParaSupervisar(sc, 'geo-sup-radio', {
          radio: 300,
        })
        await fijarConsentimiento('supervisor1', true)
        const punto = desplazar(SEDE_COORDS, 200)
        await simularPosicion(context, punto, 10)
        await abrirTurno(page, s.turnoId, 10)
        await expect(
          panel(page).getByRole('group', { name: /dentro de la zona\.$/ }),
        ).toBeVisible()
        await page
          .getByRole('button', { name: 'Supervisar', exact: true })
          .click()
        await expect(resultado(page)).toContainText('Validado')
        const r = await fichajeSupervisionGuardado(
          sc,
          await supervisionDe(sc, s.turnoId),
          'check_in',
        )
        expect(r.geo_status).toBe('valid')
        expect(r.geofence_radius_m).toBe(300)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('sin permiso de ubicación del navegador', () => {
  test.use({ permissions: [] })

  test(
    'SUP-03: el navegador niega la ubicación: se supervisa igual y queda gris «Sin validar (sin ubicación)»',
    cubre('RB-S01', 'B-03', 'B-05', 'B-07', 'CB-21', 'P-091', 'CJ-21'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const s = await turnoParaSupervisar(sc, 'geo-sup-sinpermiso')
        await fijarConsentimiento('supervisor1', true)
        await abrirTurno(page, s.turnoId)
        await expect(aviso(page)).toHaveText(
          'No tenemos permiso para ver tu ubicación. Podés registrar igual: queda sin validar.',
        )
        await page
          .getByRole('button', { name: 'Supervisar', exact: true })
          .click()
        await expect(resultado(page)).toContainText(
          'Sin validar (sin ubicación)',
        )
        const r = await fichajeSupervisionGuardado(
          sc,
          await supervisionDe(sc, s.turnoId),
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
    'SUP-03: «Continuar sin ubicación» registra gris «Sin validar (sin ubicación)» aunque el navegador tenga la posición',
    cubre('RB-S01', 'B-05', 'B-07', 'B-38', 'CB-21', 'P-091', 'CJ-21'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const s = await turnoParaSupervisar(sc, 'geo-sup-sinconsent')
        await fijarConsentimiento('supervisor1', false)
        await simularPosicion(context, SEDE_COORDS, 10)
        await page.goto(`/sup/turnos/${s.turnoId}`)
        await page
          .getByRole('button', { name: 'Supervisar', exact: true })
          .click()
        await expect(
          page.getByRole('heading', {
            name: 'Tu ubicación al fichar',
            level: 1,
          }),
        ).toBeVisible()
        await page
          .getByRole('button', { name: 'Continuar sin ubicación' })
          .click()
        await expect(page.getByTestId('geo-accuracy')).toHaveCount(0)
        await page
          .getByRole('button', { name: 'Supervisar', exact: true })
          .click()
        await expect(resultado(page)).toContainText(
          'Sin validar (sin ubicación)',
        )
        const r = await fichajeSupervisionGuardado(
          sc,
          await supervisionDe(sc, s.turnoId),
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
    'SUP-03 y SUP-06: con el texto cambiado después de mi consentimiento, vuelve a pedirlo antes del inicio y también antes del fin',
    cubre('RB-S01', 'B-07', 'B-22', 'P-108', 'CJ-21'),
    async ({ page, context }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      let reponer: (() => Promise<void>) | null = null
      try {
        const s = await turnoParaSupervisar(sc, 'geo-sup-reconsent')
        reponer = await consentimientoVencido('supervisor1')
        await simularPosicion(context, SEDE_COORDS, 10)

        await test.step('antes del inicio: muestra de nuevo el texto y, al aceptar, supervisa con ubicación', async () => {
          await page.goto(`/sup/turnos/${s.turnoId}`)
          await expect(page.getByTestId('geo-panel')).toHaveCount(0)
          await page
            .getByRole('button', { name: 'Supervisar', exact: true })
            .click()
          await expect(
            page.getByRole('heading', {
              name: 'Tu ubicación al fichar',
              level: 1,
            }),
          ).toBeVisible()
          await page
            .getByRole('button', { name: 'Aceptar y continuar' })
            .click()
          // El panel aparece recién cuando el consentimiento nuevo quedó guardado.
          await expect(page.getByTestId('geo-accuracy')).toHaveText(
            'Precisión: 10 m',
          )
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
          await page
            .getByRole('button', { name: 'Supervisar', exact: true })
            .click()
          await expect(resultado(page)).toContainText('Validado')
          await resultado(page)
            .getByRole('button', { name: 'Seguir con la supervisión' })
            .click()
        })

        await test.step('antes del fin: si el texto vuelve a cambiar, lo pide otra vez', async () => {
          await reponer?.()
          reponer = await consentimientoVencido('supervisor1')
          const supervisionId = await supervisionDe(sc, s.turnoId)
          await page.goto(`/sup/supervisiones/${supervisionId}/cerrar`)
          await page.getByRole('button', { name: 'Cerrar supervisión' }).click()
          await expect(
            page.getByRole('heading', {
              name: 'Tu ubicación al fichar',
              level: 1,
            }),
          ).toBeVisible()
          await page
            .getByRole('button', { name: 'Aceptar y continuar' })
            .click()
          await expect(page.getByTestId('geo-accuracy')).toHaveText(
            'Precisión: 10 m',
          )
          await page.getByRole('button', { name: 'Cerrar supervisión' }).click()
          await expect(page).toHaveURL(/\/sup$/)
          const fin = await fichajeSupervisionGuardado(
            sc,
            supervisionId,
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
