import { expect, test } from '@playwright/test'
import { readE2eAuthEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// AUTH-012 (08_Fases_y_Backlog.md F6): "e2e de ingreso por rol (dueño, administrador,
// supervisor, empleado: cada uno cae en su shell/pantalla de inicio correcta según
// 05_Pantallas_y_Navegacion.md sección 5)".
//
// Usa las cuentas del seed en SOLO LECTURA (regla 2 del encargo: nunca se mutan). No hace falta
// la clave de servicio para este archivo en particular, pero igual se saltea sin `.env.local`
// completo (SEED_DEV_PASSWORD es la contraseña compartida de las 14 cuentas), para no fallar
// con un error de red confuso si alguien lo corre sin el archivo.
const env = readE2eAuthEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

interface RoleCase {
  nombre: string
  email: string
  /** Fragmento de URL de la pantalla de inicio, `05_Pantallas_y_Navegacion.md` sección 5. */
  urlEsperada: RegExp
  /** El `screenId` del placeholder (`placeholder.tsx`) de esa pantalla de inicio. */
  screenIdEsperado: string
  tituloEsperado: string
}

const casos: RoleCase[] = [
  {
    nombre: 'dueño',
    email: SEED_ACCOUNTS.owner,
    urlEsperada: /\/admin$/,
    screenIdEsperado: 'ADM-02',
    tituloEsperado: 'Resumen',
  },
  {
    nombre: 'administrador',
    email: SEED_ACCOUNTS.admin,
    urlEsperada: /\/admin$/,
    screenIdEsperado: 'ADM-02',
    tituloEsperado: 'Resumen',
  },
  {
    nombre: 'supervisor',
    email: SEED_ACCOUNTS.supervisors[0],
    urlEsperada: /\/sup$/,
    screenIdEsperado: 'SUP-02',
    tituloEsperado: 'Hoy',
  },
  {
    nombre: 'empleado',
    email: SEED_ACCOUNTS.employees[0],
    urlEsperada: /\/app$/,
    screenIdEsperado: 'EMP-03',
    tituloEsperado: 'Hoy',
  },
]

for (const caso of casos) {
  test(`el ${caso.nombre} del seed entra y cae en su pantalla de inicio (${caso.screenIdEsperado})`, async ({
    page,
  }) => {
    await page.goto('/ingresar')
    await page.getByLabel('Email').fill(caso.email)
    await page.getByLabel('Contraseña').fill(env!.seedPassword)
    await page.getByRole('button', { name: 'Ingresar' }).click()

    await expect(page).toHaveURL(caso.urlEsperada)
    // `getByRole('main')`, no la página entera: en `/admin` (AdminShell) la topbar repite el
    // mismo título como encabezado (`<header>`), así que buscar el heading suelto matchea dos
    // elementos y `toBeVisible()` explota por "strict mode violation" (comprobado en P06.4).
    const contenido = page.getByRole('main')
    await expect(contenido.getByText(caso.screenIdEsperado)).toBeVisible()
    await expect(
      contenido.getByRole('heading', { name: caso.tituloEsperado }),
    ).toBeVisible()
  })
}
