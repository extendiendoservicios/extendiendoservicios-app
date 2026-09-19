# `src/api`

Un módulo por dominio (`clients.ts`, `employees.ts`, `shifts.ts`, etc.), cada
uno con las funciones que llaman a Supabase (PostgREST, RPC o la Edge
Function `admin-users`) y traducen los errores del servidor a mensajes en
voseo. Nada de estado de React acá: los hooks de TanStack Query que
consumen estas funciones van en `src/features/<dominio>/queries.ts`.

Carpeta vacía hasta F8 (primer dominio: clientes y sedes).
