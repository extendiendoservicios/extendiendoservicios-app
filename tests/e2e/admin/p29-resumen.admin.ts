import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import {
  FRANJAS,
  isTooCloseToMidnight,
  minutesSinceMidnightAR,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { contextoDe, fichar } from '../../fixtures/movil.ts'
import { franjaPorComenzar } from '../../fixtures/p29.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { interceptMapRequests } from '../../fixtures/ui.ts'

// P29.6 (P29.3: OG-01, OG-02, OG-03), escritorio 1280 px: el Resumen de administración.
//   - OG-02: cerrar un aviso de «Requiere atención» con la ✕, verlo en «Ver cerrados (N)», reabrirlo
//     y comprobar que el cierre vale para toda la administración (segunda sesión, la del dueño).
//   - OG-03: la demora avisada es una alerta; «Estoy en camino» no.
//   - OG-01: el selector «Hoy / Todos los clientes» del mapa y su contador «N clientes · M sedes».
// Los avisos dependen de la hora del día, así que se arman con franjas fijas (00:04–00:05, ya
// terminó) o que arrancan dentro de 40 minutos (se saltea pasadas las 22:00). Empleados: empleado3,
// empleado4 y empleado5. En App_dev hay avisos de otras pruebas: todo se filtra por la sede propia.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

const requiereAtencion = (page: Page) =>
  page.getByRole('region', { name: 'Requiere atención' })

/** Aviso abierto de una sede (tiene la ✕; los cerrados no). */
const avisoAbierto = (page: Page, sede: string) =>
  requiereAtencion(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /^Cerrar aviso/ }) })
    .filter({ hasText: sede })

/** Aviso de la lista «Ver cerrados». */
const avisoCerrado = (page: Page, sede: string) =>
  requiereAtencion(page)
    .getByRole('list', { name: 'Avisos cerrados' })
    .getByRole('listitem')
    .filter({ hasText: sede })

async function verCerrados(page: Page): Promise<void> {
  const boton = requiereAtencion(page).getByRole('button', {
    name: /^Ver cerrados \(\d+\)$/,
  })
  await expect(boton).toBeVisible()
  await boton.click()
}

