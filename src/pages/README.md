# `src/pages`

Componentes de página (una ruta = un archivo acá), agrupados por vía de
navegación:

- `common/` — páginas sin rol específico: `ProfilePage` (COM-04, perfil
  propio, cualquier rol autenticado), desde F6 (P06.3). Hasta F5 tenía la
  portada `ConstructionPage` (INFRA-001) — reemplazada por el redirect de
  `/` según sesión y rol (AUTH-004, `src/app/router.tsx`).
- `admin/` — administración (dueño y administradores), desde F5.
- `app/` — app del empleado, desde F13.
- `sup/` — app del supervisor, desde F15.
- `auth/` — ingreso (COM-01), recuperar (COM-02), restablecer (COM-03) y
  sin acceso (COM-05), desde F6 (P06.3).
- `dev/` — páginas internas de desarrollo (`/dev/design`, `/dev/rol`),
  desde F5, nunca en `dist/`.

Estos componentes arman la pantalla combinando piezas de
`src/features/<dominio>/components` y `src/components`; no llevan lógica de
datos propia más allá de conectar los hooks del feature correspondiente.
