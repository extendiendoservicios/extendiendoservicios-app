import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { expect, test, type Page } from '@playwright/test'
import { nombreDe, FIXED_ACCOUNTS } from '../../fixtures/accounts.ts'
import { expectHint } from '../../fixtures/api.ts'
import {
  daysFromToday,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { jpegDecodificable, subirEvidencia } from '../../fixtures/media.ts'
import { FRANJAS_MOVIL, fichar } from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import {
  chooseMenuItem,
  expectNoHorizontalScroll,
  pickDate,
} from '../../fixtures/ui.ts'

// TEST-030 (P21.6, módulo H · evidencia fotográfica), administración en escritorio (1280 px):
//   - ADM-32 Fotos y videos: lista lo subido, filtra, abre el visor, conserva, descarga una y
//     varias en un ZIP (H-08, H-09, H-03);
//   - ADM-06 Detalle del turno y ADM-15 Supervisión: las fotos por persona y la marca «Sin fotos»
//     (H-07);
//   - ADM-25 Servicio y ADM-07 Turno: la casilla «Pide fotos» y que los turnos la heredan (H-07);
//   - ADM-02 y ADM-32: el medidor de espacio en amarillo y rojo (H-14, H-18);
//   - eliminar un servicio con evidencia: SERVICE_HAS_MEDIA (P-014);
//   - quien no es dueño ni administrador no entra a ADM-32 (H-03).
// Las personas que suben son empleado5 (que ningún otro archivo de administración asigna) y
// supervisor2. Los plazos de vencimiento (ADM-28) están en `evidencia-plazos.admin.ts`, que corre
// aparte porque edita la configuración de la empresa.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

const EMPLEADO = 'empleado5' as const
const SUPERVISOR = 'supervisor2' as const

/** Sección de una grilla agrupada por turno (el título lleva cliente y sede). */
function grupo(page: Page, texto: string) {
  return page.getByRole('region', { name: new RegExp(texto) })
}

async function crearTurno(
  sc: Scenario,
  slug: string,
  ventana: { start: string; end: string },
  options: { pideFotos?: boolean; serviceId?: string } = {},
) {
  const cliente = await sc.client(slug)
  const sede = await sc.site(cliente.id, slug)
  const turno = await sc.shift(
    cliente.id,
    sede.id,
    sc.today,
    FRANJAS_MOVIL.diaCompleto,
    2,
    {
      requiresPhotos: options.pideFotos ?? false,
      serviceId: options.serviceId,
    },
  )
  const asignacion = await sc.assign(turno, EMPLEADO, ventana)
  return { cliente, sede, turno, asignacion }
}

test.describe('ADM-32 Fotos y videos', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'lista lo subido por turno, filtra, abre el visor, conserva, descarga una y varias en un ZIP (H-03, H-08, H-09)',
    cubre('H-03', 'H-08', 'H-09', 'P-014'),
    async ({ page }, testInfo) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const a = await crearTurno(sc, 'evid-adm-a', {
          start: '00:00',
          end: '00:05',
        })
        const b = await crearTurno(sc, 'evid-adm-b', {
          start: '00:05',
          end: '00:10',
        })
        const supervision = await sc.assignSupervision(a.turno, SUPERVISOR)
        expect(supervision).toBeTruthy()

        await page.goto('about:blank')
        const jpeg = new Uint8Array(
          await jpegDecodificable(page, { ancho: 640, alto: 480 }),
        )
        const empleado = await sessionClient(EMPLEADO)
        const supervisor = await sessionClient(SUPERVISOR)
        const fotoA1 = await subirEvidencia(empleado, a.turno, { bytes: jpeg })
        await subirEvidencia(empleado, a.turno, { bytes: jpeg })
        await subirEvidencia(empleado, a.turno, {
          kind: 'video',
          durationSeconds: 12,
          bytes: jpeg,
        })
        await subirEvidencia(supervisor, a.turno, { bytes: jpeg })
        await subirEvidencia(empleado, b.turno, { bytes: jpeg })

        await test.step('el medidor de espacio y los turnos con su cantidad', async () => {
          await page.goto('/admin/fotos')
          await expect(
            page.getByRole('heading', { name: 'Espacio usado' }),
          ).toBeVisible()
          await expect(page.getByText(/de 1,0 GB/)).toBeVisible()
          await expect(grupo(page, a.cliente.name)).toBeVisible()
          await expect(grupo(page, a.cliente.name)).toContainText(
            '3 fotos · 1 video',
          )
          await expect(grupo(page, b.cliente.name)).toContainText('1 foto')
          await expect(
            grupo(page, a.cliente.name).getByRole('button', {
              name: /^(Foto|Video) de /,
            }),
          ).toHaveCount(4)
          await expectNoHorizontalScroll(page)
        })

        await test.step('filtra por cliente, por tipo y por persona', async () => {
          await page
            .getByRole('combobox', { name: 'Filtrar por cliente' })
            .click()
          await page.getByRole('option', { name: b.cliente.name }).click()
          await expect(grupo(page, b.cliente.name)).toBeVisible()
          await expect(grupo(page, a.cliente.name)).toHaveCount(0)

          await page
            .getByRole('combobox', { name: 'Filtrar por cliente' })
            .click()
          await page.getByRole('option', { name: 'Todos los clientes' }).click()
          await expect(grupo(page, a.cliente.name)).toBeVisible()

          await page.getByRole('combobox', { name: 'Filtrar por tipo' }).click()
          await page.getByRole('option', { name: 'Solo videos' }).click()
          await expect(grupo(page, a.cliente.name)).toContainText('1 video')
          await expect(grupo(page, a.cliente.name)).not.toContainText('foto')
          await expect(grupo(page, b.cliente.name)).toHaveCount(0)

          await page.getByRole('combobox', { name: 'Filtrar por tipo' }).click()
          await page.getByRole('option', { name: 'Fotos y videos' }).click()

          await page
            .getByRole('combobox', { name: 'Filtrar por persona' })
            .click()
          await page.getByRole('option', { name: nombreDe(SUPERVISOR) }).click()
          await expect(grupo(page, a.cliente.name)).toContainText('1 foto')
          await expect(grupo(page, a.cliente.name)).not.toContainText('video')
          await expect(grupo(page, b.cliente.name)).toHaveCount(0)

          await page
            .getByRole('combobox', { name: 'Filtrar por persona' })
            .click()
          await page.getByRole('option', { name: 'Todas las personas' }).click()
          await expect(grupo(page, a.cliente.name)).toContainText(
            '3 fotos · 1 video',
          )
        })

        await test.step('«Conservadas» arranca vacío; el visor conserva y la marca se refleja en la base y en el filtro', async () => {
          await page
            .getByRole('combobox', { name: 'Filtrar por conservación' })
            .click()
          await page.getByRole('option', { name: 'Conservadas' }).click()
          await expect(
            page.getByText('No hay fotos ni videos con estos filtros'),
          ).toBeVisible()
          await page
            .getByRole('combobox', { name: 'Filtrar por conservación' })
            .click()
          await page.getByRole('option', { name: 'Todas' }).click()

          await grupo(page, a.cliente.name)
            .getByRole('button', { name: /^Foto de / })
            .first()
            .click()
          await expect(page.getByText(/^\d+ de \d+$/)).toBeVisible()
          await page
            .getByRole('button', { name: 'Conservar', exact: true })
            .click()
          await expect(
            page.getByRole('button', { name: 'Dejar de conservar' }),
          ).toBeVisible()
          await expect
            .poll(async () => {
              const { data } = await sc.db
                .from('shift_media')
                .select('id')
                .eq('shift_id', a.turno)
                .eq('keep', true)
              return (data ?? []).length
            })
            .toBe(1)
          const { data: conservada } = await sc.db
            .from('shift_media')
            .select('kept_by, kept_at')
            .eq('shift_id', a.turno)
            .eq('keep', true)
            .single()
          expect(conservada?.kept_by).toBe(readId('admin'))
          expect(conservada?.kept_at).not.toBeNull()
          await page.getByRole('button', { name: 'Cerrar el visor' }).click()

          await page
            .getByRole('combobox', { name: 'Filtrar por conservación' })
            .click()
          await page.getByRole('option', { name: 'Conservadas' }).click()
          await expect(grupo(page, a.cliente.name)).toContainText('1 foto')
          await expect(grupo(page, b.cliente.name)).toHaveCount(0)
          // Se deja de conservar desde el visor.
          await grupo(page, a.cliente.name)
            .getByRole('button', { name: /^Foto de / })
            .first()
            .click()
          await page.getByRole('button', { name: 'Dejar de conservar' }).click()
          await expect(
            page.getByText(
              'Dejamos de conservarlo: vuelve a vencer con el plazo normal.',
            ),
          ).toBeVisible()
          // En la vista «Conservadas» la foto sale de la lista y el visor puede cerrarse solo:
          // Escape cierra el visor si sigue abierto y no hace nada si ya se cerró.
          await page.keyboard.press('Escape')
          await expect(
            page.getByRole('button', { name: 'Cerrar el visor' }),
          ).toHaveCount(0)
          const { data: sinMarca } = await sc.db
            .from('shift_media')
            .select('id')
            .eq('shift_id', a.turno)
            .eq('keep', true)
          expect(sinMarca ?? []).toHaveLength(0)
          await page
            .getByRole('combobox', { name: 'Filtrar por conservación' })
            .click()
          await page.getByRole('option', { name: 'Todas' }).click()
          await expect(grupo(page, a.cliente.name)).toContainText(
            '3 fotos · 1 video',
          )
        })

        await test.step('descarga una foto desde el visor con un nombre legible', async () => {
          await grupo(page, a.cliente.name)
            .getByRole('button', { name: /^Foto de / })
            .first()
            .click()
          const [descarga] = await Promise.all([
            page.waitForEvent('download'),
            page
              .getByRole('button', { name: 'Descargar', exact: true })
              .click(),
          ])
          // AAAA-MM-DD_Cliente_Sede_Persona_NN.jpg
          expect(descarga.suggestedFilename()).toMatch(
            /^\d{4}-\d{2}-\d{2}_[A-Za-z0-9]+_[A-Za-z0-9]+_[A-Za-z0-9]+_01\.jpg$/,
          )
          expect(descarga.suggestedFilename().startsWith(sc.today)).toBe(true)
          const ruta = await descarga.path()
          expect(readFileSync(ruta).length).toBe(jpeg.length)
          await page.getByRole('button', { name: 'Cerrar el visor' }).click()
        })

        await test.step('selecciona varias y baja el ZIP con un archivo por foto y video', async () => {
          await grupo(page, a.cliente.name)
            .getByRole('button', { name: 'Seleccionar todo' })
            .click()
          await expect(
            page.getByRole('region', { name: 'Selección' }),
          ).toContainText('4 seleccionados')
          const [zip] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('button', { name: 'Descargar ZIP' }).click(),
          ])
          expect(zip.suggestedFilename()).toBe(`fotos-y-videos-${sc.today}.zip`)
          const entradas = unzipSync(
            new Uint8Array(readFileSync(await zip.path())),
          )
          const nombres = Object.keys(entradas).sort()
          expect(nombres).toHaveLength(4)
          for (const nombre of nombres) {
            expect(nombre).toMatch(
              /^\d{4}-\d{2}-\d{2}_[A-Za-z0-9]+_[A-Za-z0-9]+_[A-Za-z0-9]+_0[1-4]\.(jpg|mp4)$/,
            )
          }
          // Dos autores distintos y un video: los nombres llevan a la persona y no se pisan.
          expect(nombres.filter((n) => n.endsWith('.mp4'))).toHaveLength(1)
          expect(new Set(nombres).size).toBe(4)
          const parteNombre = nombreDe(SUPERVISOR)
            .split(/[^A-Za-z0-9]+/)
            .filter(Boolean)
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
            .join('')
          expect(nombres.some((n) => n.includes(`_${parteNombre}_`))).toBe(true)
          await expect(page.getByText('Listo: se bajó el ZIP.')).toBeVisible()
          // Terminada la descarga, la selección se limpia.
          await expect(
            page.getByRole('region', { name: 'Selección' }),
          ).toHaveCount(0)
        })

        await test.step('el visor sirve el archivo con una URL firmada (el bucket es privado)', async () => {
          const { data } = await sc.db.storage
            .from('evidence')
            .createSignedUrl(fotoA1.storagePath, 60)
          expect(data?.signedUrl).toContain('/object/sign/evidence/')
          const publica = await fetch(
            data!.signedUrl
              .replace('/object/sign/', '/object/public/')
              .split('?')[0],
          )
          expect(publica.ok).toBe(false)
        })
        testInfo.annotations.push({
          type: 'nota',
          description:
            'ADM-32 probada con la cuenta de administrador con todas las capacidades.',
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'el medidor se ve en amarillo desde el 70 % y en rojo desde el 90 %, en ADM-32 y en el aviso de ADM-02 (H-14, H-18)',
    cubre('H-14', 'H-18'),
    async ({ page }) => {
      test.setTimeout(120_000)
      const usoSimulado = (porcentaje: number, nivel: string) => ({
        total_bytes: Math.round((1024 * 1024 * 1024 * porcentaje) / 100),
        limit_bytes: 1024 * 1024 * 1024,
        percent: porcentaje,
        level: nivel,
        buckets: [
          { bucket: 'evidence', bytes: 700 * 1024 * 1024, objects: 4000 },
          { bucket: 'avatars', bytes: 10 * 1024 * 1024, objects: 30 },
        ],
      })
      // Solo se simula la respuesta del medidor (una suma que no se puede producir con datos
      // de prueba: harían falta 700 MB); el resto de la pantalla es el de verdad.
      let respuesta = usoSimulado(50, 'ok')
      await page.route('**/rest/v1/rpc/storage_usage*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(respuesta),
        }),
      )

      await test.step('por debajo del 70 %: sin aviso en el Resumen', async () => {
        await page.goto('/admin')
        await expect(page.getByText('Resumen').first()).toBeVisible()
        await expect(
          page.getByText(/El espacio de fotos y videos/),
        ).toHaveCount(0)
      })

      await test.step('72 %: amarillo en ADM-32 y aviso «se está llenando» en ADM-02', async () => {
        respuesta = usoSimulado(72, 'warning')
        await page.goto('/admin/fotos')
        const medidor = page.getByRole('region', { name: 'Espacio usado' })
        await expect(medidor.getByText('Se está llenando')).toBeVisible()
        await expect(medidor.getByRole('progressbar')).toHaveAttribute(
          'aria-valuenow',
          '72',
        )
        await expect(medidor.locator('.bg-warning')).toBeVisible()
        await expect(
          medidor.getByText('Fotos y videos de los turnos'),
        ).toBeVisible()
        await page.goto('/admin')
        await expect(
          page.getByText(
            'El espacio de fotos y videos se está llenando: 72 % usado.',
          ),
        ).toBeVisible()
        await page.getByRole('link', { name: 'Ver fotos y videos' }).click()
        await expect(page).toHaveURL(/\/admin\/fotos$/)
      })

      await test.step('93 %: rojo, «casi lleno», y la subida no se bloquea (H-18)', async () => {
        respuesta = usoSimulado(93, 'critical')
        await page.goto('/admin/fotos')
        const medidor = page.getByRole('region', { name: 'Espacio usado' })
        await expect(medidor.getByText('Casi lleno')).toBeVisible()
        await expect(medidor.locator('.bg-danger')).toBeVisible()
        await expect(
          medidor.getByText(/La app no bloquea las subidas/),
        ).toBeVisible()
        await page.goto('/admin')
        await expect(
          page.getByText(
            'El espacio de fotos y videos está casi lleno: 93 % usado.',
          ),
        ).toBeVisible()
      })
    },
  )
})

