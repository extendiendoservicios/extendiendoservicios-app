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
- `e2e-assignments/` — e2e de asignaciones y cronograma (ASSIGN-015/ASSIGN-016/TEST-008, P11.4)
  contra un backend real (`App_dev`): asignar hasta completar la dotación y verlo en la grilla
  semanal, quitar con motivo, superposición rechazada con su mensaje, un turno cancelado que
  conserva sus asignaciones, asignar desde la lista del día en celular, advertencia
  `NOT_ENABLED_FOR_CLIENT` sin bloquear, y el rendimiento del calendario mensual con 600 turnos.
  Puerto propio (4176): a diferencia de otras suites de backend real, no invoca ninguna Edge
  Function. Se corre a mano: `pnpm test:e2e:assignments`. Ver `tests/e2e-assignments/README.md`.
- `e2e-tablero/` — e2e y rendimiento del tablero operativo ADM-02 (DASH-008/DASH-009/TEST-013,
  P16.2) contra un backend real (`App_dev`): escenario con ausencia avisada, sin registro y turno
  sin cubrir, acciones del tablero, versión de 390 px (D29), permisos y rendimiento con 24 turnos y
  40 asignaciones. Las franjas son fijas dentro del día del turno (no dependen de la hora en que
  corre). Puerto 5173. Se corre a mano: `pnpm test:e2e:tablero`. Ver `tests/e2e-tablero/README.md`.
- `e2e-responsive/` y `lighthouse/` — **suite responsive (TEST-014, F17, RB-X01)**. Tres capas que
  se complementan; cada una tiene su detalle en su propio README (no se repite acá):

  | Capa                               | Qué comprueba                                                                                                                                                                                                                                                                               | Dónde / cómo                                                                                                                               |
  | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
  | Capturas por viewport (Playwright) | Las pantallas de administración a 390, 768, 1024, 1366 y 1440 px (las 20 principales a los cinco): sin scroll horizontal, tabbar o sidebar según el ancho, tarjetas en vez de tablas, objetivos táctiles de 44 px, área segura en `/app` y `/sup`. Guarda una captura por pantalla y ancho. | `e2e-responsive/`; `pnpm test:e2e:responsive`; capturas en `test-results/responsive-capturas/`. Ver `e2e-responsive/README.md`.            |
  | Lighthouse (staging)               | Accesibilidad >= 90, rendimiento y buenas prácticas de referencia, e instalabilidad de la PWA (a mano, porque Lighthouse 12+ ya no trae la categoría PWA), en celular y escritorio.                                                                                                         | `lighthouse/`; `pnpm test:lighthouse`; informes en `test-results/lighthouse/`. Ver `lighthouse/README.md`.                                 |
  | Dispositivos reales                | Instalación, pantalla completa, sesión por rol, fichaje con ubicación, teclado, área segura, rotación, aviso de versión nueva y sin conexión, en dos Android y un iPhone.                                                                                                                   | Planilla `docs/matriz-dispositivos.md` (RESP-011); la completa Mike. Explicación general en `docs/features/responsive.md` y `docs/pwa.md`. |

  Orden recomendado en una revisión: primero las capturas (rápidas y locales), después Lighthouse
  sobre staging ya desplegado, y por último la planilla en los teléfonos.

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
