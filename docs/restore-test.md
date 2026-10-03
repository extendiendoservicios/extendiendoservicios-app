# Prueba de restauración y recuperación de App_dev (TEST-024)

Guía para correr la prueba de restauración de los respaldos (`restore-test.yml`), saber si salió
bien, dejar el acta y volver a dejar `App_dev` utilizable. ADR-015 pide que la restauración esté
"documentada y repetida en F18"; `03_Plan_Maestro_Tecnico.md` sección 14.1 define el criterio:
**"el volcado se restaura y la app funciona sobre él"**.

El diseño de la secuencia, con su historia y los defectos que se corrigieron, está en
[`deployment.md`](deployment.md) sección 6.3. Esta guía es la parte operativa.

## 1. En pocas palabras

1. Es un workflow de GitHub que se dispara a mano (nunca por cron). Baja el último respaldo de R2,
   lo descifra y lo restaura en **`App_dev`** (nunca en `App`).
2. Durante unos minutos `App_dev` tiene los datos del respaldo, **incluidos los hashes de
   contraseña de los usuarios de producción**. Al terminar, el propio workflow lo borra todo.
3. **`App_dev` queda sin usuarios y sin datos**, incluidas las cuentas fijas de las pruebas e2e.
   Se recupera con `pnpm db:recuperar-dev` (sección 8).
4. El resultado queda en la pestaña **Summary** de la corrida: es el insumo del acta (sección 9).
5. Dura entre 1 y 5 minutos. El ensayo local con 5.526 filas tardó 20 segundos.

## 2. Qué hace y qué deja sin probar

El workflow corre `scripts/restore-from-r2.sh`, que hace, en este orden:

| Paso | Qué hace                                                                                                                                                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0a   | Comprueba que el volcado sea un **respaldo completo**: datos de `auth.users` y `auth.identities`, migraciones, hook de Auth, triggers sobre `auth`, buckets y las seis políticas de Storage, y que tenga las mismas políticas RLS que `App_dev`.                                                               |
| 0b   | Comprueba que `App_dev` tenga **las mismas migraciones** que el volcado. Si no, aborta sin tocar nada.                                                                                                                                                                                                         |
| 0c   | Comprueba que las columnas de `auth.users` y `auth.identities` del volcado existan en `App_dev` (Supabase actualiza Auth proyecto por proyecto).                                                                                                                                                               |
| 0d   | Comprueba que la estructura y los permisos de `App_dev` sean los de las migraciones y saca una huella de los permisos.                                                                                                                                                                                         |
| 1    | Vacía `public` (`TRUNCATE ... CASCADE`).                                                                                                                                                                                                                                                                       |
| 2    | Reemplaza `auth.users` y `auth.identities` con los del volcado.                                                                                                                                                                                                                                                |
| 3    | Carga los datos de `public`.                                                                                                                                                                                                                                                                                   |
| 4    | Verifica: filas de **cada tabla** contra el volcado, claves foráneas sin huérfanas, estructura y permisos otra vez, huella de permisos idéntica a la de antes, y una **sesión simulada** de una persona dueña o administradora (el hook de Auth arma su token y la RLS tiene que dejarle ver todas las filas). |
| 5    | Limpia: vacía `public` y borra los usuarios restaurados, siempre, aunque algo haya fallado antes. Confirma que quedó vacío.                                                                                                                                                                                    |

**Solo se reemplazan datos.** Nunca se toca una tabla, un permiso, una política ni un trigger:
quedan como los dejaron las migraciones. Por eso los permisos de después son iguales a los de
antes y no aparece el `GRANT ALL` por defecto de Supabase (la prueba lo verifica).

Lo que esta prueba **no** cubre, para que no se lea de más:

- **Los archivos de Storage** (fotos de perfil y logo). El respaldo es un `pg_dump`: guarda la
  lista de buckets y las políticas, no los archivos. La prueba tampoco los toca: los archivos
  que haya en `App_dev` quedan, aunque sus perfiles se borren. Si hubiera que recuperar `App`
  desde cero, las fotos y el logo se vuelven a subir a mano.
