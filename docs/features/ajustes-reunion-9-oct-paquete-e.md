# Ajustes de la reunión del 9 oct 2026 · paquete E (P19.6)

Un ajuste: **AJ2-03**, «Avisos y anuncios». Administración publica un anuncio
para empleados, supervisores, todos o personas elegidas; cada persona lo cierra
con «Entendido» en el celular y administración ve quién lo leyó. La base está en
la migración `0042` (ver «Avisos y anuncios» en `docs/database.md`); acá va la
parte de pantallas.

## Administración

**Quién.** Dueño y administradores, sin exigir capacidad. Sección propia
«Avisos y anuncios» en la barra lateral (y en «Más» del celular). El servidor
vuelve a verificar (`FORBIDDEN`).

**Rutas** (carga diferida con `lazyPage`):

| Ruta                         | Pantalla                                         |
| ---------------------------- | ------------------------------------------------ |
| `/admin/anuncios`            | Listado                                          |
| `/admin/anuncios/nuevo`      | Alta                                             |
| `/admin/anuncios/:id`        | Detalle: cómo lo ve la persona y «Quién lo leyó» |
| `/admin/anuncios/:id/editar` | Edición                                          |

**Listado.** Título, destinatarios («Empleados», «Supervisores», «Todos», «N
personas»), vigencia («Hasta el dd/mm/aaaa» o «Sin vencimiento»), estado
(Activo, Vencido, Archivado) y «Leído por X de Y». Filtro por estado, por
defecto «Activos». Tarjetas en el celular. Se actualiza solo cada 60 s.

**Formulario.** Título (hasta 120), texto con contador (hasta 2000),
destinatarios (Empleados, Supervisores, Todos o Elegir personas) y fecha «hasta»
opcional. «Elegir personas» muestra empleados y supervisores no dados de baja
con casillas y búsqueda por nombre o legajo; «Seleccionar todos» y «Seleccionar
ninguno» actúan solo sobre lo que muestra el filtro. Al editar se avisa que
cambiar el título o el texto hace que quienes ya lo leyeron lo vuelvan a ver;
cambiar destinatarios o fecha no. Un anuncio archivado no se edita.

**Detalle.** Muestra el anuncio como lo ve la persona y la tabla «Quién lo
leyó» (nombre, rol, «Leído el dd/mm hh:mm» o «Todavía no»), primero quienes no lo
leyeron. Botones Editar y Archivar (con confirmación) mientras no esté archivado.

**Código.**

- `src/api/announcements.ts`: ver «Avisos y anuncios de administración» en `docs/api.md`.
- `src/features/announcements/schemas.ts`: esquema zod espejo de las reglas del
  servidor (`createAnnouncementFormSchema`); al editar, una fecha «hasta» pasada
  que no cambió no se marca (el servidor tampoco la rechaza).
- `src/features/announcements/helpers.ts`: textos (`audienceText`,
  `validityText`, `readByText`, `readAtText`, `rolesText`) y `sortRecipients`.
- `src/features/announcements/queries.ts`: hooks.
- Componentes en `src/features/announcements/components/`: `AnnouncementsList`,
  `AnnouncementForm`, `RecipientPicker`, `AnnouncementDetail`.
- Páginas en `src/pages/admin/`: `AnnouncementsPage`, `AnnouncementFormPage`,
  `AnnouncementDetailPage`.

**Tests.** `schemas.test.ts` y `helpers.test.ts` (reglas del esquema, texto de
destinatarios, orden de lecturas, búsqueda de personas).

## Celular

Decisión de Mike: los anuncios que publica administración aparecen en la portada del celular (empleado y supervisor). Cada persona lo cierra con «Entendido» y queda registrado que lo leyó.

- **Datos**: `src/api/myAnnouncements.ts` lee `v_my_announcements` y llama a `acknowledge_announcement(p_id)` (idempotente). Pendiente = `read_at is null`; `was_edited` muestra la marca «Actualizado».
- **Portada** (Hoy del empleado, `/app`, y Hoy del supervisor, `/sup`): `AnnouncementsBanner` va arriba de todo, antes de «Instalar la app». Cada tarjeta (`role="region"`, `aria-label="Anuncio: <título>"`) muestra título, texto completo con saltos de línea (texto plano, sin HTML), fecha corta y el botón «Entendido» (≥ 44 px). Con más de 2 pendientes muestra 2 y «Ver N anuncios más».
- **«Entendido»**: actualización optimista (la tarjeta se desvanece y sale), después invalida la consulta. Si falla por red, la tarjeta vuelve con un aviso. Si el servidor responde `ANNOUNCEMENT_NOT_AVAILABLE`, se la saca de la lista y se muestra «Ese anuncio ya no está disponible para vos.». Sin conexión (`navigator.onLine` falso) el botón queda deshabilitado.
- **Foco**: al irse una tarjeta, el foco pasa a la tarjeta vecina o, si no queda ninguna, al contenido (`main`).
- **Historial**: en «Más» hay una entrada «Anuncios» (`/app/anuncios` y `/sup/anuncios`) con todos los vigentes: «Leído el dd/mm» o el botón «Entendido».
- **Consulta**: TanStack Query, clave `['announcements', 'mine']`, `staleTime` de 60 s, refetch al volver a la app. Si falla, no se muestra nada y el resto de la portada no se ve afectado.
- **Archivos**: `src/features/announcements/mobile/` (`queries.ts`, `AnnouncementCard.tsx`, `AnnouncementsBanner.tsx`, `AnnouncementsHistory.tsx`), `src/pages/app/AnnouncementsPage.tsx`, `src/pages/sup/AnnouncementsPage.tsx`, rutas en `employeeRoutes.tsx` y `supervisorRoutes.tsx`.
