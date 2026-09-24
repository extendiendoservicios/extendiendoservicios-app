# Clientes (ADM-19 a ADM-21)

Tres pantallas del paquete P08.3 (CLIENT-001 a CLIENT-006, CLIENT-009),
bajo `/admin/clientes...`: listado (ADM-19), formulario de alta y edición
(ADM-20) y detalle con pestañas (ADM-21). Sin capacidad que las restrinja
(`03_Plan_Maestro_Tecnico.md` sección 6, `04_Modelo_de_Datos.md` sección
7.2: "O, A: todas") — las ve y las edita cualquier dueño o administrador,
protegidas solo por `RequireRole allow={['owner','admin']}` del grupo
`/admin` (`router.tsx`) y por `clients_write_admin`/`client_contacts_write_
admin` del lado del servidor (`0012_rls_policies.sql`).

## ADM-19 · Clientes · listado

Ruta `/admin/clientes`. Tabla (`DataTable`) con nombre, CUIT, sedes,
servicios activos, contacto principal y estado; filtro de texto (nombre,
fantasía o CUIT) con `useDebouncedValue` de 300 ms y filtro de estado;
botón "Nuevo cliente" (ADM-20). Polling de 60 s con indicador "Actualizado
hace n s" (`UpdatedAgo.tsx`, regla común de `02_Decisiones.md` P-005 — ni
tablero ni "Asistencia de hoy").

La pestaña "Mapa" que describe `05_Pantallas_y_Navegacion.md` línea 73
(`?pestana=mapa` → ADM-24) **no se construyó en este paquete**: es
SITE-005, de P08.4. La barra de filtros de ADM-19 queda lista para sumarla
después sin rehacer nada.

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
  cada una (ADM-22) y a "Nueva sede" (ADM-23). El alta y el detalle de sede
  en sí son de SITE-001 a SITE-004 (P08.4): hoy esas rutas existen como
  placeholder en `adminRoutes.tsx` (ya lo estaban antes de este paquete);
  los enlaces de esta pestaña quedan preparados, sin construir esas
  pantallas.
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
servidor para esto en este paquete.

La baja de un contacto es lógica (`deleted_at`), sin motivo obligatorio (no
está en la lista de `07_Design_System.md` sección 2.4 que sí lo exige) —
confirmación simple con `SimpleConfirmDialog`.

### Cambiar estado (CLIENT-006)

`ChangeClientStatusDialog`: confirmación simple (sin motivo obligatorio,
mismo criterio que arriba) con un texto que explica el efecto de cada
estado (`06_API.md` sección 4: "pasar a `suspended` o `closed` no toca
turnos existentes; `generate_shifts` y `create_shift` rechazan clientes no
activos").

## Decisiones tomadas en este paquete

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
  `active_services_count` filtra `status = 'active'`. Decisión menor, ver
  el reporte del encargo.
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
  directorio no es de este dominio — pedido a front-plataforma en el
  reporte del encargo.
- **`SimpleConfirmDialog` (`src/features/settings/components/`) ganó un
  `children` opcional** para poder meterle el `Select` de estado nuevo de
  `ChangeClientStatusDialog` entre la descripción y los botones, en vez de
  crear un diálogo de confirmación paralelo solo para eso.

## Qué falta / para el orquestador

- La pestaña "Mapa" de ADM-19 (`?pestana=mapa` → ADM-24) queda para
  SITE-005 (P08.4).
- Sedes (ADM-22, ADM-23), servicios (F10) y la plantilla de tareas del
  cliente (ADM-26) son de paquetes posteriores; esta fase solo deja los
  enlaces preparados.