- **Los permisos de `App`**. El volcado se hace con `--no-privileges`: no trae permisos. Los de
  `App` se comprueban con las migraciones, no con el respaldo. Para recuperar `App` de verdad se
  corren primero las migraciones y recién después se cargan los datos (`docs/runbook-produccion.md`,
  F20).
- **La configuración de Auth** (SMTP, plantillas, hook activado). Vive en `config.toml`, no en la
  base: se restituye con `supabase config push`.
- **La Edge Function.** Vive aparte de la base.

## 3. Cuándo correrla

- **Una vez ahora**, para cerrar TEST-024 en F18, en una ventana en la que nadie use `App_dev`.
- **Otra vez antes de la puesta en marcha (F20)**, cuando `App` ya tenga la carga inicial. Hoy `App`
  tiene el esquema (migraciones 0001 a 0029) y **ningún usuario**: el respaldo de hoy prueba el
  esquema, el cifrado y la secuencia, pero no el hook ni la RLS con datos reales (la sesión simulada
  sale `OMITIDA`, ver sección 7). La prueba que de verdad responde "¿la app funciona sobre un
  respaldo real?" es la de después de la carga inicial.
- **Después, una vez por trimestre** y siempre antes de una migración grande en producción.

**Condición que muchas veces no se cumple y hay que mirar antes: `App_dev` y `App` tienen que
estar en las mismas migraciones.** `App_dev` recibe cada migración apenas se fusiona en `develop`;
`App`, recién en el pase a `main`. Si `develop` tiene una migración nueva que `main` todavía no
tiene, el respaldo de `App` no coincide con `App_dev` y la prueba aborta en el paso 0b (sin tocar
nada). Lo ideal es correrla **justo después de un pase de `develop` a `main`**. Cómo verlo antes de
disparar:

1. Entrá a <https://github.com/extendiendoservicios/extendiendoservicios-app/compare/main...develop>.
2. Mirá la lista de archivos: si no hay ninguno en `supabase/migrations/`, estás en condiciones.

## 4. Antes de empezar

- [ ] **Nadie está usando `App_dev`.** Ni las suites e2e, ni `pnpm db:test`, ni `dev.extendiendoservicios.com`.
      Tampoco fusiones nada a `develop` mientras corre: `deploy-staging.yml` migra `App_dev` al
      fusionar y se pisaría con la prueba.
- [ ] Las migraciones de `App_dev` y de `App` son las mismas (sección 3).
- [ ] Existe un respaldo reciente. Entrá a
      <https://github.com/extendiendoservicios/extendiendoservicios-app/actions/workflows/backup.yml> y mirá que la
      última corrida de **Backup** esté en verde y sea de hoy o de ayer.
- [ ] Tenés a mano el acta (sección 9) y abrís una nota para anotar la hora de inicio.
- [ ] Sabés cómo recuperar `App_dev` después (sección 8) y tenés `.env.local` completo.
- [ ] Si `App` ya tiene usuarios reales: leíste la sección 10.

## 5. Paso a paso, clic por clic

1. Entrá a GitHub con la cuenta `extendiendoservicios` y abrí
   <https://github.com/extendiendoservicios/extendiendoservicios-app/actions/workflows/restore-test.yml>.
2. Arriba a la derecha de la lista de corridas, tocá el botón gris **Run workflow**. Se abre un
   panel.
3. En **Use workflow from** elegí la rama:
   - **`develop`** mientras la versión nueva de la prueba (la que tiene las verificaciones de esta
     guía) no haya llegado a `main`. Se sabe porque en `main` el archivo
     `scripts/restore-from-r2.sh` no tiene la sección `0d`.
   - **`main`** después del primer pase a producción que la incluya.
4. En el primer campo (el título dice _"Escribí exactamente restaurar-app-dev para confirmar…"_)
   escribí exactamente: `restaurar-app-dev`.
