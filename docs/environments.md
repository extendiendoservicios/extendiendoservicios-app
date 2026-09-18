# Entornos, cuentas y secretos

Fuente: `03_Plan_Maestro_Tecnico.md` sección 3 (`Docs/Plan_Maestro/`, fuera de
este repo), `02_Decisiones.md` P-010 a P-015, P-106, P-107, P-109 a P-115;
ADR-008, ADR-013, ADR-014, ADR-015, ADR-021. Este archivo se actualiza en el
mismo PR que cambie algo de lo que describe (ampliado en P03.4: proyecto de
Pages y bucket R2 creados, tokens con permisos mínimos para P03.5).

## 1. Entornos

| Entorno    | Frontend                                                                 | Base de datos      | Datos                                        | Quién lo usa                      | Notas                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------ | ------------------ | -------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Local      | `pnpm dev` en la máquina de cada desarrollador (`http://localhost:5173`) | `App_dev` (remoto) | Seed ficticio (desde F4)                     | Mike, quien desarrolle            | `.env.local` con la URL y la anon key de `App_dev`. Sin Supabase local / Docker (ADR-014).                                                     |
| Testing    | Playwright contra `localhost` o staging; pgTAP contra `App_dev`          | `App_dev`          | Seed ficticio recreado por corrida           | CI y quien desarrolle             | Los tests no dependen del estado previo.                                                                                                       |
| Staging    | `dev.extendiendoservicios.com` (rama `develop`)                          | `App_dev`          | Seed ficticio; datos reales solo durante F19 | Mike, referente del cliente (UAT) | Público con `noindex` y banner "Entorno de prueba" (INFRA-022, pendiente el banner en front). Keepalive semanal (INFRA-019).                   |
| Producción | `app.extendiendoservicios.com` (rama `main`)                             | `App`              | Reales                                       | Todos                             | Despliegue con aprobación manual (F20). Respaldo diario a R2 (INFRA-018, escrito y validado; falta activarlo, `docs/deployment.md` sección 3). |

`App_dev` hace doble función -- staging y desarrollo -- porque no hay
Supabase local (ADR-014, P-112). Es el único proyecto que este repositorio
vincula localmente.

## 2. Cuentas y proyectos (V3 punto 6)

| Servicio   | Cuenta                                                        | Recurso                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase   | Organización `bpcfjqvpdfmepiohltbz` ("Extendiendo Servicios") | Proyecto **`App`** (producción): ref `fysuppdadwvabrjpnnoh`, región `sa-east-1`, Postgres 17.6.                                                                                                |
| Supabase   | ídem                                                          | Proyecto **`App_dev`** (desarrollo y staging): ref `anesttvrnpsaaaxaquce`, región `sa-east-1`, Postgres 17.6.                                                                                  |
| Cloudflare | `extserviciosapp@gmail.com`                                   | Zona `extendiendoservicios.com`; Pages `extendiendoservicios-app` (creado en P03.4, sin dominios ni despliegues todavía); R2 `es-backups` (creado en P03.4, privado, con reglas de retención). |
| GitHub     | Organización `extendiendoservicios`                           | Repositorio `extendiendoservicios/extendiendoservicios-app`; secretos y environments.                                                                                                          |
| Sentry     | `extserviciosapp@gmail.com` (a crear, P03.1)                  | Proyecto `extendiendoservicios-app` (desde INFRA-021).                                                                                                                                         |

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

