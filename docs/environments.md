# Entornos, cuentas y secretos

Fuente: `03_Plan_Maestro_Tecnico.md` sección 3 (`Docs/Plan_Maestro/`, fuera de
este repo), `02_Decisiones.md` P-010 a P-015, P-106, P-107, P-109 a P-115;
ADR-008, ADR-013, ADR-014, ADR-021. Este archivo se actualiza en el mismo PR
que cambie algo de lo que describe.

## 1. Entornos

| Entorno    | Frontend                                                                 | Base de datos      | Datos                                        | Quién lo usa                      | Notas                                                                                                                        |
| ---------- | ------------------------------------------------------------------------ | ------------------ | -------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Local      | `pnpm dev` en la máquina de cada desarrollador (`http://localhost:5173`) | `App_dev` (remoto) | Seed ficticio (desde F4)                     | Mike, quien desarrolle            | `.env.local` con la URL y la anon key de `App_dev`. Sin Supabase local / Docker (ADR-014).                                   |
| Testing    | Playwright contra `localhost` o staging; pgTAP contra `App_dev`          | `App_dev`          | Seed ficticio recreado por corrida           | CI y quien desarrolle             | Los tests no dependen del estado previo.                                                                                     |
| Staging    | `dev.extendiendoservicios.com` (rama `develop`)                          | `App_dev`          | Seed ficticio; datos reales solo durante F19 | Mike, referente del cliente (UAT) | Público con `noindex` y banner "Entorno de prueba" (INFRA-022, pendiente el banner en front). Keepalive semanal (INFRA-019). |
| Producción | `app.extendiendoservicios.com` (rama `main`)                             | `App`              | Reales                                       | Todos                             | Despliegue con aprobación manual (F20). Respaldo diario (INFRA-018, pendiente).                                              |

`App_dev` hace doble función -- staging y desarrollo -- porque no hay
Supabase local (ADR-014, P-112). Es el único proyecto que este repositorio
vincula localmente.

## 2. Cuentas y proyectos (V3 punto 6)

| Servicio   | Cuenta                                                        | Recurso                                                                                                                    |
| ---------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Supabase   | Organización `bpcfjqvpdfmepiohltbz` ("Extendiendo Servicios") | Proyecto **`App`** (producción): ref `fysuppdadwvabrjpnnoh`, región `sa-east-1`, Postgres 17.6.                            |
| Supabase   | ídem                                                          | Proyecto **`App_dev`** (desarrollo y staging): ref `anesttvrnpsaaaxaquce`, región `sa-east-1`, Postgres 17.6.              |
| Cloudflare | `extserviciosapp@gmail.com`                                   | Zona `extendiendoservicios.com`, Pages `extendiendoservicios-app` (desde F3/INFRA-012), R2 `es-backups` (desde INFRA-020). |
| GitHub     | Organización `extendiendoservicios`                           | Repositorio `extendiendoservicios/extendiendoservicios-app`; secretos y environments.                                      |
| Sentry     | `extserviciosapp@gmail.com` (a crear, P03.1)                  | Proyecto `extendiendoservicios-app` (desde INFRA-021).                                                                     |

Regla permanente (memoria del proyecto): antes de crear o tocar cualquier
recurso remoto, verificar que la cuenta activa de la CLI o el navegador sea la
correcta.

### Cómo se vincula cada entorno

- **`App_dev` es lo único que se vincula desde una máquina de desarrollo o
  desde CI de staging.** Cada desarrollador, incluido Mike, corre una vez:

  ```bash
  pnpm exec supabase link --project-ref anesttvrnpsaaaxaquce
  ```

  La CLI ya tiene sesión iniciada por `supabase login` (P03.1, acción de
  Mike) y el link se resuelve por API de gestión: no pide la contraseña de la
  base de datos. El estado del link vive en `supabase/.temp/` (gitignorado):
  no se comitea ni se comparte.

- **`App` (producción) no se vincula nunca desde una máquina de desarrollo.**
  Se toca únicamente:
  1. Desde el workflow `deploy-production.yml` (INFRA-017, fuera de este
     encargo), autenticado con el secreto `SUPABASE_ACCESS_TOKEN` y el
     `SUPABASE_PROJECT_REF_PROD`, dentro del environment `production` con
     Mike como revisor.
  2. O, en un caso excepcional, a mano por Mike, con su propia sesión de
     `supabase login` y con aprobación explícita para esa acción puntual (por
     ejemplo, el comando de la sección 4 para aplicar la configuración de
     Auth).

  Ningún agente ni script de este repositorio vincula, empuja configuración
  ni consulta `App` fuera de esos dos casos.

## 3. Autenticación (Supabase Auth)