5. En el segundo campo (_"Clave del objeto en R2…"_) **dejalo vacío**: usa el respaldo más reciente
   de `diarios/`. Solo si querés uno puntual, pegá su clave, por ejemplo
   `diarios/App_20261003_060012.dump.gpg`. Para ver las claves: <https://dash.cloudflare.com> →
   cuenta `extserviciosapp@gmail.com` → **R2 object storage** → bucket **es-backups** → carpeta
   **diarios**. Los de cada 1º de mes están en **mensuales**.
6. Tocá el botón verde **Run workflow**. Anotá la hora.
7. Esperá unos segundos y refrescá la página: aparece una corrida nueva, **Restore test**, con un
   círculo amarillo. Tocala.
8. Tocá el job **Restaurar un respaldo en App_dev (public + usuarios de auth), verificar y limpiar**
   (a la izquierda). Se abren los pasos.
9. Tocá el paso **Bajar, descifrar, restaurar (public + auth.users/auth.identities), verificar y
   limpiar** para ver el log en vivo. **No canceles la corrida**: si la cortás a mitad, `App_dev`
   puede quedar con datos de producción (sección 7).
10. Cuando termine, volvé a la página de la corrida y tocá **Summary** (arriba a la izquierda): ahí
    está el resumen con tiempos y el resultado de cada comprobación.

## 6. Qué tenés que ver en cada paso del log

| Paso del workflow                              | Qué tenés que ver                                                                                                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Descargar el código**                        | Verde. Solo baja el repositorio.                                                                                                                                                    |
| **Verificar la confirmación**                  | Verde. Si falla con `La confirmación no es exactamente 'restaurar-app-dev'`, no se tocó nada: volvé a disparar y escribilo bien.                                                    |
| **Bajar, descifrar, restaurar…**, al principio | `Respaldo más reciente: diarios/App_….dump.gpg`, `Bajando…`, `Descifrando el volcado (gpg)…` y `gpg: AES256.CFB encrypted data`.                                                    |
| `0a. Contenido del volcado`                    | 14 líneas `[OK]`: datos de usuarios, migraciones, hook, dos triggers, buckets, seis políticas de Storage y `Políticas RLS de public: N en el volcado y en App_dev`.                 |
| `0b. Migraciones`                              | `[OK] App_dev tiene las mismas 29 migraciones que el volcado (la última, 0029)`. (Si ya hay más migraciones, el número cambia.)                                                     |
| `0c. Columnas de auth.users y auth.identities` | Dos líneas `[OK]` (coinciden).                                                                                                                                                      |
| `0d. Estructura y permisos de App_dev antes`   | 19 líneas `[OK]` y `Huella de permisos tomada: 7 componentes.`                                                                                                                      |
| `1/3`, `2/3`, `3/3`                            | Sin errores. Hasta acá la prueba **ya cambió `App_dev`**.                                                                                                                           |
| `4a. Filas por tabla`                          | Una tabla con las filas del volcado y de `App_dev` lado a lado, idénticas, y `[OK] Las 27 tablas tienen exactamente las mismas filas`. Si alguna dice `<-- NO COINCIDE`, falló.     |
| `4b. Integridad referencial y sesión simulada` | `[OK] claves_foraneas_sin_huerfanas`. Después, o bien dos `[OK]` (`hook_arma_roles`, `sesion_simulada_admin`), o bien `[OMITIDA]` si el respaldo no tiene dueños o administradores. |
| `4c. Estructura y permisos otra vez`           | 19 líneas `[OK]` y `[OK] La huella de permisos … es idéntica a la de antes de restaurar`.                                                                                           |
| `Limpiando App_dev`                            | Las tres filas en `0` y `OK: App_dev quedó vacío.`                                                                                                                                  |
| `RESUMEN DE LA PRUEBA DE RESTAURACIÓN`         | Tiempo total, tiempos por etapa y todas las comprobaciones. La última: `[OK] resultado_general`.                                                                                    |
| **Confirmar que App_dev quedó vacío**          | Verde, con `OK: App_dev quedó vacío.` Es una segunda confirmación independiente de la limpieza.                                                                                     |

## 7. Cómo saber si salió bien

