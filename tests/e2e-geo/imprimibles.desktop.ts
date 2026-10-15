import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../fixtures/accounts.ts'
import { daysFromToday, todayAR } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { cargarJornadaConGeo, sedeGeo, SEDE_COORDS } from './helpers/geo.ts'

// P22.5 · Imprimibles con la validación (B-20): en la hoja de asistencia de la ficha del empleado
// (AJ-06, «Descargar detalle») y en el resumen de servicios por cliente (AJ-09, «Descargar
// resumen») alcanza con «Validado», «Fuera de zona (350 m)» o «Sin validar», SIN coordenadas.
// Si inicio y fin dieron lo mismo se escribe una sola vez; si no, «Inicio: … · Fin: …».
// Las jornadas se cargan con la validación ya calculada (clave de servicio): no dependen de la hora
// ni de la posición de nadie. Cuentas: empleado1 a empleado4; mira `admin`.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('admin') })

declare global {
  interface Window {
    __impresiones?: number
  }
}

/** Reemplaza `window.print` por un contador: la prueba nunca abre el diálogo de impresión. */
async function interceptarImpresion(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__impresiones = 0
    window.print = () => {
      window.__impresiones = (window.__impresiones ?? 0) + 1
    }
  })
}

const SIN_COORDENADAS = [
  String(SEDE_COORDS.lat).slice(0, 7),
  String(SEDE_COORDS.lng).slice(0, 7),
  /latitud|longitud|accuracy|precisión del gps/i,
] as const

