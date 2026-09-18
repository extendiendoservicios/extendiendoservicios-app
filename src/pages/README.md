# `src/pages`

Componentes de página (una ruta = un archivo acá), agrupados por vía de
navegación:

- `common/` — páginas sin rol específico. Por ahora, la portada
  `ConstructionPage` (INFRA-001).
- `admin/` — administración (dueño y administradores), desde F5.
- `app/` — app del empleado, desde F13.
- `sup/` — app del supervisor, desde F15.
- `auth/` — ingreso, recuperar y restablecer contraseña, desde F6.
- `dev/` — páginas internas de desarrollo (`/dev/design`), desde F5.

Estos componentes arman la pantalla combinando piezas de
`src/features/<dominio>/components` y `src/components`; no llevan lógica de
datos propia más allá de conectar los hooks del feature correspondiente.
