import { expect, test, type Page } from '@playwright/test'
import { getAdminDb } from '../../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-030 (P21.6, módulo H): ADM-28 «Empresa», sección «Fotos y videos» con los plazos de
// vencimiento (H-08, H-17): se cambian, se validan de 7 a 365 días y se restauran. Lo hacen el
// dueño y los administradores. Va en el proyecto `dueno-config`, aparte de la corrida en paralelo:
// edita la configuración de la empresa (singleton) y la matriz de permisos también la toca y la
// repone. Todo lo que cambia se repone al terminar, pase lo que pase.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

async function plazosEnLaBase() {
  const { data } = await getAdminDb()
    .from('company_settings')
    .select('photo_retention_days, video_retention_days')
    .eq('id', 1)
    .single()
  return {
    foto: data!.photo_retention_days,
    video: data!.video_retention_days,
  }
}

/** Plazos de fábrica (migración 0047): punto de partida fijo de la prueba. */
const PLAZOS_BASE = { foto: 60, video: 30 }

async function reponer(foto: number, video: number): Promise<void> {
  await getAdminDb()
    .from('company_settings')
    .update({ photo_retention_days: foto, video_retention_days: video })
    .eq('id', 1)
}

async function abrirSeccion(page: Page) {
  await page.goto('/admin/configuracion/empresa')
  const seccion = page.getByRole('region', { name: 'Fotos y videos' })
  await expect(seccion).toBeVisible()
  return seccion
}

for (const cuenta of ['owner', 'admin'] as const) {
  test.describe(`ADM-28 plazos de fotos y videos · ${cuenta === 'owner' ? 'dueño' : 'administrador'}`, () => {
    test.use({ storageState: storageStatePath(cuenta) })

    test(
      'muestra los plazos vigentes, cambia uno, lo valida de 7 a 365 días y lo restaura (H-08, H-17)',
      cubre('H-08', 'H-17'),
      async ({ page }) => {
        test.setTimeout(120_000)
        const real = await plazosEnLaBase()
        try {
          // Parte de plazos conocidos (los de fábrica) y no de lo que haya en App_dev: con 7 o 365
          // guardados de antes, el botón «Guardar plazos» queda apagado al escribir el mismo valor
          // y el clic espera en vano. Lo real se repone en el `finally`.
          await reponer(PLAZOS_BASE.foto, PLAZOS_BASE.video)
          const original = await plazosEnLaBase()
          expect(original).toEqual(PLAZOS_BASE)
          const seccion = await abrirSeccion(page)
          const fotos = seccion.getByLabel('Las fotos vencen a los (días)')
          const videos = seccion.getByLabel('Los videos vencen a los (días)')
          const guardar = seccion.getByRole('button', {
            name: 'Guardar plazos',
          })

          await test.step('muestra los plazos que tiene la base y no deja guardar sin cambios', async () => {
            await expect(fotos).toHaveValue(String(original.foto))
            await expect(videos).toHaveValue(String(original.video))
            await expect(guardar).toBeDisabled()
            await expect(seccion.getByText(/De 7 a 365 días/)).toBeVisible()
            await expect(
              page.getByRole('region', { name: 'Espacio usado' }),
            ).toBeVisible()
          })

          await test.step('fuera de rango o vacío: avisa y no guarda', async () => {
            for (const [valor, mensaje] of [
              ['6', 'Tiene que ser de 7 a 365 días.'],
              ['366', 'Tiene que ser de 7 a 365 días.'],
              ['0', 'Tiene que ser de 7 a 365 días.'],
              ['', 'Indicá los días de las fotos.'],
              ['7.5', 'Tiene que ser un número entero de días.'],
            ] as const) {
              await fotos.fill(valor)
              await guardar.click()
              await expect(seccion.getByText(mensaje).first()).toBeVisible()
            }
            expect(await plazosEnLaBase()).toEqual(original)
          })

          await test.step('los extremos válidos se aceptan (7 y 365)', async () => {
            for (const dias of [7, 365]) {
              await fotos.fill(String(dias))
              await guardar.click()
              await expect(
                page
                  .getByText('Guardamos los plazos de fotos y videos.')
                  .last(),
              ).toBeVisible()
              await expect
                .poll(async () => (await plazosEnLaBase()).foto)
                .toBe(dias)
            }
          })

          await test.step('cambia el plazo de los videos y el de las fotos por separado', async () => {
            const nuevoVideo = original.video === 45 ? 46 : 45
            await fotos.fill(String(original.foto))
            await videos.fill(String(nuevoVideo))
            await guardar.click()
            await expect(
              page.getByText('Guardamos los plazos de fotos y videos.').last(),
            ).toBeVisible()
            await expect
              .poll(async () => plazosEnLaBase())
              .toEqual({ foto: original.foto, video: nuevoVideo })
            // Recargar muestra lo guardado.
            const recargada = await abrirSeccion(page)
            await expect(
              recargada.getByLabel('Los videos vencen a los (días)'),
            ).toHaveValue(String(nuevoVideo))
          })

          await test.step('lo restaura a como estaba', async () => {
            const recargada = await abrirSeccion(page)
            await recargada
              .getByLabel('Los videos vencen a los (días)')
              .fill(String(original.video))
            await recargada
              .getByRole('button', { name: 'Guardar plazos' })
              .click()
            await expect.poll(async () => plazosEnLaBase()).toEqual(original)
          })
        } finally {
          await reponer(real.foto, real.video)
        }
      },
    )
  })
}
