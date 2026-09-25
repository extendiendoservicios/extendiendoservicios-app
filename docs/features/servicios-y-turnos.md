# Servicios y turnos (F10)

`08_Fases_y_Backlog.md` (DOC-010) prevé un único archivo para todo F10
(servicios y generación de turnos). Este paquete (P10.2) solo cubre
servicios (SERVICE-001 a SERVICE-004, SERVICE-006); la generación de turnos
y las pantallas de turnos son de P10.1 y P10.3 -- quien las implemente suma
acá su propia sección "Turnos" en vez de crear un archivo aparte.

## Servicios (ADM-25, más la pestaña/sección Servicios de ADM-21 y ADM-22)

Una pantalla nueva bajo `/admin/servicios...` (ADM-25, alta y edición) más
dos listas que reemplazan los placeholders que había dejado F8/F9 en la
pestaña "Servicios" de ADM-21 (cliente) y en la sección "Servicios" de
ADM-22 (sede). De P10.2 (SERVICE-001 a SERVICE-004, SERVICE-006). Sin
capacidad que las restrinja (`03_Plan_Maestro_Tecnico.md` sección 6,
`04_Modelo_de_Datos.md` sección 7.2: "O, A" para `services`) — las ve y las
edita cualquier dueño o administrador, protegidas solo por `RequireRole
allow={['owner','admin']}` del grupo `/admin` y por `services_write_admin`
del lado del servidor (`0012_rls_policies.sql`).

La generación de turnos (`generate_shifts`) y las pantallas de turnos
(ADM-06, ADM-07, ADM-09) son de P10.1 y P10.3: este paquete no las toca,
solo deja cargada la tabla `services` de la que van a leer.

### ADM-25 · Servicio · formulario

Rutas `/admin/servicios/nuevo` (con `?sede=<id>`, documentado en `05`
sección 5, o `?cliente=<id>`, extensión propia de este paquete — ver más
abajo) y `/admin/servicios/:id/editar`, una sola página
(`ServiceFormPage.tsx`) que decide el modo con `useParams().id`, mismo
patrón que `ClientFormPage`/`SiteFormPage`.

A diferencia de `SiteFormPage` (donde el cliente es solo contexto, nunca un
campo del formulario), `05_Pantallas_y_Navegacion.md` línea 79 lista
"Cliente y sede" entre los campos de ADM-25: acá son dos `Combobox`
editables (`@/components/Combobox`, DS-004), no un dato fijo. Elegir un
cliente filtra la sede a las sedes de ese cliente (`useClientSitesQuery`,
el mismo hook que ya usaba la pestaña Sedes de ADM-21) y limpia la sede
elegida antes. El resto de los campos: nombre, días de la semana
(`Checkbox` por día, orden de exhibición lunes a domingo de `04` sección
2.1), franja horaria (`type="time"`), dotación (1 a 10), vigencia desde y
hasta (`DatePicker`, DS-005 -- "hasta" vacío es vigencia sin fin), "Trabaja
los feriados" (`Switch`, ver más abajo), horas mensuales mínimas y máximas
(informativas, P-047), estado y notas.

#### "Trabaja los feriados" marcado por defecto (decisión de Mike, P10.0)

`works_on_holidays` viene en `true` tanto en la base
(`0007_services_shifts_assignments.sql`) como en el formulario
(`defaultValues.worksOnHolidays = true`): "el servicio se presta también en
feriados salvo que se indique lo contrario". Se puede desmarcar por
servicio con el `Switch`.

#### Advertencia de edición (SERVICE-006)

En modo edición, un `Alert` arriba del formulario avisa: "Los turnos ya
generados no cambian. Si hace falta, generá el mes de nuevo para crear los
que falten con los datos actualizados" (`06_API.md` sección 6: "Editar un
servicio no modifica turnos ya generados; el administrador vuelve a generar
el mes si corresponde (solo crea faltantes)").

### Pestaña Servicios de ADM-21 y sección Servicios de ADM-22 (SERVICE-003)

`ServiceList`/`NewServiceButton`
(`src/features/services/components/ServiceList.tsx`), un único componente
reutilizado en las dos pantallas:

- Con `clientId` (ADM-21): lista los servicios del cliente, con el nombre
  de la sede de cada uno (un cliente puede tener varias sedes).
- Con `siteId` (ADM-22): lista los servicios de esa sede, sin repetir el
  nombre de la sede (ya se sabe cuál es).

Cada fila muestra nombre, `StatusBadge` de estado, sede (solo en el modo
`clientId`), días y franja (`formatWeekdays`, ver más abajo) y dotación. El
menú de acciones (⋮) tiene "Editar" (ADM-25) y "Cambiar estado"
(SERVICE-004, `ChangeServiceStatusDialog`). `NewServiceButton` arma el
enlace a ADM-25 con `?sede=` (si se conoce la sede, desde ADM-22) o
`?cliente=` (desde ADM-21, donde la sede todavía no está elegida).