test.describe('ADM-32 con la cuenta del dueño', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'el dueño ve la sección en la barra lateral y todo lo subido (H-03)',
    cubre('H-03'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const a = await crearTurno(sc, 'evid-dueno', {
          start: '00:00',
          end: '00:05',
        })
        await page.goto('about:blank')
        const jpeg = new Uint8Array(await jpegDecodificable(page))
        await subirEvidencia(await sessionClient(EMPLEADO), a.turno, {
          bytes: jpeg,
        })
        await page.goto('/admin')
        await page.getByRole('link', { name: 'Fotos y videos' }).first().click()
        await expect(page).toHaveURL(/\/admin\/fotos$/)
        await expect(grupo(page, a.cliente.name)).toContainText('1 foto')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('ADM-06 y ADM-15: fotos del turno y marca «Sin fotos»', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'el detalle del turno muestra las fotos por persona, «Pide fotos» y «Sin fotos» (H-07)',
    cubre('H-03', 'H-07'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        // Turno con fotos (pide fotos), turno que las pide y no tiene ninguna, y turno que no las pide.
        const conFotos = await crearTurno(
          sc,
          'evid-adm06-con',
          { start: '00:00', end: '00:05' },
          { pideFotos: true },
        )
        const sinFotos = await crearTurno(
          sc,
          'evid-adm06-sin',
          { start: '00:05', end: '00:10' },
          { pideFotos: true },
        )
        const noPide = await crearTurno(sc, 'evid-adm06-nopide', {
          start: '00:10',
          end: '00:15',
        })
        const supervision = await sc.assignSupervision(
          conFotos.turno,
          SUPERVISOR,
        )

        for (const t of [conFotos, sinFotos, noPide]) {
          await fichar(EMPLEADO, t.asignacion, 'inicio')
        }
        await page.goto('about:blank')
        const jpeg = new Uint8Array(
          await jpegDecodificable(page, { ancho: 640, alto: 480 }),
        )
        await subirEvidencia(await sessionClient(EMPLEADO), conFotos.turno, {
          bytes: jpeg,
        })
        await subirEvidencia(await sessionClient(EMPLEADO), conFotos.turno, {
          bytes: jpeg,
        })
        await subirEvidencia(await sessionClient(SUPERVISOR), conFotos.turno, {
          bytes: jpeg,
        })

        await test.step('con fotos: «Pide fotos», las miniaturas por persona y sin «Sin fotos»', async () => {
          await page.goto(`/admin/turnos/${conFotos.turno}`)
          const seccion = page.locator('section').filter({
            has: page.getByRole('heading', { name: 'Fotos y videos' }),
          })
          await expect(seccion.getByText('Pide fotos')).toBeVisible()
          await expect(seccion.getByText('Sin fotos')).toHaveCount(0)
          await expect(
            seccion.getByRole('region', {
              name: new RegExp(nombreDe(EMPLEADO)),
            }),
          ).toContainText('2 fotos')
          await expect(
            seccion.getByRole('region', {
              name: new RegExp(nombreDe(SUPERVISOR)),
            }),
          ).toContainText('1 foto')
          await seccion
            .getByRole('button', { name: /^Foto de / })
            .first()
            .click()
          await expect(page.getByText(/^1 de 3$/)).toBeVisible()
          await page.getByRole('button', { name: 'Cerrar el visor' }).click()
        })

        await test.step('pide fotos y no hay ninguna: marca «Sin fotos»', async () => {
          await page.goto(`/admin/turnos/${sinFotos.turno}`)
          const seccion = page.locator('section').filter({
            has: page.getByRole('heading', { name: 'Fotos y videos' }),
          })
          await expect(seccion.getByText('Pide fotos')).toBeVisible()
          await expect(seccion.getByText('Sin fotos')).toBeVisible()
        })

        await test.step('no pide fotos: sin marcas, aunque no tenga ninguna', async () => {
          await page.goto(`/admin/turnos/${noPide.turno}`)
          const seccion = page.locator('section').filter({
            has: page.getByRole('heading', { name: 'Fotos y videos' }),
          })
          await expect(seccion).toBeVisible()
          await expect(seccion.getByText('Pide fotos')).toHaveCount(0)
          await expect(seccion.getByText('Sin fotos')).toHaveCount(0)
        })

        await test.step('ADM-15: el detalle de la supervisión muestra lo que subió el supervisor', async () => {
          await page.goto(`/admin/supervisiones/${supervision}`)
          await expect(page.getByText('Fotos y videos').first()).toBeVisible()
          await expect(
            page.getByRole('button', { name: /^Foto de / }),
          ).toHaveCount(1)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('ADM-25 y ADM-07: «Pide fotos»', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'el servicio guarda «Pide fotos»; los turnos que se generan lo heredan y el turno se edita aparte (H-07)',
    cubre('H-07'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('evid-pide')
        const sede = await sc.site(cliente.id, 'evid-pide')
        const nombre = `e2e-evid-pide-${Date.now().toString(36)}`

        await test.step('ADM-25: alta con «Pide fotos» tildada', async () => {
          await page.goto(`/admin/servicios/nuevo?cliente=${cliente.id}`)
          await page.getByRole('combobox', { name: 'Sede' }).click()
          await page.getByRole('option', { name: sede.name }).click()
          await page.getByLabel('Nombre').fill(nombre)
          await page.getByLabel('Lunes').check()
          await page.getByLabel('Desde').first().fill('08:00')
          await page.getByLabel('Hasta').first().fill('12:00')
          const [anio, mes, dia] = sc.today.split('-').map(Number)
          await pickDate(page, 'Vigente desde', {
            year: anio,
            month: mes,
            day: dia,
          })
          const casilla = page.getByLabel('Pide fotos')
          await expect(casilla).not.toBeChecked()
          await casilla.check()
          await page.getByRole('button', { name: 'Crear servicio' }).click()
          await expect(page.getByText('Creamos el servicio.')).toBeVisible()
          const { data } = await sc.db
            .from('services')
            .select('id, requires_photos')
            .eq('name', nombre)
            .single()
          expect(data?.requires_photos).toBe(true)
          sc.extraServiceIds.push(data!.id)
        })

        const { data: servicio } = await sc.db
          .from('services')
          .select('id')
          .eq('name', nombre)
          .single()

        await test.step('ADM-25: al editar la casilla viene tildada; destildarla y guardar lo cambia', async () => {
          await page.goto(`/admin/servicios/${servicio!.id}/editar`)
          const casilla = page.getByLabel('Pide fotos')
          await expect(casilla).toBeChecked()
          await casilla.uncheck()
          await page.getByRole('button', { name: 'Guardar cambios' }).click()
          await expect(
            page.getByText('Guardamos los cambios del servicio.'),
          ).toBeVisible()
          const { data } = await sc.db
            .from('services')
            .select('requires_photos')
            .eq('id', servicio!.id)
            .single()
          expect(data?.requires_photos).toBe(false)
          // Se vuelve a tildar para el paso siguiente.
          await page.goto(`/admin/servicios/${servicio!.id}/editar`)
          await expect(page.getByLabel('Pide fotos')).not.toBeChecked()
          await page.getByLabel('Pide fotos').check()
          await page.getByRole('button', { name: 'Guardar cambios' }).click()
          await expect(
            page.getByText('Guardamos los cambios del servicio.'),
          ).toBeVisible()
        })

        await test.step('el turno insertado a mano nace sin la marca y ADM-07 la edita (turno suelto)', async () => {
          const turno = await sc.shift(
            cliente.id,
            sede.id,
            sc.today,
            FRANJAS_MOVIL.diaCompleto,
            1,
            {
              serviceId: servicio!.id,
            },
          )
          const { data: antes } = await sc.db
            .from('shifts')
            .select('requires_photos')
            .eq('id', turno)
            .single()
          expect(antes?.requires_photos).toBe(false)
          await page.goto(`/admin/turnos/${turno}/editar`)
          const casilla = page.getByLabel('Pide fotos')
          await expect(casilla).not.toBeChecked()
          await casilla.check()
          await page.getByRole('button', { name: 'Guardar cambios' }).click()
          await expect(page.getByText('Actualizamos el turno.')).toBeVisible()
          await expect
            .poll(async () => {
              const { data } = await sc.db
                .from('shifts')
                .select('requires_photos')
                .eq('id', turno)
                .single()
              return data?.requires_photos
            })
            .toBe(true)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'ADM-07: un turno nuevo suelto se crea con «Pide fotos» y create_shift hereda del servicio si no se indica (H-07)',
    cubre('H-07'),
    async () => {
      test.setTimeout(120_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('evid-herencia')
        const sede = await sc.site(cliente.id, 'evid-herencia')
        const conMarca = await sc.service(
          cliente.id,
          sede.id,
          'evid-herencia-si',
          { requiresPhotos: true },
        )
        const sinMarca = await sc.service(
          cliente.id,
          sede.id,
          'evid-herencia-no',
        )
        const dueno = await sessionClient('owner')

        // Un servicio admite un solo turno por fecha: cada turno con servicio va en otro día.
        const crear = async (
          servicioId: string | null,
          marca: boolean | null,
          desde: string,
          hasta: string,
          fecha = sc.today,
        ) => {
          const { data, error } = await dueno.rpc('create_shift', {
            p_client_id: cliente.id,
            p_site_id: sede.id,
            p_date: fecha,
            p_start: desde,
            p_end: hasta,
            p_required_staff: 1,
            ...(servicioId ? { p_service_id: servicioId } : {}),
            ...(marca !== null ? { p_requires_photos: marca } : {}),
          })
          expect(error?.message).toBeUndefined()
          const turno = (
            data as unknown as {
              shift: { id: string; requires_photos: boolean }
            }
          ).shift
          sc.extraShiftIds.push(turno.id)
          return turno.requires_photos
        }
        // Sin servicio y sin indicar: no pide fotos. Indicado a mano: pide fotos.
        expect(await crear(null, null, '08:00', '09:00')).toBe(false)
        expect(await crear(null, true, '09:00', '10:00')).toBe(true)
        // Con servicio que pide fotos y sin indicar: hereda; indicando false, manda lo indicado.
        expect(
          await crear(conMarca.id, null, '10:00', '11:00', daysFromToday(1)),
        ).toBe(true)
        expect(
          await crear(conMarca.id, false, '11:00', '12:00', daysFromToday(2)),
        ).toBe(false)
        expect(
          await crear(sinMarca.id, null, '12:00', '13:00', daysFromToday(1)),
        ).toBe(false)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('eliminar un servicio con evidencia', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'delete_service da SERVICE_HAS_MEDIA, el preview lista SHIFT_MEDIA y la pantalla lo explica en español (P-014)',
    cubre('P-014'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('evid-borrar')
        const sede = await sc.site(cliente.id, 'evid-borrar')
        const servicio = await sc.service(cliente.id, sede.id, 'evid-borrar')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
          1,
          {
            serviceId: servicio.id,
          },
        )
        await sc.assign(turno, EMPLEADO)
        await page.goto('about:blank')
        const jpeg = new Uint8Array(
          await jpegDecodificable(page, { ancho: 320, alto: 240 }),
        )

        await test.step('sin evidencia el preview deja borrar (contraprueba)', async () => {
          const dueno = await sessionClient('owner')
          const { data, error } = await dueno.rpc('service_delete_preview', {
            p_service_id: servicio.id,
          })
          expect(error?.message).toBeUndefined()
          expect((data as unknown as { can_delete: boolean }).can_delete).toBe(
            true,
          )
        })

        await subirEvidencia(await sessionClient(EMPLEADO), turno, {
          bytes: jpeg,
        })

        await test.step('por API: SERVICE_HAS_MEDIA y el preview lo lista', async () => {
          const dueno = await sessionClient('owner')
          expectHint(
            await dueno.rpc('delete_service', { p_service_id: servicio.id }),
            'SERVICE_HAS_MEDIA',
          )
          const { data } = await dueno.rpc('service_delete_preview', {
            p_service_id: servicio.id,
          })
          const preview = data as unknown as {
            can_delete: boolean
            blocking_shifts: Array<{ shift_id: string; reasons: string[] }>
          }
          expect(preview.can_delete).toBe(false)
          expect(
            preview.blocking_shifts.find((s) => s.shift_id === turno)?.reasons,
          ).toContain('SHIFT_MEDIA')
          const { data: existe } = await sc.db
            .from('services')
            .select('id')
            .eq('id', servicio.id)
          expect(existe ?? []).toHaveLength(1)
        })

        await test.step('en la pantalla: el diálogo explica que hay fotos o videos y ofrece «Dar de baja»', async () => {
          await page.goto(`/admin/clientes/${cliente.id}?pestana=servicios`)
          await chooseMenuItem(
            page,
            `Acciones para ${servicio.name}`,
            'Eliminar',
          )
          const dialogo = page.getByRole('dialog')
          await expect(
            dialogo.getByText('Este servicio no se puede eliminar.'),
          ).toBeVisible()
          await expect(dialogo.getByText(/fotos o videos/)).toBeVisible()
          await expect(
            dialogo.getByRole('button', { name: 'Dar de baja' }),
          ).toBeVisible()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('quién no entra a ADM-32', () => {
  for (const cuenta of ['empleado5', 'supervisor2'] as const) {
    test.describe(cuenta, () => {
      test.use({ storageState: storageStatePath(cuenta) })
      test(
        `${cuenta} no entra a /admin/fotos (H-03)`,
        cubre('H-03', 'CB-17'),
        async ({ page }) => {
          await page.goto('/admin/fotos')
          await expect(page).not.toHaveURL(/\/admin\/fotos/)
          await expect(page.getByText('Espacio usado')).toHaveCount(0)
          expect(FIXED_ACCOUNTS[cuenta].email).toBeTruthy()
        },
      )
    })
  }
})
