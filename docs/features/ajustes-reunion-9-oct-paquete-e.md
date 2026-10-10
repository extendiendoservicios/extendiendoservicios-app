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

(lo completa el paquete móvil)
