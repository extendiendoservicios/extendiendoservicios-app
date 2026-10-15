import { expect, test } from '@playwright/test'
import { auditarAccesibilidad, esperarPantallaLista } from '../fixtures/axe.ts'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { FRANJAS_MOVIL } from '../fixtures/movil.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import {
  borrarEventosDeCorrecciones,
  desplazar,
  ficharComoEmpleado,
  SEDE_COORDS,
  sedeGeo,
} from './helpers/geo.ts'

// P22.5 · Accesibilidad (axe-core, sin violaciones críticas ni serias) de las pantallas de
// administración que trae B1, a 1280 px: Resumen con el mapa de presencia, Clientes · Mapa con el
// radio general, formulario y detalle de la sede, planilla con el filtro y detalle del turno con
// el mini mapa y los diálogos de corrección. Cuenta: empleado4; mira `admin`.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
test.use({ storageState: storageStatePath('admin') })

test(
  'axe: Resumen con presencia, Clientes · Mapa, sede, planilla y detalle del turno con las correcciones',
  cubre('RB-X01', 'B-11', 'B-16', 'B-20'),
  async ({ page }, testInfo) => {
    test.setTimeout(240_000)
    const sc = new Scenario()
    const ids: string[] = []
    try {
      const cliente = await sc.client('geo-axe-admin')
      const sede = await sedeGeo(sc, cliente, 'geo-axe-admin', { radio: 100 })
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      const asig = await sc.assign(turno, 'empleado4')
      await ficharComoEmpleado(
        'empleado4',
        asig,
        'inicio',
        { punto: desplazar(SEDE_COORDS, 450), precision: 12 },
        'e2e: motivo',
      )
      const { data } = await sc.db
        .from('attendance_records')
        .select('id')
        .eq('assignment_id', asig)
        .single()
      ids.push(data!.id)
      const auditar = (nombre: string) =>
        auditarAccesibilidad(page, testInfo, nombre, '1280')

      await page.goto('/admin')
      await expect(
        page.getByRole('region', { name: 'Mapa de presencia' }),
      ).toBeVisible()
      await esperarPantallaLista(page)
      await auditar('ADM-02 Resumen con mapa de presencia')

      await page.goto('/admin/clientes?pestana=mapa')
      await expect(page.getByLabel('Radio general (m)')).toBeVisible()
      await page.getByRole('switch', { name: 'Mostrar radios' }).click()
      await esperarPantallaLista(page)
      await auditar('ADM-24 Clientes · Mapa con radio general')

      await page.goto(`/admin/sedes/${sede.id}/editar`)
      await expect(
        page.getByLabel('Radio de validación propio (opcional)'),
      ).toBeVisible()
      await esperarPantallaLista(page)
      await auditar('ADM-23 Formulario de sede')

      await page.goto(`/admin/sedes/${sede.id}`)
      await expect(
        page.getByRole('switch', { name: 'Mostrar radios' }),
      ).toBeVisible()
      await esperarPantallaLista(page)
      await auditar('ADM-22 Detalle de la sede')

      await page.goto('/admin/asistencia')
      await expect(
        page.getByRole('switch', { name: 'Solo fuera de zona' }),
      ).toBeVisible()
      await esperarPantallaLista(page)
      await auditar('ADM-10 Planilla de asistencia')

      await page.goto(`/admin/turnos/${turno}`)
      const d = page.getByRole('dialog', { name: 'Detalle del turno' })
      await d.getByRole('button', { name: 'Ver en el mapa' }).click()
      await expect(
        d.getByRole('group', { name: /^Mapa con la sede/ }),
      ).toBeVisible()
      await auditar('ADM-06 Detalle del turno con mini mapa')

      await d.getByRole('button', { name: 'Corregir hora' }).click()
      await expect(
        page.getByRole('dialog', { name: 'Corregir hora de inicio' }),
      ).toBeVisible()
      await auditar('ADM-06 Corregir hora')
      await page.keyboard.press('Escape')
      await d.getByRole('button', { name: 'Marcar como válido' }).click()
      await expect(
        page.getByRole('dialog', { name: 'Marcar como válido' }),
      ).toBeVisible()
      await auditar('ADM-06 Marcar como válido')
    } finally {
      await borrarEventosDeCorrecciones(sc, ids)
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
