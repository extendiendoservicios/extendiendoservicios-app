import { expect, test } from '@playwright/test'
import { readE2eUsersEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  banDirectly,
  disposableEmail,
  getAdminClient,
} from './helpers/adminUsersClient.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// USERS-018 (08_Fases_y_Backlog.md F7): "e2e: dueño crea administrador, ajusta capacidades, el
// administrador entra y ve lo que corresponde". Recorrido principal del encargo P07.4, con las
// verificaciones puntuales que pide (05_Pantallas_y_Navegacion.md ADM-27, líneas 91 y 97;
// 03_Plan_Maestro_Tecnico.md sección 6; 12_Registro_de_Progreso.md, decisiones del 23 sep 2026):
// capacidades iniciales todas activas, el dueño le quita una, el administrador entra y no ve lo
// que no le corresponde. Corre en `chromium` (1280 px) y en `mobile` (390 px, ver
// `playwright.users.config.ts`) — el propio spec no bifurca por ancho: a 390 los mismos
// elementos tienen que seguir siendo alcanzables (Playwright hace scroll solo si hace falta).

const env = readE2eUsersEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('USERS-018: el dueño crea un administrador y ajusta sus capacidades', () => {
  test('el administrador nuevo ve lo que corresponde y no ve lo que no', async ({
    page,
    browser,
  }, testInfo) => {
    // Recorrido largo contra un backend real: dos logins de más (dueño arranca, el administrador
    // entra dos veces) y varias navegaciones entre medio -- el timeout por omisión del config
    // (60 s) no alcanza (se comprobó corriendo la suite: el test se quedaba a mitad de camino,
    // sin ningún error puntual, solo el timeout general). Se triplica solo acá, no en el config
    // entero, para no ocultar una demora real en los specs más chicos.
    testInfo.setTimeout(180_000)
    const admin = getAdminClient()
    const email = disposableEmail('nuevo-admin')
    const password = `${env!.seedPassword}Aa1`
    // Apellido único por corrida (no solo el email): si una corrida anterior dejó su admin de
    // prueba desactivado sin que nada le cambie el nombre (`banDirectly` no toca `profiles`.
    // first_name/last_name), `fetchUsers` lo sigue listando (USERS-008: los desactivados también
    // aparecen, para historial) — un apellido fijo entre corridas dejaría DOS filas con el mismo
    // nombre visible y los selectores por nombre completo de este test dejarían de ser únicos
    // (encontrado corriendo la suite dos veces seguidas, ver el reporte del encargo).
    const lastName = `P074 Admin Nuevo ${Date.now()}`
    const fullName = `E2E ${lastName}`
    let newAdminProfileId: string | null = null

    try {
      await test.step('el dueño crea un administrador desde ADM-27', async () => {
        await page.goto('/ingresar')
        await page.getByLabel('Email').fill(SEED_ACCOUNTS.owner)
        await page.getByLabel('Contraseña').fill(env!.seedPassword)
        await page.getByRole('button', { name: 'Ingresar' }).click()
        await expect(page).toHaveURL(/\/admin$/)

        await page.goto('/admin/configuracion/usuarios')
        await page.getByRole('button', { name: 'Nuevo administrador' }).click()
        await page.getByLabel('Nombre').fill('E2E')
        await page.getByLabel('Apellido').fill(lastName)
        await page.getByLabel('Email de login').fill(email)
        await page.getByLabel('Contraseña inicial').fill(password)
        await page.getByRole('button', { name: 'Crear administrador' }).click()
        await expect(
          page.getByText(`Creamos la cuenta de ${fullName}.`),
        ).toBeVisible()

        // `listUsers` en vez de `getUserByEmail` (no existe en el SDK v2): la lista de usuarios
        // de `App_dev` es chica (seed + descartables de esta suite), así que filtrar por email
        // acá es liviano y no vale la pena depender de un id capturado de la red.
        const { data: usersList, error } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        })
        if (error) throw error
        const created = usersList.users.find((u) => u.email === email)
        expect(
          created,
          `no encontramos la cuenta recién creada (${email})`,
        ).toBeTruthy()
        newAdminProfileId = created!.id
      })

      await test.step('capacidades iniciales: las siete activas (decisión del 23 sep 2026)', async () => {
        await page.goto('/admin/configuracion/usuarios')
        // El aria-label del botón de acciones ya trae el nombre completo -- funciona igual en
        // modo tabla (1024 px+) que en modo tarjeta (< 1024 px, `RowCard` de `DataTable.tsx`),
        // sin depender de `role="row"` (que solo existe en el modo tabla).
        await page
          .getByRole('button', { name: `Acciones para ${fullName}` })
          .click()
        await page
          .getByRole('menuitem', { name: 'Editar roles y capacidades' })
          .click()
        await expect(
          page.getByRole('heading', {
            name: `Roles y capacidades de ${fullName}`,
          }),
        ).toBeVisible()
        const switches = page.getByRole('switch')
        await expect(switches).toHaveCount(7)
        for (const toggle of await switches.all()) {
          await expect(toggle).toBeChecked()
        }
        // `.first()`: el `Sheet` también tiene un botón "×" de cierre en la cabecera con el
        // mismo nombre accesible "Cerrar" -- el del pie (texto visible, el que aparece primero
        // en el DOM) es el que corresponde acá.
        await page.getByRole('button', { name: 'Cerrar' }).first().click()
      })

      const adminContext = await browser.newContext(
        page.viewportSize() ? { viewport: page.viewportSize()! } : {},
      )
      const adminPage = await adminContext.newPage()

      try {
        await test.step('primer ingreso del administrador, con todas las capacidades activas', async () => {
          await adminPage.goto('/ingresar')
          await adminPage.getByLabel('Email').fill(email)
          await adminPage.getByLabel('Contraseña').fill(password)
          await adminPage.getByRole('button', { name: 'Ingresar' }).click()
          await expect(adminPage).toHaveURL(/\/admin$/)

          await adminPage.goto('/admin/configuracion/usuarios')

          // No ve "Nuevo administrador" (USERS-018, canCreateAdminUser: solo dueño) aunque
          // tenga manage_users -- crear OTRO administrador es exclusivo del dueño, ver el
          // comentario de `src/features/users/permissions.ts`.
          await expect(
            adminPage.getByRole('button', { name: 'Nuevo administrador' }),
          ).toHaveCount(0)

          // Con manage_users todavía activa, sí ve el menú de acciones sobre empleados y
          // supervisores del seed (no sobre el dueño ni sobre otros administradores, que quedan
          // fuera de su alcance aunque tenga la capacidad -- `canActOnUser`).
          const actionButtonsBefore = adminPage.getByRole('button', {
            name: /^Acciones para/,
          })
          await expect(actionButtonsBefore.first()).toBeVisible()
          const countBefore = await actionButtonsBefore.count()
          expect(countBefore).toBeGreaterThan(0)

          // Dentro de ese menú, nunca aparece "Editar roles y capacidades": esa edición es
          // exclusiva del dueño en ADM-27 (USERS-010), un administrador con manage_users no la
          // ve aunque pueda resetear/desactivar a la misma persona.
          await actionButtonsBefore.first().click()
          await expect(
            adminPage.getByRole('menuitem', {
              name: 'Editar roles y capacidades',
            }),
          ).toHaveCount(0)
          await adminPage.keyboard.press('Escape')

          // ConfigNav: ve Usuarios y Empresa, no ve Feriados/Criterios/Eventos de seguridad
          // (05_Pantallas_y_Navegacion.md línea 97: "solo dueño").
          const nav = adminPage.getByRole('navigation', {
            name: 'Secciones de configuración',
          })
          await expect(
            nav.getByRole('link', { name: 'Usuarios' }),
          ).toBeVisible()
          await expect(nav.getByRole('link', { name: 'Empresa' })).toBeVisible()
          await expect(nav.getByRole('link', { name: 'Feriados' })).toHaveCount(
            0,
          )
          await expect(
            nav.getByRole('link', { name: 'Criterios de calificación' }),
          ).toHaveCount(0)
          await expect(
            nav.getByRole('link', { name: 'Eventos de seguridad' }),
          ).toHaveCount(0)

          // Si igual escribe la URL a mano, la pantalla se lo niega (OwnerOnlyNotice), no le
          // muestra una lista vacía que se leería como "no hay nada cargado".
          for (const path of [
            '/admin/configuracion/feriados',
            '/admin/configuracion/criterios',
            '/admin/configuracion/seguridad',
          ]) {
            await adminPage.goto(path)
            await expect(
              adminPage.getByText(
                'Esta sección es solo para el dueño de la cuenta',
              ),
            ).toBeVisible()
          }
        })

        await test.step('cierra sesión (para que el próximo ingreso traiga claims frescos)', async () => {
          await adminPage.goto('/admin')
          await adminPage
            .getByRole('button', { name: 'Menú de usuario' })
            .click()
          await adminPage
            .getByRole('menuitem', { name: 'Cerrar sesión' })
            .click()
          await expect(adminPage).toHaveURL(/\/ingresar/)
        })
      } finally {
        await adminContext.close()
      }

      await test.step('el dueño le quita "Gestionar usuarios" (manage_users)', async () => {
        await page.goto('/admin/configuracion/usuarios')
        await page
          .getByRole('button', { name: `Acciones para ${fullName}` })
          .click()
        await page
          .getByRole('menuitem', { name: 'Editar roles y capacidades' })
          .click()
        // Mientras `useAdminCapabilitiesQuery` está en curso, la sección muestra siete
        // `<Skeleton>` en vez de `<Switch>` (`RolesCapabilitiesSheet.tsx`): hay que esperar a que
        // el primer switch de verdad esté visible ANTES de buscar el de "Gestionar usuarios" por
        // nombre, o un `.count()` leído en el instante equivocado da 0 (encontrado corriendo
        // esta suite: pasaba una vez de cada dos, según si la respuesta de la query llegaba
        // antes o después del `count()` -- justo el tipo de intermitencia que TEST-029 pide
        // evitar).
        await expect(page.getByRole('switch').first()).toBeVisible()
        const targetSwitch = page.getByRole('switch', {
          name: /Gestionar usuarios/i,
        })
        await targetSwitch.click()
        await expect(targetSwitch).not.toBeChecked()
        await page.getByRole('button', { name: 'Cerrar' }).first().click()
      })

      const secondAdminContext = await browser.newContext(
        page.viewportSize() ? { viewport: page.viewportSize()! } : {},
      )
      const secondAdminPage = await secondAdminContext.newPage()
      try {
        await test.step('segundo ingreso: ya no ve ninguna acción que exigía manage_users', async () => {
          await secondAdminPage.goto('/ingresar')
          await secondAdminPage.getByLabel('Email').fill(email)
          await secondAdminPage.getByLabel('Contraseña').fill(password)
          await secondAdminPage
            .getByRole('button', { name: 'Ingresar' })
            .click()
          await expect(secondAdminPage).toHaveURL(/\/admin$/)

          await secondAdminPage.goto('/admin/configuracion/usuarios')
          await expect(
            secondAdminPage.getByRole('heading', { name: 'Usuarios y roles' }),
          ).toBeVisible()
          const actionButtonsAfter = secondAdminPage.getByRole('button', {
            name: /^Acciones para/,
          })
          await expect(actionButtonsAfter).toHaveCount(0)
        })
      } finally {
        await secondAdminContext.close()
      }
    } finally {
      if (newAdminProfileId) {
        // Regla del encargo: "dejá desactivados los usuarios que creaste" -- se banea directo
        // con la clave de servicio (no por la Edge Function: esta limpieza no necesita gastar
        // cupo del límite de 10 acciones por minuto del dueño, ver el comentario de
        // `banDirectly`).
        await banDirectly(admin, newAdminProfileId)
      }
    }
  })
})
