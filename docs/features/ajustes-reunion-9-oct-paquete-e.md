# Ajustes de la reunión del 9 de oct, paquete E: avisos y anuncios (AJ2-03)

## Celular

Decisión de Mike: los anuncios que publica administración aparecen en la portada del celular (empleado y supervisor). Cada persona lo cierra con «Entendido» y queda registrado que lo leyó.

- **Datos**: `src/api/myAnnouncements.ts` lee `v_my_announcements` y llama a `acknowledge_announcement(p_id)` (idempotente). Pendiente = `read_at is null`; `was_edited` muestra la marca «Actualizado».
- **Portada** (Hoy del empleado, `/app`, y Hoy del supervisor, `/sup`): `AnnouncementsBanner` va arriba de todo, antes de «Instalar la app». Cada tarjeta (`role="region"`, `aria-label="Anuncio: <título>"`) muestra título, texto completo con saltos de línea (texto plano, sin HTML), fecha corta y el botón «Entendido» (≥ 44 px). Con más de 2 pendientes muestra 2 y «Ver N anuncios más».
- **«Entendido»**: actualización optimista (la tarjeta se desvanece y sale), después invalida la consulta. Si falla por red, la tarjeta vuelve con un aviso. Si el servidor responde `ANNOUNCEMENT_NOT_AVAILABLE`, se la saca de la lista y se muestra «Ese anuncio ya no está disponible para vos.». Sin conexión (`navigator.onLine` falso) el botón queda deshabilitado.
- **Foco**: al irse una tarjeta, el foco pasa a la tarjeta vecina o, si no queda ninguna, al contenido (`main`).
- **Historial**: en «Más» hay una entrada «Anuncios» (`/app/anuncios` y `/sup/anuncios`) con todos los vigentes: «Leído el dd/mm» o el botón «Entendido».
- **Consulta**: TanStack Query, clave `['announcements', 'mine']`, `staleTime` de 60 s, refetch al volver a la app. Si falla, no se muestra nada y el resto de la portada no se ve afectado.
- **Archivos**: `src/features/announcements/mobile/` (`queries.ts`, `AnnouncementCard.tsx`, `AnnouncementsBanner.tsx`, `AnnouncementsHistory.tsx`), `src/pages/app/AnnouncementsPage.tsx`, `src/pages/sup/AnnouncementsPage.tsx`, rutas en `employeeRoutes.tsx` y `supervisorRoutes.tsx`.
