# Evidencia fotográfica en administración: eliminar y conservar (módulo H, P21.8b)

Extiende ADM-32 «Fotos y videos» (`/admin/fotos`). La pantalla es solo de la dueña y los administradores, así que las acciones nuevas no necesitan ocultarse por rol; el servidor igual lo verifica (`FORBIDDEN`).

## Qué hay en la barra de selección

Al seleccionar archivos con archivo (los vencidos y eliminados no se pueden elegir) aparece, junto a «Quitar selección» y «Descargar ZIP»:

- **Conservar**: aparece si alguno de los elegidos no está conservado. Sin confirmación; toast con cuántos cambiaron.
- **Quitar Conservar**: aparece si alguno está conservado. Si hay de los dos tipos, se ven los dos botones y cada uno actúa solo sobre los que corresponde.
- **Eliminar** (destructivo): abre un diálogo que dice cuántos archivos son, que no se puede deshacer y que queda la constancia. Si entre los elegidos hay marcados «Conservar», suma un aviso aparte: «N de los seleccionados están marcados «Conservar» y también se van a eliminar.» No pide motivo. Al terminar: toast con cuántos se eliminaron y el espacio liberado aproximado, y se limpia la selección.

## Constancia de lo eliminado

`v_shift_media` devuelve la fila eliminada con `has_file = false` y `deleted_at` con valor (la vencida tiene `deleted_at` nulo). `unavailableOf` (`src/features/media/items.ts`) distingue los dos casos y arma el texto con `deletedNote` (`src/lib/media/deletedNote.ts`):

- «Eliminada por {nombre} {apellido} el día {jue 13 ago}».
- Sin nombre: «Eliminada el día {jue 13 ago}».

Se ve en la grilla de ADM-32, en el detalle del turno (ADM-06), en la supervisión (ADM-15) y en la sección de fotos del celular del empleado; ninguna intenta cargar la imagen. `MediaItem.unavailable` suma el valor `deleted` y `unavailableNote`.

## `src/api/mediaAdmin.ts`

- `setShiftMediaKeepMany(ids, keep)` -> `set_shift_media_keep_many`, en lotes de 200 (`MEDIA_BATCH_SIZE`), devuelve cuántas cambiaron.
- `deleteShiftMedia(ids)` -> `delete_shift_media` en lotes de 200 y, después de cada lote, `storage.from('evidence').remove(paths)` de a 100. Si Storage falla no lanza: informa `storageFailedCount` y el barrido nocturno (`evidence-cleanup`) termina el trabajo; la pantalla muestra un aviso suave.
- Hints nuevos traducidos: `MEDIA_IDS_REQUIRED`, `MEDIA_TOO_MANY` (más los ya existentes `FORBIDDEN`, `KEEP_REQUIRED`).
- Las filas suman `deletedAt`, `deletedBy`, `deletedByFirstName`, `deletedByLastName`.

Hooks (`src/features/media/queries.ts`): `useSetMediaKeepManyMutation` y `useDeleteShiftMediaMutation` invalidan todo `mediaKeys.all` (galería, detalle del turno y de la supervisión, y el medidor `usage`), salvo las URL firmadas.

## Pruebas

`src/api/mediaAdmin.test.ts` (lotes, hints, Storage), `src/features/media/components/MediaScreen.test.tsx` (botones, diálogo, aviso de «Conservar», error), `src/features/media/items.test.ts` y `src/lib/media/deletedNote.test.ts` (constancia), `src/features/employee/components/ShiftMediaSection.test.tsx` (celular).