| Nombre                                                                       | Dónde vive                                                                                                                                                     | Quién lo carga                                           | Para qué se usa                                                                                                                                                                                                                   | En qué paquete hace falta                                               |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                                | `.env.local` (cada desarrollador); secreto de los `environment` de GitHub `staging` y `production` (mismo nombre, valor distinto por entorno) [^actions-build] | Cada desarrollador; Mike (secretos de GitHub)            | Cliente de Supabase del frontend. La anon key es pública por diseño: RLS protege.                                                                                                                                                 | P03.4 (existe el proyecto de Pages) / P03.5 (Mike las carga)            |
| `VITE_APP_ENV`                                                               | ídem, pero fijo por workflow (`staging`/`production`), no un secreto                                                                                           | `deploy-staging.yml`/`deploy-production.yml`, automático | Banner de "Entorno de prueba" en staging; `environment` de Sentry.                                                                                                                                                                | P03.3 (ya, en este encargo) / P03.5 (Mike solo carga las otras)         |
| `VITE_APP_VERSION`                                                           | Build (`vite.config.ts` lo lee de `package.json`, no es una variable cargada a mano)                                                                           | Automático, siempre                                      | Versión visible en la interfaz.                                                                                                                                                                                                   | Ya (F2, ADR-020)                                                        |
| `VITE_SENTRY_DSN`                                                            | Secreto de GitHub (de repositorio, no de `environment`: un solo proyecto de Sentry para los dos entornos) [^actions-build]                                     | Mike                                                     | Errores de frontend (INFRA-021).                                                                                                                                                                                                  | P03.3 (workflow, ya en este encargo) / P03.5 (Mike carga el valor real) |
| `SUPABASE_ACCESS_TOKEN`                                                      | Secreto de GitHub                                                                                                                                              | Mike                                                     | Autenticar la CLI de Supabase dentro de los workflows.                                                                                                                                                                            | P03.3                                                                   |
| `SUPABASE_PROJECT_REF_DEV`                                                   | Secreto de GitHub                                                                                                                                              | Mike                                                     | `supabase link --project-ref` en `deploy-staging.yml` / `ci.yml`.                                                                                                                                                                 | P03.3                                                                   |
| `SUPABASE_PROJECT_REF_PROD`                                                  | Secreto de GitHub                                                                                                                                              | Mike                                                     | `supabase link --project-ref` en `deploy-production.yml`.                                                                                                                                                                         | P03.3                                                                   |
| `SUPABASE_DB_URL_DEV`                                                        | Secreto de GitHub                                                                                                                                              | Mike                                                     | `keepalive.yml` (**ya, en este encargo**); además `ci.yml` (pgTAP) y `deploy-staging.yml` más adelante. Cadena del **Session pooler** (IPv4), no la conexión directa: los runners de GitHub no tienen salida IPv6.                | Ya (P03.2) y luego P03.3                                                |
| `SUPABASE_DB_URL_PROD`                                                       | Secreto de GitHub                                                                                                                                              | Mike                                                     | `backup.yml` (`pg_dump`) y `deploy-production.yml`. Cadena del **Session pooler** (IPv4), mismo motivo que arriba.                                                                                                                | P03.4 (respaldo) / P03.3 (deploy)                                       |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                              | Secreto de GitHub                                                                                                                                              | Mike                                                     | Crear el proyecto de Pages y el bucket R2 con `wrangler` (P03.4); publicar builds desde `deploy-staging.yml` / `deploy-production.yml` (P03.3).                                                                                   | P03.4 y P03.3                                                           |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `BACKUP_PASSPHRASE` | Secreto de GitHub                                                                                                                                              | Mike                                                     | Subida cifrada del volcado diario a R2 (`backup.yml`).                                                                                                                                                                            | P03.4                                                                   |
| `SENTRY_AUTH_TOKEN`                                                          | Secreto de GitHub (de repositorio)                                                                                                                             | Mike                                                     | Subir source maps a Sentry desde `deploy-staging.yml`/`deploy-production.yml` (`vite.config.ts`, INFRA-021). Sin este secreto, esos workflows construyen igual pero sin generar ni subir `.map` (`docs/deployment.md` sección 7). | P03.3 (workflow, ya en este encargo) / P03.5 (Mike carga el valor real) |
| `SUPABASE_SERVICE_ROLE_KEY`                                                  | Ninguno (la inyecta Supabase automáticamente dentro de la Edge Function)                                                                                       | Nadie manualmente                                        | Únicamente dentro de `supabase/functions/admin-users`. Nunca en el repo, nunca en el frontend, nunca en un secreto de GitHub.                                                                                                     | F7 (la Edge Function)                                                   |

