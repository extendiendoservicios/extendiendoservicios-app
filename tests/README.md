# `tests`

Pruebas que no son unitarias (esas viven junto a cada archivo en `src/` como
`*.test.ts(x)`, con Vitest):

- `e2e/` — pruebas de punta a punta con Playwright (proyectos chromium,
  webkit y mobile a 390 px). `pnpm test:e2e` las corre contra
  `pnpm preview`.
- `permissions/` — suite negativa por rol (cada rol intenta lo que no puede,
  por UI y por API directa), desde F18.
- `fixtures/` — datos y helpers compartidos entre specs de e2e, a medida que
  se necesiten.

`permissions/` y `fixtures/` se crean cuando tengan contenido (F18); por
ahora solo existe `e2e/` con la prueba de humo de esta fase.
