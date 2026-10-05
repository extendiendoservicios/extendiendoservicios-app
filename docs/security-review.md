# Revisión de seguridad de la Plataforma Base (TEST-025)

Revisión de F18 contra el checklist de `03_Plan_Maestro_Tecnico.md` sección 15. Fecha: 3 oct 2026. Base: `develop` en `5c2149d`, migraciones 0001 a 0029, contra `App_dev`.

Es una revisión de **solo lectura**: no se cambió la base, la configuración ni el código de la app. Las comprobaciones en vivo fueron lecturas con la clave anónima (pública por diseño), una llamada de `signup` que el servidor rechaza y dos llamadas a la Edge Function sin sesión. Ningún valor de secreto se imprimió ni se copió a este documento.

Complementa la matriz de permisos (`tests/permissions/suite/`, 1.580 casos) y la revisión del orquestador (`Docs/Plan_Maestro/reportes/P18.3/revision-orquestador.md`). Los identificadores `DEF-Pxx` son los de `tests/permissions/suite/defectos.ts`.

## 0. Estado tras P18.6 (4 oct 2026)

La migración `0030_p18_6_permisos_y_rendimiento.sql` y la Edge Function `admin-users` corrigieron
SEG-01 (= DEF-P07), SEG-02, SEG-03, SEG-07 y SEG-08 (= DEF-P11), más los trece defectos de la matriz
(DEF-P01 a DEF-P13). SEG-04 y SEG-05 (contraseña de 8 y la del seed) quedan como están por decisión
de Mike, y SEG-06 se cerró actualizando el plan (03 §15, 4 oct 2026). Las secciones siguientes conservan el texto original de la
revisión; cada hallazgo corregido lleva su nota "Corregido en P18.6". Detalle técnico en
`docs/database.md`, "Correcciones de P18.6".

## 1. Resumen

| Severidad     | Cantidad        | Hallazgos                                              |
| ------------- | --------------- | ------------------------------------------------------ |
| Mayor         | 2               | SEG-01 (= DEF-P07), SEG-05                             |
| Menor         | 6               | SEG-02, SEG-03, SEG-04, SEG-06, SEG-07, SEG-08         |
| Sin hallazgos | 12 de 14 puntos | ver la sección 2 (los puntos 13 y 14 llevan hallazgos) |

Además, la matriz de permisos encontró 13 causas raíz de permisos de más o de rendimiento (50 casos "expected fail"); están en el reporte del paquete P18.3 y se corrigen en P18.6. Los de seguridad más graves son DEF-P13 (un administrador sin capacidades desactiva a cualquiera, incluido el dueño), DEF-P04 (el supervisor lee DNI, CUIL y domicilio de sus empleados) y DEF-P07 (= SEG-01).

## 2. Checklist de la sección 15

