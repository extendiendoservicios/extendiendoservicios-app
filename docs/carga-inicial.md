# Carga inicial de datos

Procedimiento para pasar a la plataforma los datos reales de la empresa (clientes, sedes,
personal, servicios, feriados y criterios) desde la planilla
[`plantilla-carga-inicial.xlsx`](plantilla-carga-inicial.xlsx), con el importador
`scripts/import-initial.ts` (DATA-003, DATA-004, DATA-005, DATA-010; F19). Lo usan el
orquestador y Mike. La empresa solo completa la planilla.

Contenido: [1. Qué hace el importador](#1-qué-hace-el-importador) ·
[2. Antes de empezar](#2-antes-de-empezar) · [3. Paso a paso](#3-paso-a-paso) ·
[4. Cómo leer el informe](#4-cómo-leer-el-informe) · [5. Cómo reintentar](#5-cómo-reintentar-con---resume) ·
[6. Reglas que aplica](#6-reglas-que-aplica-el-importador) ·
[7. Cómo se vincula cada hoja con el cliente](#7-cómo-se-vincula-cada-hoja-con-el-cliente) ·
[8. Después de la carga](#8-después-de-la-carga) · [9. Producción (F20)](#9-producción-f20) ·
[10. Tests](#10-tests) · [11. Códigos de incidencia](#11-códigos-de-incidencia)

## 1. Qué hace el importador

1. Lee el Excel tal cual lo devuelve la empresa (no hace falta limpiarlo ni cambiarle columnas).
2. Valida **toda** la planilla, sin conectarse a la base, y escribe un informe con cada
   problema: hoja, fila de Excel, columna y qué pasa, en español.
3. Si hay **al menos un error**, no escribe nada. Las advertencias no frenan la carga.
4. Si no hay errores, carga en este orden: clientes, contactos, sedes, empleados y
   supervisores (con su usuario), habilitaciones, servicios, feriados y criterios.

Fuera de alcance: la hoja de disponibilidad no existe en la planilla (cada persona la declara
desde la aplicación) y las licencias tampoco se cargan.

Las filas de ejemplo de la plantilla (las que dicen "Ejemplo", o tienen el fondo amarillo arriba
del renglón "Borrá la fila de ejemplo...") se ignoran y quedan en el informe como "filas
ignoradas" con su número, para que se vea qué se descartó.

## 2. Antes de empezar

- **El archivo real tiene datos personales (DNI, CUIL, teléfonos, domicilios) y este repositorio
  es público.** La planilla de la empresa, sus copias y los informes que se generen a partir de
  ella viven **fuera** del repositorio (hoy: `Docs/carga_inicial/`). Nunca en un commit, un
  issue, un PR ni un mensaje. Por defecto, el importador escribe los informes en
  `informes-importacion/` (dentro de `app/`, ignorada por git); con una planilla real usá siempre
  `--salida` con una carpeta de afuera.
- Los informes pueden incluir datos del archivo (por ejemplo, un CUIT repetido): tratalos como
  confidenciales. En la consola el importador imprime solo cantidades, nunca esos mensajes.
- Para **validar** no hace falta nada más (ni `.env.local` ni conexión).
- Para **escribir** (o para consultar la base) hacen falta, en `app/.env.local` o en el entorno:
  - `IMPORT_ENTORNO`: `app_dev` (staging y ensayos) o `app` (producción, solo F20). No tiene valor
    por defecto a propósito.
  - `VITE_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del proyecto elegido. La clave de servicio
    vive solo en `.env.local`, que git ignora.
- El importador verifica el proyecto **antes de escribir**: la URL tiene que ser la del entorno
  elegido (`App_dev`: `anesttvrnpsaaaxaquce`; `App`: `fysuppdadwvabrjpnnoh`) y, si la clave es un
  JWT, su `ref` también. Se niega a correr contra `App` salvo con `--permitir-produccion-f20`.
- No corras una carga mientras corre el workflow nocturno de e2e (4:30 hora de Argentina): usa
  `App_dev`.

## 3. Paso a paso

Todos los comandos, desde la raíz de `app/`. Reemplazá las rutas por las tuyas. Los ejemplos
usan la sintaxis de Git Bash (`IMPORT_ENTORNO=app_dev pnpm ...`); en PowerShell, definí antes la
variable con `$env:IMPORT_ENTORNO = 'app_dev'`.

### Paso 1. Validar la planilla (sin tocar la base)

```bash
pnpm import:initial "D:/ruta/fuera/del/repo/planilla.xlsx" --dry-run --salida "D:/ruta/fuera/del/repo/carga_inicial"
```

Sirve con cualquier archivo, las veces que haga falta. Termina con código 0 si no hay errores y
con 1 si los hay. Escribe tres archivos en la carpeta de salida:

- `informe-validacion-AAAAMMDD-HHMMSS.txt`: el informe completo, para leer.
- `informe-validacion-AAAAMMDD-HHMMSS.xlsx`: lo mismo en Excel (hojas Resumen, Errores,
  Advertencias e Ignoradas, con filtro) para pasárselo a la empresa y que lo recorra.
- `informe-validacion-AAAAMMDD-HHMMSS.json`: para uso interno.

### Paso 2. Corregir con la empresa

Se les pasa el Excel de errores. Cada fila dice en qué hoja, en qué fila de **su** planilla y en
qué columna está el problema. Cuando devuelven la planilla corregida, se repite el Paso 1 hasta
que no queden errores. Las advertencias se revisan (ver la sección 4) pero no hay que
eliminarlas.

### Paso 3. (Opcional) Ver qué hay ya en la base de destino

```bash
IMPORT_ENTORNO=app_dev pnpm import:initial "D:/ruta/planilla.xlsx" --dry-run --consultar-base --salida "D:/ruta/carga_inicial"
```

Además de validar, lee la base (sin escribir) y avisa qué de la planilla ya está cargado. Sirve
para decidir si corresponde una carga nueva o un reintento.

### Paso 4. Cargar

```bash
IMPORT_ENTORNO=app_dev pnpm import:initial "D:/ruta/planilla.xlsx" --salida "D:/ruta/carga_inicial"
```

1. Vuelve a validar. Si hay errores, corta sin escribir (código 1).
2. Verifica el entorno de destino y lee lo que ya existe. Si la base **ya tiene algo** de esta
   planilla, corta sin escribir y lo dice: es probable que sea un reintento (sección 5).
3. Carga paso por paso y, al final, escribe `informe-carga-AAAAMMDD-HHMMSS.txt` con cuántos
   registros se crearon, cuántos ya existían y cuáles fallaron.

Códigos de salida: `0` todo bien · `1` la planilla tiene errores o la base ya tiene datos (no se
escribió nada) · `2` mal uso o entorno mal configurado (no se escribió nada) · `3` la carga empezó
y tuvo fallas o se interrumpió.

Ayuda de todas las opciones: `pnpm import:initial --ayuda`.

## 4. Cómo leer el informe

El informe tiene cuatro partes:

1. **Resultado y cantidades.** Dice si se puede cargar y cuánto se cargaría de cada cosa (por
   ejemplo, cuántas sedes `Principal` se crearían solas).
2. **Errores.** Frenan todo. Cada línea: `fila N, columna "X": qué pasa`. La fila es el número que
   se ve en el margen de Excel. Están ordenados por hoja y fila.
3. **Advertencias.** No frenan. Son avisos de que algo se ve raro (un dígito verificador, una
   razón social repetida, un cliente sin sede...). Se carga igual; conviene revisarlas con la
   empresa, sobre todo las de dígito verificador y las de clientes sin sede.
4. **Filas ignoradas.** Los ejemplos de la plantilla. Si aparece una fila que no es un ejemplo,
   es porque dice "Ejemplo" en alguna celda o conserva el fondo amarillo: se le saca y se
   vuelve a validar.

La regla de la plantilla, que también rige acá: **se bloquea solo donde Postgres rechazaría la
fila** (un CUIT de largo distinto de 11, un CUIT o DNI repetido, un día sin marcar en un servicio)
**y se avisa donde la regla es una ayuda nuestra** (dígito verificador de CUIT/CUIL, DNI de largo
raro, coordenadas fuera de rango). Hay tres excepciones que son errores aunque la base no las
rechace, porque sin distinguirlas no se podría reintentar la carga: dos contactos con el mismo
nombre en el mismo cliente, dos servicios con el mismo nombre en la misma sede y dos criterios con
el mismo título.

## 5. Cómo reintentar con `--resume`

```bash
IMPORT_ENTORNO=app_dev pnpm import:initial "D:/ruta/planilla.xlsx" --resume --salida "D:/ruta/carga_inicial"
```

Sirve cuando una carga se cortó o tuvo fallas, y cuando la empresa agrega filas a una planilla ya
cargada. El importador **omite lo que ya está** (lo reconoce por su clave natural, nunca por
un id) y carga solo lo que falta. Se puede repetir sin riesgo de duplicar.

| Qué                        | Cómo se reconoce que ya está cargado                               |
| -------------------------- | ------------------------------------------------------------------ |
| Cliente                    | CUIT; si no tiene CUIT, razón social (entre los clientes sin CUIT) |
| Contacto                   | Cliente + nombre                                                   |
| Sede                       | Cliente + nombre                                                   |
| Persona (empleado/superv.) | DNI. Si ya existe, solo se agregan los roles que falten            |
| Habilitación               | Persona + cliente                                                  |
| Servicio                   | Sede + nombre                                                      |
| Feriado                    | Fecha                                                              |
| Criterio                   | Título                                                             |

Detalles:

- Sin `--resume`, si algo de la planilla ya está en la base, el importador corta **antes de
  escribir**. Es a propósito: evita duplicar o pisar datos por un doble clic.
- Un dato ya cargado **no se actualiza**: si la empresa corrige, por ejemplo, la dirección de un
  cliente ya cargado, se corrige desde la aplicación (el importador omite esa fila). Para los
  feriados, `--resume` también sirve cuando la base ya trae feriados de otra fuente.
- Si una corrida se cortó entre crear la cuenta de acceso de una persona y guardar sus datos, el
  reintento retoma esa cuenta (no la duplica). Si el email ya pertenece a otro empleado, esa
  persona queda como falla en el informe.
- La sede `Principal` automática solo se crea si el cliente no tiene ninguna sede en la base.

## 6. Reglas que aplica el importador

| Tema                              | Regla                                                                                                                                                                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email de empleados y supervisores | **Obligatorio.** La fila sin email (o con uno mal escrito) es un error. Tiene que ser propio de cada persona: un email usado por dos DNI distintos es error.                                                                                                                           |
| CUIT del cliente                  | Opcional. Si está, tiene que tener 11 dígitos (error si no) y no repetirse (error). Dígito verificador incorrecto: advertencia. Se aceptan guiones y puntos (se quitan, con aviso). Si el cliente no tiene CUIT, la celda va **vacía** (no sirve escribir "sin CUIT" ni "en trámite"). |
| DNI                               | Solo dígitos (error si no); repetido en la misma hoja es error; de largo fuera de 6 a 9 es advertencia. El mismo DNI en Empleados y Supervisores es una sola persona con los dos roles (el email tiene que coincidir).                                                                 |
| CUIL                              | Opcional. 11 dígitos (error si no); verificador incorrecto: advertencia.                                                                                                                                                                                                               |
| Sede automática                   | Un cliente sin filas en Sedes y **con** dirección administrativa recibe una sede `Principal` con esa dirección (activa, sin coordenadas). Sin dirección no se crea sede y queda una advertencia.                                                                                       |
| Razón social repetida             | Dos clientes sin CUIT con la misma razón social: error. Si alguno tiene CUIT: advertencia (en las otras hojas se los vincula por CUIT).                                                                                                                                                |
| Sedes                             | Nombre único dentro del cliente (error si se repite).                                                                                                                                                                                                                                  |
| Contactos                         | A lo sumo un contacto principal por cliente (error si hay más de uno).                                                                                                                                                                                                                 |
| Servicios                         | Al menos un día en "Sí"; hora de fin posterior a la de inicio (no cruza la medianoche); dotación de 1 a 10; la sede tiene que figurar para ese cliente (la `Principal` automática sirve).                                                                                              |
| Estados                           | Vacío = Activo/Activa. Cualquier valor fuera de la lista es error.                                                                                                                                                                                                                     |
| Personas de Baja                  | Se cargan con estado Baja, pero **su cuenta queda habilitada**: advertencia para desactivarla desde Usuarios.                                                                                                                                                                          |
| Coordenadas                       | Fuera de rango (latitud ±90, longitud ±180) o incompletas: advertencia; la fila se carga sin coordenadas.                                                                                                                                                                              |
| Habilitaciones                    | El DNI tiene que estar en Empleados o Supervisores y el cliente en Clientes. Filas repetidas: advertencia, se carga una.                                                                                                                                                               |
| Feriados                          | Una fila por fecha (error si se repite).                                                                                                                                                                                                                                               |
| Criterios                         | Orden de 1 a 99; título único (error si se repite); orden repetido: advertencia. Sin fecha de inicio, rige desde hoy.                                                                                                                                                                  |
| Legajo                            | Opcional; si está, es único (error si se repite). En blanco, lo asigna el sistema.                                                                                                                                                                                                     |

## 7. Cómo se vincula cada hoja con el cliente

En las hojas Contactos, Sedes, Servicios y Habilitaciones, la columna **"CUIT del cliente"**
(en Habilitaciones, "CUIT del cliente habilitado") acepta dos formas:

- el **CUIT** del cliente (solo números, como en Clientes; se toleran guiones y puntos), o
- la **razón social exacta** del cliente, escrita igual que en la hoja Clientes (no importan las
  mayúsculas ni los espacios de más). Es lo que se usa para los clientes sin CUIT.

Cómo decide: si lo escrito son solo números, es un CUIT y tiene que existir. Si no, es una razón
social. Si la razón social corresponde a un solo cliente, listo. Si corresponde a varios y
uno solo no tiene CUIT, se elige ese. Si siguen quedando varios, es un error de referencia
ambigua: hay que usar el CUIT.

**Atención con la plantilla de Excel:** esas columnas llevan hoy una validación de Excel que solo
deja escribir 11 dígitos, así que Excel rechaza escribir una razón social a mano. Mientras la
plantilla no se actualice, la empresa puede **pegar** el texto (Excel no valida lo que se
pega) o se completa esa columna por otro medio. Hay una propuesta de cambio de la
plantilla pendiente de decisión de Mike.

Las sedes y los servicios se vinculan por el **nombre de la sede** dentro de ese cliente.

## 8. Después de la carga

- **Contraseñas.** Las cuentas se crean **sin contraseña**: nadie puede iniciar sesión todavía.
  Las contraseñas iniciales las asigna un paso aparte, DATA-008 (P19.3, pendiente de
  confirmación). El importador deja el punto de extensión (`contrasenaInicial` en
  `scripts/import-initial/cargar.ts`). Nunca se escriben en el repositorio ni en los logs.
- **Misma lógica que `create_user`.** Cada persona se crea como lo hace la Edge Function
  `admin-users` (`06_API.md` sección 2.1): cuenta de Auth con el email confirmado y nombre y
  apellido, fila de empleado, roles y el evento `user_created` en el registro de seguridad. Las
  diferencias: no hay una persona que actúa (`created_by` queda vacío) y la cuenta nace sin
  contraseña. El teléfono se guarda en el perfil.
- **Verificar** en la aplicación: la cantidad de clientes, sedes y personal contra el informe de
  carga; revisar las sedes `Principal` creadas solas (la empresa puede renombrarlas o completar
  sus datos) y los clientes sin sede.
- **Legajos.** Si la planilla trae legajos, se guardan tal cual, pero la secuencia que asigna el
  legajo automático **no avanza sola**: después de cargar legajos manuales hay que ajustarla para
  que un empleado nuevo creado desde la aplicación no choque con uno cargado. Hoy el importador no
  puede hacerlo (necesita una función en la base): se consulta antes de la carga en producción.
- **Datos de prueba ficticios** que se hayan cargado en `App_dev` para ensayar se barren aparte
  (lo que carga la prueba automática, con el prefijo `imp-test-`, se barre solo). No hay un
  script de barrido de datos reales: no se borra nada sin indicación expresa de Mike.

## 9. Producción (F20)

No se usa antes de F20 y solo por encargo explícito. Hace falta `IMPORT_ENTORNO=app`, la URL y la
clave de servicio de `App` y la bandera `--permitir-produccion-f20`. Siempre con un volcado previo
de la base y, antes, la misma planilla ensayada sin errores en `App_dev`. El importador verifica
el ref del proyecto antes de escribir.

## 10. Tests

- **Unitarios** (corren en `pnpm test`, sin base ni credenciales): `scripts/import-initial/*.test.ts`.
  Leen planillas ficticias armadas en el propio test y cubren cada regla de la sección 6, la
  lectura de la plantilla oficial y la elección del entorno.
- **Integración contra `App_dev`** (`pnpm test:import`, a mano; no corre en CI): carga datos
  ficticios con el prefijo `imp-test-` (un cliente sin CUIT vinculado por razón social, sede
  automática, una persona con los dos roles...), comprueba el contenido en la base, repite la
  carga sin y con `--resume`, simula una carga cortada y verifica que una planilla con un error
  no escribe nada. Al terminar (y al empezar) barre todo lo que lleva el prefijo, incluidas las
  cuentas de Auth, sin tocar nada más.

Archivos del importador:

| Archivo                                     | Qué hace                                                         |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `scripts/import-initial.ts`                 | Punto de entrada (`pnpm import:initial`).                        |
| `scripts/import-initial/ejecutar.ts`        | Flujo completo y códigos de salida.                              |
| `scripts/import-initial/leer-plantilla.ts`  | Lee el Excel con `exceljs`; ubica hojas, encabezados y ejemplos. |
| `scripts/import-initial/esquema.ts`         | Hojas y columnas de la plantilla.                                |
| `scripts/import-initial/validar.ts`         | Todas las reglas; arma el plan y las incidencias.                |
| `scripts/import-initial/cargar.ts`          | Escribe en la base; reintento por clave natural.                 |
| `scripts/import-initial/entorno.ts`         | Elección y verificación del destino.                             |
| `scripts/import-initial/informe.ts`         | Informes (texto, Excel, JSON).                                   |
| `scripts/import-initial/compat-openpyxl.ts` | Permite abrir la plantilla original (generada con openpyxl).     |

## 11. Códigos de incidencia

Aparecen en el JSON del informe y en las pruebas. **E** = error, **A** = advertencia.

| Código                                                        | Nivel | Qué significa y qué hacer                                                                       |
| ------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| `ARCHIVO_ILEGIBLE`, `SIN_HOJAS`                               | E     | El archivo no se abre como Excel o no tiene las hojas de la plantilla.                          |
| `HOJA_FALTA`                                                  | A     | No está la hoja: se toma como vacía.                                                            |
| `ENCABEZADOS_NO_ENCONTRADOS`, `COLUMNA_FALTA`                 | E / A | Cambiaron los títulos de las columnas. Usar la plantilla original (falta una opcional = aviso). |
| `FILA_DE_EJEMPLO`                                             | -     | Fila de ejemplo ignorada.                                                                       |
| `FALTA_DATO`                                                  | E     | Falta un dato obligatorio.                                                                      |
| `FECHA_INVALIDA`, `HORA_INVALIDA`                             | E     | Escribir DD/MM/AAAA y HH:MM.                                                                    |
| `SI_NO_INVALIDO`, `OPCION_INVALIDA`                           | E     | Elegir un valor de la lista desplegable.                                                        |
| `NUMERO_INVALIDO`, `NUMERO_FUERA_DE_RANGO`                    | E     | Número mal escrito o fuera de rango (dotación 1 a 10, orden 1 a 99...).                         |
| `NUMERO_NEGATIVO`, `HORAS_INVERTIDAS`, `VIGENCIA_INVERTIDA`   | A     | Dato raro; se carga igual (o sin ese dato).                                                     |
| `COORDENADA_FUERA_DE_RANGO`, `COORDENADA_INCOMPLETA`          | A     | Se carga sin coordenadas.                                                                       |
| `CUIT_FORMATO`, `CUIT_LARGO`, `CUIL_FORMATO`, `CUIL_LARGO`    | E     | No tiene 11 dígitos numéricos. Si no lo tiene, dejar la celda vacía.                            |
| `CUIT_LIMPIADO`, `CUIL_LIMPIADO`, `DNI_LIMPIADO`              | A     | Se quitaron puntos, guiones o espacios.                                                         |
| `CUIT_VERIFICADOR`, `CUIL_VERIFICADOR`                        | A     | Dígito verificador incorrecto: posible error de tipeo. Revisar con la empresa.                  |
| `CUIT_REPETIDO`, `DNI_REPETIDO`, `LEGAJO_REPETIDO`            | E     | Repetido: la base no lo admite.                                                                 |
| `CLIENTE_SIN_CUIT_REPETIDO`                                   | E     | Dos clientes sin CUIT con la misma razón social.                                                |
| `RAZON_SOCIAL_REPETIDA`                                       | A     | Misma razón social con CUIT distinto o ausente.                                                 |
| `CLIENTE_NO_ENCONTRADO`, `CLIENTE_AMBIGUO`                    | E     | La referencia al cliente no existe en Clientes o corresponde a más de uno.                      |
| `CLIENTE_SIN_SEDE`                                            | A     | Sin sedes ni dirección: se carga sin sede.                                                      |
| `SEDE_REPETIDA`, `SEDE_NO_ENCONTRADA`                         | E     | Sede duplicada en el cliente, o un servicio apunta a una sede que no existe.                    |
| `CONTACTO_PRINCIPAL_REPETIDO`, `CONTACTO_REPETIDO`            | E     | Más de un principal, o dos contactos con el mismo nombre en el cliente.                         |
| `EMAIL_CONTACTO`                                              | A     | El email del contacto no parece válido.                                                         |
| `SERVICIO_SIN_DIAS`, `HORA_FIN_ANTERIOR`, `SERVICIO_REPETIDO` | E     | Ningún día marcado; fin no posterior al inicio; servicio duplicado en la sede.                  |
| `EMAIL_FALTA`, `EMAIL_INVALIDO`, `EMAIL_REPETIDO`             | E     | Falta, está mal escrito o lo usan dos personas distintas.                                       |
| `EMAIL_DISTINTO_ENTRE_HOJAS`                                  | E     | La misma persona (mismo DNI) tiene emails distintos en Empleados y Supervisores.                |
| `NOMBRE_DISTINTO_ENTRE_HOJAS`                                 | A     | Distinto nombre para el mismo DNI: se usa el de la primera hoja.                                |
| `DNI_FORMATO`                                                 | E     | El DNI tiene letras u otros caracteres.                                                         |
| `DNI_LARGO`                                                   | A     | DNI de largo poco habitual.                                                                     |
| `DNI_NO_ENCONTRADO`                                           | E     | La habilitación apunta a un DNI que no está en el personal.                                     |
| `PERSONA_DE_BAJA`                                             | A     | Se carga de Baja con la cuenta habilitada: desactivarla desde Usuarios.                         |
| `HABILITACION_REPETIDA`                                       | A     | Fila repetida: se carga una sola.                                                               |
| `FERIADO_REPETIDO`, `CRITERIO_REPETIDO`                       | E     | Fecha o título repetido.                                                                        |
| `ORDEN_REPETIDO`                                              | A     | Dos criterios con el mismo orden.                                                               |