Ningún secreto vive en el repositorio; `.env.example` documenta los nombres
sin valores. Rotación anual y ante cualquier sospecha (`03` sección 3.3).

[^actions-build]:
    Esta fila se corrigió en P03.3 (INFRA-016/017): P03.2 la
    documentó solo como "variable de Pages por rama" asumiendo que
    Cloudflare Pages iba a construir el sitio a partir del repositorio
    conectado por Git. `deploy-staging.yml`/`deploy-production.yml`
    resolvieron el despliegue distinto -- **el build lo hace GitHub
    Actions** (`pnpm build`) y `wrangler pages deploy` solo sube el
    `dist/` ya construido, sin que Cloudflare ejecute ningún build propio
    -- así que estas variables tienen que existir también como secretos de
    GitHub para que el build de Actions las vea. Detalle completo:
    `docs/deployment.md` sección 9.

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
que `keepalive.yml` funcione (sección 5). Los demás los carga Mike en P03.5,
una vez creados los tokens correspondientes (`CLOUDFLARE_API_TOKEN`, R2 y
Sentry: ver más abajo) -- los workflows que los usan (`deploy-staging.yml`,
`deploy-production.yml`, `backup.yml`) ya existen (P03.3, P03.4) pero están
detrás de sus interruptores (`docs/deployment.md` sección 3) y no corren
hasta P03.6.

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

El proyecto de Pages y el bucket R2 ya existen (P03.4, `wrangler pages
project create` / `wrangler r2 bucket create`, sección 6); lo que falta es
que Mike cree los tokens con permisos mínimos y cargue los secretos (P03.5).
Paso a paso en el panel:

**`CLOUDFLARE_API_TOKEN`** (publica builds en Pages desde
`deploy-staging.yml`/`deploy-production.yml`, `pnpm exec wrangler pages
deploy`):

1. Panel de Cloudflare (cuenta `extserviciosapp@gmail.com`) → ícono de
   perfil → **My Profile** → **API Tokens** → **Create Token**.
2. Plantilla **Edit Cloudflare Pages** (o **Custom token** con el mismo
   permiso): **Account** → **Cloudflare Pages** → **Edit**. Es el permiso
   mínimo disponible: la API de tokens de Cloudflare no permite acotarlo a
   un único proyecto de Pages, solo a nivel cuenta.
3. **Account Resources**: **Include** → la cuenta `extserviciosapp@gmail.com`
   (ninguna otra). Sin **Zone Resources** (no hace falta tocar DNS con este
   token; eso es un cambio manual en el panel, `docs/deployment.md`).
4. **Continue to summary** → **Create Token** → copiar el valor (se muestra
   una sola vez).
5. `gh secret set CLOUDFLARE_API_TOKEN --repo extendiendoservicios/extendiendoservicios-app`
   (pega el valor cuando lo pida; nunca en la línea de comando).

**`CLOUDFLARE_ACCOUNT_ID`**: no es secreto por naturaleza (es un
identificador, no una credencial) pero se carga igual como secreto de
GitHub por prolijidad y para no repetirlo en cada workflow. Panel de
Cloudflare → cualquier dominio de la cuenta, o **Workers & Pages** →
**Overview** → columna derecha, **Account ID**.

**`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`** (suben el respaldo cifrado a
R2 por su API S3, `backup.yml` y el volcado previo de `deploy-production.yml`):

1. Panel de Cloudflare → **R2** → **Overview** → **Manage API Tokens** (o,
   dentro del bucket `es-backups` → **Settings** → **API Tokens**).
