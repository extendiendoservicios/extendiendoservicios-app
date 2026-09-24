# `tests`

Pruebas que no son unitarias (esas viven junto a cada archivo en `src/` como
`*.test.ts(x)`, con Vitest):

- `e2e/` — pruebas de punta a punta con Playwright (proyectos chromium,
  webkit y mobile a 390 px). `pnpm test:e2e` las corre contra
  `pnpm preview`. **Suite de humo**: `ci.yml` la corre contra un build con
  variables FALSAS (sin backend) y `deploy-staging.yml`/
  `deploy-production.yml` la reutilizan como smoke test contra la URL ya
  publicada. Por eso no puede depender de ningún dato real ni de sesión.
- `e2e-auth/` — e2e de autenticación (AUTH-012/TEST-003, P06.4) contra un
  backend real (`App_dev`): ingreso por rol, credenciales erróneas,
  recuperación de contraseña de punta a punta, persistencia de sesión y
  usuario desactivado. **Aparte de `e2e/` a propósito**: necesita
  `app/.env.local` (las mismas cuatro variables que `scripts/seed-dev.ts` —
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SEED_DEV_PASSWORD`) para loguear con las cuentas del seed y crear/borrar
  cuentas descartables (prefijo `e2e-auth-`) con la Admin API. Ninguno de los
  tres workflows la descubre ni la ejecuta (su config, su `testDir` y su
  script son propios). Se corre a mano, desde `app/`:

  ```bash
  pnpm test:e2e:auth                      # los dos proyectos (chromium, mobile)
  pnpm test:e2e:auth --project=chromium   # uno solo
  ```

  El script corre `pnpm build` primero (carga `.env.local` con la
  convención de Vite, así que apunta de verdad a `App_dev`) y recién
  después Playwright, que sirve ese `dist/` en el puerto 4174. Ver
  `tests/e2e-auth/README.md` y `tests/e2e-auth/helpers/env.ts` para el
  detalle.

- `e2e-clients-sites/` — e2e de clientes y sedes (CLIENT-008/SITE-008/TEST-005, P08.5) contra
  un backend real (`App_dev`): alta de cliente con contactos y CUIT repetido, alta de sede con
  coordenadas y su marcador en el mapa, el criterio de aceptación de F8 con la cuenta `admin`,
  rutas vedadas a empleado y supervisor, capturas móviles sin scroll horizontal. Mismo motivo de
  separación que `e2e-auth/` y `e2e-users/` (necesita la clave de servicio); puerto propio
  (4175), sin la restricción de CORS de `e2e-users/` porque este dominio no llama a ninguna Edge
  Function. Se corre a mano: `pnpm test:e2e:clients-sites`. Ver `tests/e2e-clients-sites/README.md`.
- `permissions/` — suite negativa por rol (cada rol intenta lo que no puede,
  por interfaz y por API directa). Primer esqueleto desde P04.7 (F4, API
  directa solamente, criterio de aceptación de la fase); la versión
  completa (todas las tablas y RPC, más la variante por interfaz) es
  TEST-019 (F18). Ver `permissions/README.md`: corre con un config de
  Vitest propio, fuera de `pnpm test`, porque necesita credenciales de
  `App_dev` que no existen en CI.
- `fixtures/` — datos y helpers compartidos entre specs de e2e, a medida que
  se necesiten.

`fixtures/` se crea cuando tenga contenido (llega con los primeros specs de
`e2e/` de una pantalla real, F6 en adelante).
