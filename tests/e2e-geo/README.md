# `tests/e2e-geo`

Suite e2e del módulo B1 (geolocalización y corrección de fichajes, P22.5) contra `App_dev`. Usa el
conjunto de cuentas propio `geo` (`tests/fixtures/accounts.ts`) y datos por test con prefijo `e2e-`
que cada test limpia (también el rastro de las correcciones en `security_events`). Nunca corre contra
producción. Los casos por API directa están en `tests/permissions/suite/92-geo-b1.permissions.ts`
(permisos) y `93-geo-regla.permissions.ts` (casos borde de la regla contra las RPC reales).

| Archivo                     | Qué prueba                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `empleado.movil.ts`         | EMP-05/EMP-10 a 390 px con posición simulada: dentro, fuera con motivo, precisión mala (B-06, B-23), esperar señal, sin permiso, sin consentimiento, sede sin coordenadas, re-consentimiento |
| `supervisor.movil.ts`       | Lo mismo para SUP-04 (B-07)                                                                                                                                                                  |
| `historial.movil.ts`        | Historial del empleado: estado, «Validado (corregido)» y «Corregido», sin motivos ni coordenadas                                                                                             |
| `presencia.desktop.ts`      | Resumen: mapa de presencia, finalizados, sin ubicación, «Ver turno», actualización cada 45 s, «Requiere atención»                                                                            |
| `radios.desktop.ts`         | «Mostrar radios», radio general, radio propio en el formulario y detalle de la sede                                                                                                          |
| `planilla-turno.desktop.ts` | Planilla con «Solo fuera de zona»; detalle del turno y de la supervisión con «Corregir hora» y «Marcar como válido»                                                                          |
| `imprimibles.desktop.ts`    | AJ-06 y resumen por cliente con el texto de validación y sin coordenadas                                                                                                                     |
| `accesibilidad.*.ts`        | axe-core en las pantallas nuevas (celular y 1280 px)                                                                                                                                         |

## Cómo correrla

```bash
pnpm test:e2e:geo                      # build + todos los proyectos (puerto 5173)
# con otro puerto y un servidor ya levantado (`pnpm exec vite preview --port 5205 --strictPort`):
E2E_BASE_URL=http://localhost:5205 E2E_REUSE_SERVER=1 E2E_SKIP_SWEEP=1 \
  node --env-file=.env.local ./node_modules/@playwright/test/cli.js test \
  --config=tests/e2e-geo/playwright.geo.config.ts --project=mobile
```

Proyectos: `mobile` (390 px), `desktop` (1280 px) y `webkit-movil` (iPhone 14, después de `mobile`).

## Defectos abiertos marcados con `test.fail()`

- **DEF-B1-01** (`empleado.movil.ts`): el círculo de la sede del mini mapa queda azul por omisión y
  nunca verde ni rojo (`circlePathOptions` pasa `className` por `setStyle`, que Leaflet ignora).
