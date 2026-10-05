import { expect, test } from '@playwright/test'
import { anioLejano } from '../../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { pickMonth } from '../../fixtures/ui.ts'

// TEST-016 (P18.1): generación mensual de turnos desde ADM-09 (RB-A04, P-044, P-050).
//   - CB-24: mes de 31 días y servicio con vigencia que termina el 15: turnos solo hasta el 15.
//   - CB-08: generar el mes dos veces, la segunda con un servicio nuevo: solo se crean los
//     turnos del servicio nuevo.
//   - CB-09: feriado con un servicio que no trabaja feriados: sin turno ese día.
// `generate_shifts` es global (genera los turnos de TODOS los servicios activos vigentes), por
// eso se usa un mes lejano reservado de este archivo (julio del año lejano del conjunto, 2193 en `base`; 31 días) y la limpieza
// borra los turnos sin asignaciones de ese mes. Sin cuentas de empleado: no hay asignaciones.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

const ANIO = anioLejano()
const MES = 7
const FERIADO = `${ANIO}-07-05`

function diasDelMes(desde: number, hasta: number): string[] {
  return Array.from(
    { length: hasta - desde + 1 },
    (_, i) => `${ANIO}-07-${String(desde + i).padStart(2, '0')}`,
  )
}

test(
  'la generación respeta la vigencia (CB-24), no duplica y la segunda corrida crea solo lo del servicio nuevo (CB-08, CB-09)',
  cubre('RB-A04', 'CB-08', 'CB-09', 'CB-24', 'P-044', 'P-050'),
  async ({ page }) => {
    test.setTimeout(240_000) // ~165 clics de año en el selector de mes, dos veces.
    const sc = new Scenario()
    sc.useFarMonth(ANIO, MES)
    try {
      const client = await sc.client('genera')
      const site = await sc.site(client.id, 'genera')
      await sc.holiday(FERIADO, 'e2e-feriado-generacion')
      const servicioA = await sc.service(client.id, site.id, 'vigencia-al-15', {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        validFrom: `${ANIO}-07-01`,
        validTo: `${ANIO}-07-15`,
      })

      const fechasDe = async (serviceId: string): Promise<string[]> => {
        const { data } = await sc.db
          .from('shifts')
          .select('shift_date')
          .eq('service_id', serviceId)
          .order('shift_date')
        return (data ?? []).map((s) => s.shift_date)
      }

      await test.step('primera generación desde ADM-09: el servicio A genera solo hasta su vigencia (CB-24)', async () => {
        await page.goto('/admin/turnos/generar')
        await pickMonth(page, 'Mes a generar', ANIO, MES)
        await page
          .getByRole('button', { name: 'Generar turnos del mes' })
          .click()
        await expect(page.getByText('Generación terminada')).toBeVisible({
          timeout: 60_000,
        })
        const fechas = await fechasDe(servicioA.id)
        expect(fechas, 'del 1 al 15, aunque julio tenga 31 días').toEqual(
          diasDelMes(1, 15),
        )
        expect(
          fechas,
          'el servicio A trabaja feriados (por omisión): genera el 5',
        ).toContain(FERIADO)
      })

      const servicioB = await sc.service(client.id, site.id, 'sin-feriados', {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        validFrom: `${ANIO}-07-01`,
        validTo: `${ANIO}-07-31`,
        worksOnHolidays: false,
      })

      await test.step('segunda generación con un servicio nuevo: solo se crean los turnos del servicio B (CB-08)', async () => {
        await page
          .getByRole('button', { name: 'Generar turnos del mes' })
          .click()
        // 31 días de julio menos el feriado del 5 que B no trabaja.
        await expect(page.getByText(/Se crearon 30 turnos,/)).toBeVisible({
          timeout: 60_000,
        })
        const fechasB = await fechasDe(servicioB.id)
        expect(fechasB).toHaveLength(30)
        expect(fechasB, 'sin turno el día del feriado (CB-09)').not.toContain(
          FERIADO,
        )
        expect(
          await fechasDe(servicioA.id),
          'el servicio A no se tocó',
        ).toEqual(diasDelMes(1, 15))
      })

      await test.step('una tercera corrida no crea nada (idempotente)', async () => {
        await page
          .getByRole('button', { name: 'Generar turnos del mes' })
          .click()
        await expect(page.getByText(/Se crearon 0 turnos,/)).toBeVisible({
          timeout: 60_000,
        })
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