La configuración de Auth vive versionada en `supabase/config.toml` (bloque
`[auth]` para `App_dev`, bloque `[remotes.produccion.auth]` para `App`) y se
aplica con `supabase config push` -- no hay pantalla del panel que haya que
tocar a mano para lo que sigue:

| Regla                  | Valor                                                                                                                                                                                                                                                                   | Decisión                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Registro público       | Deshabilitado (`enable_signup = false` general y de email). Los usuarios los crea el dueño o un administrador, por pantalla o por la Admin API (Edge Function `admin-users`, F7).                                                                                       | P-011, ADR-008          |
| Contraseña mínima      | 8 caracteres, sin otras reglas de composición.                                                                                                                                                                                                                          | P-106                   |
| JWT                    | 1 hora (`jwt_expiry = 3600`).                                                                                                                                                                                                                                           | P-015                   |
| Sesión / refresh token | Persistente: rotación de refresh token habilitada con el intervalo de reúso recomendado por Supabase (10 s); sin `[auth.sessions].timebox` ni `.inactivity_timeout` declarados, es decir sin límite por tiempo ni por inactividad.                                      | P-015                   |
| `site_url`             | `App_dev`: `https://dev.extendiendoservicios.com`. `App`: `https://app.extendiendoservicios.com`.                                                                                                                                                                       | P-111                   |
| URLs de redirección    | `App_dev`: `http://localhost:5173`, `http://localhost:5173/restablecer`, `https://dev.extendiendoservicios.com`, `https://dev.extendiendoservicios.com/restablecer`. `App`: `https://app.extendiendoservicios.com`, `https://app.extendiendoservicios.com/restablecer`. | COM-03 (`/restablecer`) |
| Rate limiting          | Sin cambios respecto del valor por defecto de Supabase.                                                                                                                                                                                                                 | P-107                   |

**Aplicado hoy:** `App_dev`, con `pnpm exec supabase config push` (ver
"Cómo lo verifiqué" en el reporte del encargo para la diferencia exacta que
mostró la CLI).

**Pendiente para Mike, en `App`:** este repositorio no vincula ni empuja
configuración a `App` bajo ninguna circunstancia (ver sección 2). Cuando
Mike decida aplicar la misma configuración de Auth a producción, el comando
es:

```bash
pnpm exec supabase config push --project-ref fysuppdadwvabrjpnnoh
```

Ese comando usa el bloque `[remotes.produccion]` de `supabase/config.toml`
(que ya trae el `site_url` y las URLs de redirección de `App`; el resto de
las reglas -- sin registro público, contraseña mínima, JWT, refresh token,
rate limiting -- las hereda del bloque `[auth]` raíz, porque son las mismas
para los dos proyectos) y pide confirmación mostrando el diff antes de
escribir nada; conviene correr antes `pnpm exec supabase config diff
--project-ref fysuppdadwvabrjpnnoh` para revisarlo sin aplicar cambios.

### Qué no queda versionado ni se pushea con la CLI

`supabase config diff` marca estas propiedades como "no administradas" por
`config push` (quedan fuera de la comparación y de cualquier push, se tocan
solo desde el panel si hace falta en el futuro):

- `auth.rate_limit.email_sent` (límite de correos de Auth por hora).
- `auth.external.apple.*`, `auth.oauth_server.*` (no se usan en este plan).
- `db.network_restrictions.*` (no se usan en este plan).
- `storage.analytics.*` (no se usa en este plan).

Además, a propósito, `supabase/config.toml` **no declara** en este encargo
`auth.email.enable_confirmations`, `auth.email.max_frequency`,
`auth.email.otp_length`, `auth.sms.twilio.*` ni `auth.mfa.totp.*`: son
ajustes de email/SMTP/SMS/MFA que no forman parte de este encargo (SMTP
queda pendiente, ver más abajo) o directamente no forman parte del plan
(SMS, MFA -- ADR-008 descartó OTP por SMS). Quedan como estén hoy en cada
proyecto remoto hasta que un encargo futuro (P06.0, según
`11_Desglose_de_Tareas.md`) los declare y decida su valor.

### Límites del envío de emails de Auth con la configuración por defecto

Ni `App` ni `App_dev` tienen un servidor SMTP propio configurado (ese es
justamente el trabajo pendiente de P06.0: Resend + DNS + `config.toml`). Sin
SMTP propio, Supabase usa su servicio de correo integrado para los emails de
Auth (recuperación de contraseña, invitación, cambio de email), que tiene
limitaciones importantes hoy:

- **2 correos por hora por proyecto** en total -- muy por debajo de lo que
  necesita un uso real.
- **Solo entrega a direcciones que son parte del equipo del proyecto** en el
  panel de Supabase; a cualquier otra dirección responde "Email address not
  authorized". En la práctica, hoy **nadie que no sea parte del equipo de
  Supabase del proyecto puede recibir un correo de recuperación de
  contraseña**, ni en `App_dev` ni en `App`.