test.describe('OG-02 · cerrar avisos de «Requiere atención»', () => {
  test.use({ storageState: storageStatePath('admin') })
  // «Llegó tarde» vale hasta 15 minutos después del inicio (00:04): antes de las 00:25 el aviso
  // todavía sería ese y no «no registró el inicio».
  test.skip(
    minutesSinceMidnightAR() < 25,
    'Muy temprano: todavía rige «llegó tarde».',
  )

  test(
    'la ✕ cierra el aviso para toda la administración, queda en «Ver cerrados (N)» con quién y cuándo, y se reabre',
    cubre('RB-A06', 'RB-A07', 'OG-02'),
    async ({ page, browser }, testInfo) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      const otraSesion = await contextoDe(browser, testInfo, 'owner')
      try {
        const cliente = await sc.client('og02')
        const sede = await sc.site(cliente.id, 'og02')
        const turno = await sc.shift(cliente.id, sede.id, sc.today, {
          start: '00:04',
          end: '00:05',
        })
        const asignacion = await sc.assign(turno, 'empleado5')

        await test.step('el aviso aparece abierto: «no registró el inicio»', async () => {
          await page.goto('/admin')
          // Con la base ocupada, el Resumen puede tardar más de los 10 s por omisión en cargar.
          await expect(avisoAbierto(page, sede.name)).toContainText(
            `${nombreDe('empleado5')} no registró el inicio`,
            { timeout: 30_000 },
          )
        })

        await test.step('la ✕ lo cierra: sale de la lista y queda registrado quién lo cerró', async () => {
          await avisoAbierto(page, sede.name)
            .getByRole('button', { name: /^Cerrar aviso/ })
            .click()
          await expect(avisoAbierto(page, sede.name)).toHaveCount(0)
          await verCerrados(page)
          const cerrado = avisoCerrado(page, sede.name)
          await expect(cerrado).toContainText('no registró el inicio')
          await expect(cerrado).toContainText(
            new RegExp(`Cerrado por ${nombreDe('admin')} a las \\d{2}:\\d{2}`),
          )
          const { data } = await sc.db
            .from('attention_dismissals')
            .select('kind, dismissed_by, shift_id')
            .eq('assignment_id', asignacion)
          expect(data).toEqual([
            {
              kind: 'noRecord',
              dismissed_by: readId('admin'),
              shift_id: turno,
            },
          ])
          // Cerrar no toca la asistencia: la asignación sigue sin registro.
          const { data: a } = await sc.db
            .from('assignments')
            .select('status, removed_at')
            .eq('id', asignacion)
            .single()
          expect(a?.removed_at).toBeNull()
          expect(a?.status).toBe('expected')
        })

        const otra = await otraSesion.newPage()
        await test.step('desde otra sesión de administración el aviso también está cerrado (C-01)', async () => {
          await otra.goto('/admin')
          await expect(
            requiereAtencion(otra).getByRole('heading', {
              name: 'Requiere atención',
            }),
          ).toBeVisible()
          await expect(avisoAbierto(otra, sede.name)).toHaveCount(0)
          await verCerrados(otra)
          await expect(avisoCerrado(otra, sede.name)).toContainText(
            `Cerrado por ${nombreDe('admin')}`,
          )
        })

        await test.step('la otra sesión lo reabre y vuelve a aparecer en las dos', async () => {
          await avisoCerrado(otra, sede.name)
            .getByRole('button', { name: 'Reabrir' })
            .click()
          await expect(avisoAbierto(otra, sede.name)).toContainText(
            'no registró el inicio',
          )
          await page.reload()
          await expect(avisoAbierto(page, sede.name)).toContainText(
            'no registró el inicio',
          )
          await expect(avisoCerrado(page, sede.name)).toHaveCount(0)
          const { data } = await sc.db
            .from('attention_dismissals')
            .select('id')
            .eq('assignment_id', asignacion)
          expect(data).toEqual([])
        })
      } finally {
        await otraSesion.close()
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('OG-03 · demoras avisadas en «Requiere atención»', () => {
  test.use({ storageState: storageStatePath('admin') })
  const franja = franjaPorComenzar(minutesSinceMidnightAR())
  test.skip(
    franja === null,
    'Pasadas las 22:00 ya no hay margen para un turno por comenzar hoy.',
  )

  test(
    'una demora avisada es una alerta amarilla con los minutos y el motivo; «Estoy en camino» no lo es; fichar el inicio la saca y la ✕ la cierra',
    cubre('RB-A06', 'RB-A07', 'RB-E05', 'AJ-02', 'OG-03'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('og03')
        const sede = await sc.site(cliente.id, 'og03')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          franja ?? FRANJAS.noche,
          3,
        )
        const conDemora = await sc.assign(turno, 'empleado5')
        const queFicha = await sc.assign(turno, 'empleado4')
        const enCamino = await sc.assign(turno, 'empleado3')

        const demora5 = await (
          await sessionClient('empleado5')
        ).rpc('notify_delay', {
          p_assignment_id: conDemora,
          p_minutes: 20,
          p_reason_text: 'e2e: tráfico en la autopista',
        })
        expect(demora5.error, demora5.error?.message).toBeNull()
        const demora4 = await (
          await sessionClient('empleado4')
        ).rpc('notify_delay', {
          p_assignment_id: queFicha,
          p_minutes: 15,
        })
        expect(demora4.error, demora4.error?.message).toBeNull()
        const camino = await (
          await sessionClient('empleado3')
        ).rpc('notify_on_the_way', {
          p_assignment_id: enCamino,
          p_eta_minutes: 10,
        })
        expect(camino.error, camino.error?.message).toBeNull()

        await page.goto('/admin')
        const abiertas = requiereAtencion(page)
          .getByRole('listitem')
          .filter({ hasText: sede.name })

        await test.step('la demora aparece con los minutos avisados y el motivo', async () => {
          const aviso = abiertas.filter({
            hasText: nombreDe('empleado5'),
          })
          await expect(aviso).toContainText(
            `${nombreDe('empleado5')} avisó que llega 20 min tarde`,
          )
          await expect(aviso).toContainText('e2e: tráfico en la autopista')
          await expect(aviso).toContainText(cliente.name)
          // Amarillo: la alerta de advertencia, no la roja de «no registró el inicio».
          await expect(aviso).toHaveClass(/border-warning-border/)
        })

        await test.step('«Estoy en camino» no es una alerta: solo hay las dos demoras', async () => {
          await expect(abiertas).toHaveCount(2)
          await expect(
            abiertas.filter({ hasText: nombreDe('empleado3') }),
          ).toHaveCount(0)
        })

        await test.step('con la ✕ se cierra la demora y pasa a «Ver cerrados»', async () => {
          await abiertas
            .filter({ hasText: nombreDe('empleado5') })
            .getByRole('button', { name: /^Cerrar aviso/ })
            .click()
          await expect(
            abiertas.filter({ hasText: nombreDe('empleado5') }),
          ).toHaveCount(0)
          await verCerrados(page)
          await expect(avisoCerrado(page, sede.name)).toContainText(
            `${nombreDe('empleado5')} avisó que llega 20 min tarde`,
          )
        })

        await test.step('cuando el empleado ficha el inicio, la demora deja de ser alerta', async () => {
          await fichar('empleado4', queFicha, 'inicio')
          await page.reload()
          await expect(
            requiereAtencion(page).getByRole('heading', {
              name: 'Requiere atención',
            }),
          ).toBeVisible()
          await expect(
            abiertas.filter({ hasText: nombreDe('empleado4') }),
          ).toHaveCount(0)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('OG-01 · mapa «Hoy / Todos los clientes»', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'el selector cambia al modo «Todos los clientes» con su contador de clientes y sedes, el pin con servicios y «Ver sede»',
    cubre('RB-A05', 'CB-20', 'OG-01'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('og01')
        const sede = await sc.site(cliente.id, 'og01', {
          lat: -34.6037,
          lng: -58.3816,
        })
        // Sin ubicación y sin servicios: no tiene que salir en el mapa.
        const sinUbicacion = await sc.site(cliente.id, 'og01-sin-ubicacion')
        const servicio = await sc.service(cliente.id, sede.id, 'og01')
        await sc.service(cliente.id, sinUbicacion.id, 'og01-sin-ubicacion')

        const owner = await sessionClient('owner')
        const enBase = async () => {
          const r = await owner.rpc('map_active_sites')
          expect(r.error, r.error?.message).toBeNull()
          const filas = (r.data ?? []) as Array<{
            client_id: string
            site_id: string
          }>
          return {
            filas,
            clientes: new Set(filas.map((f) => f.client_id)).size,
            sedes: filas.length,
          }
        }
        const antes = await enBase()
        expect(antes.filas.map((f) => f.site_id)).toContain(sede.id)
        expect(antes.filas.map((f) => f.site_id)).not.toContain(sinUbicacion.id)

        await interceptMapRequests(page)
        await page.goto('/admin')
        const mapa = page.getByRole('region', { name: 'Mapa de presencia' })
        const modo = mapa.getByRole('radiogroup', {
          name: 'Qué mostrar en el mapa',
        })

        await test.step('por omisión está en «Hoy», con sus conmutadores de estado', async () => {
          await expect(modo.getByRole('radio', { name: 'Hoy' })).toBeChecked()
          await expect(
            mapa.getByRole('switch', { name: 'Por comenzar' }),
          ).toBeVisible()
        })

        await test.step('«Todos los clientes» muestra el contador y esconde los conmutadores del día', async () => {
          await modo.getByRole('radio', { name: 'Todos los clientes' }).click()
          await expect(
            modo.getByRole('radio', { name: 'Todos los clientes' }),
          ).toBeChecked()
          const contador = mapa.getByText(/^\d+ clientes? · \d+ sedes?$/)
          await expect(contador).toBeVisible()
          const despues = await enBase()
          const etiqueta = (n: { clientes: number; sedes: number }) =>
            `${n.clientes} ${n.clientes === 1 ? 'cliente' : 'clientes'} · ${n.sedes} ${n.sedes === 1 ? 'sede' : 'sedes'}`
          // El contador arranca en «0 clientes · 0 sedes» hasta que llega la consulta: se espera
          // (sin dormir) a que coincida con lo que devuelve `map_active_sites` en la base.
          await expect
            .poll(async () => (await contador.textContent())?.trim(), {
              timeout: 15_000,
            })
            .toMatch(new RegExp(`^(${etiqueta(antes)}|${etiqueta(despues)})$`))
          await expect(
            mapa.getByRole('switch', { name: 'Por comenzar' }),
          ).toHaveCount(0)
          await expect(
            mapa.getByRole('switch', { name: 'Finalizados' }),
          ).toHaveCount(0)
        })

        await test.step('el pin de la sede abre cliente, sede, servicios activos y «Ver sede»', async () => {
          const pin = mapa.getByTitle(`${cliente.name} · ${sede.name}`)
          await expect(pin).toHaveCount(1)
          await pin.click({ force: true })
          const globo = page.locator('.leaflet-popup')
          await expect(globo).toContainText(cliente.name)
          await expect(globo).toContainText(sede.name)
          await expect(globo).toContainText(servicio.name)
          await globo.getByRole('link', { name: 'Ver sede' }).click()
          await expect(page).toHaveURL(new RegExp(`/admin/sedes/${sede.id}$`))
        })

        await test.step('el modo elegido se recuerda al volver al Resumen', async () => {
          await page.goto('/admin')
          await expect(
            page
              .getByRole('region', { name: 'Mapa de presencia' })
              .getByRole('radio', { name: 'Todos los clientes' }),
          ).toBeChecked()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
