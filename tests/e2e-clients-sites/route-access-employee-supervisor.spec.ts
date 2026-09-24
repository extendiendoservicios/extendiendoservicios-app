import { expect, test } from '@playwright/test'
import { readE2eClientsSitesEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// TEST-005: "que empleado y supervisor no entren a las rutas de administración de clientes y
// sedes" (encargo P08.5). `RequireRole allow={['owner','admin']}` (`router.tsx`) protege TODO
// el grupo `/admin`, así que alcanza con probarlo una vez por ruta de este dominio: un empleado
// o una supervisora con sesión real que escribe la URL a mano termina en su propia vía
// (`homePathForRoles`, `/app` o `/sup`), nunca ve la pantalla.
//
// Regla común de la suite de permisos ("por interfaz... y por API directa"): acá solo la parte
// de interfaz (la ruta oculta/redirigida). La parte de API directa (RLS de `clients`/`sites`
// contra escrituras y lecturas fuera de rol) es TEST-019 (F18, "todas las tablas y RPC"), fuera
// de alcance de este paquete — `docs/features/clientes-y-sedes.md` ya documenta que la
// protección real de los datos es RLS, esto solo cubre la navegación.

const env = readE2eClientsSitesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

const CLIENTS_SITES_ADMIN_ROUTES = [
  '/admin/clientes',
  '/admin/clientes/nuevo',
  '/admin/clientes?pestana=mapa',
  '/admin/sedes/nueva',
]

test.describe('TEST-005: empleado y supervisor no entran a las rutas de clientes y sedes', () => {
  test('un empleado que escribe estas rutas termina en /app', async ({
    page,
  }) => {
    await loginAs(page, SEED_ACCOUNTS.employees[0], env!.seedPassword, /\/app/)

    for (const route of CLIENTS_SITES_ADMIN_ROUTES) {
      await page.goto(route)
      await expect(page).toHaveURL(/\/app/)
    }
  })

  test('una supervisora que escribe estas rutas termina en /sup', async ({
    page,
  }) => {
    await loginAs(
      page,
      SEED_ACCOUNTS.supervisors[0],
      env!.seedPassword,
      /\/sup/,
    )

    for (const route of CLIENTS_SITES_ADMIN_ROUTES) {
      await page.goto(route)
      await expect(page).toHaveURL(/\/sup/)
    }
  })
})
