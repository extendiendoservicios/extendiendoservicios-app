import { expect, test, type Page } from '@playwright/test'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  jpegDecodificable,
  objetosDeEvidencia,
  simularDuracionDeVideo,
  subirEvidencia,
  webmCorto,
} from '../../fixtures/media.ts'
import {
  fichar,
  FRANJAS_MOVIL,
  fijarConsentimiento,
  marcarCambiosVistos,
  continuarTrasFichar,
} from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// TEST-030 (P21.6, módulo H · evidencia fotográfica), lado empleado en el celular (390 px):
// EMP-07 (sacar o elegir foto, contador, miniatura, quitar, topes, sede sin fotos, video largo),
// EMP-10 (advertencia «pide fotos» y «Finalizar igual») y EMP-11 (agregar una foto después de
// finalizar, cantidad subida). Cuenta de este archivo: empleado5 (ningún otro archivo de empleado
// la usa). Trazabilidad: H-01 a H-07, H-11, H-13, H-15 (modulos/H_evidencia_fotografica.md) y P-014.
// El consentimiento de ubicación queda dado y el navegador la niega: acá no se prueba la posición.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('empleado5') })
test.use({ permissions: [] })

const EMPLEADO = 'empleado5' as const

interface Preparado {
  sc: Scenario
  turno: string
  asignacion: string
  clienteId: string
}

/** Cliente, sede, turno de hoy a todo el día y empleado5 con el inicio ya registrado. */
async function prepararTurno(
  slug: string,
  options: { pideFotos?: boolean; sedeSinFotos?: boolean } = {},
): Promise<Preparado> {
  const sc = new Scenario()
  const cliente = await sc.client(slug)
  const sede = await sc.site(cliente.id, slug, undefined, {
    photosNotAllowed: options.sedeSinFotos ?? false,
  })
  const turno = await sc.shift(
    cliente.id,
    sede.id,
    sc.today,
    FRANJAS_MOVIL.diaCompleto,
    1,
    { requiresPhotos: options.pideFotos ?? false },
  )
  const asignacion = await sc.assign(turno, EMPLEADO)
  await fijarConsentimiento(EMPLEADO, true)
  await marcarCambiosVistos(EMPLEADO)
  await fichar(EMPLEADO, asignacion, 'inicio')
  return { sc, turno, asignacion, clienteId: cliente.id }
}

/** Espera a que el bloque «Fotos y videos» (que se carga en diferido) esté en pantalla. */
async function esperarBloque(page: Page): Promise<void> {
  await expect(
    page
      .getByRole('group', { name: 'Topes del turno' })
      .or(page.getByText('En esta sede no se permiten fotos.')),
  ).toBeVisible()
}

async function filasDelTurno(sc: Scenario, turno: string) {
  const { data, error } = await sc.db
    .from('shift_media')
    .select(
      'id, kind, storage_path, thumb_path, width, height, size_bytes, confirmed_at, removed_at, assignment_id, supervision_id',
    )
    .eq('shift_id', turno)
    .order('created_at')
  expect(error?.message).toBeUndefined()
  return data ?? []
}

