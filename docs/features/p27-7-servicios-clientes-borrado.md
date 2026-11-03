# P27.7 · Fijos en lote, categorías de clientes y borrado del dueño

Observaciones de los dueños del 2 de noviembre (OD-11 y OD-20 a OD-23). Backend: migraciones 0078 y 0080 y la acción `delete_user` de `admin-users`. OD-27 (generar turnos al guardar un servicio) va en otro paquete.

## OD-11 · Aplicar los fijos a los turnos ya creados

- Al guardar un servicio **en edición** con cambios en sus empleados fijos, se abre «¿Aplicar a los turnos?» con la fecha elegible (por defecto, hoy en Buenos Aires).
- «Aplicar» llama a `apply_service_fixed_employees(service_id, from_date)`. «No aplicar» deja los turnos como están.
- El resultado muestra los turnos actualizados, las asignaciones quitadas y nuevas, y lo que se salteó con su motivo: el turno entero (cancelado, ya empezó, con fichajes o avisos) o un empleado en un turno (licencia, superposición, disponibilidad). El texto de cada motivo es el `message` del servidor.
- Invalida servicios, turnos, planificación y asistencia.
- Código: `src/features/services/components/ApplyFixedEmployeesDialog.tsx`, `src/features/services/fixedApply.ts`, `useApplyServiceFixedEmployeesMutation`.

## OD-20 · Categorías de clientes

- Configuración, pantalla «Empresa» (ADM-28): sección «Categorías de clientes», visible para el dueño y los administradores. Alta, cambio de nombre, orden (botones subir y bajar, que sirven también en el celular) y baja lógica.
- Antes de dar de baja avisa cuántos clientes quedan sin categoría.
- Alta y edición de clientes (ADM-20): desplegable «Categoría (opcional)».
- API: `src/api/clientCategories.ts` (`upsert_client_category`, `reorder_client_categories`, `remove_client_category`). Errores del servidor: `NAME_REQUIRED`, `NAME_TOO_LONG`, `CATEGORY_NOT_FOUND`, `CATEGORY_NAME_TAKEN`.

## OD-21 · Listado agrupado

- Pestaña «Listado» de Clientes (ADM-19): un grupo por categoría en el orden de la empresa y «Sin categoría» al final; los grupos vacíos no aparecen.
- Filtros nuevos: por categoría (incluye «Sin categoría»), además de texto y estado.
- Arriba de la sección, en el listado y en el mapa, el total de clientes activos (no depende de los filtros).

## OD-22 y OD-23 · Eliminar (solo el dueño)

La acción «Eliminar» solo la ve el dueño (`canOwnerDelete`). Aparece en:

| Dónde                                        | Qué borra                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Detalle del turno (ADM-06), debajo del panel | Turno sin historia (no pide escribir el nombre)                         |
| Lista de servicios (ADM-21 y ADM-22)         | Servicio sin turnos; «Eliminar turnos sin historia…» con fecha elegible |
| Detalle de la sede (ADM-22)                  | Sede sin servicios ni turnos                                            |
| Detalle del cliente (ADM-21)                 | Cliente sin sedes ni servicios                                          |
| Ficha del empleado (ADM-17)                  | Empleado sin historia (no se ofrece sobre uno mismo)                    |

Todos usan `OwnerDeleteDialog` (`src/features/ownerDelete/`):

1. Consulta primero `owner_delete_preview_*`.
2. Dice que es irreversible y que puede alterar registros, y lista lo que se borra (conteos).
3. Si hay bloqueos, muestra cada `message` del servidor y no deja confirmar.
4. Para confirmar hay que escribir el nombre (el turno no lo pide). La comparación ignora mayúsculas y espacios de más; el cliente acepta razón social o nombre comercial y el empleado «Nombre Apellido» o «Apellido Nombre». El servidor lo verifica de nuevo.
5. Al borrar, invalida las consultas y navega al listado correspondiente.

Detalles por entidad:

- **Empleado:** se borra con la Edge Function `admin-users`, acción `delete_user` (primero la base, después Auth). Si Auth falla responde `AUTH_DELETE_FAILED`: el diálogo muestra el mensaje y el botón pasa a «Reintentar», que repite la llamada y termina el trabajo.
- **Cliente:** después del borrado se elimina de Storage el archivo `photo_path` que devuelve el servidor (mejor esfuerzo: si falla, no frena nada).
- **Turnos de un servicio:** los turnos con historia no bloquean, se saltean y el diálogo los lista.
- **Eventos de seguridad (ADM-31):** cada borrado deja un `record_deleted` («Registro eliminado por el dueño») con la copia JSON.

### Cambio respecto de lo anterior

La acción «Eliminar» servicio que veían los administradores (RPC `delete_service` de 0044, con `service_delete_preview`) se **quitó de la pantalla** junto con `DeleteServiceDialog` y sus funciones de `src/api/services.ts`: decisión de Mike, eliminar servicios es solo del dueño. Los administradores siguen pudiendo pausar o finalizar el servicio.
