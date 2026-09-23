# Usuarios y roles (ADM-27)

Pantalla `/admin/configuracion/usuarios` (P07.2, USERS-007 a USERS-011).
Gestiona accesos: quién puede entrar, con qué roles y, si es
administrador, con qué capacidades.

## Quién ve qué

Matriz completa en `Docs/Plan_Maestro/03_Plan_Maestro_Tecnico.md` sección 6. Resumen de esta pantalla en particular:

| Acción                                                             | Dueño                | Administrador con `manage_users`                                        | Administrador sin `manage_users` |
| ------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| Ver la lista, con roles y estado                                   | Sí                   | Sí                                                                      | Sí                               |
| Ver "último inicio de sesión"                                      | Sí                   | No (columna en blanco — `security_events` es de lectura solo del dueño) | No                               |
| Crear un administrador                                             | Sí                   | No                                                                      | No                               |
| Resetear contraseña / cambiar email / cerrar sesiones / desactivar | Sí, sobre cualquiera | Sí, pero nunca sobre alguien con rol `owner` o `admin`                  | No                               |
| Reactivar                                                          | Sí                   | No                                                                      | No                               |
| Editar roles y capacidades                                         | Sí                   | No                                                                      | No                               |

Las dos últimas filas son más restrictivas del lado de la pantalla que lo
que el servidor permitiría (la RPC `set_user_roles` sí deja a un
administrador con `manage_users` tocar roles `employee`/`supervisor` de
alguien sin privilegios): `08_Fases_y_Backlog.md` deja USERS-010 explícito
como "solo dueño" para ADM-27 en particular — esa vía más amplia queda
para las pantallas de empleados (ADM-17/ADM-18, otro paquete), no para
acá. Decisión documentada en `src/features/users/permissions.ts`.

## Decisiones tomadas en este paquete

- **La alta desde ADM-27 es siempre de un administrador** (`roles:
['admin']`), nunca de dueño/supervisor/empleado: la Edge Function
  `admin-users` rechaza con `FORBIDDEN` a quien no sea el dueño si pide un
  rol privilegiado, y el botón de alta ya está oculto para quien no sea
  dueño (`canCreateAdminUser`). Crear empleados/supervisores sigue siendo
  ADM-18 (otro paquete, EMP-003).
- **La lista no muestra el email de login.** No está en `profiles` (vive
  en `auth.users`, fuera del alcance de PostgREST) y
  `05_Pantallas_y_Navegacion.md` no lo pide para ADM-27 (solo "roles,
  estado, último inicio de sesión"). Para cambiar el email de alguien no
  hace falta ver el actual, solo escribir el nuevo.
- **Sin polling en el editor de roles/capacidades ni en los diálogos de
  acción**: son formularios/paneles que se abren a demanda, no listas
  permanentes en pantalla. Sí hay polling de 60 s en la lista principal y
  en "último inicio de sesión" (regla común, `02_Decisiones.md` P-005),
  con el indicador "Actualizado hace n s" (`UpdatedAgo.tsx`).
- **Quitar un rol cierra las sesiones de la persona automáticamente**
  (`06_API.md` sección 2.2: "si se quita un rol, el frontend llama
  `sign_out_user`"). `RolesCapabilitiesSheet` avisa esto antes de guardar
  si la selección nueva le saca algún rol a la persona.
- **Las capacidades se guardan solas, al tocar cada `ToggleRow`** (sin un
  botón "Guardar" aparte para ellas) — los roles, en cambio, se guardan
  con un botón explícito, porque reemplazan el conjunto completo de una
  sola vez (una sola RPC, `set_user_roles`) y tienen el efecto colateral de
  cerrar sesiones.
- **Cerrar sesiones y reactivar no piden motivo** (no están en la lista de
  acciones de `07_Design_System.md` sección 2.4 que lo exigen): confirmación
  simple. **Desactivar sí** (motivo obligatorio, `ConfirmDialog`).

## Qué falta / para el orquestador

- No hay forma, con el contrato actual, de que el dueño vea el email de
  login ACTUAL de alguien antes de cambiarlo (la Edge Function no expone
  una acción de lectura sobre `auth.users`, y PostgREST no llega ahí). Hoy
  no hace falta (el diálogo de "Cambiar email" solo pide el nuevo), pero si
  una pantalla futura necesitara mostrarlo, hace falta una acción nueva en
  `admin-users` (o una vista que la exponga) — trabajo de
  `backend-supabase`.
- El indicador "Actualizado hace n s" (`src/features/users/components/
UpdatedAgo.tsx`) quedó local a este dominio porque es la primera pantalla
  con polling. Si una próxima pantalla ADM con polling lo necesita,
  conviene subirlo a `src/components/` (pedido a front-plataforma) en vez
  de duplicarlo.