2. **Create API Token** → nombre descriptivo (por ejemplo
   `backup-ci-es-backups`) → **Permissions**: **Object Read & Write** →
   **Specify bucket(s)** → elegir únicamente `es-backups` (nunca "Apply to
   all buckets"): con esto el token no puede leer ni escribir en ningún
   otro bucket que se cree más adelante.
3. **TTL**: sin vencimiento, sujeto a la rotación anual de `03` sección 3.3
   (o una fecha de vencimiento si Mike prefiere rotarlo antes a mano).
4. **Create API Token** → copiar **Access Key ID** y **Secret Access Key**
   (se muestran una sola vez).
5. ```bash
   gh secret set R2_ACCESS_KEY_ID --repo extendiendoservicios/extendiendoservicios-app
   gh secret set R2_SECRET_ACCESS_KEY --repo extendiendoservicios/extendiendoservicios-app
   gh secret set R2_BUCKET --body es-backups --repo extendiendoservicios/extendiendoservicios-app
   ```

**`BACKUP_PASSPHRASE`** (cifra/descifra los volcados, `scripts/backup-to-r2.sh`
/ `scripts/restore-from-r2.sh`, `docs/deployment.md` sección 6): una frase
generada por Mike, larga y aleatoria (por ejemplo `openssl rand -base64 32`
en cualquier terminal, o el generador de un gestor de contraseñas), que no
se deriva de ninguna otra contraseña existente.

```bash
gh secret set BACKUP_PASSPHRASE --repo extendiendoservicios/extendiendoservicios-app
```

**Advertencia:** GitHub no permite leer de nuevo un secreto ya cargado (solo
sobrescribirlo), y el cifrado es simétrico sin puerta trasera: **si esta
frase se pierde, todos los respaldos ya subidos a R2 quedan inservibles para
siempre**, sin forma de recuperarlos. Guardarla también en un gestor de
contraseñas u otro lugar seguro fuera de GitHub (nunca en el repositorio, un
chat o un archivo sin cifrar) es indispensable, no opcional.

**Sentry (`SENTRY_AUTH_TOKEN`, `VITE_SENTRY_DSN`)**: la cuenta de Sentry
todavía no existe (`03` sección 3.2 la marca "a crear"); su creación y los
tokens correspondientes quedan para cuando Mike la cree (P03.5). El uso de
cada uno ya está documentado en `docs/deployment.md` sección 9.

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
  cargue (`backup.yml`, `docs/deployment.md` sección 6).
- Si la consulta falla, el job falla (sin reintento): eso es lo que dispara
  el correo de alerta de GitHub Actions a quien tenga notificaciones
  activadas para el repositorio.
- Se puede disparar a mano desde la pestaña **Actions** → **keepalive** →
  **Run workflow**, además de correr solo los lunes.

## 6. Wrangler

`wrangler` es dependencia de desarrollo del proyecto (no una instalación
global): `pnpm exec wrangler <comando>`. Mike y CI la ejecutan siempre así,
igual que con `supabase` (`login`, verificado por Mike en P03.1).

En P03.4, con la sesión de `wrangler` ya iniciada por Mike, se crearon (cuenta
verificada primero con `wrangler whoami`):

```bash
pnpm exec wrangler pages project create extendiendoservicios-app --production-branch=main
pnpm exec wrangler r2 bucket create es-backups
```

Detalle de ambos recursos, sus reglas de retención y lo que falta (tokens,
dominios, primer despliegue): `docs/deployment.md` sección 7.

Ya en uso, sin ejecutarse todavía (proyecto creado, pero sin token de API
cargado ni interruptor activado): `deploy-staging.yml` y
`deploy-production.yml` (INFRA-016/INFRA-017) publican con
`pnpm exec wrangler pages deploy dist --project-name=extendiendoservicios-app --branch=<develop|main>`,
autenticado con los secretos `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`.
Ambos workflows están detrás de sus interruptores (`docs/deployment.md`
sección 3): no publican nada hasta que Mike cargue los secretos (P03.5) y
active los interruptores (P03.6).