- Sin garantía de entrega ni de disponibilidad (servicio "best effort"),
  pensado solo para explorar y probar plantillas, no para producción.

Mientras esto no se resuelva (P06.0), la recuperación de contraseña por
email (COM-02) no funciona para usuarios reales; el reseteo administrativo
de contraseña (P-012, pantalla de usuarios / Edge Function `admin-users`,
F7) es la única vía utilizable en la práctica.

## 4. Variables y secretos

| Nombre                                                                       | Dónde vive                                                               | Quién lo carga                   | Para qué se usa                                                                                                                                                                                                    | En qué paquete hace falta                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                                | `.env.local` (cada desarrollador); variable de Pages por rama            | Cada desarrollador; Mike (Pages) | Cliente de Supabase del frontend. La anon key es pública por diseño: RLS protege.                                                                                                                                  | P03.4 (existe el proyecto de Pages) / P03.5 (Mike las carga) |
| `VITE_APP_ENV`                                                               | ídem                                                                     | ídem                             | Banner de "Entorno de prueba" en staging; `environment` de Sentry.                                                                                                                                                 | P03.4 / P03.5                                                |
| `VITE_APP_VERSION`                                                           | Build (CI)                                                               | CI, automático                   | Versión visible en la interfaz.                                                                                                                                                                                    | P03.3                                                        |
| `VITE_SENTRY_DSN`                                                            | Variable de Pages                                                        | Mike                             | Errores de frontend (INFRA-021).                                                                                                                                                                                   | P03.3 (workflow) / P03.5 (carga)                             |
| `SUPABASE_ACCESS_TOKEN`                                                      | Secreto de GitHub                                                        | Mike                             | Autenticar la CLI de Supabase dentro de los workflows.                                                                                                                                                             | P03.3                                                        |
| `SUPABASE_PROJECT_REF_DEV`                                                   | Secreto de GitHub                                                        | Mike                             | `supabase link --project-ref` en `deploy-staging.yml` / `ci.yml`.                                                                                                                                                  | P03.3                                                        |
| `SUPABASE_PROJECT_REF_PROD`                                                  | Secreto de GitHub                                                        | Mike                             | `supabase link --project-ref` en `deploy-production.yml`.                                                                                                                                                          | P03.3                                                        |
| `SUPABASE_DB_URL_DEV`                                                        | Secreto de GitHub                                                        | Mike                             | `keepalive.yml` (**ya, en este encargo**); además `ci.yml` (pgTAP) y `deploy-staging.yml` más adelante. Cadena del **Session pooler** (IPv4), no la conexión directa: los runners de GitHub no tienen salida IPv6. | Ya (P03.2) y luego P03.3                                     |
| `SUPABASE_DB_URL_PROD`                                                       | Secreto de GitHub                                                        | Mike                             | `backup.yml` (`pg_dump`) y `deploy-production.yml`. Cadena del **Session pooler** (IPv4), mismo motivo que arriba.                                                                                                 | P03.4 (respaldo) / P03.3 (deploy)                            |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                              | Secreto de GitHub                                                        | Mike                             | Crear el proyecto de Pages y el bucket R2 con `wrangler` (P03.4); publicar builds desde `deploy-staging.yml` / `deploy-production.yml` (P03.3).                                                                    | P03.4 y P03.3                                                |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `BACKUP_PASSPHRASE` | Secreto de GitHub                                                        | Mike                             | Subida cifrada del volcado diario a R2 (`backup.yml`).                                                                                                                                                             | P03.4                                                        |
| `SENTRY_AUTH_TOKEN`                                                          | Secreto de GitHub                                                        | Mike                             | Subir source maps a Sentry desde CI.                                                                                                                                                                               | P03.3                                                        |
| `SUPABASE_SERVICE_ROLE_KEY`                                                  | Ninguno (la inyecta Supabase automáticamente dentro de la Edge Function) | Nadie manualmente                | Únicamente dentro de `supabase/functions/admin-users`. Nunca en el repo, nunca en el frontend, nunca en un secreto de GitHub.                                                                                      | F7 (la Edge Function)                                        |

Ningún secreto vive en el repositorio; `.env.example` documenta los nombres
sin valores. Rotación anual y ante cualquier sospecha (`03` sección 3.3).

### Comandos para cargar los secretos de GitHub

El valor **nunca** va en la línea de comando, en un archivo ni en el chat:
`gh secret set` sin `--body` lo pide por teclado (entrada oculta). Correr
uno por uno, desde una terminal de Mike:

