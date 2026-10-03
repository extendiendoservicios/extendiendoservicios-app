import { expect, test } from '@playwright/test'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario, uniqueCuit, uniqueName } from '../../fixtures/scenario.ts'
import {
  readId,
  signedClient,
  storageStatePath,
} from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { interceptMapRequests, pickDate, pickMonth } from '../../fixtures/ui.ts'

// TEST-016 (P18.1): RECORRIDO DE PUNTA A PUNTA DEL ADMINISTRADOR (cuenta fija `admin`, con las
// siete capacidades; no es el dueño). Cubre los flujos críticos 3, 4, 7 y 8 de
// `03_Plan_Maestro_Tecnico.md` sección 14.2 encadenados sobre los MISMOS datos, cada paso con el
// resultado del anterior:
//   cliente y contacto (ADM-20/21) -> sede con coordenadas y mapa (ADM-23/24) -> servicio
//   (ADM-25) -> plantilla de tareas (ADM-26) -> generación del mes (ADM-09) -> cronograma y
//   asignación (ADM-05/06/08) -> asistencia en nombre del empleado (ADM-10/11) -> supervisión y
//   calificación (ADM-14/15) -> tablero (ADM-02).
// El mes de la generación es lejano y reservado de este archivo (agosto de 2193, 31 días): la
// generación es global y no se debe tocar la operación real. Empleado: empleado1 (franja de
// madrugada 00:02–00:03, que ya terminó a cualquier hora del día); supervisor: supervisor2.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

const ANIO = 2193
const MES = 8
const DIA_LEJANO = `${ANIO}-08-03`

