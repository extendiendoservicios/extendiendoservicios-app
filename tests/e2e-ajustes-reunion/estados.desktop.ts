import { expect, test, type Locator, type Page } from '@playwright/test'
import { getAdminDb, nombreDe } from '../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { fichar } from '../fixtures/movil.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { minutesSinceMidnightAR } from '../fixtures/dates.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import { registrarJornada } from './helpers/jornada.ts'
import {
  faltaMargenHaciaAdelante,
  faltaMargenHaciaAtras,
  franjaDesdeAhora,
  horaArgentina,
} from './helpers/tiempo.ts'

// P19.5d · AJ-02, AJ-03, AJ-07 y AJ-08 en la planilla de administración (tablero «Servicios de
// hoy» y Asistencia de hoy), escritorio 1280 px, administrador con todas las capacidades.
//   - «En camino»: fila celeste, «llega ~HH:MM», filtro «En camino», no es alerta roja ni entra en
//     «Requiere atención»; al fichar el inicio pasa a «Presente».
//   - «Llegada tarde» (inicio hace menos de 15 min, sin fichaje): fila amarilla, filtro y bloque
//     «Requiere atención»; con inicio hace más de 15 min: «Sin registro» roja.
//   - Turno cancelado: manda sobre «En camino» y «Llegada tarde».
//   - Horas: tilde verde si cumplió la franja, advertencia con el motivo si faltaron minutos o
//     salió antes, «en curso» sin fin.
//   - «Finalizado» en verde (success) y «En curso» del turno en azul (primary).
// Todas las franjas se arman desde "ahora" o con franjas fijas de la madrugada y recortadas al día
// del turno; cada test declara qué hora del día necesita y se saltea con el motivo si no la hay.
// Cuentas: empleado1 a empleado4 (de a uno por test, nunca dos tests a la vez).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('admin') })

function servicios(page: Page): Locator {
  return page.getByRole('region', { name: 'Servicios de hoy' })
}

function filaDe(zona: Locator, texto: string): Locator {
  return zona.getByRole('row').filter({ hasText: texto })
}

async function filtrarPorEstado(page: Page, estado: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Filtrar por estado' }).click()
  await page.getByRole('option', { name: estado, exact: true }).click()
}

/** Hora estimada (ISO) del último aviso en camino de la asignación, según el servidor. */
async function estimacionDe(assignmentId: string): Promise<string> {
  const { data, error } = await getAdminDb()
    .from('attendance_notices')
    .select('estimated_arrival_at')
    .eq('assignment_id', assignmentId)
    .eq('kind', 'on_the_way')
    .order('created_at', { ascending: false })
    .limit(1)
  expect(error, error?.message).toBeNull()
  const iso = data?.[0]?.estimated_arrival_at
  expect(iso, 'el aviso en camino trae la hora estimada').toBeTruthy()
  return iso as string
}

async function avisarEnCamino(
  who: 'empleado1' | 'empleado2' | 'empleado3' | 'empleado4',
  assignmentId: string,
  minutos: number,
): Promise<void> {
  const cliente = await sessionClient(who)
  const { error } = await cliente.rpc('notify_on_the_way', {
    p_assignment_id: assignmentId,
    p_eta_minutes: minutos,
  })
  expect(error, error?.message).toBeNull()
}