test(
  'EMP-07: elige una foto de la galería, ve el contador y la miniatura, y la quita (H-01, H-04, H-05, H-15)',
  cubre('H-01', 'H-04', 'H-05', 'H-15', 'P-014'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const { sc, turno, asignacion } = await prepararTurno('evid-galeria', {
      pideFotos: true,
    })
    try {
      await page.goto(`/app/en-curso/${asignacion}`)
      await esperarBloque(page)

      await test.step('el bloque avisa que el servicio pide fotos y arranca en 0', async () => {
        await expect(page.getByText('Este servicio pide fotos.')).toBeVisible()
        await expect(page.getByText('0 de 10 fotos')).toBeVisible()
        await expect(page.getByText('0 de 2 videos')).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Sacar foto' }),
        ).toBeEnabled()
        await expect(
          page.getByRole('button', { name: 'Elegir de la galería' }),
        ).toBeEnabled()
        await expectNoHorizontalScroll(page)
      })

      await test.step('elegir de la galería: se comprime, se sube y aparece el contador y la miniatura', async () => {
        const jpeg = await jpegDecodificable(page, { ancho: 2400, alto: 1800 })
        await page.getByTestId('media-gallery-input').setInputFiles({
          name: 'e2e-galeria.jpg',
          mimeType: 'image/jpeg',
          buffer: jpeg,
        })
        await expect(page.getByText('1 de 10 fotos')).toBeVisible()
        const miniatura = page.getByRole('button', {
          name: /^Foto de las \d{2}:\d{2}/,
        })
        await expect(miniatura).toBeVisible()
        // La miniatura es una URL firmada que el navegador pudo bajar y decodificar.
        await expect
          .poll(() =>
            miniatura
              .locator('img')
              .evaluate(
                (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
              ),
          )
          .toBe(true)
        await expectNoHorizontalScroll(page)
      })

      await test.step('en la base: una fila confirmada del empleado, comprimida a 1280 px o menos y sin metadatos de más', async () => {
        const filas = await filasDelTurno(sc, turno)
        expect(filas).toHaveLength(1)
        const fila = filas[0]
        expect(fila.kind).toBe('photo')
        expect(fila.confirmed_at).not.toBeNull()
        expect(fila.removed_at).toBeNull()
        expect(fila.assignment_id).toBe(asignacion)
        expect(fila.supervision_id).toBeNull()
        expect(Math.max(fila.width ?? 0, fila.height ?? 0)).toBeLessThanOrEqual(
          1280,
        )
        expect(fila.width).toBe(1280)
        expect(fila.height).toBe(960)
        // «unos 150 KB» (H-05) más la miniatura de ~20 KB: nunca más de 400 KB para esta imagen.
        expect(fila.size_bytes).toBeLessThan(400 * 1024)
        const objetos = await objetosDeEvidencia(sc.db)
        expect(objetos).toContain(fila.storage_path)
        expect(objetos).toContain(fila.thumb_path)
      })

      await test.step('el visor la abre; «Quitar» pide confirmación y la saca (H-15)', async () => {
        await page
          .getByRole('button', { name: /^Foto de las \d{2}:\d{2}/ })
          .click()
        await expect(page.getByText('1 de 1', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Quitar' }).click()
        await expect(
          page.getByRole('heading', { name: '¿Quitar esta foto?' }),
        ).toBeVisible()
        // Cancelar no quita nada.
        await page.getByRole('button', { name: 'Cancelar' }).click()
        await expect(page.getByText('1 de 10 fotos')).toBeVisible()
        expect((await filasDelTurno(sc, turno))[0].removed_at).toBeNull()

        await page
          .getByRole('button', { name: /^Foto de las \d{2}:\d{2}/ })
          .click()
        await page.getByRole('button', { name: 'Quitar' }).click()
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Quitar' })
          .click()
        await expect(page.getByText('0 de 10 fotos')).toBeVisible()
        await expect(
          page.getByRole('button', { name: /^Foto de las/ }),
        ).toHaveCount(0)
      })

      await test.step('en la base: la fila queda como constancia (sin borrado físico) y el archivo desaparece', async () => {
        const filas = await filasDelTurno(sc, turno)
        expect(filas).toHaveLength(1)
        expect(filas[0].removed_at).not.toBeNull()
        await expect
          .poll(async () => {
            const objetos = await objetosDeEvidencia(sc.db)
            return (
              objetos.includes(filas[0].storage_path) ||
              objetos.includes(filas[0].thumb_path)
            )
          })
          .toBe(false)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'EMP-07: «Sacar foto» abre la cámara del teléfono (selector de archivos de cámara) y sube la foto (H-04)',
  cubre('H-04', 'H-05'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const { sc, turno, asignacion } = await prepararTurno('evid-camara')
    try {
      await page.goto(`/app/en-curso/${asignacion}`)
      await esperarBloque(page)
      // La entrada de la cámara pide la trasera y solo imágenes.
      await expect(page.getByTestId('media-camera-input')).toHaveAttribute(
        'capture',
        'environment',
      )
      await expect(page.getByTestId('media-camera-input')).toHaveAttribute(
        'accept',
        'image/*',
      )

      const jpeg = await jpegDecodificable(page, { color: '#b45309' })
      const [selector] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByRole('button', { name: 'Sacar foto' }).click(),
      ])
      await selector.setFiles({
        name: 'e2e-camara.jpg',
        mimeType: 'image/jpeg',
        buffer: jpeg,
      })
      // El contador suma lo que está en cola: la foto está subida cuando la fila se confirma.
      await expect(page.getByText('1 de 10 fotos')).toBeVisible()
      await expect
        .poll(async () => {
          const filas = await filasDelTurno(sc, turno)
          return filas.filter((f) => f.confirmed_at !== null).length
        })
        .toBe(1)
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'EMP-10: el servicio pide fotos y no hay ninguna: advierte, deja sacar una y también «Finalizar igual»; EMP-11 la agrega después (H-07)',
  cubre('H-07', 'H-12'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const { sc, turno, asignacion } = await prepararTurno('evid-finalizar', {
      pideFotos: true,
    })
    try {
      await page.goto(`/app/en-curso/${asignacion}/finalizar`)

      await test.step('EMP-10: advertencia con «Sacar foto» y el botón principal dice «Finalizar igual»', async () => {
        await expect(
          page.getByText(
            'Este servicio pide fotos y todavía no subiste ninguna. Podés finalizar igual.',
          ),
        ).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Sacar foto' }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Finalizar igual' }),
        ).toBeEnabled()
        await expect(
          page.getByRole('button', { name: 'Registrar fin' }),
        ).toHaveCount(0)
        await expectNoHorizontalScroll(page)
      })

      await test.step('«Sacar foto» lleva al bloque de EMP-07 (#fotos)', async () => {
        await page.getByRole('link', { name: 'Sacar foto' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/app/en-curso/${asignacion}#fotos$`),
        )
        await esperarBloque(page)
        await expect(
          page.getByRole('button', { name: 'Sacar foto' }),
        ).toBeVisible()
      })

      await test.step('«Finalizar igual» registra el fin: la advertencia no bloquea', async () => {
        await page.goto(`/app/en-curso/${asignacion}/finalizar`)
        await page.getByRole('button', { name: 'Finalizar igual' }).click()
        await continuarTrasFichar(page)
        await expect(page).toHaveURL(new RegExp(`/app/resumen/${asignacion}$`))
        const { data } = await sc.db
          .from('attendance_records')
          .select('kind')
          .eq('assignment_id', asignacion)
          .eq('kind', 'check_out')
        expect(data ?? []).toHaveLength(1)
      })

      await test.step('EMP-11: dice «Ninguno» y permite agregar una foto después de finalizar', async () => {
        await esperarBloque(page)
        const fila = page
          .locator('div')
          .filter({ hasText: /^Fotos y videosNinguno$/ })
        await expect(fila.first()).toBeVisible()
        const jpeg = await jpegDecodificable(page, { color: '#1d4ed8' })
        await page.getByTestId('media-gallery-input').setInputFiles({
          name: 'e2e-resumen.jpg',
          mimeType: 'image/jpeg',
          buffer: jpeg,
        })
        await expect(page.getByText('1 de 10 fotos')).toBeVisible()
        await expect(page.getByText('Ninguno', { exact: true })).toHaveCount(0)
        await expect(page.getByText('1 foto', { exact: true })).toBeVisible()
        const filas = await filasDelTurno(sc, turno)
        expect(filas).toHaveLength(1)
        expect(filas[0].assignment_id).toBe(asignacion)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'EMP-10: con una foto propia ya no advierte y el botón vuelve a ser «Registrar fin» (H-07)',
  cubre('H-07'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const { sc, turno, asignacion } = await prepararTurno('evid-con-foto', {
      pideFotos: true,
    })
    try {
      await subirEvidencia(await sessionClient(EMPLEADO), turno)
      await page.goto(`/app/en-curso/${asignacion}/finalizar`)
      await expect(
        page.getByRole('button', { name: 'Registrar fin' }),
      ).toBeEnabled()
      await expect(page.getByText(/Este servicio pide fotos/)).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Sacar foto' })).toHaveCount(
        0,
      )
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'EMP-07/EMP-10/EMP-11: sede sin fotos: sin botones, sin advertencia aunque el servicio pida fotos (H-13)',
  cubre('H-07', 'H-13'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const { sc, turno, asignacion } = await prepararTurno('evid-sin-fotos', {
      pideFotos: true,
      sedeSinFotos: true,
    })
    try {
      await test.step('EMP-07: el texto de la prohibición y ningún botón', async () => {
        await page.goto(`/app/en-curso/${asignacion}`)
        await esperarBloque(page)
        await expect(
          page.getByText('En esta sede no se permiten fotos.'),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Sacar foto' }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: 'Elegir de la galería' }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: 'Grabar video' }),
        ).toHaveCount(0)
        await expect(page.getByTestId('media-gallery-input')).toHaveCount(0)
        await expect(page.getByText(/de 10 fotos/)).toHaveCount(0)
        await expect(page.getByText('Este servicio pide fotos.')).toHaveCount(0)
      })

      await test.step('EMP-10: no advierte (no habría cómo cumplirla) y finaliza con «Registrar fin»', async () => {
        await page.goto(`/app/en-curso/${asignacion}/finalizar`)
        await expect(
          page.getByRole('button', { name: 'Registrar fin' }),
        ).toBeEnabled()
        await expect(page.getByText(/Este servicio pide fotos/)).toHaveCount(0)
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await continuarTrasFichar(page)
        await expect(page).toHaveURL(new RegExp(`/app/resumen/${asignacion}$`))
      })

      await test.step('EMP-11: sin fila de cantidad y sin botones', async () => {
        await esperarBloque(page)
        await expect(
          page.getByText('En esta sede no se permiten fotos.'),
        ).toBeVisible()
        await expect(page.getByText('Ninguno', { exact: true })).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: 'Sacar foto' }),
        ).toHaveCount(0)
      })

      await test.step('en el servidor: la base también lo rechaza (PHOTOS_NOT_ALLOWED)', async () => {
        const api = await sessionClient(EMPLEADO)
        await expect(subirEvidencia(api, turno)).rejects.toThrow(
          /PHOTOS_NOT_ALLOWED/,
        )
        expect(await filasDelTurno(sc, turno)).toHaveLength(0)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'EMP-07: con el tope alcanzado (10 fotos y 2 videos) los botones quedan apagados y el contador lo dice (H-11)',
  cubre('H-11'),
  async ({ page }) => {
    test.setTimeout(240_000)
    const { sc, turno, asignacion } = await prepararTurno('evid-tope')
    try {
      const api = await sessionClient(EMPLEADO)
      for (let i = 0; i < 10; i += 1) await subirEvidencia(api, turno)

      await test.step('con 10 fotos: «Sacar foto» apagado, la galería sigue sirviendo para videos', async () => {
        await page.goto(`/app/en-curso/${asignacion}`)
        await esperarBloque(page)
        // La pantalla carga 10 miniaturas firmadas: con la base ocupada tarda más que el plazo común.
        await expect(page.getByText('10 de 10 fotos')).toBeVisible({
          timeout: 30_000,
        })
        await expect(
          page.getByRole('button', { name: 'Sacar foto' }),
        ).toBeDisabled()
        await expect(
          page.getByRole('button', { name: 'Elegir de la galería' }),
        ).toBeEnabled()
        await expect(page.getByTestId('media-gallery-input')).toHaveAttribute(
          'accept',
          'video/*',
        )
      })

      await test.step('con 2 videos más: también la galería queda apagada', async () => {
        for (let i = 0; i < 2; i += 1) {
          await subirEvidencia(api, turno, {
            kind: 'video',
            durationSeconds: 5,
          })
        }
        await page.reload()
        await esperarBloque(page)
        await expect(page.getByText('2 de 2 videos')).toBeVisible({
          timeout: 30_000,
        })
        await expect(page.getByText('10 de 10 fotos')).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Sacar foto' }),
        ).toBeDisabled()
        await expect(
          page.getByRole('button', { name: 'Elegir de la galería' }),
        ).toBeDisabled()
        const grabar = page.getByRole('button', { name: 'Grabar video' })
        if ((await grabar.count()) > 0) await expect(grabar).toBeDisabled()
        await expectNoHorizontalScroll(page)
      })

      await test.step('en el servidor: la foto 11 y el video 3 dan MEDIA_LIMIT_REACHED', async () => {
        await expect(subirEvidencia(api, turno)).rejects.toThrow(
          /MEDIA_LIMIT_REACHED/,
        )
        await expect(
          subirEvidencia(api, turno, { kind: 'video', durationSeconds: 5 }),
        ).rejects.toThrow(/MEDIA_LIMIT_REACHED/)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'EMP-07: un video de más de 30 s se rechaza en el celular, sin subir nada y sin ofrecer reintento (H-06)',
  cubre('H-06'),
  async ({ page, browserName }) => {
    // El WebKit de Playwright no tiene `canvas.captureStream` ni reproduce WebM: no se puede armar
    // el video de prueba. El rechazo por duración es lógica de JavaScript sin diferencias entre
    // navegadores; en un iPhone real se prueba a mano (planilla de dispositivos, P21.7).
    test.skip(
      browserName === 'webkit',
      'El WebKit de Playwright no puede generar un video de prueba (sin canvas.captureStream).',
    )
    test.setTimeout(180_000)
    const { sc, turno, asignacion } = await prepararTurno('evid-video-largo')
    try {
      await page.goto(`/app/en-curso/${asignacion}`)
      await esperarBloque(page)
      // Un WebM real de un segundo; la duración que lee la app se simula en 40 s (no se graban
      // 40 s de verdad). Ver `simularDuracionDeVideo`.
      const webm = await webmCorto(page)
      await simularDuracionDeVideo(page, 40)
      await page.getByTestId('media-gallery-input').setInputFiles({
        name: 'e2e-largo.webm',
        mimeType: 'video/webm',
        buffer: webm,
      })

      const cola = page.getByRole('list', { name: 'Archivos en cola' })
      await expect(
        cola.getByText(
          'El video dura más de 30 segundos. Elegí uno más corto.',
        ),
      ).toBeVisible()
      // Sin reintento (no tiene sentido reintentar el mismo archivo); sí se puede descartar.
      await expect(
        cola.getByRole('button', { name: 'Reintentar' }),
      ).toHaveCount(0)
      await expect(
        cola.getByRole('button', { name: 'Descartar e2e-largo.webm' }),
      ).toBeVisible()
      await expect(page.getByText('0 de 2 videos')).toBeVisible()
      expect(await filasDelTurno(sc, turno)).toHaveLength(0)
      await cola
        .getByRole('button', { name: 'Descartar e2e-largo.webm' })
        .click()
      await expect(cola).toHaveCount(0)
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'EMP-07: un archivo que no es foto ni video se rechaza con un aviso claro',
  cubre('H-05'),
  async ({ page }) => {
    test.setTimeout(120_000)
    const { sc, turno, asignacion } = await prepararTurno(
      'evid-archivo-invalido',
    )
    try {
      await page.goto(`/app/en-curso/${asignacion}`)
      await esperarBloque(page)
      await page.getByTestId('media-gallery-input').setInputFiles({
        name: 'e2e-notas.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 e2e'),
      })
      await expect(
        page.getByText(
          'Ese archivo no es una foto ni un video que podamos usar.',
        ),
      ).toBeVisible()
      await expect(page.getByText('0 de 10 fotos')).toBeVisible()
      expect(await filasDelTurno(sc, turno)).toHaveLength(0)
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
