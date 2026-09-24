# `supabase/functions`

Una única Edge Function del proyecto: `admin-users` (Deno), con las
acciones administrativas que necesitan la `service_role` (crear usuario,
resetear contraseña, cambiar email de login, cerrar sesiones, desactivar y
reactivar — `06_API.md` sección 2.1, ADR-005). Se despliega con
`supabase functions deploy admin-users` (ya automatizado, condicionado a que
el archivo exista, en `deploy-staging.yml` y `deploy-production.yml`).

Detalle completo (autorización por acción, límite de acciones por minuto,
`security_events`, decisiones menores) en `docs/database.md`, sección
"Edge Function `admin-users`".

## Archivos

- `admin-users/index.ts`: la función.
- `admin-users/index.test.ts`: tests Deno (`deno test`, TEST-004). Dos
  capas: `handleRequest` con requests reales (CORS, validaciones, falta de
  `Authorization`, método) y las funciones de cada acción llamadas directo
  con un cliente de Supabase simulado (rechaza sin capacidad, crea un
  usuario, no desactiva al último dueño). El límite de acciones por minuto
  y el registro en `security_events` se verificaron en vivo contra
  `App_dev`, no con mocks (ver `docs/database.md`).
- `_shared/cors.ts`: lista blanca de orígenes y cabeceras CORS. El prefijo
  `_` es la convención de Supabase para que la carpeta no se despliegue
  como una función propia.

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
