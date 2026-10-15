import { expect, test } from '@playwright/test'
import { daysFromToday } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { marcarCambiosVistos } from '../fixtures/movil.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import { SEDE_COORDS, sedeGeo } from './helpers/geo.ts'

// P22.5 · Historial del empleado (EMP-HIS, B-19, B-28, B-40): cada fichaje muestra si quedó
// «Validado», «Fuera de zona» o «Sin validar»; si la administración marcó la validación como válida
// se ve «Validado (corregido)», y si cambió la hora se ve «Corregido». El MOTIVO de las correcciones
// nunca llega al celular (ni el de la hora ni el de la validación) y las coordenadas tampoco.
// Cuenta de este archivo: empleado2.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('empleado2') })

const MOTIVO_GEO = 'e2e-secreto-motivo-de-la-validacion'
const MOTIVO_HORA = 'e2e-secreto-motivo-de-la-hora'
const MOTIVO_EMPLEADO = 'e2e-motivo-que-escribio-el-empleado'

/** Turno pasado con asignación de empleado2 y sus dos fichajes con la validación ya calculada. */
async function jornadaPasada(
  sc: Scenario,
  fecha: string,
  slug: string,
  inicio: {
    estado: 'valid' | 'outside' | 'unvalidated'
    motivo?: 'no_location' | null
  },
  fin: {
    estado: 'valid' | 'outside' | 'unvalidated'
    motivo?: 'no_location' | null
  },
) {
  const cliente = await sc.client(slug)
  const sede = await sedeGeo(sc, cliente, slug, { radio: 100 })
  const turnoId = await sc.shift(cliente.id, sede.id, fecha, {
    start: '08:00',
    end: '11:00',
  })
  const asignacionId = await sc.assign(turnoId, 'empleado2')
  const fila = (
    kind: 'check_in' | 'check_out',
    hora: string,
    g: typeof inicio,
  ) => ({
    assignment_id: asignacionId,
    kind,
    recorded_at: `${fecha}T${hora}-03:00`,
    source: 'employee_app' as const,
    recorded_by: readId('empleado2'),
    latitude: g.estado === 'unvalidated' ? null : SEDE_COORDS.lat,
    longitude: g.estado === 'unvalidated' ? null : SEDE_COORDS.lng,
    accuracy_m: g.estado === 'unvalidated' ? null : 12,
    geo_status: g.estado,
    geo_unvalidated_reason:
      g.estado === 'unvalidated' ? (g.motivo ?? 'no_location') : null,
    site_distance_m:
      g.estado === 'outside' ? 350 : g.estado === 'valid' ? 4 : null,
    geofence_radius_m: 100,
    outside_reason: g.estado === 'outside' ? MOTIVO_EMPLEADO : null,
  })
  const { error } = await sc.db
    .from('attendance_records')
    .insert([
      fila('check_in', '08:00:30', inicio),
      fila('check_out', '11:00:30', fin),
    ])
  if (error) throw new Error(`fichajes: ${error.message}`)
  await sc.db
    .from('assignments')
    .update({ status: 'finished' })
    .eq('id', asignacionId)
  await sc.db.from('shifts').update({ status: 'completed' }).eq('id', turnoId)
  const { data: registros } = await sc.db
    .from('attendance_records')
    .select('id, kind')
    .eq('assignment_id', asignacionId)
  const idDe = (k: string) => registros!.find((r) => r.kind === k)!.id
  return {
    cliente,
    sede,
    turnoId,
    asignacionId,
    inicioId: idDe('check_in'),
    finId: idDe('check_out'),
  }
}