```bash
gh secret set SUPABASE_ACCESS_TOKEN --repo extendiendoservicios/extendiendoservicios-app
gh secret set SUPABASE_PROJECT_REF_DEV --repo extendiendoservicios/extendiendoservicios-app
gh secret set SUPABASE_PROJECT_REF_PROD --repo extendiendoservicios/extendiendoservicios-app
gh secret set SUPABASE_DB_URL_DEV --repo extendiendoservicios/extendiendoservicios-app
gh secret set SUPABASE_DB_URL_PROD --repo extendiendoservicios/extendiendoservicios-app
gh secret set CLOUDFLARE_API_TOKEN --repo extendiendoservicios/extendiendoservicios-app
gh secret set CLOUDFLARE_ACCOUNT_ID --repo extendiendoservicios/extendiendoservicios-app
gh secret set R2_ACCESS_KEY_ID --repo extendiendoservicios/extendiendoservicios-app
gh secret set R2_SECRET_ACCESS_KEY --repo extendiendoservicios/extendiendoservicios-app
gh secret set R2_BUCKET --repo extendiendoservicios/extendiendoservicios-app
gh secret set BACKUP_PASSPHRASE --repo extendiendoservicios/extendiendoservicios-app
gh secret set SENTRY_AUTH_TOKEN --repo extendiendoservicios/extendiendoservicios-app
```

`SUPABASE_DB_URL_DEV` es el único de esta lista que hace falta **ya**, para
que `keepalive.yml` funcione (sección 5). Los demás corresponden a workflows
que todavía no existen en este repositorio (P03.3, P03.4 -- fuera de este
encargo).

### Dónde obtener cada valor en el panel de Supabase

- **`SUPABASE_ACCESS_TOKEN`**: panel de Supabase → ícono de la cuenta →
  **Access Tokens** → **Generate new token**. Es personal de quien lo genera
  (recomendado: un token dedicado a CI, no el de uso diario de Mike).
- **`SUPABASE_PROJECT_REF_DEV` / `_PROD`**: `anesttvrnpsaaaxaquce` y
  `fysuppdadwvabrjpnnoh` respectivamente (sección 2 de este documento), o en
  el panel de cada proyecto → **Project Settings** → **General** → _Reference
  ID_.
- **`SUPABASE_DB_URL_DEV` / `_PROD`**: panel del proyecto correspondiente →
  **Project Settings** → **Database** → **Connect** → pestaña **Session
  pooler** (no "Direct connection" ni "Transaction pooler") → copiar la
  cadena completa y reemplazar `[YOUR-PASSWORD]` por la contraseña de la
  base de datos de ese proyecto. Formato de referencia (la CLI de Supabase
  no permite armarla a mano porque el índice del pooler no es adivinable):
  `postgresql://postgres.<ref>:<password>@aws-<índice>-sa-east-1.pooler.supabase.com:5432/postgres`.

### Cloudflare, R2 y Sentry

Los tokens de Cloudflare (`CLOUDFLARE_API_TOKEN`), R2
(`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`) y Sentry (`SENTRY_AUTH_TOKEN`,
`VITE_SENTRY_DSN`) se documentan con sus permisos mínimos en el paquete
P03.4 (creación del proyecto de Pages, el bucket R2 y el workflow de
respaldo), fuera de este encargo. Este documento no los detalla todavía para
no adelantar decisiones de alcance de permisos que no corresponden a
INFRA-010/011/019/023.

## 5. Keepalive (INFRA-019)

`.github/workflows/keepalive.yml` corre una consulta trivial (`select 1`)
semanal contra `App_dev` con `psql`, usando el secreto `SUPABASE_DB_URL_DEV`.
Evita que el plan sin cargo de Supabase pause el proyecto por inactividad
(ADR-014).

- **La cadena tiene que ser la del Session pooler (IPv4), no la conexión
  directa.** Los runners hospedados de GitHub Actions no tienen salida
  IPv6, y la conexión directa de Supabase es IPv6 en proyectos nuevos; si se
  carga la conexión directa, el workflow falla por timeout de red, no por un
  problema de la base. Mismo criterio para `SUPABASE_DB_URL_PROD` cuando se
  cargue (`backup.yml`, P03.4).
- Si la consulta falla, el job falla (sin reintento): eso es lo que dispara
  el correo de alerta de GitHub Actions a quien tenga notificaciones
  activadas para el repositorio.
- Se puede disparar a mano desde la pestaña **Actions** → **keepalive** →
  **Run workflow**, además de correr solo los lunes.

## 6. Wrangler

`wrangler` es dependencia de desarrollo del proyecto (no una instalación
global): `pnpm exec wrangler <comando>`. Mike y CI la ejecutan siempre así,
igual que con `supabase`. Este encargo no autoriza crear nada en Cloudflare
todavía (eso es P03.4); `wrangler` queda instalada y lista para cuando ese
paquete la necesite (`login`, verificado por Mike en P03.1).
