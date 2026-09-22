# `tests`

Pruebas que no son unitarias (esas viven junto a cada archivo en `src/` como
`*.test.ts(x)`, con Vitest):

- `e2e/` — pruebas de punta a punta con Playwright (proyectos chromium,
  webkit y mobile a 390 px). `pnpm test:e2e` las corre contra
  `pnpm preview`.
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
