# `tests/e2e-clients-sites`

e2e de clientes y sedes (CLIENT-008, SITE-008, TEST-005 — `08_Fases_y_Backlog.md` F8, encargo
P08.5) contra un backend real (`App_dev`): alta de cliente con CUIT y dos contactos (cambio de
principal), CUIT repetido, suspensión de un cliente; alta de sede con coordenadas y su marcador
en el mapa (ADM-24), filtro por cliente, apertura desde el popup, nombre de sede repetido; el
criterio de aceptación de F8 tal cual ("un administrador da de alta un cliente con dos contactos
y dos sedes con coordenadas; el mapa las muestra"), corrido con la cuenta `admin` del seed, no
`owner`; rutas de administración de este dominio vedadas a empleado y supervisor; capturas
móviles de ADM-19, ADM-21, ADM-22 y ADM-24 sin scroll horizontal.

## Por qué está separada de `tests/e2e`, `tests/e2e-auth` y `tests/e2e-users`

Mismo motivo que separó esas tres entre sí (ver sus propios README): esta suite necesita
`SUPABASE_SERVICE_ROLE_KEY` para preparar precondiciones (un cliente ya existente antes de crear
una sede, por ejemplo) y para borrar todo lo que crea al terminar, sin pasar por la interfaz —
algo que ni `ci.yml` ni los workflows de despliegue tienen ni deberían tener. A diferencia de
`tests/e2e-users/`, este dominio no llama a ninguna Edge Function (todo es insert/update directo
por PostgREST, `06_API.md` secciones 4 y 5), así que no hereda la restricción de puerto por CORS
de esa suite: usa un puerto propio (4175), no 5173.

## Cómo correrla

Desde `app/`, con `.env.local` completo (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SEED_DEV_PASSWORD`):

```bash
pnpm test:e2e:clients-sites                      # chromium (1280 px) y mobile (390 px, solo las capturas)
pnpm test:e2e:clients-sites --project=chromium   # uno solo
```

`pnpm test:e2e:clients-sites` corre `pnpm build` primero (carga `.env.local` con la convención
de Vite, así apunta de verdad a `App_dev`) y recién después Playwright, que sirve ese `dist/`
con `vite preview --port 4175`.

## Organización

- `helpers/env.ts` — lee y valida las cuatro variables (nunca las imprime); copia deliberada de
  `tests/e2e-users/helpers/env.ts`, no un import cruzado: cada suite de backend real queda
  autocontenida.
- `helpers/adminClient.ts` — cliente con la clave de servicio para crear clientes de
  precondición (`createDisposableClient`) y borrar en cascada (sedes, contactos, cliente) todo lo
  que la suite deja (`deleteDisposableClient`), más `disposableName`/`disposableCuit` para
  nombres y CUIT únicos por corrida.
- `helpers/interceptMap.ts` — intercepta Nominatim (nunca se llama de verdad, servicio externo
  con límite de uso) y los tiles de OpenStreetMap (PNG de 1×1, para no depender de la red).
- `helpers/login.ts` — login por interfaz contra una cuenta real, con la URL esperada según el
  rol.
- `helpers/noHorizontalScroll.ts` — comprobación mecánica de `scrollWidth <= clientWidth` para
  las capturas móviles.
- `client-full-signup.spec.ts` (CLIENT-008) — alta de cliente con CUIT, dos contactos (uno
  principal, cambio de cuál es el principal), CUIT repetido rechazado con el mensaje exacto de
  `06_API.md` sección 15, cambio de estado a "Suspendido". Corre como el dueño del seed.
- `site-map.spec.ts` (SITE-008) — alta de sede con coordenadas (cargadas a mano en los campos de
  latitud y longitud, sin tocar Nominatim), su marcador en ADM-24, filtro por cliente (con un
  cliente de control que no tiene que aparecer), apertura de la ficha desde el popup, nombre de
  sede repetido para el mismo cliente rechazado. Corre como el dueño del seed.
- `client-two-contacts-two-sites-acceptance.spec.ts` — el criterio de aceptación de F8 tal cual
  lo escribe `08_Fases_y_Backlog.md`, corrido con la cuenta `admin` del seed (no `owner`, a
  diferencia del resto de esta suite): un cliente con dos contactos y dos sedes con coordenadas,
  las dos visibles en el mapa filtrado por ese cliente.
- `route-access-employee-supervisor.spec.ts` (parte de TEST-005) — un empleado y una supervisora
  con sesión real que escriben a mano las rutas de administración de este dominio terminan en su
  propia vía (`/app`, `/sup`), nunca ven la pantalla. Sin API directa: esa parte de la suite de
  permisos es TEST-019 (F18).
- `mobile-screenshots.spec.ts` (parte de TEST-005) — capturas a 390 px (proyecto `mobile`) de
  ADM-19 (listado), ADM-21, ADM-22 y ADM-24, cada una con la comprobación de que no haya scroll
  horizontal. Las capturas quedan en `test-results/capturas-p085/` (gitignorado, la misma
  carpeta donde Playwright ya guarda el resto de la evidencia de cada corrida — no se versionan).

## Independencia y limpieza

Nombres descartables con el prefijo `E2E-P085` en la razón social o el nombre de la sede,
distinto del de `tests/e2e-auth/` (`e2e-auth-`) y `tests/e2e-users/` (`e2e-p074-`), para poder
identificar de un vistazo qué suite dejó cada fila si algo quedara a medio limpiar. `clients`,
`sites` y `client_contacts` no tienen `on delete cascade` entre sí (decisión del modelo: nada se
borra físicamente salvo un alta de prueba descartable como esta, `04_Modelo_de_Datos.md` sección

1. — `deleteDisposableClient` borra a mano, en orden (sedes, contactos, cliente), en un
   `try/finally` de cada spec, aun si el test falla.

## Qué no cubre (para el orquestador)

- La suite de permisos completa por API directa sobre `clients`/`sites`/`client_contacts` (leer
  y escribir fuera de rol, por `supabase-js` directo) es TEST-019 (F18): esta suite solo prueba
  la navegación (rutas vedadas por interfaz).
- Lighthouse y la revisión sistemática a 768/1024/1366/1440 px son de F17 (RESP-003 en
  adelante): las capturas de acá son solo las cuatro pantallas de este dominio a 390 px que pide
  TEST-005.
