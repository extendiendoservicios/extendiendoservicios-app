# Guion de la prueba de aceptación (UAT)

DEPLOY-001 (F19). Prueba de aceptación de la Plataforma Base de Extendiendo Servicios con la referente de la empresa.

**Para qué sirve este guion:** que la referente recorra, paso a paso, los flujos de la V3 punto 1 en el entorno de pruebas, y que quede registrado qué funcionó, qué falló y qué observaciones hay, separando lo que corresponde a la Base de lo que sería una ampliación (V3 punto 7).

**Cómo está armado:**

1. [Preparación (para quien organiza la sesión)](#1-preparación-para-quien-organiza-la-sesión)
2. [Cómo se usa este guion](#2-cómo-se-usa-este-guion)
3. [Orden recomendado de la sesión](#3-orden-recomendado-de-la-sesión)
4. [Escenarios](#4-escenarios): dueño, administración, empleado, supervisor y transversales
5. [Acta de la sesión](#5-acta-de-la-sesión)

---

## 1. Preparación (para quien organiza la sesión)

Esta sección no la lee la referente. La completa **quien organiza la sesión** (el orquestador o Mike) **antes** del día de la prueba. Nada de esto lleva contraseñas escritas: las contraseñas se entregan por un canal seguro y no se anotan en este documento.

### 1.1. Entorno

- La prueba se hace en el **entorno de pruebas** (`https://dev.extendiendoservicios.com`, base `App_dev`), con el cartel amarillo "Entorno de prueba: los datos de esta versión no son reales". Lo que se carga ahí **no pasa a producción**.
- **Verificar el día anterior** que el entorno responde: ingresar con una cuenta y abrir el Resumen. Si dice "No pudimos iniciar sesión" o "No pudimos cargar...", el proyecto puede estar pausado: ver [`troubleshooting.md`](../troubleshooting.md#43-la-versión-de-pruebas-staging-no-responde-app_dev-pausado).
- Confirmar que llegan los **correos** de recuperación de contraseña (escenario UAT-TRA-01): mandarse uno a una casilla propia.

### 1.2. Cuentas que tienen que estar listas

| Cuenta                                  | Cuántas           | Para qué                                                                                                             |
| --------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Dueño                                   | 1                 | Escenarios UAT-DUE                                                                                                   |
| Administrador con los 7 permisos        | 1                 | Casi todos los escenarios de administración (**Administrador 1**)                                                    |
| Administrador con los 7 permisos        | 1                 | Para quitarle un permiso y probar que no puede (UAT-DUE-02 y UAT-ADM-02) (**Administrador 2**)                       |
| Supervisor o supervisora                | 1 (2 si se puede) | Escenarios UAT-SUP. Una segunda sirve para comprobar que cada una ve solo lo suyo                                    |
| Empleado o empleada                     | 2                 | **Empleado A** hace toda la jornada de prueba; **Empleado B** prueba el inicio sin ubicación y "registrar en nombre" |
| Empleado B (opcional) y una persona más | 1                 | Para dar de baja y resetear contraseña (UAT-ADM-22 y UAT-ADM-23): puede ser una cuenta creada en la propia sesión    |

**Importante, los emails:** la planilla que devolvió la empresa trae los empleados y supervisores **sin email**, y sin email no se puede crear el usuario. Antes de la sesión hay que **pedir a la empresa un email de login** para, como mínimo, el Empleado A, el Empleado B y la supervisora, o usar casillas de prueba que el organizador controle. Los administradores y el dueño también necesitan email.

Cada persona tiene que poder **recibir correo** en ese email (para probar la recuperación de contraseña) y **entrar con su celular** (empleados y supervisora).

### 1.3. Teléfonos y equipos

- **Una computadora** con Chrome o Edge para administración (la referente y el dueño).
- **Dos celulares** para la jornada: uno para el Empleado A y otro para la supervisora. Si se puede, un **Android con Chrome** y un **iPhone con Safari (iOS 16.4 o más nuevo)**, para ver las dos formas de instalación (UAT-TRA-04).
- Un **tercer celular** (o el mismo de la referente) para probar la administración desde el celular (UAT-ADM-20) y, si hay un Empleado B, para él.
- **Internet** en todos (wifi o datos móviles). Para UAT-TRA-03 hace falta poder poner el celular en modo avión.
- **Ubicación activada** en los celulares de empleados y supervisora, para probar el registro con ubicación.
- La sesión conviene hacerla **de día y en horario laboral**: los escenarios de la jornada usan turnos de hoy.

### 1.4. Datos que tienen que estar cargados

La empresa devolvió la planilla con **clientes**, **empleados** y **supervisores**, pero **sin sedes ni servicios**. Por eso:

- **Antes de la sesión (importación):** los clientes, con su CUIT y, si los mandó, sus contactos. Los empleados y supervisores solo si ya hay un email para cada uno; si no, se crean en la sesión (UAT-ADM-07 y UAT-ADM-08).
- **Durante la sesión (por pantalla):** las sedes, los servicios, las tareas, los turnos y las asignaciones. Los escenarios del bloque B (UAT-ADM-04 a UAT-ADM-10) los cargan **a mano**, con los datos de la tabla siguiente.
- Los **criterios de calificación definitivos** de la empresa, el **teléfono de soporte** y el **texto de consentimiento de ubicación**: si la empresa ya los mandó, tenerlos escritos aparte para cargarlos en UAT-DUE-03 y UAT-DUE-04.

### 1.5. Datos de la sesión (completar a mano antes de empezar)

Esta tabla se llena **en la copia impresa o en la copia de trabajo**, nunca en el archivo del repositorio: los nombres reales de clientes y de personas no se guardan en el repositorio.

| Dato                                                                      | Valor                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Dirección de la plataforma de prueba                                      | `https://dev.extendiendoservicios.com`                              |
| **Cliente de prueba** (uno de los ya cargados)                            |                                                                     |
| **Sede de prueba**: nombre, dirección y localidad                         |                                                                     |
| **Servicio de prueba**: nombre, días, desde y hasta, dotación (de 1 a 10) |                                                                     |
| **Plantilla de tareas** del cliente (4 o 5 tareas)                        |                                                                     |
| **Empleado A**: nombre y email de login                                   |                                                                     |
| **Empleado B**: nombre y email de login                                   |                                                                     |
| **Supervisora**: nombre y email de login                                  |                                                                     |
| **Administrador 1** y **Administrador 2**: nombre y email                 |                                                                     |
| **Dueño**: nombre y email                                                 |                                                                     |
| Contraseñas iniciales                                                     | Las entrega el organizador por un canal seguro. No se escriben acá. |

### 1.6. El mismo día, antes de arrancar

- Todas las cuentas ingresan una vez (que no sea la primera vez la de la sesión).
- La referente tiene a mano este guion impreso, o abierto en una pantalla aparte.
- Alguien (el organizador) **anota las observaciones en voz alta** mientras la referente recorre: ella se concentra en usar la plataforma.
- Se acuerda de antemano cuánto tiempo se dedica: ver la tabla de la sección 3.

---

## 2. Cómo se usa este guion

### 2.1. Cada escenario

Cada escenario tiene:

- Un **código** que no cambia (por ejemplo **UAT-EMP-07**): sirve para hablar del escenario sin confundirse.
- El **rol** que lo ejecuta y **dónde** (computadora o celular).
- Si es **Imprescindible** (hay que hacerlo) u **Opcional** (si da el tiempo).
- Lo que tiene que estar listo antes (**Precondición**).
- Los **pasos**, numerados. Se hacen en orden.
- El **resultado esperado**: lo que tendrías que ver si todo está bien.
- Una **tabla para completar** al terminar.

Los nombres entre comillas o en **negrita** (por ejemplo **Registrar inicio**) son los que dicen los botones y las pantallas.

### 2.2. Cómo se completa la tabla de cada escenario

| Columna           | Qué se marca                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resultado**     | **OK:** pasó lo que dice "Resultado esperado". **Falla:** no pasó, o apareció un error. Se marca una sola.                                         |
| **Observación**   | Qué viste. Si fue "Falla", escribí qué pasó y qué mensaje apareció. Si fue OK pero algo te pareció raro o querés que sea distinto, también va acá. |
| **Clasificación** | Solo si hay una observación: si es de la **Base** o una **Ampliación** (ver 2.3). Si no lo sabés: **No sé**.                                       |

Si un escenario no se pudo hacer (faltaba algo, no hubo tiempo), escribilo en **Observación** con "No se hizo" y el motivo.

### 2.3. Base o ampliación (V3 punto 7)

Lo acordado en la V3 es esto:

| Es **Base**: se corrige sin costo                           | Es **Ampliación**: se cotiza aparte                           |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| Una función del punto 1 de la V3 **no funciona o da error** | Una pantalla, regla o función **que no figura** en el punto 1 |
| **Ajustes menores** que surgen del uso real                 | **Cambios de criterio** sobre algo ya definido y aprobado     |
| **Dudas de uso**, consultas y capacitación                  | **Automatizaciones** e integraciones con servicios externos   |

Ejemplos:

- "Toco **Registrar inicio** y da error": **Base**.
- "El texto del botón no se entiende, prefiero que diga otra cosa": **Base** (ajuste menor).
- "Quiero subir fotos del servicio": **Ampliación** (la carga de fotos es un módulo aparte).
- "Quiero que le llegue una notificación al celular cuando le asignan un turno": **Ampliación** (módulo de avisos).
- "Quiero un reporte de horas trabajadas por empleado": **Ampliación**.
- "No sé cómo se hace tal cosa": **Base** (duda de uso).

Si hay dudas sobre cómo clasificar algo, se anota **No sé** y se decide después con calma entre las partes. **La clasificación final se confirma en el acta.**

### 2.4. Reglas de oro

- **No se corrige nada durante la sesión.** Se anota y se sigue.
- Si algo falla, **no se insiste**: se anota con el mensaje exacto (de ser posible, una foto de la pantalla) y se pasa al siguiente.
- Lo que se carga en el entorno de pruebas **no es real** y no pasa a producción: se puede probar con tranquilidad.
- Nunca se escribe una contraseña en este guion.

---

## 3. Orden recomendado de la sesión

Los escenarios están agrupados en bloques. **Conviene respetar el orden**, porque los últimos usan lo que cargaron los primeros.

| Bloque | Qué se hace                                                        | Escenarios                                                                          | Tiempo estimado |
| ------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------- |
| A      | Ingreso y permisos                                                 | UAT-DUE-01, UAT-DUE-02, UAT-ADM-01, UAT-ADM-02                                      | 20 minutos      |
| B      | Carga por pantalla: clientes, sedes, tareas, servicios y personas  | UAT-ADM-03 a UAT-ADM-09, UAT-DUE-03, UAT-DUE-04                                     | 60 minutos      |
| C      | Planificación: turnos y asignaciones                               | UAT-ADM-10 a UAT-ADM-16                                                             | 45 minutos      |
| D      | La jornada de hoy: empleado en el celular y administración mirando | UAT-EMP-01 a UAT-EMP-11, UAT-ADM-17 a UAT-ADM-19, UAT-ADM-20                        | 60 minutos      |
| E      | La supervisión                                                     | UAT-SUP-01 a UAT-SUP-07, UAT-ADM-21                                                 | 40 minutos      |
| F      | Cierre: contraseñas, bajas, sesión y seguridad                     | UAT-ADM-22, UAT-ADM-23, UAT-TRA-01 a UAT-TRA-04, UAT-DUE-05, UAT-EMP-12, UAT-SUP-08 | 30 minutos      |

Total: unas **4 horas y media**, con una pausa entre bloques. Si hay menos tiempo, se hacen primero los escenarios **Imprescindibles** y se dejan para otra sesión los **Opcionales**.

Resumen por rol (para ubicarse):

| Rol                      | Escenarios | Cantidad |
| ------------------------ | ---------- | -------- |
| Dueño (UAT-DUE)          | 01 a 05    | 5        |
| Administración (UAT-ADM) | 01 a 23    | 23       |
| Empleado (UAT-EMP)       | 01 a 12    | 12       |
| Supervisor (UAT-SUP)     | 01 a 08    | 8        |
| Transversales (UAT-TRA)  | 01 a 04    | 4        |

---

## 4. Escenarios

### Bloque A · Ingreso y permisos

#### UAT-DUE-01 · El dueño ingresa y ve el Resumen

|                  |                                              |
| ---------------- | -------------------------------------------- |
| **Rol**          | Dueño                                        |
| **Dónde**        | Computadora                                  |
| **Tipo**         | Imprescindible                               |
| **Cubre**        | RB-A01 (ingreso seguro con usuario y perfil) |
| **Precondición** | El dueño tiene su email y su contraseña.     |

**Pasos**

1. Abrí la dirección de la plataforma de prueba.
2. Escribí el **Email** y la **Contraseña** del dueño. Tocá **Ingresar**.
3. Mirá la pantalla que se abre y el menú de la izquierda.
4. Entrá a **Configuración** y mirá las pestañas de arriba.

**Resultado esperado**

- Se abre **Resumen**. Abajo del menú izquierdo figura el nombre del dueño con el rol **Dueño**.
- El menú tiene ocho secciones: Resumen, Planificación, Asistencia, Supervisiones, Empleados, Clientes y sedes, Tareas y Configuración.
- En **Configuración** hay cinco pestañas: **Usuarios**, **Empresa**, **Feriados**, **Criterios de calificación** y **Eventos de seguridad**.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-DUE-02 · El dueño quita un permiso a un administrador

|                  |                                                                             |
| ---------------- | --------------------------------------------------------------------------- |
| **Rol**          | Dueño                                                                       |
| **Dónde**        | Computadora                                                                 |
| **Tipo**         | Imprescindible                                                              |
| **Cubre**        | RB-A01 (un administrador sin una capacidad no puede ejecutar esa acción)    |
| **Precondición** | UAT-DUE-01 hecho. El **Administrador 2** existe y tiene los siete permisos. |

**Pasos**

1. Entrá a **Configuración** y a la pestaña **Usuarios**.
2. Buscá al **Administrador 2**. Tocá los tres puntos de su fila y elegí **Editar roles y capacidades**.
3. Apagá el permiso **Generar turnos del mes**. Se guarda solo, sin botón.
4. Cerrá el panel.

**Resultado esperado**

- El permiso **Generar turnos del mes** queda apagado para el Administrador 2. Los otros seis siguen encendidos.
- No hubo ningún botón de guardar: el cambio se aplicó al tocar.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-01 · Los administradores ingresan con su email

|                  |                                                               |
| ---------------- | ------------------------------------------------------------- |
| **Rol**          | Administrador                                                 |
| **Dónde**        | Computadora                                                   |
| **Tipo**         | Imprescindible                                                |
| **Cubre**        | RB-A01 (el dueño y los administradores ingresan con su email) |
| **Precondición** | Cada administrador tiene su email y su contraseña.            |

**Pasos**

1. En la computadora, abrí la dirección de la plataforma de prueba.
2. Ingresá con el email y la contraseña del **Administrador 1**.
3. Mirá que se abre **Resumen** y que abajo del menú dice el rol **Administrador**.
4. Tocá tu foto (arriba a la derecha) y elegí **Cerrar sesión**.
5. Repetí los pasos 2 a 4 con cada uno de los demás administradores.

**Resultado esperado**

- Cada administrador entra con su propio email y ve **Resumen**.
- En **Configuración** el administrador ve solo **Usuarios** y **Empresa** (no ve Feriados, Criterios ni Eventos de seguridad: son del dueño).

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-02 · Un administrador sin permiso no puede hacer esa acción

|                  |                                                                              |
| ---------------- | ---------------------------------------------------------------------------- |
| **Rol**          | Administrador (el **Administrador 2**)                                       |
| **Dónde**        | Computadora                                                                  |
| **Tipo**         | Imprescindible                                                               |
| **Cubre**        | RB-A01 (un administrador sin una capacidad no puede ejecutar esa acción)     |
| **Precondición** | UAT-DUE-02 hecho: al Administrador 2 se le quitó **Generar turnos del mes**. |

**Pasos**

1. Si el Administrador 2 tenía la sesión abierta, tocá su foto, **Cerrar sesión**, y volvé a ingresar. (Los permisos se leen al ingresar.)
2. Entrá a **Planificación**.
3. Buscá el botón **Generar turnos del mes**.
4. Probá con otra acción que sí le corresponde: tocá **Nuevo turno** y mirá que se abre el formulario (no lo guardes).

**Resultado esperado**

- El botón **Generar turnos del mes no aparece**.
- **Nuevo turno** sí funciona: el administrador conserva sus otros permisos.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

### Bloque B · Carga por pantalla

En este bloque se cargan a mano las **sedes, los servicios, las tareas y las personas** que la planilla no traía. Usá los datos de la tabla 1.5. Lo que cargues acá lo usan los bloques siguientes.

#### UAT-ADM-03 · Revisar los clientes cargados y sus contactos

|                  |                                                           |
| ---------------- | --------------------------------------------------------- |
| **Rol**          | Administrador (Administrador 1)                           |
| **Dónde**        | Computadora                                               |
| **Tipo**         | Imprescindible                                            |
| **Cubre**        | RB-A03 (los clientes reales están cargados con contactos) |
| **Precondición** | Los clientes de la planilla ya fueron importados.         |

**Pasos**

1. Entrá a **Clientes y sedes**.
2. Compará la lista con la planilla que mandó la empresa: la cantidad de clientes, el nombre y el **CUIT** de cada uno, y el estado.
3. Abrí el **cliente de prueba** y entrá a la pestaña **Contactos**.
4. Si no tiene contacto, tocá **Nuevo contacto**, completá nombre, cargo, teléfono y email, y tocá **Guardar**.
5. Marcá un contacto como **Principal** (si hay más de uno) y volvé a la lista de clientes.

**Resultado esperado**

- Están todos los clientes de la planilla, con el CUIT correcto y en estado **Activo**.
- El cliente de prueba tiene su contacto cargado y en la lista figura como **Contacto principal**.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-04 · Crear una sede con ubicación en el mapa

|                  |                                                                             |
| ---------------- | --------------------------------------------------------------------------- |
| **Rol**          | Administrador (Administrador 1)                                             |
| **Dónde**        | Computadora                                                                 |
| **Tipo**         | Imprescindible                                                              |
| **Cubre**        | RB-A03 (el mapa muestra las sedes con coordenadas)                          |
| **Precondición** | El cliente de prueba existe. Tenés a mano los datos de la sede (tabla 1.5). |

**Pasos**

1. Abrí el **cliente de prueba** y, en la pestaña **Sedes**, tocá **Nueva sede**.
2. Completá **Nombre**, **Dirección**, **Localidad**, **Contacto en la sede**, **Teléfono de contacto** y **Horario del edificio**.
3. En **Instrucciones de acceso**, escribí cómo se entra a la sede.
4. En **Restricciones informativas**, encendé una de las opciones (por ejemplo **No se permiten fotos**).
5. En **Ubicación (opcional)**, escribí la dirección en **Buscar dirección** y tocá el botón. Mirá que el marcador cae sobre el lugar; si no, movelo a mano.
6. Tocá **Crear sede**.
7. Volvé a **Clientes y sedes** y abrí la pestaña **Mapa**.

**Resultado esperado**

- La sede se crea y aparece en la lista de sedes del cliente, **Activa**.
- En la pestaña **Mapa** se ve un marcador en la ubicación de la sede. Al tocarlo muestra el cliente y la dirección.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-05 · Cargar la lista de tareas del cliente y de una sede

|                  |                                                                                 |
| ---------------- | ------------------------------------------------------------------------------- |
| **Rol**          | Administrador (Administrador 1)                                                 |
| **Dónde**        | Computadora                                                                     |
| **Tipo**         | Imprescindible                                                                  |
| **Cubre**        | RB-A05 (cada cliente tiene plantilla; al menos una sede tiene plantilla propia) |
| **Precondición** | UAT-ADM-04 hecho. Tenés escritas 4 o 5 tareas de limpieza para el cliente.      |

**Pasos**

1. Entrá a **Tareas** y elegí el **cliente de prueba**.
2. En **Ámbito**, dejá **Plantilla del cliente**.
3. Tocá **Agregar ítem**, escribí el título de la primera tarea y guardá. Repetí hasta cargar 4 o 5 tareas.
4. En una de ellas marcá que es **opcional**.
5. Usá las **flechas** para subir una tarea y bajar otra.
6. En **Ámbito**, elegí la **sede de prueba**. Tocá **Crear plantilla propia para esta sede**.
7. En la lista de la sede, **editá** el título de una tarea y **quitá** otra (con el tacho).

**Resultado esperado**

- La plantilla del cliente muestra las tareas en el orden elegido, con la opcional marcada como **Opcional**.
- La sede tiene su **plantilla propia** (copia de la del cliente), con los cambios, sin afectar a la del cliente.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-06 · Crear un servicio recurrente

|                  |                                                             |
| ---------------- | ----------------------------------------------------------- |
| **Rol**          | Administrador (Administrador 1)                             |
| **Dónde**        | Computadora                                                 |
| **Tipo**         | Imprescindible                                              |
| **Cubre**        | RB-A04 (creación de servicios)                              |
| **Precondición** | UAT-ADM-04 hecho. Tenés los datos del servicio (tabla 1.5). |

**Pasos**

1. Abrí la **sede de prueba** y tocá **Nuevo servicio** (o desde el cliente, pestaña **Servicios**).
2. Elegí el **Cliente** y la **Sede**.
3. Escribí el **Nombre** (por ejemplo "Limpieza mañana"). Dejá el **Estado** en **Activo**. Poné la **Dotación** (de 1 a 10).
4. Tildá los **días de la semana**. Elegí **Desde** y **Hasta**.
5. Elegí desde qué fecha rige en **Vigencia**.
6. Tocá **Crear servicio**.

**Resultado esperado**

- El servicio se crea y aparece en la ficha de la sede y en la pestaña **Servicios** del cliente.
- La pantalla avisa que **los turnos ya generados no cambian** y que hay que generar el mes para crear los que faltan.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-07 · Dar de alta un empleado con su usuario

|                  |                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| **Rol**          | Administrador (Administrador 1, con el permiso **Gestionar usuarios**)                         |
| **Dónde**        | Computadora                                                                                    |
| **Tipo**         | Imprescindible                                                                                 |
| **Cubre**        | RB-A02 (alta de un empleado real; ingresa desde su celular)                                    |
| **Precondición** | Tenés el email de login del **Empleado A** y una contraseña inicial que te dio el organizador. |

**Pasos**

1. Entrá a **Empleados** y tocá **Nuevo empleado**.
2. En **Roles**, dejá tildado **Empleado**.
3. En **Usuario y contraseña**, escribí el **Email de login** y la **Contraseña inicial** (al menos 8 caracteres).
4. En **Datos personales**, completá **Nombre**, **Apellido**, **DNI** (solo números) y **Teléfono**.
5. En **Datos laborales**, mirá el **Legajo** que sugiere la plataforma y completá la **Fecha de ingreso**.
6. Tocá **Crear**.
7. Buscá a la persona en la lista de **Empleados**.

**Resultado esperado**

- La persona se crea y aparece en **Empleados**, con su legajo y el estado **Activo**.
- Su ficha muestra los datos cargados y el rol **Empleado**.
- Más adelante (UAT-EMP-01) esa persona va a poder ingresar desde su celular.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

> Repetí este escenario para el **Empleado B** si lo vas a usar en la jornada (UAT-EMP-08 y UAT-ADM-19).

#### UAT-ADM-08 · Dar de alta un supervisor con su usuario

|                  |                                                                        |
| ---------------- | ---------------------------------------------------------------------- |
| **Rol**          | Administrador (Administrador 1, con el permiso **Gestionar usuarios**) |
| **Dónde**        | Computadora                                                            |
| **Tipo**         | Imprescindible                                                         |
| **Cubre**        | RB-A02 (alta de un supervisor real; ingresa desde su celular)          |
| **Precondición** | Tenés el email de login de la supervisora y una contraseña inicial.    |

**Pasos**

1. Entrá a **Empleados** y tocá **Nuevo empleado**.
2. En **Roles**, **destildá Empleado** y tildá **Supervisor**.
3. Completá el email, la contraseña inicial y los datos personales y laborales, como en UAT-ADM-07.
4. Tocá **Crear**.

**Resultado esperado**

- La persona aparece en **Empleados** con el rol **Supervisor**.
- Más adelante (UAT-SUP-01) va a poder ingresar desde su celular y ver su pantalla de supervisora.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-09 · Cargar habilitaciones, disponibilidad y una licencia

|                  |                                                                           |
| ---------------- | ------------------------------------------------------------------------- |
| **Rol**          | Administrador (Administrador 1)                                           |
| **Dónde**        | Computadora                                                               |
| **Tipo**         | Opcional                                                                  |
| **Cubre**        | RB-A02 (gestión de empleados: habilitaciones, disponibilidad y licencias) |
| **Precondición** | UAT-ADM-07 hecho.                                                         |

**Pasos**

1. Abrí la ficha del **Empleado A** y entrá a **Habilitaciones**.
2. Elegí el **cliente de prueba** y tocá **Habilitar**.
3. Entrá a **Disponibilidad**. Elegí un día de la semana y una franja y tocá **Agregar**.
4. Entrá a **Licencias** y tocá **Agregar licencia**. Cargá una licencia de fechas **futuras**, que no pisen la jornada de hoy.
5. Entrá a **Próximos turnos**.

**Resultado esperado**

- En cada pestaña queda lo que cargaste.
- La licencia figura con sus fechas. En la lista de **Empleados**, mientras dure la licencia, la persona figura "de licencia".

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-DUE-03 · Cargar los criterios de calificación definitivos

|                  |                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------- |
| **Rol**          | Dueño                                                                                        |
| **Dónde**        | Computadora                                                                                  |
| **Tipo**         | Imprescindible                                                                               |
| **Cubre**        | RB-X04 (los criterios definitivos del cliente están cargados y se muestran al calificar)     |
| **Precondición** | Tenés escritos los criterios de calificación de la empresa (título y una descripción corta). |

**Pasos**

1. Entrá a **Configuración**, pestaña **Criterios de calificación**.
2. Tocá **Nuevo criterio**. Escribí el **Título** y la **Descripción**. Tocá **Agregar criterio**.
3. Repetí con cada criterio de la empresa.
4. Mirá el orden de la lista y, si hace falta, cambialo.
5. Si hay un criterio de ejemplo que no corresponde, tocá **Cerrar criterio** para dejar de usarlo.

**Resultado esperado**

- Los criterios definitivos de la empresa figuran en la lista, en el orden correcto.
- Más adelante (UAT-SUP-04), la supervisora los ve como guía al calificar. Los criterios cerrados ya no aparecen.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-DUE-04 · Cargar los feriados y los datos de la empresa

|                  |                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Rol**          | Dueño                                                                                                                         |
| **Dónde**        | Computadora                                                                                                                   |
| **Tipo**         | Imprescindible                                                                                                                |
| **Cubre**        | RB-X04 (datos definitivos del cliente) y RB-A01 (acceso con el perfil del dueño)                                              |
| **Precondición** | Tenés el logo de la empresa (PNG, JPEG o WebP, hasta 1 MB), el teléfono de soporte y el texto de consentimiento de ubicación. |

**Pasos**

1. Entrá a **Configuración**, pestaña **Feriados**. Elegí el año en curso.
2. Tocá **Cargar feriados nacionales de** (el año). Si falta un feriado local, tocá **Nuevo feriado** y cargalo.
3. Entrá a la pestaña **Empresa**.
4. Tocá **Subir logo** y elegí el archivo.
5. Escribí el **Teléfono de soporte** y revisá el **Texto de consentimiento de ubicación**. Tocá **Guardar cambios**.
6. Tocá tu foto, **Cerrar sesión**, y mirá la pantalla de ingreso.

**Resultado esperado**

- Los feriados del año figuran en la lista. En **Planificación**, esos días se marcan como **Feriado**.
- En la pantalla de ingreso se ve el **logo** de la empresa y, abajo, el teléfono de soporte ("Si no podés entrar, comunicate con Administración al ...").
- El texto de consentimiento se verá en el celular del empleado (UAT-EMP-07).

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

### Bloque C · Planificación

#### UAT-ADM-10 · Generar los turnos de un mes

|                  |                                                                            |
| ---------------- | -------------------------------------------------------------------------- |
| **Rol**          | Administrador (Administrador 1, con el permiso **Generar turnos del mes**) |
| **Dónde**        | Computadora                                                                |
| **Tipo**         | Imprescindible                                                             |
| **Cubre**        | RB-A04 (se genera un mes; los turnos nacen con su dotación)                |
| **Precondición** | UAT-ADM-06 hecho (servicio creado) y feriados cargados (UAT-DUE-04).       |

**Pasos**

1. Entrá a **Planificación** y tocá **Generar turnos del mes**.
2. Elegí el **mes** en curso. Mirá cuántos servicios activos vigentes y cuántos feriados tiene.
3. Tocá **Generar turnos del mes**.
4. Leé el mensaje del resultado.
5. Volvé a tocar **Generar turnos del mes** para el mismo mes.
6. Volvé a **Planificación** y mirá el calendario del mes.

**Resultado esperado**

- El mensaje dice cuántos turnos se crearon ("Se crearon n turnos, se omitieron 0 por ya existir y n por caer en feriado").
- La segunda vez **no crea turnos nuevos**: dice que se omitieron por ya existir. No duplica ni modifica los anteriores.
- En el calendario aparecen los turnos en los días del servicio, con su cliente y sede. Los feriados quedan sin turno si el servicio no trabaja los feriados.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-11 · Ver el cronograma por mes, semana y día

|                  |                                                    |
| ---------------- | -------------------------------------------------- |
| **Rol**          | Administrador                                      |
| **Dónde**        | Computadora                                        |
| **Tipo**         | Imprescindible                                     |
| **Cubre**        | RB-A06 (el cronograma se ve por mes, semana y día) |
| **Precondición** | UAT-ADM-10 hecho.                                  |

**Pasos**

1. En **Planificación**, mirá la pestaña **Mes**. Cambiá de mes con las flechas.
2. Usá los filtros: elegí el **cliente de prueba** y mirá cómo cambia el calendario. Sacá el filtro.
3. Entrá a la pestaña **Semana**. Mirá la grilla de empleados por día. Las celdas vacías dicen **Libre**.
4. Entrá a la pestaña **Día** y elegí una fecha con turnos. Mirá la **Franja**, la **Dotación** (por ejemplo 0/2) y el **Estado**.
5. Tocá **Ver** en un turno: se abre el detalle.

**Resultado esperado**

- Las tres vistas muestran los mismos turnos.
- El estado de cada turno es coherente: **Programado** si no tiene a nadie asignado, **Asignado** si ya tiene personal.
- El detalle abre sin errores y muestra cliente, sede, fecha, franja, dotación y tareas.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-12 · Asignar personal a un turno

|                  |                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Rol**          | Administrador                                                                                                                                                |
| **Dónde**        | Computadora                                                                                                                                                  |
| **Tipo**         | Imprescindible                                                                                                                                               |
| **Cubre**        | RB-A04 (cada turno recibe su dotación)                                                                                                                       |
| **Precondición** | UAT-ADM-10 hecho. Un turno **futuro** (no el de hoy) del cliente de prueba. Si hay licencia cargada (UAT-ADM-09), que el turno elegido caiga en esas fechas. |

**Pasos**

1. En **Planificación**, abrí un turno futuro de la sede de prueba.
2. Tocá **Asignar empleado**. Se abre la lista de personas.
3. Mirá las etiquetas de cada persona: **Habilitado y disponible**, **No habilitado para el cliente**, **Fuera de su disponibilidad**, **De licencia**.
4. Elegí al **Empleado A** y tocá **Asignar**.
5. Mirá el detalle del turno.
6. Si la dotación es mayor a 1, asigná también al Empleado B.
7. Probá asignar a una persona que muestre una advertencia (por ejemplo, de licencia). Leé el mensaje.

**Resultado esperado**

- El empleado queda asignado: la **Dotación** pasa a "1/n" y el turno a **Asignado**.
- Para una persona con advertencia, aparece "Asignamos igual, con advertencias" y se explica cuál es (licencia, no habilitada o fuera de disponibilidad). La asignación se hizo igual.
- Con **Quitar** podés sacar a la persona (pide un motivo).

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-13 · Una superposición de horarios se rechaza

|                  |                                                                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rol**          | Administrador                                                                                                                                                                                                                    |
| **Dónde**        | Computadora                                                                                                                                                                                                                      |
| **Tipo**         | Imprescindible                                                                                                                                                                                                                   |
| **Cubre**        | RB-A04 (una superposición se rechaza)                                                                                                                                                                                            |
| **Precondición** | Dos turnos del mismo día que se pisan en horario. Si hace falta, creá uno con **Nuevo turno** (cliente y sede de prueba, una fecha futura, mismas horas que otro turno). El Empleado A ya está asignado al primero (UAT-ADM-12). |

**Pasos**

1. Abrí el segundo turno, el que se pisa con el primero.
2. Tocá **Asignar empleado**.
3. Buscá al Empleado A: mirá las etiquetas que tiene.
4. Elegí al Empleado A y tocá **Asignar**.

**Resultado esperado**

- En la lista, el Empleado A muestra una etiqueta roja **Se superpone con …** con la sede y el horario del otro turno.
- Al intentar asignarlo, la plataforma **lo rechaza** con el mensaje "El empleado ya tiene otro turno en ese horario." La asignación **no se hace**.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-14 · Cancelar un turno con motivo

|                  |                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Rol**          | Administrador (Administrador 1, con el permiso **Cancelar turnos**)                                                      |
| **Dónde**        | Computadora                                                                                                              |
| **Tipo**         | Imprescindible                                                                                                           |
| **Cubre**        | RB-A04 (un turno se cancela con motivo)                                                                                  |
| **Precondición** | El turno extra de UAT-ADM-13 (o cualquier turno **de prueba**). No canceles uno que se vaya a usar en la jornada de hoy. |

**Pasos**

1. Abrí el turno de prueba.
2. Tocá **Cancelar turno**.
3. Escribí el **Motivo de la cancelación** y confirmá.
4. Volvé a **Planificación** y buscá ese turno.

**Resultado esperado**

- El turno pasa a **Cancelado** y conserva el motivo.
- En el calendario se ve tachado o como cancelado, y ya no se le puede asignar personal.
- Si había un empleado asignado, en su celular el servicio figura como **Cancelado**.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-15 · Preparar los turnos de prueba de hoy

Este escenario no prueba nada nuevo: **deja listo lo que usan los escenarios de la jornada** (bloque D). Hacelo justo antes de empezar el bloque D, porque depende de la hora.

|                  |                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| **Rol**          | Administrador (Administrador 1)                                                                    |
| **Dónde**        | Computadora                                                                                        |
| **Tipo**         | Imprescindible                                                                                     |
| **Cubre**        | RB-A04 (creación de turnos y asignación de personal)                                               |
| **Precondición** | UAT-ADM-07 y UAT-ADM-08 hechos (Empleado A y supervisora). El cliente y la sede de prueba existen. |

**Pasos**

1. Anotá la hora de ahora. Con eso armá estos horarios de **hoy** (el ejemplo supone que son las 14:00):

   | Turno       | Para qué                                     | Horario del ejemplo | Persona    |
   | ----------- | -------------------------------------------- | ------------------- | ---------- |
   | **Turno 1** | Avisar demora o ausencia (todavía no empezó) | 16:00 a 18:00       | Empleado A |
   | **Turno 2** | Registrar inicio y fin (ya empezó)           | 12:00 a 15:00       | Empleado A |
   | **Turno 3** | Inicio sin ubicación y "registrar en nombre" | 12:00 a 15:00       | Empleado B |

   Los horarios del Turno 1 y del Turno 2 **no se pueden pisar** entre sí. Las franjas no pueden cruzar la medianoche.

2. En **Planificación**, tocá **Nuevo turno**. Elegí el **cliente de prueba**, la **sede de prueba**, la **fecha de hoy**, **Desde**, **Hasta** y la **Dotación** (1). Tocá **Crear turno**. Hacelo para cada turno.
3. Abrí cada turno y tocá **Asignar empleado** con la persona de la tabla.
4. Abrí el **Turno 2** y mirá la sección **Tareas**: tiene que tener la lista de la sede. Si dice que no tiene tareas, tocá **Recargar tareas**.

**Resultado esperado**

- Los tres turnos de hoy existen, cada uno con su persona asignada, en estado **Asignado**.
- El Turno 2 tiene las tareas cargadas en UAT-ADM-05.
- Si solo tenés un empleado, hacé únicamente el Turno 1 y el Turno 2.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-16 · Asignar una supervisión a un turno

|                  |                                                                           |
| ---------------- | ------------------------------------------------------------------------- |
| **Rol**          | Administrador (Administrador 1, con el permiso **Asignar supervisiones**) |
| **Dónde**        | Computadora                                                               |
| **Tipo**         | Imprescindible                                                            |
| **Cubre**        | RB-S02 (las supervisiones las asigna la administración)                   |
| **Precondición** | UAT-ADM-15 hecho. La supervisora existe (UAT-ADM-08).                     |

**Pasos**

1. Entrá a **Supervisiones** y tocá **Asignar supervisión**.
2. Elegí la **Fecha** de hoy.
3. En **Turno**, elegí el **Turno 2** (el de 12:00 a 15:00 del ejemplo).
4. En **Supervisor**, elegí a la supervisora y confirmá.
5. Volvé a la lista de **Supervisiones**.
6. Abrí el **Turno 2** y mirá la sección **Supervisiones**.

**Resultado esperado**

- La supervisión aparece en la lista, con estado **Asignada** y la supervisora elegida.
- El detalle del turno muestra a la supervisora.
- Más adelante (UAT-SUP-01) aparece en la pantalla **Hoy** de la supervisora, y **de nadie más**.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

### Bloque D · La jornada de hoy

Acá trabajan **dos personas a la vez**: el **Empleado A** con su celular y la **administración** mirando desde la computadora. Los escenarios del empleado (UAT-EMP) y los de administración que los acompañan (UAT-ADM-17 a UAT-ADM-20) se van intercalando. Se marca en cada uno.

#### UAT-EMP-01 · Ingresar desde el celular y que la sesión quede abierta

|                  |                                                                       |
| ---------------- | --------------------------------------------------------------------- |
| **Rol**          | Empleado (Empleado A)                                                 |
| **Dónde**        | Celular                                                               |
| **Tipo**         | Imprescindible                                                        |
| **Cubre**        | RB-E01 (cada empleado real ingresa con su email y la sesión persiste) |
| **Precondición** | UAT-ADM-07 hecho. El empleado tiene su email y la contraseña inicial. |

**Pasos**

1. En el celular, abrí el navegador (Chrome o Safari) y escribí la dirección de la plataforma de prueba.
2. Escribí el **Email** y la **Contraseña**. Tocá **Ingresar**.
3. Mirá la pantalla que se abre.
4. Cerrá el navegador del todo (sacalo de las aplicaciones recientes).
5. Volvé a abrir la dirección.

**Resultado esperado**

- Se abre **Hoy**, con el saludo "Hola, " y el nombre del empleado.
- Al volver a abrir, **ya está adentro**, sin pedir el email ni la contraseña.
- Abajo hay tres botones: **Hoy**, el botón redondo del medio (**Fichar**) y **Más**.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-EMP-02 · Instalar la app en la pantalla de inicio

|                  |                                                   |
| ---------------- | ------------------------------------------------- |
| **Rol**          | Empleado                                          |
| **Dónde**        | Celular (Android con Chrome, o iPhone con Safari) |
| **Tipo**         | Opcional                                          |
| **Cubre**        | RB-E01 y COM-06 (instalación como aplicación)     |
| **Precondición** | UAT-EMP-01 hecho.                                 |

**Pasos**

1. En **Android (Chrome)**: en **Hoy**, tocá **Instalar** en el cartel de arriba. Si no aparece, tocá los tres puntitos de Chrome y **Instalar aplicación**. Confirmá.
2. En **iPhone (Safari)**: tocá **Compartir**, **Agregar a pantalla de inicio** y **Agregar**.
3. Buscá el ícono **Ext. Servicios** en la pantalla de inicio y abrilo desde ahí.
4. En iPhone, ingresá de nuevo (la primera vez de la app instalada lo pide).

**Resultado esperado**

- Aparece el ícono en la pantalla de inicio.
- La app se abre a **pantalla completa**, sin la barra del navegador.
- Después de ingresar, funciona igual que en el navegador.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-EMP-03 · "Hoy" muestra exactamente mis servicios

|                  |                                                                    |
| ---------------- | ------------------------------------------------------------------ |
| **Rol**          | Empleado (Empleado A)                                              |
| **Dónde**        | Celular                                                            |
| **Tipo**         | Imprescindible                                                     |
| **Cubre**        | RB-E02 (jornada del día y servicios asignados)                     |
| **Precondición** | UAT-ADM-15 hecho: el Empleado A tiene el Turno 1 y el Turno 2 hoy. |

**Pasos**

1. En el celular del Empleado A, abrí la app y mirá **Hoy**.
2. Contá los servicios de hoy y mirá el horario, la sede y el estado de cada uno.
3. Bajá hasta **Próximos días**.
4. Pedile al organizador que confirme qué turnos tiene asignados el Empleado A.

**Resultado esperado**

- **Hoy** muestra **exactamente** los turnos asignados al Empleado A para hoy (el Turno 1 y el Turno 2), con su cliente, sede, horario y el estado **Esperado**.
- **No** aparece el Turno 3 (es del Empleado B) ni ningún servicio de otras personas.
- **Próximos días** muestra los servicios que tenga en los próximos siete días.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-EMP-04 · El detalle de un servicio

|                  |                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| **Rol**          | Empleado (Empleado A)                                                                                      |
| **Dónde**        | Celular                                                                                                    |
| **Tipo**         | Imprescindible                                                                                             |
| **Cubre**        | RB-E03 (lugar, horario y tareas de cada servicio)                                                          |
| **Precondición** | UAT-EMP-03 hecho. La sede de prueba tiene instrucciones, contacto y una restricción cargados (UAT-ADM-04). |

**Pasos**

1. En **Hoy**, tocá la tarjeta del **Turno 2**.
2. Mirá cada sección: la dirección, el horario, las instrucciones, las restricciones, el contacto, los compañeros y las tareas previstas.
3. Tocá **Abrir en el mapa**. Volvé a la app.
4. Tocá el teléfono del contacto de la sede (no hace falta completar la llamada).

**Resultado esperado**

- El detalle muestra: la **dirección**, el **horario**, las **instrucciones de acceso**, la **restricción** de la sede (por ejemplo "No se permiten fotos"), el **contacto** y las **tareas previstas** (con la opcional marcada como **Opcional**).
- **Abrir en el mapa** abre el mapa del teléfono en esa dirección. El teléfono ofrece llamar al tocar el número.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-EMP-05 · Avisar una demora antes del turno

|                  |                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------- |
| **Rol**          | Empleado (Empleado A)                                                                         |
| **Dónde**        | Celular                                                                                       |
| **Tipo**         | Imprescindible                                                                                |
| **Cubre**        | RB-E07 (un aviso enviado antes del inicio se acepta y aparece en el tablero)                  |
| **Precondición** | El **Turno 1** todavía no empezó. **Alguien de administración mira el Resumen** (UAT-ADM-17). |

**Pasos**

1. En **Hoy**, tocá **Avisar demora o ausencia**.
2. Elegí el **Turno 1** y tocá **Continuar**.
3. Elegí **Demora**.
4. Indicá **15** minutos y, si querés, escribí un motivo. Tocá **Continuar**.
5. En el resumen, tocá **Confirmar aviso**.
6. Volvé a **Hoy** y mirá el Turno 1.

**Resultado esperado**

- El aviso se acepta.
- En **Hoy**, el Turno 1 pasa a **Demora avisada** y dice "Avisaste una demora de 15 min."
- **Administración lo ve en su Resumen** en menos de un minuto (UAT-ADM-17).

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-17 · El aviso aparece en el tablero sin recargar

Se hace **a la vez** que UAT-EMP-05.

|                  |                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| **Rol**          | Administrador                                                                                                |
| **Dónde**        | Computadora                                                                                                  |
| **Tipo**         | Imprescindible                                                                                               |
| **Cubre**        | RB-A08 (un aviso desde un celular aparece en el tablero en menos de un minuto) y RB-A07 (el tablero del día) |
| **Precondición** | UAT-ADM-15 hecho. El Resumen está abierto en la computadora **antes** de que el empleado mande el aviso.     |

**Pasos**

1. Abrí **Resumen** y **no lo recargues**. Anotá los valores de **Turnos hoy**, **Presentes**, **Sin registro** y **Avisos**.
2. Pedile al Empleado A que mande su aviso de demora (UAT-EMP-05). Mirá el reloj.
3. Esperá sin tocar nada. Mirá "Actualizado hace n s" arriba a la derecha.
4. Entrá a **Asistencia** y buscá la fila del Empleado A en el Turno 1.
5. Más tarde, cuando el Empleado A registre su inicio en el Turno 2 (UAT-EMP-07), volvé a mirar **Presentes**.

**Resultado esperado**

- **Turnos hoy** coincide con los turnos de hoy que cargaste (con sus clientes y sedes).
- El aviso de demora **aparece en menos de un minuto, sin recargar**: **Avisos** pasa a 1 ("0 ausencias · 1 demoras"), y el Turno 1 muestra **Demora avisada** con "15" minutos.
- Cuando el Empleado A registra su inicio, **Presentes** pasa a 1.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-EMP-06 · Avisar una ausencia, y un aviso fuera de hora se rechaza

|                  |                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------ |
| **Rol**          | Empleado (Empleado A)                                                                |
| **Dónde**        | Celular                                                                              |
| **Tipo**         | Imprescindible                                                                       |
| **Cubre**        | RB-E07 (antes del inicio se acepta; después del inicio se rechaza con mensaje claro) |
| **Precondición** | UAT-EMP-05 hecho. El **Turno 1** todavía no empezó y el **Turno 2** ya empezó.       |

**Pasos**

1. Tocá **Más**, **Avisar demora o ausencia**. Elegí el **Turno 1** y tocá **Continuar**.
2. Elegí **Ausencia**. Elegí un motivo de la lista (por ejemplo **Trámite**). Tocá **Continuar** y **Confirmar aviso**.
3. Volvé a **Hoy** y mirá el Turno 1.
4. Probá de nuevo con el **Turno 2** (el que ya empezó): ¿podés avisar sobre ese servicio?

**Resultado esperado**

- El aviso de ausencia del Turno 1 se acepta: en **Hoy** figura **Ausencia avisada** con el motivo.
- Para el Turno 2 (ya empezó) **no se ofrece avisar**, o si se intenta aparece el mensaje "El aviso tiene que hacerse antes de la hora de inicio."

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-EMP-07 · Registrar el inicio de un servicio, con ubicación

|                  |                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| **Rol**          | Empleado (Empleado A)                                                                                      |
| **Dónde**        | Celular, con la ubicación activada                                                                         |
| **Tipo**         | Imprescindible                                                                                             |
| **Cubre**        | RB-E04 (registra inicio; la hora es la del servidor; funciona con y sin ubicación)                         |
| **Precondición** | El **Turno 2** es de hoy y el Empleado A no registró nada todavía. La ubicación del celular está activada. |

**Pasos**

1. Tocá el **botón redondo del medio** (**Fichar**).
2. Si la app pregunta "¿Cuál vas a empezar?", elegí el **Turno 2**.
3. Si es la primera vez, aparece "Tu ubicación al fichar". **Leé el texto**: tiene que ser el que cargó la empresa (UAT-DUE-04). Tocá **Aceptar y continuar**.
4. Cuando el teléfono pregunte por la ubicación, tocá **Permitir** (mientras se usa la app).
5. Mirá la hora que muestra la pantalla y comparala con tu reloj.
6. Tocá **Registrar inicio**.
7. Mirá la pantalla **Servicio en curso**.

**Resultado esperado**

- El texto de consentimiento es el de la empresa.
- Al registrar, se abre **Servicio en curso**, con el cronómetro y "Iniciado a las HH:MM".
- La hora que quedó registrada es la **del servidor** (la pantalla aclara que la hora del celular es solo de referencia).
- La administración ve al Empleado A como **Presente** (UAT-ADM-17).

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-EMP-08 · Registrar el inicio sin ubicación

|                  |                                                                               |
| ---------------- | ----------------------------------------------------------------------------- |
| **Rol**          | Empleado (Empleado B)                                                         |
| **Dónde**        | Celular                                                                       |
| **Tipo**         | Opcional (hace falta un segundo empleado)                                     |
| **Cubre**        | RB-E04 (funciona con y sin permiso de ubicación)                              |
| **Precondición** | El Empleado B tiene el **Turno 3** de hoy y no dio el consentimiento todavía. |

**Pasos**

1. En el celular del Empleado B, ingresá y tocá el botón del medio (**Fichar**).
2. En "Tu ubicación al fichar", tocá **Continuar sin ubicación**.
3. Tocá **Registrar inicio**.

**Resultado esperado**

- Se registra el inicio igual, **sin pedir permiso de ubicación** y sin errores.
- La administración ve al Empleado B como **Presente**.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-EMP-09 · Marcar las tareas durante el servicio

|                  |                                                                             |
| ---------------- | --------------------------------------------------------------------------- |
| **Rol**          | Empleado (Empleado A)                                                       |
| **Dónde**        | Celular                                                                     |
| **Tipo**         | Imprescindible                                                              |
| **Cubre**        | RB-E05 (las tareas se marcan durante el servicio y el administrador las ve) |
| **Precondición** | UAT-EMP-07 hecho: el Turno 2 está en curso.                                 |

**Pasos**

1. En **Servicio en curso**, tocá **Tareas**.
2. Tocá el cuadradito de dos tareas para marcarlas como hechas.
3. Tocá una de las ya marcadas para deshacerla.
4. En otra tarea, tocá **No realizada**, escribí un **Motivo** y tocá **Marcar no realizada**.
5. Volvé a **Servicio en curso** y mirá el avance ("n de m").
6. Pedile a la administración que mire el detalle del Turno 2 (UAT-ADM-18).

**Resultado esperado**

- Cada tarea marcada muestra "Completada" y la hora. La que se deshizo vuelve a **Pendiente**.
- La tarea "No realizada" muestra el motivo.
- El avance de **Servicio en curso** coincide con las tareas completadas.
- Administración ve el mismo estado de cada tarea en el detalle del turno.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-EMP-10 · Cargar una observación del servicio

|                  |                                                                            |
| ---------------- | -------------------------------------------------------------------------- |
| **Rol**          | Empleado (Empleado A)                                                      |
| **Dónde**        | Celular                                                                    |
| **Tipo**         | Imprescindible                                                             |
| **Cubre**        | RB-E06 (la observación se ve en el detalle del turno y para el supervisor) |
| **Precondición** | El Turno 2 está en curso.                                                  |

**Pasos**

1. En **Servicio en curso**, tocá **Observaciones**.
2. Escribí una observación de prueba (por ejemplo "Observación de la prueba de aceptación").
3. Tocá **Guardar**.
4. Salí y volvé a entrar a **Observaciones**.

**Resultado esperado**

- La observación queda guardada y se ve al volver a entrar.
- Administración la ve en el detalle del Turno 2 (UAT-ADM-18) y la supervisora la ve en el detalle de su supervisión.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-18 · Ver en el detalle del turno lo que cargó el empleado

|                  |                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| **Rol**          | Administrador                                                                                    |
| **Dónde**        | Computadora                                                                                      |
| **Tipo**         | Imprescindible                                                                                   |
| **Cubre**        | RB-E05, RB-E06 y RB-A06 (el estado de cada turno coincide con lo registrado desde los celulares) |
| **Precondición** | UAT-EMP-07, UAT-EMP-09 y UAT-EMP-10 hechos.                                                      |

**Pasos**

1. Abrí el **Turno 2** desde **Planificación** (vista **Día**) o desde **Resumen**.
2. Mirá la sección **Dotación**: el estado del Empleado A, el **Inicio real**, el **Fin real** y cómo se registró.
3. Mirá la sección **Tareas**.
4. Buscá la **observación** del empleado.

**Resultado esperado**

- El Empleado A figura **Presente**, con el **Inicio real** y el texto "marcó desde la app".
- Las tareas muestran el mismo estado que marcó el empleado, y la que no se hizo muestra su motivo.
- Se ve la observación que cargó el empleado.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-EMP-11 · Registrar el fin y ver el resumen

|                  |                                                                          |
| ---------------- | ------------------------------------------------------------------------ |
| **Rol**          | Empleado (Empleado A)                                                    |
| **Dónde**        | Celular                                                                  |
| **Tipo**         | Imprescindible                                                           |
| **Cubre**        | RB-E04 (un empleado registra inicio y fin de un turno real)              |
| **Precondición** | El Turno 2 está en curso y todavía quedan tareas obligatorias sin hacer. |

**Pasos**

1. En **Servicio en curso**, tocá **Finalizar servicio**.
2. Leé el resumen y los avisos que aparecen.
3. Tocá **Registrar fin**.
4. Mirá el **Resumen del servicio** y tocá **Volver a Hoy**.

**Resultado esperado**

- Si quedan tareas obligatorias sin hacer, aparece un aviso ("Tenés ... tarea obligatoria pendiente. Podés registrar el fin igual."). **No impide terminar.**
- El **Resumen del servicio** muestra inicio, fin, duración, tareas y la observación.
- En **Hoy**, el servicio figura **Finalizado**. En la administración, el estado del turno cambia y el Empleado A figura **Finalizado**.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-19 · Registrar en nombre de un empleado y cerrar a mano

|                  |                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Rol**          | Administrador (Administrador 1, con el permiso **Registrar asistencia por otros**)                                            |
| **Dónde**        | Computadora                                                                                                                   |
| **Tipo**         | Imprescindible                                                                                                                |
| **Cubre**        | RB-A08 (registrar en nombre de otro, cerrar una asignación)                                                                   |
| **Precondición** | El **Turno 3** del Empleado B no tiene inicio registrado (si ya lo registró en UAT-EMP-08, usá otra asignación sin registro). |

**Pasos**

1. Entrá a **Asistencia**. Buscá la fila del Empleado B en el Turno 3.
2. Tocá **Registrar en nombre**.
3. Elegí la acción **Inicio**. Dejá la hora por omisión (ahora) o elegí una anterior de hoy. Escribí un **Motivo** ("Prueba de aceptación") y confirmá.
4. Mirá la fila de nuevo.
5. Tocá otra vez **Registrar en nombre**. Elegí **Cierre manual**, con un motivo, y confirmá.
6. Abrí el turno y mirá la sección **Dotación**.
7. Probá elegir una hora **futura**: la plataforma tiene que impedirlo.

**Resultado esperado**

- Después del paso 3 el Empleado B figura **Presente**, con el inicio registrado.
- Después del paso 5 figura **Finalizado**.
- El detalle del turno aclara que **lo cargó la administración** (con el nombre de quien lo hizo).
- No deja cargar una hora futura.
- También se puede registrar una **ausencia** en nombre de un empleado, incluso después de la hora de inicio.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-20 · La administración desde el celular

|                  |                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Rol**          | Administrador                                                                                                        |
| **Dónde**        | Celular                                                                                                              |
| **Tipo**         | Imprescindible                                                                                                       |
| **Cubre**        | RB-X01 (desde un celular: ver el tablero, asignar un empleado, registrar en nombre de otro, asignar una supervisión) |
| **Precondición** | Hay turnos con lugar libre y un turno sin inicio registrado. El Administrador 1 tiene su email en el celular.        |

**Pasos**

1. En el celular, ingresá con el email del Administrador 1.
2. Mirá **Hoy** (el tablero): los números del día y **Servicios de hoy**.
3. Tocá **Planificar**, elegí un turno con lugar libre y tocá **Asignar empleado**. Asigná a una persona.
4. Tocá **Asistencia** y, en una fila sin registro, tocá **Registrar en nombre** (con motivo) y confirmá.
5. Tocá **Supervisiones**, **Asignar supervisión**, y asigná una supervisión a un turno.

**Resultado esperado**

- Las cuatro cosas se pueden hacer desde el celular, igual que en la computadora.
- Las tablas se ven como tarjetas y los paneles ocupan toda la pantalla, sin que se corte nada.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

### Bloque E · La supervisión

#### UAT-SUP-01 · La supervisora ingresa y ve solo sus supervisiones

|                  |                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| **Rol**          | Supervisor (la supervisora)                                                                                |
| **Dónde**        | Celular                                                                                                    |
| **Tipo**         | Imprescindible                                                                                             |
| **Cubre**        | RB-S01 (ingreso con su propio usuario) y RB-S02 (aparece en Hoy de la supervisora correcta y de nadie más) |
| **Precondición** | UAT-ADM-08 y UAT-ADM-16 hechos.                                                                            |

**Pasos**

1. En el celular de la supervisora, abrí la dirección de la plataforma e ingresá con su email y contraseña.
2. Mirá la pantalla **Hoy**.
3. Tocá **Supervisiones**, abajo, y mirá la lista.
4. Si hay una segunda supervisora (o el Empleado A, que no es supervisor), pedile que mire que **esa supervisión no aparece** en su pantalla.

**Resultado esperado**

- Se abre **Hoy** con el saludo de la supervisora y la supervisión del **Turno 2** con estado **Asignada**: cliente, sede, horario y los empleados a supervisar.
- La pestaña **Supervisiones** también la muestra.
- **Nadie más** la ve.
- Abajo hay cuatro botones: **Hoy**, **Supervisiones**, **Historial** y **Más**.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-SUP-02 · El detalle de la supervisión

|                  |                                                                                   |
| ---------------- | --------------------------------------------------------------------------------- |
| **Rol**          | Supervisor                                                                        |
| **Dónde**        | Celular                                                                           |
| **Tipo**         | Imprescindible                                                                    |
| **Cubre**        | RB-S03 (sede, horario y personal a supervisar con su asistencia)                  |
| **Precondición** | UAT-SUP-01 hecho. El Empleado A ya registró su inicio en el Turno 2 (UAT-EMP-07). |

**Pasos**

1. En **Hoy**, tocá la supervisión del Turno 2.
2. Mirá la sección **Sede**, **Empleados a supervisar**, **Tareas del turno** y **Criterios de calificación**.

**Resultado esperado**

- Se ven la sede, el horario, las instrucciones, las restricciones y el contacto.
- **Empleados a supervisar** muestra a los empleados del turno con su estado (**Presente**, con la hora de inicio, o **Finalizado**).
- Las **tareas del turno** se ven con su estado, solo para mirar.
- La supervisora ve **solo** las supervisiones que le asignaron a ella.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-SUP-03 · Registrar el inicio de la supervisión

|                  |                                                         |
| ---------------- | ------------------------------------------------------- |
| **Rol**          | Supervisor                                              |
| **Dónde**        | Celular                                                 |
| **Tipo**         | Imprescindible                                          |
| **Cubre**        | RB-S01 (registra inicio y fin en cada sede supervisada) |
| **Precondición** | UAT-SUP-02 hecho.                                       |

**Pasos**

1. En el detalle de la supervisión, tocá **Registrar inicio de supervisión**.
2. Si aparece el texto de ubicación, elegí **Aceptar y continuar** o **Continuar sin ubicación**.
3. Tocá **Registrar inicio**.
4. Volvé al detalle de la supervisión.

**Resultado esperado**

- La supervisión pasa a **En curso**, con "Iniciada a las HH:MM".
- Aparecen los botones **Calificar** al lado de cada empleado y **Registrar fin de supervisión**.
- Administración ve la supervisión **En curso**, con el inicio.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-SUP-04 · Calificar a cada empleado con puntaje y comentario

|                  |                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Rol**          | Supervisor                                                                                                                   |
| **Dónde**        | Celular                                                                                                                      |
| **Tipo**         | Imprescindible                                                                                                               |
| **Cubre**        | RB-S04 (cada empleado recibe un puntaje de 1 a 5 y un comentario opcional) y RB-X04 (los criterios se muestran al calificar) |
| **Precondición** | UAT-SUP-03 hecho. Los criterios definitivos están cargados (UAT-DUE-03).                                                     |

**Pasos**

1. Tocá **Calificar** al lado del Empleado A.
2. Elegí **4 estrellas**. Escribí un **Comentario**. Mirá los **Criterios de calificación** que aparecen abajo.
3. Tocá **Guardar calificación**.
4. Volvé al detalle. Mirá el botón al lado del Empleado A.
5. Calificá de la misma manera a los demás empleados del turno, **sin comentario** en uno de ellos.
6. Volvé a calificar al Empleado A con **5 estrellas**.

**Resultado esperado**

- Cada empleado se califica de **1 a 5 estrellas**. El comentario es opcional.
- Los **criterios** que se ven son los definitivos de la empresa.
- Después de guardar, el botón del empleado pasa a decir **Editar**.
- Al volver a calificar, **se reemplaza** la calificación anterior (queda una sola).

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-SUP-05 · Registrar el fin y completar la supervisión

|                  |                                                                              |
| ---------------- | ---------------------------------------------------------------------------- |
| **Rol**          | Supervisor                                                                   |
| **Dónde**        | Celular                                                                      |
| **Tipo**         | Imprescindible                                                               |
| **Cubre**        | RB-S01 (registra inicio y fin) y RB-S04 (la supervisión se completa)         |
| **Precondición** | UAT-SUP-04 hecho (calificó a todos menos, si querés probar el aviso, a uno). |

**Pasos**

1. En el detalle, tocá **Registrar fin de supervisión**.
2. Tocá **Cerrar supervisión**.
3. Elegí **Completar**. Leé a cuántos empleados calificaste y si aparece un aviso.
4. Escribí una **Nota general** si querés.
5. Tocá **Completar supervisión**.

**Resultado esperado**

- Aparece "Calificaste a n de m empleados". Si falta alguno, hay un aviso, pero **se puede completar igual**.
- La supervisión pasa a **Completada**.
- Administración la ve **Completada**, con los puntajes y los comentarios.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-SUP-06 · Marcar una supervisión como "No se pudo realizar"

|                  |                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| **Rol**          | Supervisor                                                                                       |
| **Dónde**        | Celular                                                                                          |
| **Tipo**         | Opcional                                                                                         |
| **Cubre**        | RB-S04 (cierre de la supervisión)                                                                |
| **Precondición** | Otra supervisión asignada a la supervisora (asignala desde **Supervisiones**, sobre el Turno 3). |

**Pasos**

1. Abrí esa supervisión y tocá **Cerrar supervisión**.
2. Elegí **No se pudo realizar**.
3. Escribí el **Motivo** y tocá **Marcar como no realizada**.

**Resultado esperado**

- Sin escribir el motivo no deja continuar.
- La supervisión queda **No realizada**, con el motivo, y se ve en el **Historial** de la supervisora y en la administración.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-SUP-07 · El historial muestra solo lo propio

|                  |                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------- |
| **Rol**          | Supervisor                                                                          |
| **Dónde**        | Celular                                                                             |
| **Tipo**         | Imprescindible                                                                      |
| **Cubre**        | RB-S05 (el historial muestra solo las supervisiones propias con sus calificaciones) |
| **Precondición** | UAT-SUP-05 hecho.                                                                   |

**Pasos**

1. Tocá **Historial**.
2. Mirá las supervisiones que aparecen.
3. Tocá la del Turno 2 y mirá lo que muestra.

**Resultado esperado**

- El historial muestra las supervisiones **completadas** (y **no realizadas**) de esta supervisora, con las estrellas.
- El detalle se ve **solo para leer**, con cada calificación y su comentario.
- No hay supervisiones de otras personas.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-21 · Consultar supervisiones y calificaciones

|                  |                                                                               |
| ---------------- | ----------------------------------------------------------------------------- |
| **Rol**          | Administrador (con el permiso **Editar calificaciones**)                      |
| **Dónde**        | Computadora                                                                   |
| **Tipo**         | Imprescindible                                                                |
| **Cubre**        | RB-A09 (las supervisiones se consultan con filtros, con puntaje y comentario) |
| **Precondición** | UAT-SUP-05 hecho.                                                             |

**Pasos**

1. Entrá a **Supervisiones**. Mirá la lista.
2. Filtrá por **supervisor**, por **cliente**, por **estado** y por **fecha**. Sacá los filtros.
3. Entrá a la pestaña **Calificaciones**. Mirá una fila por empleado calificado.
4. Abrí la supervisión del Turno 2. Mirá los **criterios usados** y las calificaciones por empleado.
5. En un empleado, tocá **Editar** y cambiá el puntaje. Guardá.

**Resultado esperado**

- Los filtros por empleado, supervisor, cliente, sede, fecha y estado funcionan.
- La pestaña **Calificaciones** muestra puntaje y comentario de cada empleado, con fecha, sede y supervisor.
- El administrador con el permiso puede **editar** una calificación, y el detalle muestra **quién la editó y cuándo**.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

### Bloque F · Cierre

#### UAT-ADM-22 · Resetear la contraseña de una persona

|                  |                                                                       |
| ---------------- | --------------------------------------------------------------------- |
| **Rol**          | Administrador (con el permiso **Gestionar usuarios**)                 |
| **Dónde**        | Computadora, y el celular de la persona                               |
| **Tipo**         | Imprescindible                                                        |
| **Cubre**        | RB-A02 (gestión de empleados y supervisores)                          |
| **Precondición** | Una persona de prueba que pueda ingresar (por ejemplo el Empleado B). |

**Pasos**

1. Abrí la ficha del **Empleado B** (**Empleados**).
2. Tocá **Resetear contraseña**. Escribí una contraseña nueva (al menos 8 caracteres) y confirmá. Pasásela a la persona por un canal seguro.
3. En el celular del Empleado B, ingresá con la contraseña **vieja**.
4. Ingresá con la contraseña **nueva**.

**Resultado esperado**

- Con la contraseña vieja aparece "El email o la contraseña no son correctos."
- Con la nueva, entra.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-ADM-23 · Dar de baja a una persona y que pierda el acceso

|                  |                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Rol**          | Administrador (con el permiso **Gestionar usuarios**)                                                                                     |
| **Dónde**        | Computadora, y el celular de la persona                                                                                                   |
| **Tipo**         | Imprescindible                                                                                                                            |
| **Cubre**        | RB-A02 (una baja les quita el acceso)                                                                                                     |
| **Precondición** | Una persona de prueba **que no se vaya a usar más** (si podés, creá una para esto en esta sesión). Tiene la sesión abierta en un celular. |

**Pasos**

1. Abrí la ficha de esa persona y tocá **Dar de baja**. Leé el mensaje y confirmá.
2. En el celular de esa persona, que tenía la sesión abierta, abrí la app o tocá cualquier pantalla.
3. Probá ingresar de nuevo con su email y su contraseña.
4. En la administración, mirá **Empleados** y **Configuración**, **Usuarios** (con **Mostrar desactivados**).

**Resultado esperado**

- La persona **no puede iniciar sesión**: la app le muestra "Sin acceso" o que la cuenta está desactivada, con el teléfono de soporte si está cargado.
- Queda marcada como baja y **su historial se conserva**.
- Solo el **dueño** puede reactivarla.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-TRA-01 · Recuperar la contraseña por correo

|                  |                                                                                |
| ---------------- | ------------------------------------------------------------------------------ |
| **Rol**          | Cualquiera (se prueba con el Empleado A, y si se puede con una administradora) |
| **Dónde**        | Celular o computadora                                                          |
| **Tipo**         | Imprescindible                                                                 |
| **Cubre**        | RB-A01 y RB-E01 (ingreso seguro; recuperación de la contraseña)                |
| **Precondición** | La persona puede abrir el correo de su email de login.                         |

**Pasos**

1. En la pantalla de ingreso, tocá **¿Olvidaste tu contraseña?**
2. Escribí el email y tocá **Mandar instrucciones**.
3. Abrí el correo (mirá en **Spam** si no está). Tocá el enlace.
4. Escribí una contraseña nueva de al menos 8 caracteres, repetila y confirmá.
5. Ingresá con la contraseña nueva.

**Resultado esperado**

- Aparece "Revisá tu correo" con el mensaje "Si ese email tiene una cuenta, te mandamos un correo con instrucciones para restablecer la contraseña."
- El correo llega en unos minutos.
- El enlace abre la pantalla para elegir la contraseña nueva, y con ella se puede ingresar.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-TRA-02 · Cerrar sesión

|                  |                                          |
| ---------------- | ---------------------------------------- |
| **Rol**          | Todos                                    |
| **Dónde**        | Celular y computadora                    |
| **Tipo**         | Imprescindible                           |
| **Cubre**        | RB-A01, RB-E01 y RB-S01 (ingreso seguro) |
| **Precondición** | Cada rol con la sesión abierta.          |

**Pasos**

1. **Empleado y supervisora:** en el celular, tocá **Más** y **Cerrar sesión**.
2. **Administración y dueño:** en la computadora, tocá tu foto (arriba a la derecha) y **Cerrar sesión**.
3. Probá volver atrás o abrir de nuevo la dirección.

**Resultado esperado**

- Cada uno vuelve a la pantalla de ingreso.
- No se puede ver ninguna pantalla interna sin volver a ingresar.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-TRA-03 · Sin conexión

|                  |                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------- |
| **Rol**          | Empleado                                                                                  |
| **Dónde**        | Celular instalado                                                                         |
| **Tipo**         | Opcional                                                                                  |
| **Cubre**        | Funcionamiento de la app sin conexión (la app abre, los datos no se guardan para después) |
| **Precondición** | La app instalada (UAT-EMP-02), con sesión abierta.                                        |

**Pasos**

1. Poné el celular en **modo avión**.
2. Abrí la app y mirá **Hoy**.
3. Intentá registrar un inicio o un aviso.
4. Sacá el modo avión y volvé a intentar.

**Resultado esperado**

- La app **abre** sin conexión, pero no muestra los servicios ("No pudimos cargar tu jornada...").
- Los botones que guardan quedan apagados con un aviso de que no hay conexión: **no se guarda nada para después**.
- Con conexión, todo funciona de nuevo.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-TRA-04 · Android y iPhone

|                  |                                                                 |
| ---------------- | --------------------------------------------------------------- |
| **Rol**          | Empleado y supervisora                                          |
| **Dónde**        | Un Android con Chrome y un iPhone con Safari                    |
| **Tipo**         | Opcional                                                        |
| **Cubre**        | RB-E01 y RB-S01 (ingresan desde su celular) en los dos sistemas |
| **Precondición** | Los dos celulares disponibles.                                  |

**Pasos**

1. En cada celular, hacé UAT-EMP-01 (ingreso) y UAT-EMP-03 (Hoy).
2. En cada celular, tocá **Fichar** y mirá que el botón y la pantalla se ven completos, sin que el teclado o los bordes tapen nada.
3. Girá el celular y volvé a ponerlo vertical.

**Resultado esperado**

- Todo se ve y funciona igual en los dos celulares.
- Los botones de abajo no quedan tapados por la barra del sistema.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-EMP-12 · Los cambios desde la última visita

|                  |                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Rol**          | Empleado (Empleado A) y administración                                                  |
| **Dónde**        | Celular y computadora                                                                   |
| **Tipo**         | Opcional                                                                                |
| **Cubre**        | RB-E02 (jornada del día y servicios asignados)                                          |
| **Precondición** | El Empleado A tiene un turno de los próximos días (no el de hoy) que todavía no empezó. |

**Pasos**

1. En el celular del Empleado A, abrí **Hoy** (para que quede "visto").
2. En la administración, abrí ese turno futuro del Empleado A y tocá **Editar franja**: cambiá el horario y guardá.
3. En el celular del Empleado A, volvé a abrir **Hoy**.

**Resultado esperado**

- En **Hoy** aparece el aviso **Cambios desde tu última visita**, que indica el servicio cuyo horario cambió.
- Al volver a abrir **Hoy**, el aviso ya no aparece.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-SUP-08 · Editar una calificación: dentro y fuera de plazo

|                  |                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------- |
| **Rol**          | Supervisor y administración                                                        |
| **Dónde**        | Celular y computadora                                                              |
| **Tipo**         | Opcional (parte se prueba al día siguiente)                                        |
| **Cubre**        | RB-S04 (fuera del plazo no se edita)                                               |
| **Precondición** | UAT-SUP-05 hecho. Una supervisión con calificaciones de un turno **ya terminado**. |

**Pasos**

1. **Dentro del plazo:** mientras el turno no terminó, la supervisora abre la supervisión y cambia una calificación. (Ya se probó en UAT-SUP-04.)
2. **Fuera del plazo:** al día siguiente, la supervisora entra a **Historial**, abre la supervisión y trata de cambiar una calificación.
3. La administración (con el permiso **Editar calificaciones**) intenta cambiar esa misma calificación.

**Resultado esperado**

- La supervisora **no puede** cambiarla: aparece "El plazo para editar esta calificación terminó."
- La administración **sí puede** y queda anotado quién la editó y cuándo.

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

#### UAT-DUE-05 · El dueño revisa los eventos de seguridad y deja todo como estaba

|                  |                                                        |
| ---------------- | ------------------------------------------------------ |
| **Rol**          | Dueño                                                  |
| **Dónde**        | Computadora                                            |
| **Tipo**         | Imprescindible                                         |
| **Cubre**        | RB-A01 (acceso por perfil) y control de quién hizo qué |
| **Precondición** | Fin de la sesión.                                      |

**Pasos**

1. Entrá a **Configuración**, pestaña **Eventos de seguridad**.
2. Mirá los últimos eventos: inicios de sesión, resets de contraseña, bajas. Filtrá por una persona.
3. Entrá a **Usuarios**. Abrí el menú del **Administrador 2** y **Editar roles y capacidades**. **Volvé a encender** el permiso **Generar turnos del mes**.

**Resultado esperado**

- Los eventos de la sesión (inicios de sesión, el reseteo de contraseña, la baja) figuran, con fecha y hora, quién los hizo y sobre quién.
- El Administrador 2 recupera su permiso (cuando vuelva a ingresar, ve **Generar turnos del mes**).

| Resultado           | Observación | Clasificación                             |
| ------------------- | ----------- | ----------------------------------------- |
| ☐ OK &nbsp; ☐ Falla |             | ☐ Base &nbsp; ☐ Ampliación &nbsp; ☐ No sé |

---

## 5. Acta de la sesión

Se completa **al final de la sesión**, con la referente. Es el documento que queda firmado.

### 5.1. Datos de la sesión

| Dato                     | Valor                                               |
| ------------------------ | --------------------------------------------------- |
| Fecha                    |                                                     |
| Hora de inicio y de fin  |                                                     |
| Lugar o modalidad        |                                                     |
| Entorno probado          | Entorno de pruebas (`dev.extendiendoservicios.com`) |
| Versión de la plataforma | (la que figura abajo del menú: "Versión x.y.z")     |

### 5.2. Participantes

| Nombre | Rol en la sesión (referente, dueño, administración, empleado, supervisora, organizador) | Firma |
| ------ | --------------------------------------------------------------------------------------- | ----- |
|        |                                                                                         |       |
|        |                                                                                         |       |
|        |                                                                                         |       |
|        |                                                                                         |       |
|        |                                                                                         |       |

### 5.3. Resumen de resultados

| Dato                                                 | Cantidad |
| ---------------------------------------------------- | -------- |
| Escenarios del guion                                 | 52       |
| Escenarios ejecutados                                |          |
| Con resultado **OK**                                 |          |
| Con resultado **Falla**                              |          |
| **No ejecutados** (y por qué, en las observaciones)  |          |
| Observaciones **Base**                               |          |
| Observaciones **Ampliación**                         |          |
| Observaciones **No sé** (se deciden en el punto 5.5) |          |

### 5.4. Lista de observaciones

Una fila por observación. Sirve para decidir qué se corrige.

| N°  | Escenario (código) | Qué se observó | Clasificación (Base, Ampliación, No sé) | Qué se acuerda (corregir, cotizar, aclarar, descartar) |
| --- | ------------------ | -------------- | --------------------------------------- | ------------------------------------------------------ |
| 1   |                    |                |                                         |                                                        |
| 2   |                    |                |                                         |                                                        |
| 3   |                    |                |                                         |                                                        |
| 4   |                    |                |                                         |                                                        |
| 5   |                    |                |                                         |                                                        |
| 6   |                    |                |                                         |                                                        |
| 7   |                    |                |                                         |                                                        |
| 8   |                    |                |                                         |                                                        |

(Si no alcanzan las filas, se agregan en una hoja aparte y se firma cada hoja.)

### 5.5. Clasificación de las observaciones dudosas

Las observaciones marcadas **No sé** se clasifican acá, de común acuerdo, con la regla de la V3 punto 7: lo que es una función del punto 1 que no funciona o un ajuste menor es **Base** y se corrige sin costo; lo que no figura en el punto 1 o cambia un criterio ya aprobado es **Ampliación** y se cotiza.

| N° de observación | Clasificación final (Base o Ampliación) | Comentario |
| ----------------- | --------------------------------------- | ---------- |
|                   |                                         |            |
|                   |                                         |            |
|                   |                                         |            |

### 5.6. Conclusión

Marcá una opción:

- ☐ **Aceptada.** La referente ejecutó los flujos del punto 1 de la V3 en el entorno de pruebas y los da por válidos.
- ☐ **Aceptada con observaciones de la Base.** Los flujos funcionan, y se acuerda corregir las observaciones clasificadas como **Base** antes de pasar a producción. Las clasificadas como **Ampliación** quedan anotadas para cotizar aparte.
- ☐ **No aceptada.** Hay fallas que impiden usar los flujos del punto 1. Se acuerda repetir los escenarios que fallaron, una vez corregidos.

Resumen en pocas líneas (qué funcionó bien, qué hay que corregir, qué queda para después):

&nbsp;

&nbsp;

&nbsp;

### 5.7. Firmas

Esta acta registra el resultado de la prueba de aceptación en el **entorno de pruebas**. La aceptación definitiva de la Plataforma Base, según la V3 punto 7, se da cuando los flujos funcionan correctamente en **producción**.

| Firma de la referente de la empresa | Firma de quien condujo la sesión |
| ----------------------------------- | -------------------------------- |
| &nbsp;                              | &nbsp;                           |
| &nbsp;                              | &nbsp;                           |
| Aclaración:                         | Aclaración:                      |
| Fecha:                              | Fecha:                           |