test(
  'el administrador recorre clientes, servicios, generación, asignación, asistencia, supervisión y tablero',
  cubre(
    'RB-A03',
    'RB-A04',
    'RB-A05',
    'RB-A06',
    'RB-A07',
    'RB-A08',
    'RB-A09',
    'RB-S02',
  ),
  async ({ page }) => {
    test.setTimeout(420_000)
    const sc = new Scenario()
    sc.useFarMonth(ANIO, MES)
    const nombreCliente = uniqueName('recorrido-cliente')
    const nombreSede = uniqueName('recorrido-sede')
    const nombreServicio = uniqueName('recorrido-servicio')
    const nombreContacto = 'Contacto Recorrido'
    let clienteId = ''
    let sedeId = ''
    let servicioId = ''

    await interceptMapRequests(page)

    try {
      await test.step('ADM-20/21: alta del cliente con su contacto principal', async () => {
        await page.goto('/admin/clientes/nuevo')
        await page.getByLabel('Razón social').fill(nombreCliente)
        await page.getByLabel('CUIT').fill(uniqueCuit())
        await page.getByRole('button', { name: 'Crear cliente' }).click()
        await expect(page.getByText('Creamos el cliente.')).toBeVisible()
        await expect(page).toHaveURL(/\/admin\/clientes\/[0-9a-f-]+$/)
        clienteId = page.url().split('/clientes/')[1]
        sc.clientIds.push(clienteId) // la limpieza lo borra aunque el test se corte

        await page.getByRole('tab', { name: 'Contactos' }).click()
        await page.getByRole('button', { name: 'Nuevo contacto' }).click()
        await page.getByLabel('Nombre').fill(nombreContacto)
        await page.getByLabel('Teléfono').fill('1122334455')
        await page.getByLabel('Contacto principal').check()
        await page.getByRole('button', { name: 'Guardar' }).click()
        await expect(page.getByText('Agregamos el contacto.')).toBeVisible()
        await expect(
          page.getByRole('listitem').filter({ hasText: nombreContacto }),
        ).toContainText('Principal')
      })

      await test.step('ADM-23/24: alta de la sede con coordenadas; aparece en el mapa', async () => {
        await page.goto(`/admin/sedes/nueva?cliente=${clienteId}`)
        await page.getByLabel('Nombre').fill(nombreSede)
        await page
          .getByLabel('Dirección', { exact: true })
          .fill('Av. Corrientes 1234')
        await page.getByLabel('Localidad').fill('CABA')
        await page.getByLabel('Latitud').fill('-34.6037')
        await page.getByLabel('Longitud').fill('-58.3816')
        await page.getByRole('button', { name: 'Crear sede' }).click()
        await expect(page.getByText('Creamos la sede.')).toBeVisible()
        await expect(page).toHaveURL(/\/admin\/sedes\/[0-9a-f-]+$/)
        sedeId = page.url().split('/sedes/')[1]

        await page.goto('/admin/clientes?pestana=mapa')
        await page
          .getByRole('combobox', { name: 'Filtrar por cliente' })
          .click()
        await page.getByRole('option', { name: nombreCliente }).click()
        await expect(
          page.getByRole('button', {
            name: `${nombreCliente} — ${nombreSede}`,
          }),
        ).toBeVisible()
      })

      await test.step('ADM-25: alta del servicio diario con vigencia desde agosto de 2193', async () => {
        await page.goto(`/admin/servicios/nuevo?cliente=${clienteId}`)
        await page.getByRole('combobox', { name: 'Sede' }).click()
        await page.getByRole('option', { name: nombreSede }).click()
        await page.getByLabel('Nombre').fill(nombreServicio)
        for (const dia of [
          'Lunes',
          'Martes',
          'Miércoles',
          'Jueves',
          'Viernes',
          'Sábado',
          'Domingo',
        ]) {
          await page.getByLabel(dia).check()
        }
        await page.getByLabel('Desde').first().fill('08:00')
        await page.getByLabel('Hasta').first().fill('12:00')
        await pickDate(page, 'Vigente desde', {
          year: ANIO,
          month: MES,
          day: 1,
        })
        await page.getByRole('button', { name: 'Crear servicio' }).click()
        await expect(page.getByText('Creamos el servicio.')).toBeVisible()
        await expect(page).toHaveURL(
          new RegExp(`/admin/clientes/${clienteId}\\?pestana=servicios`),
        )
        await expect(page.getByText(nombreServicio)).toBeVisible()
        const { data } = await sc.db
          .from('services')
          .select('id')
          .eq('name', nombreServicio)
          .single()
        servicioId = data!.id
      })

      await test.step('ADM-26: plantilla de tareas del cliente con dos ítems', async () => {
        await page.goto(`/admin/tareas?cliente=${clienteId}`)
        await page
          .getByRole('button', { name: 'Crear plantilla del cliente' })
          .click()
        await expect(
          page.getByText('Creamos la plantilla del cliente.').last(),
        ).toBeVisible()
        for (const titulo of ['Barrer el sector', 'Vaciar los canastos']) {
          await page.getByRole('button', { name: 'Agregar ítem' }).click()
          await page.getByLabel('Título').fill(titulo)
          await page.getByRole('button', { name: 'Guardar' }).click()
          // El toast "Agregamos el ítem." del ítem anterior puede seguir en pantalla: se espera
          // al ítem mismo en la lista, así el siguiente paso no arranca antes de que se guarde.
          await expect(page.getByText(titulo, { exact: true })).toBeVisible()
        }
      })

      await test.step('ADM-09: generación de agosto de 2193; los turnos nacen con las tareas de la plantilla', async () => {
        await page.goto('/admin/turnos/generar')
        await pickMonth(page, 'Mes a generar', ANIO, MES)
        await page
          .getByRole('button', { name: 'Generar turnos del mes' })
          .click()
        await expect(page.getByText('Generación terminada')).toBeVisible({
          timeout: 60_000,
        })
        const { data: turnos } = await sc.db
          .from('shifts')
          .select('id, shift_date')
          .eq('service_id', servicioId)
          .order('shift_date')
        expect(turnos, 'un turno por día del mes').toHaveLength(31)
        const { data: tareas } = await sc.db
          .from('shift_tasks')
          .select('title')
          .eq('shift_id', turnos![2].id)
          .order('position')
        expect(tareas?.map((t) => t.title)).toEqual([
          'Barrer el sector',
          'Vaciar los canastos',
        ])
      })

      await test.step('ADM-05/06/08: ve el turno del 3 de agosto en el cronograma y le asigna un empleado', async () => {
        await page.goto(`/admin/planificacion?vista=dia&fecha=${DIA_LEJANO}`)
        const fila = page.getByRole('row').filter({ hasText: nombreCliente })
        await expect(fila).toContainText('0/1')
        await expect(fila).toContainText('Programado')
        await fila.getByRole('link', { name: 'Ver' }).click()

        const detalle = page.getByRole('dialog', { name: 'Detalle del turno' })
        await expect(detalle.getByText('Barrer el sector')).toBeVisible()
        await expect(detalle.getByText('Vaciar los canastos')).toBeVisible()
        await detalle.getByRole('button', { name: 'Asignar empleado' }).click()
        const hoja = page.getByRole('dialog', { name: 'Asignar empleado' })
        await hoja.getByRole('radio', { name: /E2E-Fijo Empleado1/ }).click()
        await hoja.getByRole('button', { name: 'Asignar', exact: true }).click()
        await expect(page.getByText('Asignamos al empleado.')).toBeVisible()
        await expect(detalle.getByText('Dotación: 1/1')).toBeVisible()

        const { data } = await sc.db
          .from('shifts')
          .select('status')
          .eq('service_id', servicioId)
          .eq('shift_date', DIA_LEJANO)
          .single()
        expect(data?.status).toBe('assigned')
      })

      // El resto del recorrido ocurre "hoy": un turno de la madrugada (ya terminó a cualquier
      // hora) del mismo cliente y la misma sede, con el empleado asignado.
      const turnoHoy = await sc.shift(
        clienteId,
        sedeId,
        sc.today,
        FRANJAS.madrugada2,
      )
      await sc.assign(turnoHoy, 'empleado1')
      const cargarHora = (hhmm: string) => `${sc.today}T${hhmm}`

      await test.step('ADM-10: la asignación sin registro figura como "Sin registro"', async () => {
        await page.goto('/admin/asistencia')
        await page.getByPlaceholder('Buscar por nombre…').fill('Empleado1')
        await expect(
          page.getByRole('row').filter({ hasText: nombreCliente }),
        ).toContainText('Sin registro')
      })

      let supervisionId = ''
      await test.step('ADM-14: asigna una supervisión al turno de hoy (todavía sin cerrar)', async () => {
        await page.goto('/admin/supervisiones')
        await page.getByRole('link', { name: 'Asignar supervisión' }).click()
        const hoja = page.getByRole('dialog', { name: 'Asignar supervisión' })
        await hoja.getByRole('combobox', { name: 'Turno' }).click()
        await page
          .getByRole('option', {
            name: new RegExp(`${nombreCliente}.*${nombreSede}.*00:02–00:03`),
          })
          .click()
        await hoja.getByRole('combobox', { name: 'Supervisor' }).click()
        await page.getByRole('option', { name: 'E2E-Fijo Supervisor2' }).click()
        await hoja.getByRole('button', { name: 'Asignar supervisión' }).click()
        await expect(page.getByText('Asignamos al supervisor.')).toBeVisible()
        const { data: supervision } = await sc.db
          .from('supervisions')
          .select('id, status')
          .eq('shift_id', turnoHoy)
          .single()
        expect(supervision?.status).toBe('assigned')
        supervisionId = supervision!.id
        await page.goto(`/admin/supervisiones/${supervisionId}`)
        await expect(
          page.getByRole('dialog', { name: 'Detalle de la supervisión' }),
        ).toContainText('Asignada')
      })

      await test.step('ADM-11: registra el inicio y el fin en nombre del empleado', async () => {
        await page.goto(`/admin/turnos/${turnoHoy}`)
        await page.getByRole('button', { name: 'Registrar en nombre' }).click()
        await page.getByLabel('Hora').fill(cargarHora('00:02'))
        await page
          .getByLabel('Motivo')
          .fill('e2e: avisó por teléfono que ya había llegado')
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(page.getByText('Registramos el inicio.')).toBeVisible()

        await page.getByRole('button', { name: 'Registrar en nombre' }).click()
        await page.getByRole('combobox', { name: 'Elegir acción' }).click()
        await page.getByRole('option', { name: 'Fin', exact: true }).click()
        await page.getByLabel('Hora').fill(cargarHora('00:03'))
        await page
          .getByLabel('Motivo')
          .fill('e2e: avisó por teléfono que ya terminó')
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await expect(page.getByText('Registramos el fin.')).toBeVisible()

        const { data: turno } = await sc.db
          .from('shifts')
          .select('status')
          .eq('id', turnoHoy)
          .single()
        expect(
          turno?.status,
          'con el único empleado finalizado, el turno se completa',
        ).toBe('completed')
      })

      await test.step('ADM-15: el supervisor recorre el turno; la administración califica y la supervisión se completa', async () => {
        // El recorrido del supervisor desde su celular lo cubre `tests/e2e-supervisiones/`: acá se
        // hace por API para encadenar el resultado con la pantalla de administración.
        const supervisor = await signedClient('supervisor2')
        const inicio = await supervisor.rpc('supervision_check_in', {
          p_supervision_id: supervisionId,
        })
        expect(inicio.error, inicio.error?.message).toBeNull()
        const fin = await supervisor.rpc('supervision_check_out', {
          p_supervision_id: supervisionId,
        })
        expect(fin.error, fin.error?.message).toBeNull()

        await page.goto(`/admin/supervisiones/${supervisionId}`)
        const detalle = page.getByRole('dialog', {
          name: 'Detalle de la supervisión',
        })
        await detalle.getByRole('button', { name: 'Calificar' }).click()
        const dialogo = page.getByRole('dialog', { name: /^Calificar a/ })
        await dialogo.getByRole('radio', { name: '4 de 5 estrellas' }).click()
        await dialogo
          .getByLabel('Comentario (opcional)')
          .fill('e2e: cumple con lo pedido')
        await dialogo.getByRole('button', { name: 'Guardar' }).click()
        await expect(dialogo).toBeHidden()
        await expect(
          detalle.getByRole('img', { name: '4 de 5 estrellas' }),
        ).toBeVisible()
        await expect(
          detalle.getByText('e2e: cumple con lo pedido'),
        ).toBeVisible()
        const { data } = await sc.db
          .from('ratings')
          .select('score, created_by')
          .eq('supervision_id', supervisionId)
          .single()
        expect(data?.score).toBe(4)
        expect(
          data?.created_by,
          'la calificación la cargó la administradora',
        ).toBe(readId('admin'))

        const cierre = await supervisor.rpc('complete_supervision', {
          p_supervision_id: supervisionId,
          p_general_notes: 'e2e: recorrido sin novedades',
        })
        expect(cierre.error, cierre.error?.message).toBeNull()
        await page.reload()
        await expect(
          page.getByRole('dialog', { name: 'Detalle de la supervisión' }),
        ).toContainText('Completada')
      })

      await test.step('ADM-02: el tablero refleja lo operado hoy', async () => {
        await page.goto('/admin')
        const filas = page
          .getByRole('region', { name: 'Servicios de hoy' })
          .getByRole('row')
          .filter({ hasText: nombreCliente })
        await expect(filas.first()).toContainText('E2E-Fijo Empleado1')
        await expect(
          page.getByRole('region', { name: 'Supervisiones de hoy' }),
        ).toContainText(nombreCliente)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
