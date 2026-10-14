# Evidencia fotográfica en el celular (módulo H, P21.3)

Especificación: `Docs/Plan_Maestro/modulos/H_evidencia_fotografica.md` §4 (decisiones H-01 a H-18). Base de datos: `docs/database.md`, «Evidencia fotográfica». Piezas de captura, compresión y visor: `docs/design-system.md`, «Evidencia fotográfica». Acá están las pantallas de celular que las componen: EMP-07, EMP-10, EMP-11, SUP-03 y SUP-04. Las de administración son de P21.4.

## Qué hay en cada pantalla

| Pantalla                          | Ruta                                    | Qué suma                                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EMP-07 Servicio en curso          | `/app/en-curso/:assignmentId`           | Bloque «Fotos y videos» entre el progreso y los accesos: aviso «Este servicio pide fotos.», `MediaCapture` con los topes («3 de 10 fotos»), la grilla de lo propio, el visor con «Quitar». Ancla `#fotos`. |
| EMP-10 Finalizar                  | `/app/en-curso/:assignmentId/finalizar` | Si el servicio pide fotos y no hay ninguna propia: advertencia con «Sacar foto» (lleva a `#fotos` de EMP-07) y el botón principal pasa a decir «Finalizar igual». No bloquea.                              |
| EMP-11 Resumen                    | `/app/resumen/:assignmentId`            | Fila «Fotos y videos» («3 fotos y 1 video» o «Ninguno») y el mismo bloque de EMP-07.                                                                                                                       |
| SUP-03 Detalle de la supervisión  | `/sup/supervisiones/:id`                | El bloque, en cualquier estado menos `cancelled`.                                                                                                                                                          |
| SUP-04 Registro de la supervisión | `/sup/supervisiones/:id/registro`       | El bloque en el paso del fin (con el inicio ya registrado).                                                                                                                                                |

## Dónde viven las cosas

- `src/api/media.ts`: subida, lista de lo propio, URL firmadas, quitar y los mensajes de error.
- `src/features/employee/mediaQueries.ts`: hooks de TanStack Query (`useMyShiftMediaQuery`, `useShiftMediaUpload`, `useRefreshMyMedia`, `useRemoveShiftMediaMutation`).
- `src/features/employee/mediaWindow.ts`: ventana de H-12 para apagar los botones.
- `src/features/employee/mediaCounts.ts`: texto de cantidades para EMP-11.
- `src/features/employee/components/ShiftMediaSection.tsx`: el bloque, compartido por empleado y supervisor. `LazyShiftMediaSection.tsx` lo carga en diferido.
- `v_my_day` (`MyDayAssignment`) y `v_my_supervisions` (`MySupervision`) suman `requiresPhotos`, `myPhotosCount` y `myVideosCount`. En la vista del supervisor la sede sin fotos ya llegaba como `photosNotAllowed`.

## `src/api/media.ts`

| Función                                            | Para qué                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createShiftMediaUpload(shiftId): MediaUploadFn`   | La función de subida que recibe `MediaCapture`: `begin_shift_media`, archivo, miniatura (ambos sin `upsert`) y `confirm_shift_media`. Progreso por etapas (10 % la fila, 80 % archivo y miniatura, 90 % confirmación, 100 % al terminar) y abort en cualquier etapa. Si algo falla después del `begin`, descarta lo pendiente (`remove_shift_media` y borrado de las dos rutas). |
| `fetchMyShiftMedia(shiftId, userId)`               | Lo que subió la persona (filtra por `uploaded_by` además de la RLS), con las miniaturas firmadas en un solo pedido.                                                                                                                                                                                                                                                              |
| `signMediaUrl(path)`                               | URL firmada del original, de 10 minutos. Se pide recién al abrir el visor.                                                                                                                                                                                                                                                                                                       |
| `removeShiftMedia({ id, storagePath, thumbPath })` | `remove_shift_media` y después `storage.remove` de las dos rutas. Si Storage falla no es un error: la fila ya quedó quitada y el barrido nocturno borra los objetos.                                                                                                                                                                                                             |
| `MEDIA_HINT_MESSAGES`, `mediaApiErrorMessage`      | Mensaje en español con voseo para cada código del `hint`.                                                                                                                                                                                                                                                                                                                        |

Detalle importante: a `begin_shift_media` se le manda `p_size_bytes = media.bytes` (solo el archivo) y `p_thumb_size_bytes = media.thumbnailBytes`. El servidor suma los dos para `size_bytes` y valida cada uno contra 20 MB. Mandar `totalBytes` en `p_size_bytes` contaría la miniatura dos veces.

## Reglas de pantalla

- Sede con `photos_not_allowed`: solo el texto «En esta sede no se permiten fotos.», sin botones ni grilla. EMP-10 no advierte (no habría cómo cumplirlo) y EMP-11 no lista la cantidad.
- Ventana de H-12 (desde el inicio del turno hasta 2 horas después del fin): fuera de ella los botones quedan apagados con el motivo debajo y «Quitar» no se ofrece. Es solo una ayuda: la regla la aplica el servidor con su reloj (`MEDIA_WINDOW_NOT_OPEN`, `MEDIA_WINDOW_CLOSED`), así que un reloj del teléfono corrido no deja pasar nada.
- Sin conexión: botones apagados con «Estás sin conexión…». Sin cola ni sincronización (módulo C).
- Supervisor: puede subir con la supervisión `assigned`, `in_progress` o `completed` (el servidor rechaza solo la cancelada).
- Después de subir o quitar se invalidan `v_my_day`, `v_my_supervisions` y la lista propia, así que los contadores y el aviso de EMP-10 se actualizan solos.
- Las coordenadas no se muestran ni se mandan: la compresión ya quitó el EXIF.

## Decisiones menores

- EMP-11 lleva el bloque completo (y no un acceso al detalle del turno) porque EMP-07 redirige al resumen apenas se registra el fin, y la ventana sigue abierta 2 horas más: es la única pantalla del empleado donde se puede agregar después de finalizar.
- «Quitar» usa un diálogo de confirmación simple y no `ConfirmDialog`: ese componente exige un motivo y `remove_shift_media` no recibe ninguno. Se cierra el visor antes de abrir la confirmación para que no se pisen los dos diálogos.
- «Finalizar igual» no es un segundo botón: es el botón principal de EMP-10 con otra etiqueta mientras la advertencia está activa, para no duplicar el camino de confirmación.
- La barra de progreso de la subida avanza por etapas: la Storage API del cliente no informa bytes enviados.

## Pruebas

- Unitarias: `src/api/media.test.ts` (orden de llamadas, limpieza, abort, mensajes), `ShiftMediaSection.test.tsx`, `mediaPages.test.tsx` (EMP-07, EMP-10, EMP-11), los de SUP-03 y SUP-04 y `mediaWindow.test.ts`.
- E2E: los escribe qa-pruebas (P21.6).
- A mano en teléfono real: la lista de `docs/design-system.md`, «Qué hay que probar en teléfono real».