#### `formatWeekdays` (`src/features/services/weekdays.ts`)

Arma el texto corto de los días de un servicio para la lista: agrupa días
consecutivos en el orden de exhibición (lunes a domingo, domingo al final)
en un rango ("lun a vie"), separa los sueltos con coma y muestra "Todos los
días" cuando son los 7. Es lógica pura, sin React ni Supabase, por eso tiene
su propio archivo con tests (`weekdays.test.ts`) en vez de vivir inline en
`ServiceList.tsx`.

#### Cambiar estado del servicio (SERVICE-004)

`ChangeServiceStatusDialog`: mismo patrón que `ChangeClientStatusDialog`/
`ChangeSiteStatusDialog` (confirmación simple, sin motivo obligatorio -- no
está en la lista de `07_Design_System.md` sección 2.4 que sí lo exige) con
un texto que explica el efecto de cada estado (`06_API.md` sección 6:
"Solo `active` genera turnos").

### Decisiones tomadas en P10.2 (servicios)

- **`?cliente=` en `/admin/servicios/nuevo` es una extensión propia, no
  documentada en `05_Pantallas_y_Navegacion.md` sección 5** (que solo lista
  `?sede=`): la tabla de rutas no cubre el caso de "Nuevo servicio" desde
  ADM-21, donde todavía no hay una sede elegida (un cliente puede tener
  varias). Se decidió pasar el cliente igual, mismo criterio que `?cliente=`
  de `/admin/sedes/nueva` (ADM-23), y dejar la sede sin precargar --
  reportado al orquestador como una laguna menor de `05`, con esta
  resolución como recomendación.
- **`INVALID_WEEKDAYS` no está en la tabla de `06_API.md` sección 15**
  (`INVALID_TIME_RANGE` sí), aunque la sección 6 lo nombra en la lista de
  errores de `services`. Contradicción menor entre ambas secciones,
  reportada al orquestador; se armó un mensaje en español acorde al check
  que lo genera ("Elegí al menos un día de la semana.").
- **Sin `CLIENT_NOT_ACTIVE`/`SITE_NOT_ACTIVE` al crear o editar un
  servicio**: a diferencia de lo que podría sugerir la lista de errores que
  sigue a la fila de `generate_shifts` en `06` sección 6, no hay ningún
  check ni trigger en `0007_services_shifts_assignments.sql` que rechace un
  cliente o una sede no activos al escribir en `services` -- esos dos
  códigos solo los devuelven `generate_shifts` y `create_shift` (comentario
  de `0005_clients_sites.sql`), ambas RPC de P10.1/P10.3. Un administrador
  puede cargar un servicio para un cliente suspendido o una sede inactiva;
  no se le van a generar turnos mientras siga así, pero la carga en sí no se
  bloquea. El `Combobox` de cliente y de sede sí marca con una etiqueta
  ("suspendido", "baja", "inactiva") los que no están activos, para que el
  administrador lo vea antes de elegir.
- **`StatusBadge` suma el dominio `service`** (`src/components/status/`):
  `07_Design_System.md` sección 3 no tenía una fila para servicios (todas
  las demás tablas del modelo sí la tienen, incluido `service_status` de
  `04_Modelo_de_Datos.md` sección 3). Variante elegida por analogía con
  Cliente (`active`/`suspended`/`closed` → éxito/warning/neutral):
  `active` → éxito, `paused` → warning, `ended` → neutral. Es un cambio
  chico y compatible hacia atrás a un componente de `src/components/`, que
  no es de este dominio -- señalado acá y en el reporte del encargo para
  que lo confirme front-plataforma y lo sume a `07`.
- **`requiredStaff`, como en `employeeNumberSchema`, es texto en el
  formulario, no `z.coerce.number()`**: mismo motivo que `employees/
schemas.ts` (el tipo de entrada y el de salida de `z.coerce` no coinciden,
  lo que rompe el tipado de `zodResolver` con `useForm`) -- se convierte a
  número recién en `serviceFormValuesToInput`.
- **Las horas mensuales mínimas y máximas no tienen una restricción en la
  base** (son informativas, P-047): se agregó de todos modos un `refine` en
  el esquema zod que exige que las máximas no sean menores que las mínimas,
  por prolijidad de la carga -- una validación de cliente sin equivalente en
  el servidor, señalada acá porque se aparta un poco del criterio general de
  "el esquema zod repite, no agrega, restricciones del servidor".

### Qué falta / para el orquestador

- Sin detalle propio del servicio (no hay una pantalla "ADM-XX Servicio ·
  detalle" en `05`): la edición se hace directo desde la lista, con
  "Editar" abriendo ADM-25.
- La generación de turnos (`generate_shifts`, ADM-09) y el resto de
  turnos/asignaciones son de P10.1 y P10.3, fuera de este paquete.
- e2e de alta y edición de servicio (SERVICE-007) quedan para qa-pruebas.