Salió bien cuando se cumplen **las cuatro**:

1. La corrida entera está en **verde** (los tres pasos).
2. En **Summary**, `resultado_general` dice `OK` y ninguna fila dice `FALLA`.
3. El paso final dice `OK: App_dev quedó vacío.`
4. `filas_por_tabla_volcado_vs_app_dev` dice que las tablas son idénticas.

Con `App` **sin usuarios** (hoy), lo esperable es:

- `usuarios_de_auth_restaurados`: `auth.users: 0, auth.identities: 0`.
- `sesion_simulada_admin`: `OMITIDA`. No es un error: no hay a quién simular. La prueba que ejercita
  el hook y la RLS sobre datos reales es la de después de la carga inicial (sección 3).

Si algo sale distinto, la tabla de abajo dice qué pasó y qué hacer.

| Lo que ves                                                                    | Qué significa                                                                                              | Qué hacer                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No hay ningún respaldo en diarios/ todavía`                                  | El workflow de respaldo no corrió o falló.                                                                 | Revisá **Backup** en Actions. No se tocó nada.                                                                                                                                                                                                    |
| `gpg: decryption failed: Bad session key`                                     | La frase `BACKUP_PASSPHRASE` de GitHub no es la que se usó para cifrar ese respaldo.                       | Es grave: un respaldo que no se puede descifrar no sirve. No se tocó nada. Avisá y buscá la frase guardada fuera de GitHub (`environments.md` sección 4).                                                                                         |
| `ABORTADO: el volcado no es un respaldo completo`                             | Al respaldo le falta algo de lo que enumera `0a`.                                                          | No se tocó nada. Avisá: hay que revisar `backup-to-r2.sh`.                                                                                                                                                                                        |
| `ABORTADO: App_dev no está en la misma versión de migraciones que el volcado` | `App_dev` y `App` tienen migraciones distintas (sección 3).                                                | No se tocó nada. Esperá al pase a `main` o corré la prueba con un respaldo que coincida. **No fuerces** migraciones en `App`.                                                                                                                     |
| `ABORTADO: auth.users de App_dev no tiene estas columnas`                     | Supabase actualizó el servicio de Auth en un proyecto y no en el otro.                                     | No se tocó nada. Avisá: hay que esperar a que se igualen o restaurar a mano.                                                                                                                                                                      |
| `[FALLA] antes_…`                                                             | `App_dev` no tiene la estructura o los permisos de las migraciones (por ejemplo, un `GRANT` hecho a mano). | No se tocó nada. Avisá con el nombre de la comprobación: alguien cambió `App_dev` por fuera de las migraciones.                                                                                                                                   |
| `ERROR: permission denied for table users` en `2/3`                           | El rol `postgres` de `App_dev` no puede escribir en `auth.users`.                                          | La limpieza deja todo vacío. Corré esta consulta en el SQL Editor de `App_dev` y avisá: `select has_table_privilege('postgres','auth.users','INSERT'), has_table_privilege('postgres','auth.users','DELETE');` (el 19 sep dieron `true` los dos). |
| `ERROR: … violates … constraint` en `3/3`                                     | Una fila del respaldo no cumple una restricción de `App_dev`.                                              | No debería pasar con migraciones iguales. La limpieza deja todo vacío. Avisá con el nombre de la restricción: es un hallazgo real sobre el respaldo.                                                                                              |
| `[FALLA] filas_por_tabla_volcado_vs_app_dev` o `<-- NO COINCIDE`              | Se cargaron filas de menos o de más.                                                                       | Hallazgo real: guardá el log y avisá. La limpieza deja todo vacío.                                                                                                                                                                                |
| `[FALLA] claves_foraneas_sin_huerfanas`                                       | El respaldo tiene filas que apuntan a algo que no existe.                                                  | Hallazgo real sobre los datos de producción. Avisá con el nombre de la tabla.                                                                                                                                                                     |
| `[FALLA] sesion_simulada_admin` o `hook_arma_roles`                           | Con los datos restaurados, la RLS o el hook no se comportan.                                               | Hallazgo real (es justo lo que busca TEST-024). Guardá el log y avisá.                                                                                                                                                                            |
| `[FALLA] huella_de_permisos_igual_a_la_de_antes`                              | Algún paso cambió permisos. No debería poder pasar.                                                        | Hallazgo grave. Avisá con los componentes que cambiaron.                                                                                                                                                                                          |
| `ADVERTENCIA: … App_dev no quedó vacío`, o el paso final en rojo              | La limpieza no terminó. `dev.` **no es seguro**: puede haber hashes de producción en `App_dev`.            | Hacelo ya: corré la limpieza de emergencia (abajo) y después `scripts/restore-from-r2.sh --confirmar-vacio`.                                                                                                                                      |
| Cancelaste la corrida o GitHub la cortó a mitad                               | La limpieza puede no haber corrido.                                                                        | Mismo caso que el anterior: limpieza de emergencia ya mismo.                                                                                                                                                                                      |

**Limpieza de emergencia.** En <https://supabase.com/dashboard/project/anesttvrnpsaaaxaquce/sql/new>
(proyecto `App_dev`, cuenta `extserviciosapp@gmail.com`; verificá que el nombre del proyecto
arriba diga **App_dev** y no **App**), pegá y ejecutá:

```sql
begin;
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table public.%I cascade', r.tablename);
  end loop;
