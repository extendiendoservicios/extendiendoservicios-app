import { expect, test, type Page } from '@playwright/test'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  jpegDecodificable,
  objetosDeEvidencia,
  subirEvidencia,
} from '../../fixtures/media.ts'
import { FRANJAS_MOVIL, supervisionFichar } from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// TEST-030 (P21.6, módulo H · evidencia fotográfica), lado supervisor en el celular (390 px):
// SUP-03 (detalle de la supervisión) y SUP-04 (registro de inicio y fin) con el bloque «Fotos y
// videos»: subir desde la galería, contador, miniatura, sede sin fotos y supervisión cancelada.
// Cuenta de este archivo: supervisor2. Trazabilidad: H-02, H-03, H-12, H-13
// (modulos/H_evidencia_fotografica.md).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('supervisor2') })

const SUPERVISOR = 'supervisor2' as const

async function prepararSupervision(
  slug: string,
  options: { pideFotos?: boolean; sedeSinFotos?: boolean } = {},
) {
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
  const supervision = await sc.assignSupervision(turno, SUPERVISOR)
  return { sc, turno, supervision }
}

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
      'id, kind, uploaded_by, storage_path, thumb_path, confirmed_at, removed_at, assignment_id, supervision_id',
    )
    .eq('shift_id', turno)
    .order('created_at')
  expect(error?.message).toBeUndefined()
  return data ?? []
}

test(
  'SUP-03 y SUP-04: el supervisor sube una foto de la galería en su supervisión, ve el contador y la miniatura (H-02, H-03)',
  cubre('H-02', 'H-03', 'H-12'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const { sc, turno, supervision } = await prepararSupervision('evid-sup', {
      pideFotos: true,
    })
    try {
      await test.step('SUP-03: el bloque está, avisa que el servicio pide fotos y arranca en 0', async () => {
        await page.goto(`/sup/supervisiones/${supervision}`)
        await esperarBloque(page)
        await expect(page.getByText('Este servicio pide fotos.')).toBeVisible()
        await expect(page.getByText('0 de 10 fotos')).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Sacar foto' }),
        ).toBeEnabled()
        await expectNoHorizontalScroll(page)
      })

      await test.step('elegir de la galería: se sube y aparece la miniatura', async () => {
        const jpeg = await jpegDecodificable(page, { ancho: 1800, alto: 1200 })
        await page.getByTestId('media-gallery-input').setInputFiles({
          name: 'e2e-sup.jpg',
          mimeType: 'image/jpeg',
          buffer: jpeg,
        })
        await expect(page.getByText('1 de 10 fotos')).toBeVisible()
        const miniatura = page.getByRole('button', {
          name: /^Foto de las \d{2}:\d{2}/,
        })
        await expect(miniatura).toBeVisible()
        await expect
          .poll(() =>
            miniatura
              .locator('img')
              .evaluate(
                (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
              ),
          )
          .toBe(true)
      })

      await test.step('en la base: la fila es del supervisor y cuelga de la supervisión, no de una asignación', async () => {
        const filas = await filasDelTurno(sc, turno)
        expect(filas).toHaveLength(1)
        expect(filas[0].supervision_id).toBe(supervision)
        expect(filas[0].assignment_id).toBeNull()
        expect(filas[0].confirmed_at).not.toBeNull()
        expect(filas[0].kind).toBe('photo')
        const objetos = await objetosDeEvidencia(sc.db)
        expect(objetos).toContain(filas[0].storage_path)
        expect(objetos).toContain(filas[0].thumb_path)
      })

      await test.step('SUP-04: con el inicio registrado, el bloque sigue ahí con lo ya subido', async () => {
        await supervisionFichar(SUPERVISOR, supervision, 'inicio')
        await page.goto(`/sup/supervisiones/${supervision}/registro`)
        await esperarBloque(page)
        await expect(page.getByText('1 de 10 fotos')).toBeVisible()
        await expect(
          page.getByRole('button', { name: /^Foto de las \d{2}:\d{2}/ }),
        ).toBeVisible()
      })

      await test.step('lo que subió el supervisor es suyo: el otro supervisor del servidor no lo ve (H-03)', async () => {
        const otro = await sessionClient('supervisor1')
        const { data } = await otro
          .from('shift_media')
          .select('id')
          .eq('shift_id', turno)
        expect(data ?? []).toHaveLength(0)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'SUP-03: en una sede sin fotos no hay botones (H-13)',
  cubre('H-13'),
  async ({ page }) => {
    test.setTimeout(120_000)
    const { sc, turno, supervision } = await prepararSupervision(
      'evid-sup-sin',
      {
        pideFotos: true,
        sedeSinFotos: true,
      },
    )
    try {
      await page.goto(`/sup/supervisiones/${supervision}`)
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
      await expect(page.getByTestId('media-gallery-input')).toHaveCount(0)
      await expect(
        subirEvidencia(await sessionClient(SUPERVISOR), turno),
      ).rejects.toThrow(/PHOTOS_NOT_ALLOWED/)
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'SUP-03: con la supervisión cancelada o «no realizada» no aparece el bloque, y el servidor tampoco deja subir (H-02)',
  cubre('H-02'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const cancelada = await prepararSupervision('evid-sup-cancel')
    const noHecha = await prepararSupervision('evid-sup-nohecha')
    try {
      const dueno = await sessionClient('owner')
      const cancel = await dueno.rpc('cancel_supervision', {
        p_supervision_id: cancelada.supervision,
        p_reason: 'e2e-evidencia: cancelada',
      })
      expect(cancel.error?.message).toBeUndefined()
      const propio = await sessionClient(SUPERVISOR)
      const hecha = await propio.rpc('mark_supervision_not_done', {
        p_supervision_id: noHecha.supervision,
        p_reason: 'e2e-evidencia: no realizada',
      })
      expect(hecha.error?.message).toBeUndefined()

      for (const { supervision, turno } of [cancelada, noHecha]) {
        await page.goto(`/sup/supervisiones/${supervision}`)
        // Espera a que la pantalla terminó de cargar (la supervisión cancelada ya no se encuentra;
        // la «no realizada» se ve con su estado) y recién ahí afirma las ausencias.
        await expect(
          page
            .getByRole('alert')
            .or(page.getByText(/no realizad/i))
            .first(),
        ).toBeVisible()
        await expect(
          page.getByRole('group', { name: 'Topes del turno' }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: 'Sacar foto' }),
        ).toHaveCount(0)
        await expect(subirEvidencia(propio, turno)).rejects.toThrow(
          /NOT_SHIFT_PARTICIPANT/,
        )
      }
    } finally {
      expect(await cancelada.sc.cleanup(), 'limpieza 1').toEqual([])
      expect(await noHecha.sc.cleanup(), 'limpieza 2').toEqual([])
    }
  },
)