test(
  'EMP-HIS: el historial muestra «Validado», «Fuera de zona» y «Sin validar» de cada fichaje, sin coordenadas',
  cubre('RB-E02', 'RB-E07', 'B-03', 'B-19', 'B-40'),
  async ({ page }) => {
    test.setTimeout(120_000)
    const sc = new Scenario()
    try {
      await jornadaPasada(
        sc,
        daysFromToday(-1),
        'geo-hist-estados',
        { estado: 'outside' },
        { estado: 'unvalidated', motivo: 'no_location' },
      )
      await marcarCambiosVistos('empleado2')
      await page.goto('/app/historial')
      const marcas = page.getByTestId('attendance-mark')
      await expect(marcas).toHaveCount(2)
      await expect(marcas.first()).toContainText('Inicio 08:00')
      await expect(marcas.first()).toContainText('Fuera de zona')
      await expect(marcas.last()).toContainText('Fin 11:00')
      await expect(marcas.last()).toContainText('Sin validar (sin ubicación)')
      await expect(page.locator('body')).not.toContainText(
        String(SEDE_COORDS.lat).slice(0, 7),
      )
      await expectNoHorizontalScroll(page)
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'EMP-HIS: tras «Marcar como válido» y «Corregir hora» el historial dice «Validado (corregido)» y «Corregido», sin ningún motivo',
  cubre('RB-E02', 'RB-E07', 'RB-A08', 'B-09', 'B-19', 'B-28', 'B-40', 'B-41'),
  async ({ page }) => {
    test.setTimeout(120_000)
    const sc = new Scenario()
    try {
      const fecha = daysFromToday(-2)
      const j = await jornadaPasada(
        sc,
        fecha,
        'geo-hist-corregido',
        { estado: 'outside' },
        { estado: 'valid' },
      )
      await marcarCambiosVistos('empleado2')

      await test.step('la administración corrige con las RPC reales (dueño o administrador con manage_attendance)', async () => {
        const admin = await sessionClient('admin')
        const v = await admin.rpc('override_geo_validation', {
          p_record_type: 'attendance',
          p_record_id: j.inicioId,
          p_reason: MOTIVO_GEO,
        })
        expect(v.error, v.error?.message).toBeNull()
        const h = await admin.rpc('correct_attendance_time', {
          p_record_id: j.finId,
          p_new_time: `${fecha}T11:30:00-03:00`,
          p_reason: MOTIVO_HORA,
        })
        expect(h.error, h.error?.message).toBeNull()
        // El original se conserva: el resultado congelado sigue siendo «outside».
        const { data: original } = await sc.db
          .from('attendance_records')
          .select('geo_status, geo_override_at, geo_override_reason')
          .eq('id', j.inicioId)
          .single()
        expect(original?.geo_status).toBe('outside')
        expect(original?.geo_override_at).not.toBeNull()
        expect(original?.geo_override_reason).toBe(MOTIVO_GEO)
      })

      await test.step('el empleado ve el estado corregido y la marca «Corregido», sin los motivos', async () => {
        await page.goto('/app/historial')
        const marcas = page.getByTestId('attendance-mark')
        await expect(marcas).toHaveCount(2)
        await expect(marcas.first()).toContainText('Validado (corregido)')
        await expect(marcas.first()).not.toContainText('Corregido Validado')
        await expect(marcas.last()).toContainText('Fin 11:30')
        await expect(marcas.last()).toContainText('Corregido')
        await expect(marcas.last()).toContainText('Validado')
        const cuerpo = page.locator('body')
        await expect(cuerpo).not.toContainText(MOTIVO_GEO)
        await expect(cuerpo).not.toContainText(MOTIVO_HORA)
        await expect(cuerpo).not.toContainText('secreto')
        await expect(cuerpo).not.toContainText(
          String(SEDE_COORDS.lat).slice(0, 7),
        )
        await expectNoHorizontalScroll(page)
      })

      await test.step('el comprobante del servicio (EMP-11) tampoco muestra los motivos', async () => {
        await page.goto(`/app/resumen/${j.asignacionId}?desde=historial`)
        await expect(page.getByTestId('attendance-mark').first()).toBeVisible()
        await expect(page.locator('body')).not.toContainText('secreto')
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
