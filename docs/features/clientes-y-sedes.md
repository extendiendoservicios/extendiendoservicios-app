# Clientes y sedes (ADM-19 a ADM-24)

Seis pantallas bajo `/admin/clientes...` y `/admin/sedes...`: listado de
clientes (ADM-19, con su pestaña Mapa, ADM-24), formulario de cliente
(ADM-20), detalle de cliente con pestañas (ADM-21), detalle de sede
(ADM-22) y formulario de sede (ADM-23). Clientes es de P08.3 (CLIENT-001 a
CLIENT-006, CLIENT-009); sedes y el mapa son de P08.4 (SITE-001 a SITE-003,
SITE-005, SITE-006, SITE-009, SITE-010). Sin capacidad que las restrinja
(`03_Plan_Maestro_Tecnico.md` sección 6, `04_Modelo_de_Datos.md` sección
7.2: "O, A: todas") — las ve y las edita cualquier dueño o administrador,
protegidas solo por `RequireRole allow={['owner','admin']}` del grupo
`/admin` (`router.tsx`) y por `clients_write_admin`/`client_contacts_write_
admin`/`sites_write_admin` del lado del servidor (`0012_rls_policies.sql`).

## ADM-19 · Clientes · listado

Ruta `/admin/clientes`. Pestañas "Listado" y "Mapa" (`?pestana=mapa` para la
segunda, por omisión "Listado"; mismo patrón de `?pestana=` que ADM-21).

- **Listado**: tabla (`DataTable`) con nombre, CUIT, sedes, servicios
  activos, contacto principal y estado; filtro de texto (nombre, fantasía o
  CUIT) con `useDebouncedValue` de 300 ms y filtro de estado; botón "Nuevo
  cliente" (ADM-20). Polling de 60 s con indicador "Actualizado hace n s"
  (`UpdatedAgo.tsx`, regla común de `02_Decisiones.md` P-005 — ni tablero ni
  "Asistencia de hoy").
- **Mapa** (ADM-24, SITE-005): `MapView` de página completa con un marcador
  por sede con coordenadas cargadas (color según estado, mismo criterio que
  `StatusBadge`), popup con cliente, sede, dirección y enlace a ADM-22.
  Filtro por cliente (`Select`, todas las sedes por omisión). Las sedes sin
  coordenadas no aparecen en el mapa: un texto junto al filtro avisa cuántas
  quedan afuera ("Hay n sedes sin ubicación cargada, no se ven en el mapa").
  Polling de 60 s, igual que el listado. `MapView` recién se monta la
  primera vez que se elige esta pestaña (Radix desmonta el contenido de la
  pestaña inactiva) — no hace falta `invalidateSize()`.

## ADM-20 · Cliente · formulario

Rutas `/admin/clientes/nuevo` y `/admin/clientes/:id/editar`, una sola
página (`ClientFormPage.tsx`) que decide el modo con `useParams().id`.
Razón social, fantasía, CUIT, dirección administrativa, coordenadas
(opcional, `MapPicker` de `@/components/map`, SITE-004/P08.2), estado y
notas.

## ADM-21 · Cliente · detalle

Ruta `/admin/clientes/:id`. Cabecera con nombre, estado (`StatusBadge`),
CUIT, dirección administrativa y notas; botones "Editar" (ADM-20) y
"Cambiar estado" (CLIENT-006). Pestañas, sincronizadas con `?pestana=` (por
omisión, sin el parámetro, es "Sedes"):

- **Sedes**: lista simple de las sedes vigentes del cliente, con enlace a
  cada una (ADM-22) y a "Nueva sede" (ADM-23, con el cliente ya elegido por
  `?cliente=`).
- **Contactos**: alta, edición, marcar principal y baja lógica en línea
  (CLIENT-005, sin ruta propia) — ver más abajo.