end
$$;
delete from auth.identities;
delete from auth.users;
commit;
```

Después, la recuperación de la sección 8.

## 8. Recuperar App_dev

Después de la prueba `App_dev` tiene la estructura y las migraciones intactas, pero **ningún
usuario ni dato**. Hay que volver a cargar los datos de prueba y las cuentas fijas de las suites.
El script `scripts/recuperar-app-dev.ts` lo hace en orden y valida cada paso (no sigue si un paso
falla).

Desde la raíz de `app/` (`D:\Claude\Extendiendo_Servicios\app`), con `.env.local` completo
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SEED_DEV_PASSWORD`):

```bash
git switch develop && git pull
pnpm install
pnpm db:recuperar-dev
```

Si la CLI de Supabase te pide la contraseña de la base de `App_dev`, es la que guardaste al crear
el proyecto: escribila en la terminal, no la pegues en ningún archivo.

Qué hace, en orden, y qué tenés que ver:

| Paso                      | Qué hace                                                                                                                                           | Qué tenés que ver                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Migraciones            | `supabase db push --dry-run`; aplica las que falten.                                                                                               | `[OK] migraciones`. Después de la prueba no debería faltar ninguna.      |
| 2. Auth                   | Lee `/auth/v1/settings` y comprueba que el proveedor de email esté encendido. **No corre `config push` solo**: puede apagarlo (`environments.md`). | `[OK] auth_proveedor_email`. Si falla, corregilo a mano antes de seguir. |
| 3. Usuarios               | `scripts/seed-dev.ts` crea las 14 cuentas por la Admin API. **La cuenta del dueño (`extserviciosapp@gmail.com`) vuelve con `SEED_DEV_PASSWORD`.**  | `[OK] usuarios_de_auth`: 14 usuarios.                                    |
| 4. Datos                  | Corre `supabase/seed.sql` (empresa, roles, clientes, sedes, servicios, turnos…).                                                                   | `[OK] datos_del_seed`.                                                   |
| 5. Cuentas fijas de P18.1 | Corre el comando que arma las cuentas de las suites e2e. **Todavía no existe** (`tests/fixtures/` no está en `develop`).                           | `[PENDIENTE] fixtures_p18_1`, ver más abajo.                             |
| 6. Validación             | Lectura anónima de la marca, ingreso del dueño (el hook arma el rol `owner`), lectura con RLS, buckets de Storage y que la Edge Function responda. | Cinco líneas `[OK]` y `App_dev quedó utilizable`.                        |

**Paso 5, cuando exista `tests/fixtures/`.** Hay dos formas, a elección:

- pasar el comando en la línea:
  `pnpm db:recuperar-dev --fixtures "<COMANDO_DE_SETUP_DE_FIXTURES_P18_1>"`, o