| #   | Punto                                                   | Resultado                           | Evidencia                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Secretos en el árbol de trabajo                         | Sin hallazgos                       | `git grep` del valor exacto de `SUPABASE_SERVICE_ROLE_KEY` y de la clave anónima: 0 archivos versionados. Patrones de JWT (`eyJ...`) y de claves `sb_secret_`: 0 coincidencias. Los únicos `password` literales son los del ensayo local (`scripts/ensayo-restauracion-local.sh`, base descartable).                                                                                                                                 |
| 2   | Secretos en el historial (216 commits, todas las ramas) | Sin hallazgos                       | `git log --all -S<valor>` de la clave de servicio y de la anónima: 0 commits. `git log -G` de JWT: 0. Los únicos `.env*` que alguna vez se agregaron son `.env.example` y `supabase/.env.example` (solo nombres de variable; el de Supabase lista `RESEND_API_KEY` sin valor real).                                                                                                                                                  |
| 3   | Secretos en `dist/`                                     | Sin hallazgos                       | La clave de servicio no está en ningún archivo de `dist/` y `service_role` no aparece. La clave anónima está en un bundle, que es lo esperado (pública por diseño, 03 §15). Ver SEG-06 por el falso positivo del valor de `SEED_DEV_PASSWORD`.                                                                                                                                                                                       |
| 4   | `.env*` ignorados                                       | Sin hallazgos                       | `git check-ignore`: `.env` y `.env.local` ignorados (`.gitignore` líneas 11 y 12); en el índice solo `.env.example` y `supabase/.env.example`.                                                                                                                                                                                                                                                                                       |
| 5   | CORS de `admin-users`                                   | Sin hallazgos (ver SEG-07)          | En vivo: `Origin: https://evil.example.com` con `POST` devuelve 403 `ORIGIN_NOT_ALLOWED` sin `Access-Control-Allow-Origin`; el `OPTIONS` devuelve 204 sin esa cabecera. Con `https://dev.extendiendoservicios.com`, `OPTIONS` devuelve 204 con el origen reflejado y `POST` sin sesión devuelve 401 `UNAUTHENTICATED`.                                                                                                               |
| 6   | `public/_headers` (CSP y cabeceras)                     | Sin hallazgos                       | HSTS de 2 años, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (solo `geolocation=(self)`), CSP con `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `connect-src` y `img-src` acotados a los dos proyectos de Supabase, OSM, Nominatim y Sentry. `style-src 'unsafe-inline'` está documentado en `docs/deployment.md`. `sw.js` y el manifest sin caché larga. |
| 7   | RLS en todas las tablas                                 | Sin hallazgos                       | 25 tablas creadas en `public` y 25 con `enable row level security` en las migraciones (diferencia vacía). La matriz verifica además que lo que `/rest/v1` expone en `App_dev` coincide con las migraciones.                                                                                                                                                                                                                          |
| 8   | Grants de `anon`                                        | Sin hallazgos                       | La matriz prueba las 25 tablas, las vistas y las RPC con `anon`: cero filas o error en todo salvo `v_public_branding` y las 4 columnas de `company_settings` (`id`, `name`, `logo_path`, `support_phone`). Falla el inventario si una función de `public` queda ejecutable por `anon` o `PUBLIC` (la excepción conocida es DEF-P11, `rls_auto_enable`, de la plataforma).                                                            |
| 9   | `security definer` con `search_path` y rol              | Sin hallazgos                       | De las migraciones: 46 funciones `security definer`, las 46 con `set search_path`. La verificación de rol adentro la ejercita la matriz (cada RPC con los 7 perfiles: lo prohibido da `FORBIDDEN`/42501).                                                                                                                                                                                                                            |
| 10  | Edge Function `admin-users`                             | Sin hallazgos (ver SEG-03, DEF-P08) | JWT exigido por el gateway y resuelto con `auth.getUser`; rol y capacidades leídos en vivo de la base; perfil activo; origen; límite de 10 por minuto sobre `security_events`; errores internos genéricos. La matriz cubre cada acción con los 7 perfiles. DEF-P08: `sign_out_user` no verifica que la persona exista.                                                                                                               |
| 11  | Auth: registro abierto apagado                          | Sin hallazgos                       | En vivo: `/auth/v1/settings` devuelve `disable_signup: true`; un `signup` real devuelve 422 `signup_disabled`.                                                                                                                                                                                                                                                                                                                       |
| 12  | Auth: proveedor de email                                | Sin hallazgos                       | `/auth/v1/settings` devuelve `external.email: true`. `[auth.email] enable_signup = true` en `config.toml` es a propósito (es el interruptor del proveedor, no el registro; si se apaga, nadie puede iniciar sesión).                                                                                                                                                                                                                 |
| 13  | Auth: `jwt_expiry` y política de contraseñas            | Menor                               | `jwt_expiry = 900` contra "JWT de 1 hora" de 03 §15: ver SEG-05. `minimum_password_length = 8`, `password_requirements = ""`: coincide con el plan (mínimo 8, sin complejidad). Ver SEG-04.                                                                                                                                                                                                                                          |
| 14  | Storage: tamaños y tipos                                | Mayor / menor                       | `avatars`: 2 MB, solo `image/jpeg`. `branding`: 1 MB, PNG, JPEG y WebP. La matriz prueba carpeta propia y ajena de ambos buckets. SEG-01 (listado público) y SEG-02 (SVG).                                                                                                                                                                                                                                                           |

Además: `pnpm audit --prod` devuelve "No known vulnerabilities found".

## 3. Hallazgos

### SEG-01 (mayor) · `anon` lista el bucket `avatars` (= DEF-P07)

**Corregido en P18.6.** Se quitó `avatars_select_public`; `select` queda solo para la carpeta propia y
para owner/admin (`avatars_select_own_or_admin`). El bucket sigue siendo público: las fotos se sirven por
`/object/public` (`getPublicUrl`). `src/` no usa `.list()` ni `.download()` sobre `avatars`.

- **Dónde:** `supabase/migrations/0014_storage_buckets.sql`, política `avatars_select_public` (`select` a `anon, authenticated` sobre todo el bucket).
- **Evidencia:** con la clave anónima, `storage.from('avatars').list('')` devuelve las carpetas, que son los `profile_id`, y `list(<carpeta>)` devuelve las fotos. Lo cubre la matriz como `expected fail` con la anotación `[DEF-P07]` para `anon`, empleado, supervisor y doble rol. Detalle completo en la revisión del orquestador.
- **Plan:** 04 §7.3 apoya la lectura pública en que la URL "no sea adivinable"; el listado la anula.
- **Dueño:** backend-supabase (migración nueva en P18.6), con front-plataforma para confirmar que las fotos se muestran con `getPublicUrl` y no con `.list()` ni `.download()`.

### SEG-05 (mayor) · Cuentas del seed de `App_dev` con una contraseña adivinable

- **Dónde:** `SEED_DEV_PASSWORD` de `app/.env.local`, que `scripts/seed-dev.ts` aplica a todas las cuentas ficticias, incluidas las de dueño y administrador, y las `e2e-fijo-*`.
- **Evidencia:** el valor es una palabra corriente de 9 letras, sin dígitos ni símbolos. Cumple el mínimo de 8 del plan, pero es adivinable y no es una buena práctica. `App_dev` está publicado en `dev.extendiendoservicios.com` y el repositorio es público (lo dice `.env.example`). Es también la razón por la que el escaneo por valor de ese secreto da 68 archivos del repositorio y 13 de `dist/`: la palabra aparece en textos ordinarios. Así que ese escaneo no sirve para esa variable; se complementó con una búsqueda por patrones de asignación (sin coincidencias).
- **Severidad:** mayor si la misma contraseña está en staging. Los datos son ficticios, pero las cuentas de dueño permiten entrar a la pantalla de usuarios y a la Edge Function de `App_dev`.
- **Qué hacer (lo decide Mike):** rotar con un valor de 16 o más caracteres generado al azar (`SEED_DEV_PASSWORD` y volver a correr el seed), con la advertencia de que hay que reponer a la vez las contraseñas de las cuentas `e2e-fijo-*`, y no hacerlo en plena corrida de e2e. Subir el mínimo de `minimum_password_length` y agregar `password_requirements` es una decisión de producto (hoy el plan dice "mínimo 8"): se plantea como pregunta.
- **Dueño:** infra-devops (rotación y secretos del entorno).

### SEG-02 (menor) · SVG en `branding`

**Corregido en P18.6.** `image/svg+xml` salió de `allowed_mime_types` (PNG, JPEG y WebP). El logo de
`App_dev` no estaba cargado y el seed no trae SVG. El front (`src/api/settings.ts`) todavía lo ofrece:
pendiente de front-admin.

Ver la revisión del orquestador. Un SVG con script no se ejecuta en `<img>`, pero sí si se abre la URL directa de Storage (otro origen que el de la app). Solo lo suben dueño y administrador. Opciones: sacar `image/svg+xml` de `allowed_mime_types` o aceptar el riesgo. Dueño: backend-supabase.

### SEG-03 (menor) · El límite de tasa de `admin-users` no cuenta los rechazos

**Corregido en P18.6.** Los intentos rechazados de una persona ya identificada se registran como
`admin_action_rejected` y cuentan para el límite de 10 por minuto. No se registran `RATE_LIMITED`,
`INTERNAL_ERROR`, `UNAUTHENTICATED` ni `ORIGIN_NOT_ALLOWED`. Tests Deno y un caso en vivo en la matriz.

`checkRateLimit` cuenta eventos exitosos de `security_events`; los intentos rechazados (`FORBIDDEN`, validación) no suman. Hace falta sesión válida de dueño o administrador activo, así que el riesgo es bajo. Dueño: backend-supabase.

### SEG-04 (menor) · Contraseña mínima de 8 y sin reglas de complejidad

`config.toml` (`minimum_password_length = 8`, `password_requirements = ""`) coincide con la Edge Function (8 en `create_user` y `reset_password`) y con el plan. Se deja como observación: el plan no pide complejidad; ver la pregunta de SEG-05.

### SEG-06 (menor) · `config.toml` y el plan no coinciden en la vida del JWT

El plan (03 §15) dice "JWT de 1 hora"; `jwt_expiry = 900` (15 minutos). El cambio lo decidió Mike el 23 sep 2026 y está comentado en `config.toml`. El defecto es de documentación: actualizar 03 §15 y `docs/security.md`. Dueño: documentador.

**Cerrado en F18.** 03 §15 actualizado el 4 oct 2026; `docs/security.md` ya documentaba los 900 segundos.

### SEG-07 (menor) · `http://localhost:5173` en la lista blanca de CORS desplegada

