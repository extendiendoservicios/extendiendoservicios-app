# `src/api`

Un módulo por dominio (`users.ts`, y desde la próxima fase `clients.ts`,
`employees.ts`, `shifts.ts`, etc.), cada uno con las funciones que llaman a
Supabase (PostgREST, RPC o la Edge Function `admin-users`) y traducen los
errores del servidor a un tipo único. Nada de estado de React acá: los
hooks de TanStack Query que consumen estas funciones van en
`src/features/<dominio>/queries.ts`.

Patrón fijado en P07.2 (`src/api/users.ts`, primer dominio con datos
reales) — seguilo tal cual en cada dominio nuevo:

## 1. `errors.ts` (compartido, ya existe)

- `ApiError`: único tipo de error que sale de `src/api/`. Tiene `message`
  (el texto en español que ya viene armado del servidor, nunca se
  reescribe) y `hint` (el código estable — `SHIFT_OVERLAP`, `LAST_OWNER`,
  etc. — que usa la pantalla para lógica, `null` si no vino ninguno).
- `isApiError(error)`: type guard, para el `catch` de las pantallas.
- `fromPostgrestError(error)`: envuelve el `PostgrestError` que devuelven
  `.from(...)`/`.rpc(...)` cuando una RPC corta con
  `raise exception using errcode = 'P0001', message = '...', hint = '...'`
  (`06_API.md` sección 0). Usalo en TODAS las funciones que llaman a
  `.from`/`.rpc`.
- Para la Edge Function `admin-users` (contrato `{ data }` / `{ error:
{ message, hint } }`, distinto del de una RPC), cada módulo que la
  consuma escribe su propio `invokeXxx` interno con el mismo criterio —
  ver `users.ts`, sección "Edge Function". El detalle importante:
  `supabase.functions.invoke` nunca lanza; en error devuelve `error:
FunctionsHttpError` con el cuerpo SIN LEER en `error.context` (una
  `Response`), hay que hacer `await (error.context as Response).json()`
  para sacar `{ message, hint }`.

## 2. Un tipo por fila/entrada, sin reexportar tipos de `database.types.ts` tal cual

Los tipos que expone un módulo (`AdminUserRow`, por ejemplo) usan nombres en
`camelCase` pensados para el frontend, mapeados a mano desde las columnas
`snake_case` de la respuesta. Los enums (`Role`, `AdminCapability`) sí se
reexportan directo desde `Database['public']['Enums'][...]` — no tiene
sentido inventar un tipo paralelo para un enum.

## 3. Una función por operación, no una clase

`fetchXxx`/`createXxx`/`setXxx` async, cada una:

1. Llama a `supabase.from(...)`/`supabase.rpc(...)`/al `invokeXxx` interno.
2. Si hay error, `throw fromPostgrestError(error)` (o el equivalente de la
   Edge Function).
3. Mapea `data` al tipo de retorno del módulo.

Nada de reintentos, cachés ni debounce acá — eso es trabajo de
`queries.ts` (TanStack Query) y de las pantallas.

## 4. `src/features/<dominio>/`

- `schemas.ts`: esquemas zod que **repiten** las restricciones del
  servidor (largo mínimo de contraseña, formato de email, motivo
  obligatorio), nunca las reemplazan — el servidor vuelve a validar todo.
- `permissions.ts` (si la pantalla esconde botones por rol/capacidad):
  funciones puras `can*(actor, ...)` sobre `{ roles, capabilities }`, sin
  React ni Supabase — fáciles de testear con Vitest sin renderizar nada.
  Si una pantalla arma un menú de acciones condicional (`UserActionsMenu`
  de ADM-27), conviene exportar también una función que devuelva la LISTA
  de acciones visibles (`getVisibleUserActions`) en vez de repetir cada
  condición dentro del JSX: es mucho más fácil de testear que abrir un
  menú de Radix en jsdom (frágil con `fireEvent`, sin `userEvent`
  instalado en el repo).
- `queries.ts`: un hook `useXxxQuery`/`useXxxMutation` por función de
  `src/api/`, con:
  - Claves estables: `{dominio}Keys.list()`, `{dominio}Keys.detail(id)`,
    etc. — un objeto `xxxKeys` por dominio, no strings sueltos.
  - `staleTime`/`refetchInterval` según la regla de polling (`02_Decisiones.md`
    P-005): 30 s en el tablero y "Asistencia de hoy", 60 s en el resto de
    las listas, nada en formularios ni en datos que se abren a demanda
    (paneles, drawers).
  - Las mutaciones invalidan las queries de lista relacionadas en
    `onSuccess`, no fuera del hook.

## 5. Instrumentación compartida

- `src/lib/queryClient.ts`: una sola instancia de `QueryClient`, montada en
  `src/main.tsx` con `<QueryClientProvider>` (por encima de
  `<AuthProvider>`). No crear un `QueryClient` por pantalla.
- "Actualizado hace n s" (regla común de polling): todavía no hay un
  componente compartido para esto en `src/components/` — `ADM-27`
  (`src/features/users/components/UpdatedAgo.tsx`) tiene el primero, local
  al dominio porque hoy es el único que lo necesita. Si una segunda
  pantalla ADM con polling lo necesita, conviene subirlo a
  `src/components/` (pedido a front-plataforma) en vez de duplicarlo.

## 6. Tests

- `src/api/<dominio>.test.ts`: sin red, mockeando `@/lib/supabase` entero
  (`vi.mock('@/lib/supabase', () => ({ supabase: {...} }))`). Cada chain de
  PostgREST se mockea con funciones anidadas que terminan en un
  `Promise.resolve({ data, error })` — no hace falta un builder genérico
  reutilizable, así cada test deja clarísimo qué chain espera la función.
- `src/features/<dominio>/permissions.test.ts`: los `can*`/`getVisible*`
  de `permissions.ts`, con `describe`/`it` por función y por combinación de
  actor relevante (dueño, administrador con la capacidad, administrador
  sin ella).
