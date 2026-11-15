import { expect, test } from '@playwright/test'
import { FIXED_ACCOUNTS, nombreDe } from '../../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import {
  contador,
  esperarListado,
  ficha,
  leerFilas,
  numeros,
  URL_USUARIOS,
} from './p29-usuarios-pasos.ts'

// P29.6 (P29.4: OG-12), escritorio: Configuración → Usuarios con buscador, orden por legajo, filtros
// por rol, estado y «Sin ficha laboral», el contador «N de M usuarios» y todo recordado en la
// dirección de la página. La versión de celular (390 px, tarjetas) está en p29-usuarios.movil.admin.ts.
// Cuenta: `admin` (todas las capacidades: ve el email de quien no es dueño ni administración).
// Los datos son los de las cuentas fijas del conjunto activo (`E2E-Fijo ...`); nada se crea ni se borra.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.describe('OG-12 · Usuarios: buscador, orden y filtros', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'el buscador filtra mientras se escribe por nombre, legajo, DNI y email, sin abrir fichas; el contador acompaña',
    cubre('RB-A01', 'RB-X01', 'OG-12'),
    async ({ page }) => {
      const { legajo, dni } = await ficha('empleado3')
      await page.goto(URL_USUARIOS)
      await esperarListado(page)
      const inicial = await numeros(page)
      expect(inicial.total).toBeGreaterThan(5)
      const buscador = page.getByRole('searchbox', { name: 'Buscar usuarios' })

      await test.step('por nombre y apellido (sin tildes ni mayúsculas)', async () => {
        await buscador.fill(nombreDe('empleado3').toLowerCase())
        // En App_dev hay varios conjuntos de cuentas fijas con el mismo apellido («E2E-Fijo-EM
        // Empleado3», etc.): hay más de un resultado, pero todos llevan «Empleado3» y la cuenta
        // buscada está una sola vez.
        await expect
          .poll(async () => (await numeros(page)).visibles)
          .toBeLessThan(inicial.visibles)
        await expect(
          page.getByRole('row').filter({ hasText: nombreDe('empleado3') }),
        ).toHaveCount(1)
        for (const fila of await leerFilas(page)) {
          expect(fila.texto).toMatch(/Empleado3/)
        }
        // Sigue en el listado: no abrió ninguna ficha.
        await expect(page).toHaveURL(/\/admin\/configuracion\/usuarios\?/)
      })

      await test.step('por DNI', async () => {
        await buscador.fill(dni)
        await expect(contador(page)).toHaveText(
          `1 de ${inicial.total} usuarios`,
        )
        await expect(
          page.getByRole('row').filter({ hasText: nombreDe('empleado3') }),
        ).toHaveCount(1)
      })

      await test.step('por email', async () => {
        await buscador.fill(FIXED_ACCOUNTS.empleado3.email)
        await expect(contador(page)).toHaveText(
          `1 de ${inicial.total} usuarios`,
        )
        await expect(
          page.getByRole('row').filter({ hasText: nombreDe('empleado3') }),
        ).toHaveCount(1)
      })

      await test.step('por legajo: la persona está entre los resultados y se ve su número', async () => {
        await buscador.fill(String(legajo))
        await expect(
          page.getByRole('row').filter({ hasText: nombreDe('empleado3') }),
        ).toHaveCount(1)
        const filas = await leerFilas(page)
        expect(
          filas.some(
            (f) =>
              f.legajo === legajo && f.texto.includes(nombreDe('empleado3')),
          ),
        ).toBe(true)
      })

      await test.step('sin coincidencias: mensaje vacío y «0 de N»', async () => {
        await buscador.fill('zzz-nadie-se-llama-asi-e2e')
        await expect(contador(page)).toHaveText(
          `0 de ${inicial.total} usuarios`,
        )
        await expect(
          page.getByText('No hay usuarios con esos filtros'),
        ).toBeVisible()
      })

      await test.step('al borrar el texto vuelve el listado completo', async () => {
        await buscador.fill('')
        await expect(contador(page)).toHaveText(
          `${inicial.visibles} de ${inicial.total} usuarios`,
        )
      })
    },
  )

  test(
    'por omisión ordena por legajo de menor a mayor con los que no tienen legajo al final; el encabezado invierte y cambia de columna',
    cubre('RB-A01', 'OG-12'),
    async ({ page }) => {
      await page.goto(URL_USUARIOS)
      await esperarListado(page)
      // La URL queda limpia con los valores por omisión.
      await expect(page).toHaveURL(new RegExp(`${URL_USUARIOS}$`))

      const sinLegajoAlFinal = (filas: Array<{ legajo: number | null }>) => {
        const primerVacio = filas.findIndex((f) => f.legajo === null)
        return (
          primerVacio === -1 ||
          filas.slice(primerVacio).every((f) => f.legajo === null)
        )
      }
      const conLegajo = (filas: Array<{ legajo: number | null }>) =>
        filas.filter((f) => f.legajo !== null).map((f) => f.legajo as number)

      await test.step('ascendente por legajo, sin legajo al final', async () => {
        const filas = await leerFilas(page)
        const numerosDeLegajo = conLegajo(filas)
        expect(numerosDeLegajo.length).toBeGreaterThan(3)
        expect(numerosDeLegajo).toEqual(
          [...numerosDeLegajo].sort((a, b) => a - b),
        )
        expect(sinLegajoAlFinal(filas)).toBe(true)
        // La cuenta sin ficha laboral (por ejemplo, la de administración) existe y va al final.
        expect(filas.some((f) => f.legajo === null)).toBe(true)
      })

      await test.step('tocar «Legajo» lo pasa a descendente y lo recuerda en la dirección; los vacíos siguen al final', async () => {
        await page.getByRole('button', { name: 'Ordenar por legajo' }).click()
        await expect(page).toHaveURL(/dir=desc/)
        await expect
          .poll(async () => {
            const n = conLegajo(await leerFilas(page))
            return n.length > 1 && n[0] > n[n.length - 1]
          })
          .toBe(true)
        const filas = await leerFilas(page)
        const n = conLegajo(filas)
        expect(n).toEqual([...n].sort((a, b) => b - a))
        expect(sinLegajoAlFinal(filas)).toBe(true)
      })

      await test.step('tocar «Nombre» ordena por nombre y queda en la dirección', async () => {
        await page.getByRole('button', { name: 'Ordenar por nombre' }).click()
        await expect(page).toHaveURL(/orden=nombre/)
        await expect(page).not.toHaveURL(/dir=desc/)
      })
    },
  )

  test(
    'los filtros por rol, estado y «Sin ficha laboral» se combinan y quedan en la dirección: sobreviven a recargar y a ir y volver de una ficha',
    cubre('RB-A01', 'OG-12'),
    async ({ page }) => {
      const dni = (await ficha('empleado4')).dni
      await page.goto(URL_USUARIOS)
      await esperarListado(page)
      const todos = await numeros(page)
      const roles = page.getByRole('group', { name: 'Filtrar por rol' })

      await test.step('rol «Empleado»: solo personas con ese rol y el contador baja', async () => {
        await roles.getByRole('button', { name: 'Empleado' }).click()
        await expect(
          roles.getByRole('button', { name: 'Empleado' }),
        ).toHaveAttribute('aria-pressed', 'true')
        await expect(page).toHaveURL(/roles=employee/)
        await expect
          .poll(async () => (await numeros(page)).visibles)
          .toBeLessThan(todos.visibles)
        for (const fila of await leerFilas(page)) {
          expect(fila.texto).toContain('Empleado')
        }
      })

      await test.step('«Sin ficha laboral» con rol Empleado no deja a nadie (todo empleado tiene ficha)', async () => {
        await page.getByRole('button', { name: 'Sin ficha laboral' }).click()
        await expect(page).toHaveURL(/sinficha=1/)
        await expect(
          page.getByRole('button', { name: 'Sin ficha laboral' }),
        ).toHaveAttribute('aria-pressed', 'true')
        await expect(contador(page)).toHaveText(/^0 de \d+ usuarios$/)
        await page.getByRole('button', { name: 'Sin ficha laboral' }).click()
        await expect(page).not.toHaveURL(/sinficha=1/)
        // Se espera a que la pantalla refleje el cambio antes de tocar lo siguiente (ver DEF-P29-01).
        await expect(
          page.getByRole('button', { name: 'Sin ficha laboral' }),
        ).toHaveAttribute('aria-pressed', 'false')
      })

      await test.step('estado «Todos»: no baja respecto de «Activos»', async () => {
        const activos = (await numeros(page)).visibles
        await page
          .getByRole('radiogroup', { name: 'Estado' })
          .getByRole('radio', { name: 'Todos' })
          .click()
        await expect(page).toHaveURL(/estado=todos/)
        await expect(
          page
            .getByRole('radiogroup', { name: 'Estado' })
            .getByRole('radio', { name: 'Todos' }),
        ).toBeChecked()
        await expect
          .poll(async () => (await numeros(page)).visibles)
          .toBeGreaterThanOrEqual(activos)
      })

      await test.step('con búsqueda, rol y estado en la dirección, recargar los conserva', async () => {
        await page.getByRole('searchbox', { name: 'Buscar usuarios' }).fill(dni)
        await expect(page).toHaveURL(/q=/)
        await expect(contador(page)).toHaveText(/^1 de \d+ usuarios$/)
        await page.reload()
        await esperarListado(page)
        await expect(
          page.getByRole('searchbox', { name: 'Buscar usuarios' }),
        ).toHaveValue(dni)
        await expect(
          roles.getByRole('button', { name: 'Empleado' }),
        ).toHaveAttribute('aria-pressed', 'true')
        await expect(
          page
            .getByRole('radiogroup', { name: 'Estado' })
            .getByRole('radio', { name: 'Todos' }),
        ).toBeChecked()
        await expect(contador(page)).toHaveText(/^1 de \d+ usuarios$/)
      })

      await test.step('abrir la ficha de la persona y volver conserva la búsqueda y los filtros', async () => {
        const urlConFiltros = page.url()
        await page
          .getByRole('link', { name: new RegExp(nombreDe('empleado4')) })
          .click()
        await expect(page).not.toHaveURL(/\/configuracion\/usuarios/)
        await page.goBack()
        await expect(page).toHaveURL(urlConFiltros)
        await esperarListado(page)
        await expect(
          page.getByRole('searchbox', { name: 'Buscar usuarios' }),
        ).toHaveValue(dni)
        await expect(contador(page)).toHaveText(/^1 de \d+ usuarios$/)
      })
    },
  )

  test(
    'el filtro «Sin ficha laboral» deja solo a quienes no tienen legajo, y «Desactivados» solo a los dados de baja',
    cubre('RB-A01', 'OG-12'),
    async ({ page }) => {
      await page.goto(`${URL_USUARIOS}?sinficha=1`)
      await esperarListado(page)
      await expect(
        page.getByRole('button', { name: 'Sin ficha laboral' }),
      ).toHaveAttribute('aria-pressed', 'true')
      const sinFicha = await leerFilas(page)
      expect(sinFicha.length).toBeGreaterThan(0)
      expect(sinFicha.every((f) => f.legajo === null)).toBe(true)

      await page.goto(`${URL_USUARIOS}?estado=desactivados`)
      await esperarListado(page)
      await expect(
        page
          .getByRole('radiogroup', { name: 'Estado' })
          .getByRole('radio', { name: 'Desactivados' }),
      ).toBeChecked()
      for (const fila of await leerFilas(page)) {
        expect(fila.texto).toMatch(/Desactivad/i)
      }
    },
  )
  test(
    'escribir en el buscador a velocidad normal no pierde letras ni los demás filtros de la dirección (DEF-P29-01)',
    cubre('RB-A01', 'OG-12'),
    async ({ page }) => {
      // DEF-P29-01 (mayor, P29.4): el campo está atado a la dirección de la página y la pantalla se
      // vuelve a pintar con retraso: con 202 usuarios en App_dev, escribir «empleado3 e2e» a 120 ms por
      // tecla dejó «epleado3 e2e» (y a 0 ms, solo «e»); tocar «Todos» y escribir enseguida pierde
      // `estado=todos`. Sale de «fixme» cuando el campo guarde su propio texto y lo pase a la dirección.
      test.fixme(
        true,
        'DEF-P29-01: el buscador de Usuarios pierde letras al escribir rápido (ver informe de P29.6).',
      )
      await page.goto(URL_USUARIOS)
      await esperarListado(page)
      const buscador = page.getByRole('searchbox', { name: 'Buscar usuarios' })
      await buscador.click()
      await buscador.pressSequentially('empleado3 e2e', { delay: 120 })
      await expect(buscador).toHaveValue('empleado3 e2e')
      await expect(page).toHaveURL(/q=empleado3\+e2e/)
    },
  )
})