test.describe('AJ-02: «En camino» en la planilla de administración', () => {
  test(
    'fila celeste con «llega ~HH:MM», filtro «En camino», sin alerta roja; al fichar pasa a «Presente»',
    cubre('RB-A06', 'RB-A08', 'RB-E07', 'CB-05'),
    async ({ page }) => {
      const motivo = faltaMargenHaciaAdelante(45, 60)
      test.skip(motivo !== null, motivo ?? '')
      test.setTimeout(180_000)

      const sc = new Scenario()
      try {
        const cliente = await sc.client('adm-encamino')
        const sede = await sc.site(cliente.id, 'adm-encamino')
        const franja = franjaDesdeAhora(45, 60)
        const turno = await sc.shift(cliente.id, sede.id, sc.today, franja)
        const asignacion = await sc.assign(turno, 'empleado1')
        await avisarEnCamino('empleado1', asignacion, 20)
        const llega = horaArgentina(await estimacionDe(asignacion))

        await test.step('tablero «Servicios de hoy»: «En camino», «llega ~HH:MM» y fila celeste', async () => {
          await page.goto('/admin')
          const fila = filaDe(servicios(page), sede.name)
          await expect(fila).toBeVisible()
          await expect(fila).toContainText('En camino')
          await expect(fila).toContainText(`llega ~${llega}`)
          await expect(fila).toHaveClass(/bg-info-bg/)
          await expect(fila).not.toHaveClass(/bg-danger-bg|bg-warning-bg/)
          await expect(
            fila.locator('[data-slot="badge"][data-variant="info"]'),
          ).toContainText('En camino')
        })

        await test.step('no es una alerta: no entra en «Requiere atención» y suma a «Presentes», no a «Avisos»', async () => {
          const atencion = page.getByRole('region', {
            name: 'Requiere atención',
          })
          await expect(
            atencion.getByRole('listitem').filter({
              hasText: nombreDe('empleado1'),
            }),
          ).toHaveCount(0)
          await expect(
            page.getByRole('region', { name: 'Indicadores de hoy' }),
          ).toContainText(/\d+ en camino/)
        })

        await test.step('Asistencia de hoy: misma fila, mismo texto y el filtro «En camino»', async () => {
          await page.goto('/admin/asistencia')
          const lista = page.getByRole('main')
          await expect(filaDe(lista, sede.name)).toContainText(
            `llega ~${llega}`,
          )
          await filtrarPorEstado(page, 'En camino')
          await expect(filaDe(lista, sede.name)).toBeVisible()
          // Con el filtro puesto, todas las filas del cuerpo de la tabla dicen «En camino».
          const cuerpo = lista
            .getByRole('row')
            .filter({ has: page.locator('td') })
          await expect(cuerpo.filter({ hasNotText: 'En camino' })).toHaveCount(
            0,
          )
          await filtrarPorEstado(page, 'Llegada tarde')
          await expect(filaDe(lista, sede.name)).toHaveCount(0)
        })

        await test.step('al fichar el inicio la fila pasa a «Presente» y deja de ser «En camino»', async () => {
          await fichar('empleado1', asignacion, 'inicio')
          await page.goto('/admin')
          const fila = filaDe(servicios(page), sede.name)
          await expect(fila).toContainText('Presente')
          await expect(fila).not.toContainText('En camino')
          await expect(fila).not.toHaveClass(/bg-info-bg/)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'el tablero a 390 px muestra «En camino» sin scroll horizontal',
    cubre('RB-A06', 'RB-X05'),
    async ({ page }) => {
      const motivo = faltaMargenHaciaAdelante(45, 60)
      test.skip(motivo !== null, motivo ?? '')

      const sc = new Scenario()
      try {
        const cliente = await sc.client('adm-encamino-390')
        const sede = await sc.site(cliente.id, 'adm-encamino-390')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          franjaDesdeAhora(45, 60),
        )
        const asignacion = await sc.assign(turno, 'empleado2')
        await avisarEnCamino('empleado2', asignacion, 15)
        const llega = horaArgentina(await estimacionDe(asignacion))

        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/admin')
        await expect(servicios(page)).toContainText(sede.name)
        await expect(servicios(page)).toContainText(`llega ~${llega}`)
        await expect(servicios(page)).toContainText('En camino')
        await expectNoHorizontalScroll(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('AJ-07: «Llegada tarde» y «Sin registro»', () => {
  test(
    'inicio hace menos de 15 min: «Llegada tarde» amarilla; hace más de 15 min: «Sin registro» roja',
    cubre('RB-A06', 'RB-A08', 'CB-05'),
    async ({ page }) => {
      // El caso de «Sin registro» necesita que el inicio haya sido hace más de 15 min (se arma a
      // 20 min): entre las 0:00 y las 0:21 de Argentina no cabe en el día.
      const motivo = faltaMargenHaciaAtras(22)
      test.skip(motivo !== null, motivo ?? '')
      test.setTimeout(180_000)

      const sc = new Scenario()
      try {
        const cliente = await sc.client('adm-tarde')
        const sedeTarde = await sc.site(cliente.id, 'adm-tarde')
        const sedeSin = await sc.site(cliente.id, 'adm-sinregistro')
        const turnoTarde = await sc.shift(
          cliente.id,
          sedeTarde.id,
          sc.today,
          franjaDesdeAhora(-3, 90),
        )
        const turnoSin = await sc.shift(
          cliente.id,
          sedeSin.id,
          sc.today,
          franjaDesdeAhora(-20, 90),
        )
        await sc.assign(turnoTarde, 'empleado2')
        await sc.assign(turnoSin, 'empleado3')

        await test.step('tablero: «Llegada tarde» amarilla y «Sin registro» roja', async () => {
          await page.goto('/admin')
          const tarde = filaDe(servicios(page), sedeTarde.name)
          await expect(tarde).toContainText('Llegada tarde')
          await expect(tarde).toHaveClass(/bg-warning-bg/)
          await expect(tarde).not.toHaveClass(/bg-danger-bg/)
          await expect(
            tarde.locator('[data-slot="badge"][data-variant="warning"]'),
          ).toContainText('Llegada tarde')

          const sin = filaDe(servicios(page), sedeSin.name)
          await expect(sin).toContainText('Sin registro')
          await expect(sin).toHaveClass(/bg-danger-bg/)
          await expect(sin).not.toContainText('Llegada tarde')
        })

        await test.step('«Requiere atención»: la llegada tarde es alerta amarilla; la falta de registro, roja', async () => {
          const atencion = page.getByRole('region', {
            name: 'Requiere atención',
          })
          const alertaTarde = atencion.getByRole('listitem').filter({
            hasText: `${nombreDe('empleado2')} llegó tarde: todavía no registró el inicio`,
          })
          await expect(alertaTarde).toBeVisible()
          await expect(alertaTarde).toHaveClass(/bg-warning-bg/)
          const alertaSin = atencion.getByRole('listitem').filter({
            hasText: `${nombreDe('empleado3')} no registró el inicio`,
          })
          await expect(alertaSin).toBeVisible()
          await expect(alertaSin).toHaveClass(/bg-danger-bg/)
        })

        await test.step('tarjeta «Avisos»: suma las llegadas tarde (no las de «Sin registro»)', async () => {
          const avisos = page
            .getByRole('region', { name: 'Indicadores de hoy' })
            .getByText(/llegadas? tarde/)
          await expect(avisos).toBeVisible()
          const { data } = await getAdminDb()
            .from('v_assignments_board')
            .select('id')
            .eq('shift_date', sc.today)
            .eq('display_status', 'late')
            .eq('status', 'expected')
            .is('removed_at', null)
            .neq('shift_status', 'cancelled')
          const esperadas = data?.length ?? 0
          expect(esperadas).toBeGreaterThanOrEqual(1)
          await expect(avisos).toContainText(
            `${esperadas} ${esperadas === 1 ? 'llegada tarde' : 'llegadas tarde'}`,
          )
        })

        await test.step('Asistencia de hoy: los filtros «Llegada tarde» y «Sin registro» separan los dos casos', async () => {
          await page.goto('/admin/asistencia')
          const lista = page.getByRole('main')
          await filtrarPorEstado(page, 'Llegada tarde')
          await expect(filaDe(lista, sedeTarde.name)).toBeVisible()
          await expect(filaDe(lista, sedeSin.name)).toHaveCount(0)
          await filtrarPorEstado(page, 'Sin registro')
          await expect(filaDe(lista, sedeSin.name)).toBeVisible()
          await expect(filaDe(lista, sedeTarde.name)).toHaveCount(0)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  /**
   * Tres turnos de hoy que se cancelan DESPUÉS de tener el aviso: uno con «En camino» (empieza
   * dentro de 45 min), uno con «Llegada tarde» (empezó hace 3 min) y uno que empezó hace 20 min
   * (sin el cancelado habría quedado en «Sin registro» roja y con alerta).
   */
  async function armarCancelados(sc: Scenario, page: Page) {
    const cliente = await sc.client('adm-cancelado')
    const sedeCamino = await sc.site(cliente.id, 'adm-cancelado-camino')
    const sedeTarde = await sc.site(cliente.id, 'adm-cancelado-tarde')
    const sedeSin = await sc.site(cliente.id, 'adm-cancelado-sinreg')
    const turnoCamino = await sc.shift(
      cliente.id,
      sedeCamino.id,
      sc.today,
      franjaDesdeAhora(45, 60),
    )
    const turnoTarde = await sc.shift(
      cliente.id,
      sedeTarde.id,
      sc.today,
      franjaDesdeAhora(-3, 90),
    )
    const turnoSin = await sc.shift(
      cliente.id,
      sedeSin.id,
      sc.today,
      franjaDesdeAhora(-20, 90),
    )
    const asigCamino = await sc.assign(turnoCamino, 'empleado3')
    await sc.assign(turnoTarde, 'empleado4')
    await sc.assign(turnoSin, 'empleado2')
    await avisarEnCamino('empleado3', asigCamino, 20)

    // Antes de cancelar, las tres filas muestran el estado que les toca.
    await page.goto('/admin')
    await expect(filaDe(servicios(page), sedeCamino.name)).toContainText(
      'En camino',
    )
    await expect(filaDe(servicios(page), sedeTarde.name)).toContainText(
      'Llegada tarde',
    )
    await expect(filaDe(servicios(page), sedeSin.name)).toContainText(
      'Sin registro',
    )

    const owner = await sessionClient('owner')
    for (const turno of [turnoCamino, turnoTarde, turnoSin]) {
      const { error } = await owner.rpc('cancel_shift', {
        p_shift_id: turno,
        p_reason: 'e2e: cancelado con aviso',
      })
      expect(error, error?.message).toBeNull()
    }
    await page.goto('/admin')
    return {
      sedes: [sedeCamino, sedeTarde, sedeSin],
      empleados: ['empleado3', 'empleado4', 'empleado2'] as const,
    }
  }

  test(
    'DEF-AJ-01: un turno cancelado dice «Cancelado» (gris tachado) y manda sobre «En camino», «Llegada tarde» y «Sin registro»: sin color de fila, sin «llega ~HH:MM», sin alerta ni «Asignar reemplazo»; el filtro de estado lo descarta',
    cubre('RB-A04', 'RB-A06', 'CB-03'),
    async ({ page }) => {
      const motivoAdelante = faltaMargenHaciaAdelante(45, 60)
      test.skip(motivoAdelante !== null, motivoAdelante ?? '')
      const motivoAtras = faltaMargenHaciaAtras(22)
      test.skip(motivoAtras !== null, motivoAtras ?? '')
      test.setTimeout(240_000)

      const sc = new Scenario()
      try {
        const { sedes, empleados } = await armarCancelados(sc, page)

        await test.step('tablero: «Cancelado» neutral-strike, sin color ni hora estimada ni acciones', async () => {
          for (const sede of sedes) {
            const fila = filaDe(servicios(page), sede.name)
            await expect(fila).toBeVisible()
            await expect(
              fila.locator(
                '[data-slot="badge"][data-variant="neutral-strike"]',
              ),
            ).toContainText('Cancelado')
            await expect(fila).not.toContainText(
              /En camino|Llegada tarde|Sin registro|Esperado|llega ~/,
            )
            await expect(fila).not.toHaveClass(
              /bg-info-bg|bg-warning-bg|bg-danger-bg/,
            )
            await expect(
              fila.getByRole('button', { name: /Asignar reemplazo/ }),
            ).toHaveCount(0)
          }
        })

        await test.step('«Requiere atención»: ninguno de los tres empleados genera alerta', async () => {
          const atencion = page.getByRole('region', {
            name: 'Requiere atención',
          })
          for (const quien of empleados) {
            await expect(
              atencion.getByRole('listitem').filter({
                hasText: nombreDe(quien),
              }),
            ).toHaveCount(0)
          }
        })

        await test.step('Asistencia de hoy: «Cancelado» también ahí y los filtros de estado lo descartan', async () => {
          await page.goto('/admin/asistencia')
          const lista = page.getByRole('main')
          for (const sede of sedes) {
            const fila = filaDe(lista, sede.name)
            await expect(fila).toBeVisible()
            await expect(
              fila.locator(
                '[data-slot="badge"][data-variant="neutral-strike"]',
              ),
            ).toContainText('Cancelado')
            await expect(fila).not.toHaveClass(
              /bg-info-bg|bg-warning-bg|bg-danger-bg/,
            )
            await expect(fila).not.toContainText('llega ~')
          }
          for (const estado of [
            'En camino',
            'Llegada tarde',
            'Sin registro',
            'Esperado',
          ]) {
            await filtrarPorEstado(page, estado)
            for (const sede of sedes) {
              await expect(filaDe(lista, sede.name)).toHaveCount(0)
            }
          }
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('AJ-03: horas en «Servicios de hoy» y en Asistencia de hoy', () => {
  test(
    'tilde verde si cumplió la franja; advertencia con el motivo si faltaron minutos o salió antes; «en curso» sin fin',
    cubre('RB-A06', 'RB-A08', 'CB-05'),
    async ({ page }) => {
      // Franja 00:00–00:30: tiene que haber terminado para que las horas fechadas sean pasado.
      test.skip(
        minutesSinceMidnightAR() < 45,
        'Todavía no pasaron 45 min desde las 0:00 de Argentina: la franja 00:00–00:30 no terminó y las horas fechadas quedarían en el futuro. Se saltea explícito.',
      )
      test.setTimeout(240_000)

      const sc = new Scenario()
      try {
        const cliente = await sc.client('adm-horas')
        const sede = await sc.site(cliente.id, 'adm-horas')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          { start: '00:00', end: '00:30' },
          4,
        )
        const quienes = [
          'empleado1',
          'empleado2',
          'empleado3',
          'empleado4',
        ] as const
        const asignaciones: Record<string, string> = {}
        for (const quien of quienes) {
          asignaciones[quien] = await sc.assign(turno, quien)
        }
        // empleado1: cumplió los 30 min; empleado2: se fue 10 min antes; empleado3: llegó 10 min
        // tarde y se quedó hasta el final; empleado4: todavía no ficha la salida.
        await registrarJornada('empleado1', asignaciones.empleado1, {
          entrada: '00:00:00',
          salida: '00:30:00',
        })
        await registrarJornada('empleado2', asignaciones.empleado2, {
          entrada: '00:00:00',
          salida: '00:20:00',
        })
        await registrarJornada('empleado3', asignaciones.empleado3, {
          entrada: '00:10:00',
          salida: '00:30:00',
        })
        await registrarJornada('empleado4', asignaciones.empleado4, {
          entrada: '00:00:10',
        })

        async function verificar(zona: Locator) {
          const cumple = filaDe(zona, nombreDe('empleado1'))
          await expect(cumple).toContainText('30 min')
          await expect(cumple.locator('svg.text-success')).toHaveCount(1)
          await expect(cumple).toContainText('Cumplió las horas previstas')
          await expect(cumple.locator('svg.text-warning')).toHaveCount(0)

          const anticipada = filaDe(zona, nombreDe('empleado2'))
          await expect(anticipada).toContainText('20 min')
          await expect(anticipada.locator('svg.text-warning')).toHaveCount(1)
          await expect(anticipada.locator('svg.text-success')).toHaveCount(0)
          await expect(
            anticipada.locator('[title="Salida anticipada · faltan 10 min"]'),
          ).toHaveCount(1)
          await expect(anticipada).toContainText(
            'Salida anticipada · faltan 10 min',
          )

          const corta = filaDe(zona, nombreDe('empleado3'))
          await expect(corta).toContainText('20 min')
          await expect(corta.locator('svg.text-warning')).toHaveCount(1)
          await expect(corta.locator('[title="Faltan 10 min"]')).toHaveCount(1)
          await expect(corta).toContainText('Faltan 10 min')

          const enCurso = filaDe(zona, nombreDe('empleado4'))
          await expect(enCurso).toContainText('en curso')
          await expect(enCurso.locator('svg.text-warning')).toHaveCount(0)
          await expect(enCurso.locator('svg.text-success')).toHaveCount(0)
        }

        await test.step('tablero «Servicios de hoy»', async () => {
          await page.goto('/admin')
          await verificar(servicios(page))
        })

        await test.step('Asistencia de hoy', async () => {
          await page.goto('/admin/asistencia')
          await page.getByPlaceholder('Buscar por nombre…').fill('E2E-Fijo-AJ')
          await verificar(page.getByRole('main'))
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('AJ-08: «Finalizado» en verde y «En curso» del turno en azul', () => {
  test(
    'el turno finalizado usa la variante success y el turno en curso la variante primary',
    cubre('RB-A06', 'RB-X05'),
    async ({ page }) => {
      test.skip(
        minutesSinceMidnightAR() < 45,
        'Todavía no pasaron 45 min desde las 0:00 de Argentina: la franja 00:00–00:30 no terminó. Se saltea explícito.',
      )
      test.setTimeout(240_000)

      const sc = new Scenario()
      try {
        const cliente = await sc.client('adm-colores')
        const sedeFin = await sc.site(cliente.id, 'adm-colores-fin')
        const sedeCurso = await sc.site(cliente.id, 'adm-colores-curso')
        const turnoFin = await sc.shift(cliente.id, sedeFin.id, sc.today, {
          start: '00:00',
          end: '00:30',
        })
        const turnoCurso = await sc.shift(cliente.id, sedeCurso.id, sc.today, {
          start: '00:00',
          end: '00:30',
        })
        const asigFin = await sc.assign(turnoFin, 'empleado1')
        const asigCurso = await sc.assign(turnoCurso, 'empleado2')
        await registrarJornada('empleado1', asigFin, {
          entrada: '00:00:00',
          salida: '00:30:00',
        })
        await registrarJornada('empleado2', asigCurso, {
          entrada: '00:00:00',
        })

        await test.step('el turno finalizado: «Finalizado» success', async () => {
          await page.goto(`/admin/turnos/${turnoFin}`)
          const detalle = page.getByRole('dialog', {
            name: 'Detalle del turno',
          })
          // El detalle muestra «Finalizado» dos veces (el turno y su asignación): todas en verde.
          const finalizados = detalle.locator('[data-slot="badge"]', {
            hasText: 'Finalizado',
          })
          await expect(finalizados.first()).toBeVisible()
          await expect(finalizados.first()).toHaveAttribute(
            'data-variant',
            'success',
          )
          await expect(
            finalizados.and(
              page.locator('[data-variant]:not([data-variant="success"])'),
            ),
          ).toHaveCount(0)
        })

        await test.step('el turno en curso: «En curso» primary (ya no success)', async () => {
          await page.goto(`/admin/turnos/${turnoCurso}`)
          const detalle = page.getByRole('dialog', {
            name: 'Detalle del turno',
          })
          await expect(
            detalle.locator('[data-slot="badge"][data-variant="primary"]', {
              hasText: 'En curso',
            }),
          ).toBeVisible()
          await expect(
            detalle.locator('[data-slot="badge"][data-variant="success"]', {
              hasText: 'En curso',
            }),
          ).toHaveCount(0)
        })

        await test.step('la asignación finalizada se ve verde en la planilla; «Presente» sigue verde', async () => {
          await page.goto('/admin')
          const fin = filaDe(servicios(page), sedeFin.name)
          await expect(
            fin.locator('[data-slot="badge"][data-variant="success"]', {
              hasText: 'Finalizado',
            }),
          ).toBeVisible()
          const curso = filaDe(servicios(page), sedeCurso.name)
          await expect(
            curso.locator('[data-slot="badge"][data-variant="success"]', {
              hasText: 'Presente',
            }),
          ).toBeVisible()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
