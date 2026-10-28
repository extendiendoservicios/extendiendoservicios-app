# `supabase/functions`

Dos Edge Functions del proyecto. La primera, `admin-users` (Deno), con las
acciones administrativas que necesitan la `service_role` (crear usuario,
resetear contraseña, cambiar email de login, cerrar sesiones, desactivar y
reactivar — `06_API.md` sección 2.1, ADR-005). Se despliega con
`supabase functions deploy admin-users` (ya automatizado, condicionado a que
el archivo exista, en `deploy-staging.yml` y `deploy-production.yml`).

Detalle completo (autorización por acción, límite de acciones por minuto,
`security_events`, decisiones menores) en `docs/database.md`, sección
"Edge Function `admin-users`".

La segunda es `evidence-cleanup` (módulo H, P21.1): el borrado nocturno de las fotos y videos
vencidos del bucket `evidence`. La dispara un workflow programado con el secreto
`EVIDENCE_CLEANUP_SECRET` en el encabezado `x-evidence-cleanup-secret` (no usa JWT de usuario, por
eso se despliega con `verify_jwt = false`). El despliegue (`verify_jwt = false` en `config.toml`, y `supabase functions deploy evidence-cleanup` en `deploy-staging.yml`/`deploy-production.yml`) y el workflow `evidence-cleanup.yml` (cron diario 03:30 Argentina, o a mano desde Actions) son de P21.5; el paso a paso para correrlo y verlo en los logs está en `docs/environments.md`, sección 5.1. Archivos:
`evidence-cleanup/cleanup.ts` (la lógica, con un cliente inyectable), `index.ts` (autenticación y
`Deno.serve`) e `index.test.ts` (`deno test --allow-env --allow-net`, desde esa carpeta). Detalle en
`docs/database.md`, sección "Evidencia fotográfica".

## Archivos

- `admin-users/index.ts`: la función.
- `admin-users/index.p18_6.test.ts`: tests Deno de P18.6 (SEG-07 orígenes, DEF-P08 `sign_out_user`
  de una persona inexistente, SEG-03 intentos rechazados que cuentan para el límite), con un
  cliente simulado inyectado en `handleRequest(req, makeAdmin)`.
- `admin-users/index.test.ts`: tests Deno (`deno test`, TEST-004). Dos
  capas: `handleRequest` con requests reales (CORS, validaciones, falta de
  `Authorization`, método) y las funciones de cada acción llamadas directo
  con un cliente de Supabase simulado (rechaza sin capacidad, crea un
  usuario, no desactiva al último dueño). El límite de acciones por minuto
  y el registro en `security_events` se verificaron en vivo contra
  `App_dev`, no con mocks (ver `docs/database.md`).
- `_shared/cors.ts`: lista blanca de orígenes y cabeceras CORS. El prefijo
  `_` es la convención de Supabase para que la carpeta no se despliegue
  como una función propia. La lista base trae solo `dev.` y `app.`; los
  orígenes locales (`http://localhost:5173`) entran por el secreto de la función
  `ALLOWED_ORIGINS_EXTRA` (SEG-07), que existe solo en `App_dev`.

## Secretos de la función

| Secreto                   | Dónde                                                       | Para qué                                                                               |
| ------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS_EXTRA`   | `App_dev` (`http://localhost:5173`); **no existe en `App`** | Orígenes locales permitidos (solo `http://localhost` o `http://127.0.0.1`, con puerto) |
| `EVIDENCE_CLEANUP_SECRET` | `App_dev` y `App` (valores distintos)                       | Autentica a `evidence-cleanup` (encabezado `x-evidence-cleanup-secret`)                |
| `CREDENTIALS_KEY`         | `App_dev` y `App` (valores distintos)                       | Clave AES-256-GCM (32 bytes en base64) de la copia cifrada de contraseñas (P26.1)      |

Cargarlo: `supabase secrets set ALLOWED_ORIGINS_EXTRA=http://localhost:5173 --project-ref <ref de App_dev>`.
Las pruebas e2e (`vite preview` en `localhost:5173`) dependen de este secreto en `App_dev`.

## Cómo correr los tests

**En CI (`.github/workflows/ci.yml`, TEST-004, P07.6):** ya corren solos en
cada Pull Request a `develop`/`main`, en un paso propio dentro del job `CI`
(instala Deno 2 con `denoland/setup-deno@v2` y corre `deno test --allow-env
--allow-net` contra cualquier `*.test.ts` que encuentre bajo
`supabase/functions/`, con `find` — genérico para funciones futuras, no hace
falta tocar el workflow cuando llegue la próxima). Detalle completo en
`docs/deployment.md` sección 2.

En local, no hace falta Docker Desktop ni el proyecto vinculado para esta
parte (a diferencia de los pgTAP): alcanza con Deno.

```bash
cd supabase/functions/admin-users
deno test --allow-env --allow-net index.test.ts
```

Si no hay Deno instalado en la máquina (no forma parte de las herramientas
de este repo, ver `03_Plan_Maestro_Tecnico.md` ADR-021/ADR-023), se puede
correr con Docker, sin instalar nada de forma permanente:

```bash
docker run --rm -v "$(pwd)/../..:/app" -w /app/supabase/functions/admin-users \
  denoland/deno:2.2.4 test --allow-env --allow-net index.test.ts
```

`supabase/functions/**` está excluido de `eslint.config.js` y de
`vitest.config.ts`: corre en Deno (imports `npm:`/`jsr:`, `Deno.serve`),
no en el proyecto de TypeScript de Vite.

## Credenciales visibles (P26.1)

`admin-users` guarda una copia cifrada de la contraseña de cada cuenta (`account_credentials`, migración 0075) con `_shared/credentials.ts` y suma dos acciones. Errores nuevos: `CREDENTIALS_NOT_CONFIGURED` (500,
falta o es inválido el secreto `CREDENTIALS_KEY`; se corta antes de tocar Auth).

- `get_credentials { profile_id }` devuelve `{ email, password, source, set_at, status }`. `status` es `ok`,
  `none` (cuenta anterior a la copia) o `unreadable` (copia que no se pudo descifrar): con `none` y
  `unreadable`, `password` es `null` y la pantalla dice «No disponible». Mismo permiso que `reset_password`
  (dueño; o administrador con `manage_users` sobre quien no sea dueño ni administrador). Registra
  `credentials_viewed` y **no** cuenta para el límite de 10 acciones por minuto.
- `get_access_status { profile_id }` (P26.1b) devuelve `{ email, has_copy, readable, status, source, set_at }`
  sin descifrar nada: `status` es `none` (sin copia; `has_copy` y `readable` en `false` / `null`), `ok` o
  `unreadable` (la `key_version` de la copia ya no es la vigente), con el mismo sentido que en `get_credentials`.
  Nunca trae la contraseña ni el cifrado. Mismo permiso que `get_credentials`; **no** registra
  `credentials_viewed` ni cuenta para el límite (un rechazo sí queda como `admin_action_rejected`) y no
  necesita `CREDENTIALS_KEY`. Es la que usa la ficha al abrirse; `get_credentials` es solo para «Ver».
- `change_own_password { new_password, origin }` (`origin`: `profile` o `recovery`): cualquier persona con
  sesión y perfil activo, sin `manage_users`; cambia Auth y la copia, registra `password_changed_by_user`
  y no cierra las otras sesiones. La sesión del enlace de recuperación es un JWT común y sirve.
- `create_user` y `reset_password` guardan la copia antes de cambiar Auth (`reset_password`) o antes de la
  ficha y los roles (`create_user`); si el guardado falla, la acción falla y Auth queda como antes.