- completar la constante `COMANDO_FIXTURES_P18_1` al principio de `scripts/recuperar-app-dev.ts`
  y borrar este aviso.

El orden importa: **el seed va antes que las cuentas fijas**, porque `supabase/seed.sql` corta si
encuentra usuarios que no son los suyos (es una salvaguarda contra correrlo en una base con gente
de verdad). Si las cuentas fijas ya existieran, el seed no corre.

Para comprobar a ojo: abrí <https://dev.extendiendoservicios.com> e ingresá con el email del dueño y
`SEED_DEV_PASSWORD`. Opcional: `pnpm db:test` (pgTAP) como prueba de humo extra.

**Qué se pierde con la prueba** (por eso conviene avisar antes): todo lo que hubiera en `App_dev`,
incluidos datos cargados a mano y las cuentas de las suites. Los archivos de Storage (fotos) quedan
pero sin perfil asociado.

## 9. Acta de la prueba

Copiá esta plantilla en un archivo nuevo, `docs/actas/restore-test-AAAA-MM-DD.md`, y completala
con los datos de la pestaña **Summary** y del log. Es lo que TEST-024 pide "documentado".

```markdown
# Acta de la prueba de restauración — AAAA-MM-DD

- **Quién la corrió:** <nombre>
- **Fecha y hora de inicio (Argentina):** <AAAA-MM-DD hh:mm>
- **Corrida de GitHub Actions:** <enlace a la corrida>
- **Rama del workflow:** <develop | main> (commit <hash>)
- **Objeto de R2 restaurado:** <diarios/App_AAAAMMDD_hhmmss.dump.gpg>
- **Tamaño del volcado descifrado:** <bytes, línea volcado_descifrado>
- **Migraciones del volcado y de App_dev:** <N migraciones, la última 00NN>
- **Usuarios de producción restaurados (auth.users):** <N> — ¿había datos reales? <sí | no>

## Tiempos

| Etapa                                           | Segundos |
| ----------------------------------------------- | -------: |
| Bajar el respaldo de R2                         |          |
| Descifrar el volcado                            |          |
| Paso 0: comprobaciones previas                  |          |
| Paso 1: vaciar public                           |          |
| Paso 2: reemplazar auth.users y auth.identities |          |
| Paso 3: cargar los datos de public              |          |
| Paso 4: verificación                            |          |
| Limpieza de App_dev                             |          |
| **Total**                                       |          |

## Resultado de cada verificación

| Comprobación                                   | Resultado esperado                           | Resultado real | Observaciones |
| ---------------------------------------------- | -------------------------------------------- | -------------- | ------------- |
| volcado_es_un_respaldo_completo                | OK (13 elementos)                            |                |               |
| politicas_rls_public_volcado_vs_app_dev        | OK (mismas políticas)                        |                |               |
| migraciones_volcado_vs_app_dev                 | OK                                           |                |               |
| columnas_auth_users / columnas_auth_identities | OK                                           |                |               |
| antes_estructura_y_permisos                    | OK (19 comprobaciones)                       |                |               |
| filas_por_tabla_volcado_vs_app_dev             | OK (27 tablas idénticas; total de filas: __) |                |               |
| claves_foraneas_sin_huerfanas                  | OK (75 claves)                               |                |               |
| hook_arma_roles                                | OK, u OMITIDA si no hay dueños               |                |               |
| sesion_simulada_admin                          | OK, u OMITIDA si no hay dueños               |                |               |
| despues_estructura_y_permisos                  | OK (19 comprobaciones)                       |                |               |
| huella_de_permisos_igual_a_la_de_antes         | OK                                           |                |               |
| limpieza_app_dev_vacio                         | OK                                           |                |               |
| Paso final "Confirmar que App_dev quedó vacío" | OK                                           |                |               |
| resultado_general                              | OK                                           |                |               |

## Recuperación de App_dev

- Hora de inicio y de fin de `pnpm db:recuperar-dev`: <hh:mm – hh:mm>
- Resultado de cada paso (migraciones, Auth, usuarios, datos, cuentas fijas, validación): <OK / …>
- Ingreso al staging comprobado a mano: <sí | no>

## Hallazgos y acciones

<Qué falló o sorprendió, qué se hizo, qué queda pendiente. "Ninguno" si todo salió como se esperaba.>

## Conclusión

<La restauración funcionó | funcionó con observaciones | falló>. Próxima prueba: <fecha o hito>.
```