test(
  'AJ-06: la hoja de asistencia de la ficha trae la columna «Validación» con el texto del plan y sin coordenadas',
  cubre('RB-A06', 'RB-A08', 'P-102', 'B-09', 'B-20', 'B-40'),
  async ({ page }) => {
    test.setTimeout(240_000)
    await interceptarImpresion(page)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('geo-imprimible-ficha')
      const franja = { start: '08:00', end: '11:00' }
      const jornada = (
        dias: number,
        slug: string,
        inicio: Parameters<typeof cargarJornadaConGeo>[1]['inicio'],
        fin: Parameters<typeof cargarJornadaConGeo>[1]['fin'],
      ) =>
        sedeGeo(sc, cliente, slug).then((sede) =>
          cargarJornadaConGeo(sc, {
            cliente,
            sede,
            fecha: daysFromToday(dias),
            franja,
            quien: 'empleado1',
            entrada: '08:00:30',
            salida: '11:00:30',
            inicio,
            fin,
          }).then(() => sede),
        )
      const sedeMixta = await jornada(
        -1,
        'ficha-mixta',
        { estado: 'outside', distanciaM: 350 },
        { estado: 'valid' },
      )
      const sedeValida = await jornada(
        -2,
        'ficha-valida',
        { estado: 'valid' },
        { estado: 'valid' },
      )
      const sedeGris = await jornada(
        -3,
        'ficha-gris',
        { estado: 'unvalidated' },
        { estado: 'unvalidated' },
      )
      const sedeCorregida = await jornada(
        -4,
        'ficha-corregida',
        { estado: 'outside', distanciaM: 220, corregido: true },
        { estado: 'valid' },
      )
      const sedeFuera = await jornada(
        -5,
        'ficha-fuera',
        { estado: 'outside', distanciaM: 1500 },
        { estado: 'outside', distanciaM: 1200 },
      )

      await page.goto(`/admin/empleados/${readId('empleado1')}`)
      await page.getByRole('tab', { name: 'Asistencia' }).click()

      await test.step('en la pestaña: la columna «Validación» con el resultado de cada turno', async () => {
        const tabla = page.getByRole('table', {
          name: 'Historial de asistencia',
        })
        await expect(
          tabla.getByRole('columnheader', { name: 'Validación' }),
        ).toBeVisible()
        const fila = (sede: { name: string }) =>
          tabla.getByRole('row').filter({ hasText: sede.name })
        await expect(fila(sedeValida)).toContainText('Validado')
        await expect(fila(sedeGris)).toContainText('Sin validar')
        await expect(fila(sedeCorregida)).toContainText('Validado (corregido)')
        await expect(fila(sedeFuera)).toContainText('Fuera de zona')
        await expect(fila(sedeMixta)).toContainText('Fuera de zona')
      })

      await test.step('en la hoja imprimible: texto plano del plan, sin coordenadas', async () => {
        await page.getByRole('button', { name: 'Descargar detalle' }).click()
        const hoja = page.getByRole('dialog', {
          name: new RegExp(
            `^Detalle de asistencia - ${nombreDe('empleado1')} - `,
          ),
        })
        await expect(hoja).toBeVisible()
        await expect(
          hoja.getByRole('columnheader', { name: 'Validación', exact: true }),
        ).toBeVisible()
        const celdaDe = (sede: { name: string }) =>
          hoja.getByRole('row').filter({ hasText: sede.name })
        // Inicio y fin distintos: «Inicio: … · Fin: …», con la distancia solo del que quedó afuera.
        await expect(celdaDe(sedeMixta)).toContainText(
          'Inicio: Fuera de zona (350 m) · Fin: Validado',
        )
        // Iguales: una sola vez.
        await expect(
          celdaDe(sedeValida).getByRole('cell', {
            name: 'Validado',
            exact: true,
          }),
        ).toHaveCount(1)
        await expect(
          celdaDe(sedeGris).getByRole('cell', {
            name: 'Sin validar',
            exact: true,
          }),
        ).toHaveCount(1)
        await expect(celdaDe(sedeFuera)).toContainText(
          'Inicio: Fuera de zona (1,5 km) · Fin: Fuera de zona (1,2 km)',
        )
        // Corregida por la administración: «Validado (corregido)» (B-09) y nunca el motivo.
        await expect(celdaDe(sedeCorregida)).toContainText(
          'Inicio: Validado (corregido) · Fin: Validado',
        )
        const texto = await hoja.innerText()
        for (const prohibido of SIN_COORDENADAS) {
          if (typeof prohibido === 'string')
            expect(texto).not.toContain(prohibido)
          else expect(texto).not.toMatch(prohibido)
        }
        expect(texto).not.toContain('corregido por la administración')
        await hoja
          .getByRole('button', { name: 'Imprimir o guardar como PDF' })
          .click()
        expect(await page.evaluate(() => window.__impresiones)).toBe(1)
        await hoja.getByRole('button', { name: 'Cerrar' }).click()
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'AJ-09: el resumen de servicios por cliente imprime la validación de cada persona, sin coordenadas, y «—» a quien no ficha',
  cubre('RB-A06', 'RB-A01', 'P-102', 'B-09', 'B-20', 'B-40'),
  async ({ page }) => {
    test.setTimeout(240_000)
    await interceptarImpresion(page)
    const hoy = todayAR()
    const sc = new Scenario()
    try {
      const cliente = await sc.client('geo-imprimible-resumen')
      const sedeA = await sedeGeo(sc, cliente, 'resumen-a')
      const sedeB = await sedeGeo(sc, cliente, 'resumen-b')
      const sedeC = await sedeGeo(sc, cliente, 'resumen-c')
      const sedeD = await sedeGeo(sc, cliente, 'resumen-d')
      const franja = { start: '08:00', end: '11:00' }
      const cargar = (
        sede: typeof sedeA,
        quien: 'empleado1' | 'empleado2' | 'empleado3' | 'empleado4',
        inicio: Parameters<typeof cargarJornadaConGeo>[1]['inicio'],
        fin: Parameters<typeof cargarJornadaConGeo>[1]['fin'],
      ) =>
        cargarJornadaConGeo(sc, {
          cliente,
          sede,
          fecha: hoy,
          franja,
          quien,
          entrada: '08:00:30',
          salida: '11:00:30',
          inicio,
          fin,
        })
      await cargar(
        sedeA,
        'empleado1',
        { estado: 'outside', distanciaM: 350 },
        { estado: 'valid' },
      )
      await cargar(sedeB, 'empleado2', { estado: 'valid' }, { estado: 'valid' })
      await cargar(
        sedeC,
        'empleado3',
        { estado: 'unvalidated' },
        { estado: 'unvalidated' },
      )
      await cargar(
        sedeD,
        'empleado4',
        { estado: 'outside', distanciaM: 640, corregido: true },
        { estado: 'valid' },
      )

      await page.goto(`/admin/clientes/${cliente.id}`)
      await page.getByRole('tab', { name: 'Resumen de servicios' }).click()
      await expect(
        page.getByRole('table', { name: 'Turnos realizados del período' }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Descargar resumen' }).click()
      const hoja = page.getByRole('dialog', {
        name: new RegExp(`^Resumen de servicios - ${cliente.name} - `),
      })
      await expect(hoja).toBeVisible()
      await expect(
        hoja.getByRole('columnheader', { name: 'Validación', exact: true }),
      ).toBeVisible()
      const fila = (sede: { name: string }) =>
        hoja.getByRole('row').filter({ hasText: sede.name })
      await expect(fila(sedeA)).toContainText(
        nombreDe('empleado1').split(' ').reverse()[0],
      )
      await expect(fila(sedeA)).toContainText(
        'Inicio: Fuera de zona (350 m) · Fin: Validado',
      )
      await expect(
        fila(sedeB).getByRole('cell', { name: 'Validado', exact: true }),
      ).toHaveCount(1)
      await expect(
        fila(sedeC).getByRole('cell', { name: 'Sin validar', exact: true }),
      ).toHaveCount(1)
      await expect(fila(sedeD)).toContainText(
        'Inicio: Validado (corregido) · Fin: Validado',
      )
      const texto = await hoja.innerText()
      for (const prohibido of SIN_COORDENADAS) {
        if (typeof prohibido === 'string')
          expect(texto).not.toContain(prohibido)
        else expect(texto).not.toMatch(prohibido)
      }
      expect(texto).not.toContain('corregido por la administración')
      await hoja
        .getByRole('button', { name: 'Imprimir o guardar como PDF' })
        .click()
      expect(await page.evaluate(() => window.__impresiones)).toBe(1)
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