**Corregido en P18.6.** `localhost:5173` sale de la lista base y entra con el secreto de la función
`ALLOWED_ORIGINS_EXTRA`, cargado solo en `App_dev`. En `App` no se carga (solo se aceptan orígenes
locales aunque alguien lo cargue por error).

`supabase/functions/_shared/cors.ts` admite `localhost:5173`, además de `dev.` y `app.`. En producción esa entrada no hace falta. El riesgo es bajo (solo lo usa quien corre la app en su máquina y aun así necesita un JWT válido), pero conviene dejarlo fuera de la función de producción. Dueño: backend-supabase.

### SEG-08 (menor) · `rls_auto_enable()` expuesta como RPC (= DEF-P11)

**Corregido en P18.6.** `revoke execute` a `public`, `anon` y `authenticated`.

Función de plataforma, `security definer`, con `execute` para `anon` y `authenticated`. Hoy falla al devolver su resultado, pero no debería ser llamable (revoke de `execute`). Dueño: backend-supabase.

## 4. Cobertura de permisos relacionada

**Estado tras P18.6:** los trece defectos quedaron corregidos y la matriz no tiene casos
`expected fail`. Los de privacidad (DEF-P03 a DEF-P06) se resolvieron con vistas recortadas
(`v_people_basic`, `v_clients_basic`, `v_shift_peers`), por decisión de Mike; el texto que sigue es el
original.

Los 50 casos "expected fail" de la matriz (13 causas raíz, DEF-P01 a DEF-P13) son permisos de más o de rendimiento. Los de privacidad de datos personales (DEF-P03, DEF-P04, DEF-P05, DEF-P06) comparten una causa: la RLS filtra filas, no columnas, y el plan limita a un compañero o al supervisor a "nombre y foto"/"nombre, foto, asistencia" (03 §6 y §15). Una corrección razonable es dar a esos roles una vista o un `grant` por columna; cómo hacerlo es una decisión de diseño y la toma backend-supabase con el orquestador.

## 5. Lo que no se pudo verificar

- La configuración **remota** de Auth más allá de lo que expone `/auth/v1/settings` (por ejemplo, `jwt_expiry` y el SMTP de Resend): se leyó de `config.toml` y no del panel, para no tocar la cuenta de servicio.
- Los secretos de GitHub, Pages y Supabase (la rotación anual): requieren acceso a esos paneles.
- Staging y producción: la revisión corrió contra `App_dev`.
- `pnpm audit` cubre dependencias de producción; no se corrió contra el árbol de desarrollo.