- **Servicios**: placeholder ("se gestionan a partir de F10"), tal como
  pide `08_Fases_y_Backlog.md` para CLIENT-004.
- **Tareas**: enlace a la plantilla de tareas del cliente (ADM-26, también
  placeholder hoy).

### Contactos (CLIENT-005)

`ClientContactsPanel` + `ClientContactFormDialog`
(`src/features/clients/components/`). Un único contacto principal por
cliente, exigido por el índice único parcial `client_contacts_one_primary_
per_client_idx` (`0005_clients_sites.sql`). Sin RPC que lo resuelva en una
transacción (`06_API.md` sección 4: "insert/update/delete lógico en
`client_contacts`", directo por PostgREST): marcar principal hace **dos**
`update` secuenciales (`setPrimaryClientContact` en `src/api/clients.ts`) —
primero le saca la marca al contacto que la tuviera, después se la pone al
nuevo. Documentado en el comentario de esa función el riesgo residual (si
el segundo paso fallara justo después del primero, el cliente queda un
instante sin principal) y por qué se aceptó: no había una función de
servidor para esto en ese paquete.

La baja de un contacto es lógica (`deleted_at`), sin motivo obligatorio (no
está en la lista de `07_Design_System.md` sección 2.4 que sí lo exige) —
confirmación simple con `SimpleConfirmDialog`.

### Cambiar estado del cliente (CLIENT-006)

`ChangeClientStatusDialog`: confirmación simple (sin motivo obligatorio,
mismo criterio que arriba) con un texto que explica el efecto de cada
estado (`06_API.md` sección 4: "pasar a `suspended` o `closed` no toca
turnos existentes; `generate_shifts` y `create_shift` rechazan clientes no
activos").

## ADM-22 · Sede · detalle

Ruta `/admin/sedes/:id`. Cabecera con nombre de la sede, estado
(`StatusBadge`) y enlace al cliente dueño; botones "Editar" (ADM-23) y
"Cambiar estado" (SITE-006). Debajo, secciones apiladas (sin pestañas, a
diferencia de ADM-21: ninguna es tan pesada como para ocultarla hasta
elegirla, y así el mapa queda siempre montado — ver la nota de
`SiteDetailPage.tsx` sobre `invalidateSize()`):

- **Datos**: `SiteInfo` (ver más abajo) — dirección con enlace al mapa,
  horario del edificio, instrucciones de acceso, restricciones informativas
  y contacto de la sede.
- **Ubicación**: `MapView` con el marcador de la sede (si tiene
  coordenadas) y el zoom con la rueda desactivado
  (`scrollWheelZoom={false}`): la página tiene scroll propio y la rueda
  tiene que moverla a ella, no acercar el mapa (mismo criterio que
  `MapPicker`, que ya lo traía fijo).
- **Servicios**: placeholder hasta la gestión de servicios (F10).
- **Plantilla de tareas**: placeholder con enlace a Plantillas de tareas
  (ADM-26, también placeholder hoy).
- **Próximos turnos**: placeholder hasta P08.6/P08.7 (turnos).

## ADM-23 · Sede · formulario

Rutas `/admin/sedes/nueva?cliente=<id>` y `/admin/sedes/:id/editar`, una
sola página (`SiteFormPage.tsx`) con el mismo patrón que `ClientFormPage`.
El cliente no se elige en el formulario: llega por el parámetro `cliente`
en el alta (lo pone el botón "Nueva sede" de la pestaña Sedes de ADM-21) o
por la sede misma en la edición — una sede no cambia de dueño. Nombre,
dirección, localidad, contacto (nombre y teléfono), horario del edificio,
instrucciones de acceso, dos restricciones informativas (`Switch` "no usar
el teléfono" y "no se permiten fotos") más un texto libre, coordenadas con
`MapPicker` (que ya trae "Buscar dirección" contra Nominatim y ajuste
manual del marcador, SITE-004/P08.2) y estado.

### Cambiar estado de la sede (SITE-006)

`ChangeSiteStatusDialog`: mismo patrón que `ChangeClientStatusDialog`
(confirmación simple, sin motivo obligatorio) con el efecto de cada estado
(`06_API.md` sección 5: "Inactiva: sin turnos nuevos → `SITE_NOT_ACTIVE`").

## `SiteInfo` (SITE-010)

`src/features/sites/components/SiteInfo.tsx`: componente de solo lectura,
reutilizable entre `front-admin` (ADM-22) y `front-movil` (EMP-04, detalle
del servicio del empleado, y SUP-03, detalle de la supervisión — ambos
fuera de este paquete). Recibe los datos ya cargados por quien lo usa
(`SiteInfoData`: dirección, ciudad, coordenadas, contacto de la sede,
instrucciones de acceso, horario del edificio, las dos restricciones
booleanas y el texto libre) — no hace ninguna consulta propia, así que no
depende de qué pueda leer por RLS cada rol: todas esas columnas son de
`sites`, y `sites_select_shift_party` (`0012_rls_policies.sql`) le da a
empleados y supervisores la fila completa de la sede de su turno.

Muestra la dirección con un enlace "Abrir en el mapa"
(`src/features/sites/mapsLink.ts`, `buildMapsUrl`): un link
`https://www.google.com/maps/search/...` armado con las coordenadas si la
sede las tiene, o con la dirección como texto de búsqueda si no — no un URI
`geo:` (que sí menciona `05_Pantallas_y_Navegacion.md` para EMP-04), porque
`geo:` no lo abren los navegadores de escritorio ni Safari/iOS sin la app
de Google Maps instalada; el link web lo abre cualquier navegador y, en el
celular, deja elegir la app de mapas instalada.

## Decisiones tomadas en P08.3 (clientes)

- **`CUIT_IN_USE` se arma a mano en el cliente**, no en el servidor: igual
  que `settings.ts` (ADM-28 a ADM-31, P07.3), no hay una RPC propia para
  clientes (`06_API.md` sección 4: todo "insert/update" directo por
  PostgREST) — `clients.cuit unique` solo da un `23505` genérico de
  Postgres. `mapWriteError` en `src/api/clients.ts` lo traduce al mensaje y
  al código exacto de `06` sección 15 ("Ese CUIT ya está registrado.",
  `CUIT_IN_USE`) cuando el texto de la restricción menciona `cuit`; el
  resto de los `23505` caen en un `DUPLICATE` genérico.
- **`created_by`/`updated_by` no los completa un trigger**: igual que
  `settings.ts`, `0005_clients_sites.sql` solo dispara `app.set_updated_at`
  (toca `updated_at`), así que cada función de escritura de
  `src/api/clients.ts` recibe el `profileId` de quien está logueado como
  parámetro (`useAuth().userId`).
- **La columna "Sedes" de ADM-19 no dice "sedes activas"**, aunque
  `05_Pantallas_y_Navegacion.md` línea 73 así la nombra: `v_clients.sites_
count` (`0011_views.sql`) cuenta las sedes vigentes (`deleted_at is null`)
  sin filtrar por `status` — llamarla "activas" prometería un filtro que la
  vista no hace. "Servicios activos" sí es literal:
  `active_services_count` filtra `status = 'active'`.
- **Filtro de texto de ADM-19 en el servidor, con `useDebouncedValue`**
  (`src/features/clients/useDebouncedValue.ts`, 300 ms) en vez de filtrar
  en el cliente sobre una lista completa (como el interruptor de ADM-27):
  se prefirió no traer de más ni duplicar en el frontend la lógica de
  búsqueda de `ilike` sobre tres columnas. El filtro de estado sí viaja al
  servidor sin debounce (cambia por selección, no por tecla).
- **`UpdatedAgo` se duplicó** en `src/features/clients/components/
UpdatedAgo.tsx` (copia de `src/features/users/components/UpdatedAgo.tsx`):
  es la segunda pantalla que lo necesita, justo el caso que el comentario
  original ya avisaba. Sigue sin subirse a `src/components/` porque ese
  directorio no es de este dominio — pedido a front-plataforma.
- **`SimpleConfirmDialog` (`src/features/settings/components/`) ganó un
  `children` opcional** para poder meterle el `Select` de estado nuevo de
  `ChangeClientStatusDialog` entre la descripción y los botones, en vez de
  crear un diálogo de confirmación paralelo solo para eso. `ChangeSite
StatusDialog` (P08.4) reutiliza el mismo componente.

## Decisiones tomadas en P08.4 (sedes)

- **`SITE_NAME_IN_USE` se arma a mano**, mismo criterio que `CUIT_IN_USE`:
  `06_API.md` sección 5 tampoco tiene una RPC propia para sedes
  (`sites_write_admin` protege `insert`/`update` directos) —
  `mapWriteError` en `src/api/sites.ts` detecta el índice
  `sites_client_id_name_key` en el texto del `23505` y arma el mensaje
  exacto de `06` sección 15.
- **`fetchSiteDetail` embebe `clients(legal_name, trade_name, status)`**:
  ADM-22 puede abrirse directo desde el mapa (ADM-24) sin haber pasado por
  la ficha del cliente, así que necesita el nombre del cliente para la
  cabecera y el enlace de vuelta; `sites` no lo trae.
- **El mapa de sedes (ADM-24) no filtra `latitude not null` en el
  servidor**, a diferencia de lo que sugiere `06_API.md` sección 4
  ("`from('sites')...not('latitude','is',null)`"): `fetchSitesForMap` trae
  todas las sedes vigentes del filtro elegido y el filtrado por coordenadas
  se hace en el cliente, porque la pantalla necesita el total (con y sin
  coordenadas) para el aviso "n sedes sin ubicación cargada" que pide
  SITE-005 — con el filtro en el servidor no habría forma de saber cuántas
  quedaron afuera sin una segunda consulta.
- **El filtro "Cliente" del mapa (`fetchClientFilterOptions`, en
  `src/api/sites.ts`) lista todos los clientes vigentes**, sin filtrar por
  `status`: un cliente suspendido o dado de baja puede seguir teniendo
  sedes con turnos históricos que valga la pena ubicar en el mapa.
- **`ADM-22` no usa pestañas** (a diferencia de ADM-21): ninguna de sus
  secciones (servicios, plantilla de tareas, próximos turnos) tiene hoy
  contenido propio — son placeholders — así que no había necesidad de
  ocultar nada detrás de una pestaña. Esto además evita mezclar `MapView`
  con el problema de montarlo dentro de una pestaña oculta
  (`invalidateSize()`): acá está siempre visible.
- **`MapView` ganó la prop `scrollWheelZoom`** (`src/components/map/
LeafletMapView.tsx`, `true` por omisión): hacía falta para ADM-22, un mapa
  embebido en una página con scroll propio, donde la rueda tiene que
  scrollear la página y no hacer zoom (mismo criterio que ya traía fijo
  `MapPicker`). Es un cambio chico y de compatibilidad hacia atrás a un
  componente de `src/components/`, que no es de este dominio — señalado en
  el reporte del encargo para que lo revise front-plataforma.

## Qué falta / para el orquestador

- Servicios (F10) y la plantilla de tareas de cliente y de sede (ADM-26)
  son de paquetes posteriores; esta fase solo deja los enlaces preparados.
- "Próximos turnos" de ADM-22 queda vacío hasta que exista turnos (P08.6/
  P08.7).
- El cambio a `LeafletMapView.tsx` (prop `scrollWheelZoom`) conviene que lo
  revise front-plataforma y lo sume a `docs/design-system.md` (no se tocó
  ese archivo en este paquete: no es de este dominio).