## 10. Datos personales y hashes de contraseña

Mientras dura la prueba, `App_dev` contiene los datos de producción tal como están en el
respaldo, **incluidos los hashes de contraseña de cada usuario** (`auth.users`). Hoy `App` no
tiene usuarios, así que no hay nada personal; **desde que F20 cargue a la gente real, sí lo
habrá**. Es una decisión de Mike (19 sep 2026) y ya tiene estas protecciones:

- El respaldo viaja cifrado (AES256) y el volcado descifrado vive solo en el runner de GitHub,
  que se descarta al terminar; el script borra el directorio temporal.
- Los logs **no imprimen datos**: solo cantidades y nombres de objetos de la base.
- La limpieza corre siempre, y el workflow la confirma por separado.

Lo que queda y hay que tener presente:

- Durante la corrida (1 a 5 minutos) cualquiera que conozca la contraseña de producción de una
  persona podría ingresar a `dev.extendiendoservicios.com` con ella. Por eso se corre en una
  ventana sin uso y no se hacen otras cosas en `App_dev` en ese rato.
- No dispares un "olvidé mi contraseña" en `dev.` durante la corrida: el email de Auth de
  `App_dev` le llegaría a una persona real.
- Si la corrida se corta y `App_dev` queda con datos, la limpieza de emergencia (sección 7) es
  urgente, no pendiente.

## 11. Ensayo local, para ensayar cambios sin tocar App_dev

`scripts/ensayo-restauracion-local.sh` repite todo esto en Docker, con un Supabase local propio
(`project_id` y puertos propios: no choca con `supabase start` ni con `pnpm db:test`), un R2
simulado y datos de muestra, sin ninguna credencial:

```bash
bash scripts/ensayo-restauracion-local.sh            # completo, unos 5 minutos
bash scripts/ensayo-restauracion-local.sh --rapido   # sin los casos que tienen que fallar
```

Hay que correrlo cada vez que se cambie `restore-from-r2.sh`, `backup-to-r2.sh`, los `.sql` de
`scripts/lib/` o `recuperar-app-dev.ts`. Al terminar baja los contenedores que levantó.

**Resultado del 3 de octubre de 2026** (29 migraciones, 14 usuarios, 5.526 filas, 25 tablas de
`public` y 75 claves foráneas):

- Respaldo con `backup-to-r2.sh` y restauración con `restore-from-r2.sh --ultimo`: todas las
  comprobaciones en `OK`, 27 tablas idénticas al volcado, 20 segundos en total.
- La huella de permisos (tablas, columnas, funciones, esquemas, privilegios por defecto, políticas
  y triggers) quedó **idéntica a la de una base recién migrada**: no queda el `GRANT ALL` por
  defecto de Supabase.
- Con un `GRANT ALL` a `anon` puesto a mano, la restauración aborta en `0d` sin tocar nada.
- Con una restricción que rechaza filas, la carga falla en `3/3` y la limpieza deja todo en cero.
- Si un error de SQL rompe una verificación (por ejemplo, la sesión simulada), se informa como `FALLA`
  y no como "sin fallas"; la limpieza igual deja todo en cero.
- `recuperar-app-dev.ts --local` dejó la base utilizable: ingreso del dueño con el hook de Auth.

Lo que el ensayo **no** puede probar: la red real (R2, el Session pooler de Supabase), el cliente
de PostgreSQL que instala el runner (es el mismo 17.11) y los permisos reales del rol `postgres`
de `App_dev` sobre `auth` (se confirmaron el 19 sep con `has_table_privilege`). Eso lo prueba la
primera corrida real, por eso existe el acta.
