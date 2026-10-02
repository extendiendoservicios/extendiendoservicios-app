# Matriz de dispositivos reales (RESP-011)

Planilla de la prueba manual de la aplicación en tres teléfonos de verdad: **dos Android** (Android 8 o superior, con Chrome) y **un iPhone** (iOS 16.4 o superior, con Safari). La completa **Mike**, sin necesidad de saber de programación: cada punto dice qué tocar, qué tiene que pasar, y hay un lugar para marcar **OK** o **Falla** por teléfono.

Es la parte de dispositivos reales de la suite responsive (TEST-014; ver `tests/README.md`). Cómo funcionan la instalación y las actualizaciones que se prueban acá está en [`pwa.md`](pwa.md), y qué cambia en cada ancho de pantalla en [`features/responsive.md`](features/responsive.md). Complementa a las guías por rol de `docs/testing/` (`prueba-android-empleado.md`, MOB-EMP-018), que profundizan en el flujo del empleado en Android.

Dirección para probar: **https://dev.extendiendoservicios.com** (entorno de prueba; no pasa nada si algo sale mal).

## Antes de empezar

Pedile esto a Claude **antes** de arrancar (no escribas contraseñas en este archivo: el repositorio es público; anotalas a mano en papel):

- [ ] Un usuario de prueba **empleado** con **un servicio de hoy** sin iniciar, con al menos dos tareas, y **otro servicio** que todavía no haya empezado (para el aviso de demora; puede ser el mismo si empieza más tarde).
- [ ] Un usuario de prueba **supervisor** con **una supervisión asignada para hoy**, sobre un servicio donde haya al menos un empleado que **ya fichó el inicio**.
- [ ] Un usuario de prueba **dueño** (o administrador).
- [ ] Que alguien pueda **publicar una versión nueva en staging** durante la prueba (punto 10).

Si no tenés esto, no arranques: avisá y esperá a que te lo den.

Qué necesitás en cada teléfono:

- La ubicación (GPS) del teléfono **activada**.
- Batería y datos móviles o wifi.
- Un lugar donde puedas hacer la prueba sin apuro (todo lleva entre 1 hora y 1 hora y media por teléfono).

## Datos de los teléfonos

Completá una columna por teléfono antes de empezar. La versión del sistema está en **Ajustes → Acerca del teléfono** (Android) o **Ajustes → General → Información** (iPhone).

| Dato                                         | Android 1 | Android 2 | iPhone |
| -------------------------------------------- | --------- | --------- | ------ |
| Marca y modelo                               |           |           |        |
| Versión del sistema (Android o iOS)          |           |           |        |
| Navegador y versión (Chrome / Safari)        |           |           |        |
| Tamaño de pantalla (chico, mediano, grande)  |           |           |        |
| ¿Tiene muesca, cámara en la pantalla o isla? |           |           |        |
| ¿Navegación por botones o por gestos?        |           |           |        |
| Fecha de la prueba                           |           |           |        |
| Quién la hizo                                |           |           |        |

## Cómo anotar

- En cada punto hay una tabla con una fila por teléfono. En **Resultado** escribí **OK** si pasó lo que dice «Tiene que pasar», **Falla** si no, o **No aplica** si el punto es de otro sistema (por ejemplo, instalar desde iPhone en un Android).
- En **Observaciones** contá en una frase qué viste. Si es **Falla**, es lo más importante: qué esperabas, qué pasó, y si podés, sacá una captura de pantalla (Android: encendido + bajar volumen; iPhone: encendido + subir volumen).
- Si un punto falla, seguí con el siguiente, salvo que no puedas continuar: ahí anotalo y avisá.

---

## 1. Instalar la aplicación

La idea es que la app quede en la pantalla de inicio del teléfono, como cualquier otra.

### 1.1 · Abrir la dirección en el navegador

1. Android: abrí **Chrome**. iPhone: abrí **Safari** (el ícono de la brújula azul; no sirve Chrome en iPhone para esta prueba).
2. Escribí `https://dev.extendiendoservicios.com` y entrá.

**Tiene que pasar:** Se ve la pantalla de **Ingresar** con el logo, los campos Email y Contraseña, y arriba una franja que dice que es un entorno de prueba.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 1.2 · Instalar desde Android

1. Con la pantalla de Ingresar abierta, mirá si aparece un cartel que dice **Instalá la aplicación** (puede estar arriba o abajo). Si aparece, tocá **Instalar**.
2. Si no aparece: tocá los **tres puntitos** de Chrome (arriba a la derecha) y elegí **Instalar aplicación** (en algunos teléfonos dice **Agregar a la pantalla principal**).
3. Confirmá tocando **Instalar** en el cartel del teléfono.

**Tiene que pasar:** El teléfono avisa que la aplicación se instaló y aparece un ícono nuevo en la pantalla de inicio.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    | No aplica              |               |

### 1.3 · Instalar desde iPhone

1. Con la pantalla de Ingresar abierta en Safari, tocá el botón **Compartir** (el cuadradito con una flecha hacia arriba, abajo en el centro).
2. Deslizá la lista hacia arriba y tocá **Agregar a pantalla de inicio**.
3. Dejá el nombre como está y tocá **Agregar** (arriba a la derecha).

**Tiene que pasar:** Aparece un ícono nuevo en la pantalla de inicio del iPhone.

> En iPhone el cartel de la app (**Instalá la aplicación**) no tiene botón Instalar: solo explica estos pasos. Eso es lo esperado.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 | No aplica              |               |
| Android 2 | No aplica              |               |
| iPhone    |                        |               |

### 1.4 · El ícono y el nombre

1. Mirá el ícono nuevo en la pantalla de inicio del teléfono.

**Tiene que pasar:** El ícono es el logo de la empresa en blanco sobre fondo verde azulado, **sin bordes cortados ni franjas blancas**, y el nombre debajo dice **Ext. Servicios** (puede verse cortado si tu teléfono limita el largo).

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 1.5 · Abrir a pantalla completa

1. Cerrá el navegador (deslizalo hacia arriba desde las apps recientes, o simplemente no lo uses).
2. Tocá el ícono **Ext. Servicios** de la pantalla de inicio.

**Tiene que pasar:** Se ve primero una pantalla verde azulada con el logo (mientras carga) y después la app **sin la barra de direcciones del navegador**: ocupa toda la pantalla, solo se ve la hora y la batería arriba.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 1.6 · Color de la barra de arriba

1. Con la app abierta, mirá la franja de arriba (donde está la hora).

**Tiene que pasar:** La franja es del mismo verde azulado de la app (en iPhone puede verse transparente con la cabecera de la app detrás); no queda una franja blanca o negra suelta.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

## 2. Iniciar sesión según el rol

Necesitás tres cuentas de prueba (ver «Antes de empezar»). Hacé cada ingreso con la app **instalada**. Para cambiar de cuenta: **Más** → **Cerrar sesión**.

### 2.1 · Empleado

1. En **Ingresar** escribí el email y la contraseña de la cuenta de **empleado** y tocá **Ingresar**.

**Tiene que pasar:** Entrás a la pantalla **Hoy**, con una tarjeta grande del servicio de hoy, y abajo la barra con **Hoy · Fichar · Más**.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 2.2 · Supervisor

1. Cerrá sesión (**Más** → **Cerrar sesión**) e ingresá con la cuenta de **supervisor**.

**Tiene que pasar:** Entrás a **Hoy** del supervisor con la lista de supervisiones, y abajo la barra con **Hoy · Supervisiones · Historial · Más**.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 2.3 · Dueño o administrador

1. Cerrá sesión e ingresá con la cuenta de **dueño** (o administrador).

**Tiene que pasar:** Entrás al tablero **Hoy** de administración, con los números de la jornada, y abajo la barra con **Hoy · Planificar · Asistencia · Supervisiones · Más**.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 2.4 · La sesión se mantiene

1. Con la sesión abierta, cerrá la app del todo (deslizala hacia arriba desde las apps recientes).
2. Volvé a tocar el ícono **Ext. Servicios**.

**Tiene que pasar:** La app abre directamente en la pantalla de adentro, **sin pedir de nuevo el email y la contraseña**.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 2.5 · Contraseña equivocada

1. Cerrá sesión. En Ingresar escribí un email correcto y una contraseña incorrecta, y tocá **Ingresar**.

**Tiene que pasar:** Aparece un mensaje de error claro en español, sin pantalla blanca ni cierre de la app.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

## 3. Empleado: fichar el inicio y el fin con ubicación

Usá la cuenta de **empleado** con un servicio de hoy sin iniciar (ver «Antes de empezar»). Tenés que estar con la ubicación (GPS) del teléfono activada.

### 3.1 · Registrar el inicio y dar permiso de ubicación

1. En **Hoy** tocá **Fichar** (el botón del medio, abajo).
2. Si aparece el aviso de ubicación de la app, tocá **Aceptar y continuar**.
3. Cuando el teléfono pregunte si permitís la ubicación, elegí: Android **Mientras se usa la app** (o **Permitir**); iPhone **Permitir al usar la app**.
4. Tocá el botón grande **Registrar inicio**.

**Tiene que pasar:** Aparece la confirmación con la hora y pasás a la pantalla **Servicio en curso** con un cronómetro que avanza.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 3.2 · Servicio en curso

1. Mirá la pantalla un minuto. Tocá **Tareas** y marcá una tarea como completada. Volvé atrás.
2. Tocá **Observaciones**, escribí una frase corta y guardala. Volvé atrás.

**Tiene que pasar:** El cronómetro sigue avanzando, la tarea marcada se queda marcada y la observación se guarda sin errores.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 3.3 · Registrar el fin

1. Tocá **Finalizar servicio** y después **Registrar fin**.

**Tiene que pasar:** Se ve el **resumen del servicio** con hora de inicio, hora de fin y duración. El botón **Volver a Hoy** te lleva a la pantalla Hoy.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 3.4 · Ubicación negada (opcional, con otro servicio)

1. Con otro servicio sin iniciar (pedíselo a Claude), tocá **Fichar** y esta vez, cuando el teléfono pregunte por la ubicación, elegí **No permitir**.

**Tiene que pasar:** La app no se rompe: te deja registrar igual o te explica qué hacer, con un mensaje claro en español.

> Si no tenés un segundo servicio, dejá esta fila en blanco y anotalo en Observaciones.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

## 4. Empleado: avisar una demora

### 4.1 · Avisar demora

1. Con la cuenta de **empleado** y un servicio que **todavía no empezó**, tocá **Más** → **Avisar demora o ausencia**.
2. Elegí el servicio, dejá marcado **Demora**, poné 15 minutos y tocá el botón para confirmar.

**Tiene que pasar:** Aparece la confirmación y, al volver a **Hoy**, el servicio muestra que tiene una demora avisada.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

## 5. Supervisor: supervisión y calificación

Usá la cuenta de **supervisor**, con una supervisión asignada para hoy sobre un servicio que tenga al menos un empleado que ya fichó (ver «Antes de empezar»).

### 5.1 · Abrir la supervisión

1. En **Hoy** tocá la supervisión de hoy.

**Tiene que pasar:** Se ve el detalle: cliente, sede, dirección, horario y la lista de empleados a supervisar con su estado.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 5.2 · Registrar el inicio de la supervisión

1. Tocá **Registrar inicio de supervisión**. Aceptá el permiso de ubicación como en el punto 3.1 si lo pide.
2. Tocá **Registrar inicio**.

**Tiene que pasar:** Se ve la hora de inicio y aparece el botón **Registrar fin**.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 5.3 · Calificar a un empleado

1. Volvé al detalle de la supervisión y tocá **Calificar** en un empleado.
2. Tocá 4 estrellas, escribí un comentario corto y guardá.

**Tiene que pasar:** Las estrellas se pueden tocar con el dedo sin errar, se guarda la calificación y el empleado figura como calificado.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 5.4 · Registrar el fin y cerrar la supervisión

1. Tocá **Registrar fin de supervisión**.
2. Tocá **Completar supervisión** (si avisa que faltan empleados por calificar, es solo una advertencia).

**Tiene que pasar:** La supervisión pasa a **completada** y aparece en **Historial** con su puntaje.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

## 6. Administración: la barra de abajo y «Más»

Usá la cuenta de **dueño**.

### 6.1 · Las cinco pestañas

1. Tocá una por una: **Hoy**, **Planificar**, **Asistencia**, **Supervisiones**.

**Tiene que pasar:** Cada una abre su pantalla; la pestaña en la que estás se ve resaltada; ninguna pantalla se corta ni obliga a mover la pantalla hacia los costados.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 6.2 · El menú «Más»

1. Tocá **Más** (la última pestaña).
2. Tocá **Empleados**. Volvé con la flecha de la app (no con la del teléfono) y repetí con **Clientes y sedes**, **Tareas** y **Configuración**.

**Tiene que pasar:** «Más» muestra una lista con Empleados, Clientes y sedes, Tareas y Configuración. Cada opción abre su pantalla y se puede volver. Las listas se ven como **tarjetas**, no como tablas.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 6.3 · Nada se corta hacia los costados

1. En **Planificar** y en **Empleados**, pasá el dedo hacia la izquierda y la derecha sobre el contenido.

**Tiene que pasar:** La pantalla no se corre de costado. (Las pestañas de arriba de una pantalla sí pueden deslizarse; eso es normal.)

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

## 7. El teclado sobre los formularios

Cuando aparece el teclado, la pantalla tiene que acomodarse para que veas lo que escribís.

### 7.1 · Ingresar

1. Cerrá sesión. Tocá el campo **Contraseña** para que aparezca el teclado.

**Tiene que pasar:** El campo y el botón **Ingresar** siguen a la vista (o se pueden alcanzar deslizando) y no quedan tapados por el teclado.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 7.2 · Observaciones del empleado

1. Con la cuenta de **empleado** y un servicio en curso, abrí **Observaciones** y tocá el cuadro de texto.

**Tiene que pasar:** El texto que escribís se ve; el botón **Guardar** se puede tocar sin cerrar el teclado a mano; la barra de abajo no queda flotando arriba del teclado.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 7.3 · Comentario de la calificación

1. Con la cuenta de **supervisor**, abrí la calificación de un empleado y tocá el cuadro de comentario.

**Tiene que pasar:** Igual que arriba: se ve lo que escribís y se llega al botón de guardar.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 7.4 · Un formulario de administración

1. Con la cuenta de **dueño**, andá a **Más** → **Clientes y sedes** y tocá el botón de crear un cliente nuevo. Tocá varios campos, incluido el último de la lista.
2. No guardes nada: salí con la flecha de volver.

**Tiene que pasar:** Cada campo que tocás queda a la vista sobre el teclado, y se puede llegar al último campo y a los botones.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

## 8. Área segura: muesca, barra de inicio y botones del sistema

Se hace con la app **instalada**. Es lo que más cambia entre un teléfono y otro.

### 8.1 · Arriba (muesca, cámara, isla)

1. En las pantallas **Hoy** de cada rol, mirá la parte de arriba.

**Tiene que pasar:** El saludo, el título y los botones de arriba **no quedan debajo de la muesca, la cámara ni la hora**.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 8.2 · Abajo (barra de inicio del iPhone o botones del sistema de Android)

1. Mirá la barra de pestañas de abajo en cada rol (en la de empleado, también el botón **Fichar**).
2. Probá tocar la pestaña de más a la izquierda y la de más a la derecha.

**Tiene que pasar:** La barra queda **por encima** de la rayita de inicio del iPhone o de los botones de Android, sin superponerse; el botón **Fichar** no queda tapado; todas las pestañas responden al toque.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 8.3 · Botones al final de una pantalla

1. Con la cuenta de **empleado**, entrá a **Finalizar servicio** (con un servicio en curso) o a **Avisar demora o ausencia** y bajá hasta el final.

**Tiene que pasar:** Los botones del final se ven completos, no quedan debajo de la barra de inicio y no tapan el último renglón del contenido.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

## 9. Rotar el teléfono

### 9.1 · Girar a horizontal y volver

1. Activá la rotación automática del teléfono (en iPhone, desactivá el bloqueo de orientación desde el Centro de control).
2. Con la app abierta en **Hoy**, girá el teléfono a horizontal. Mirá un par de pantallas. Volvé a vertical.

**Tiene que pasar:** La app se acomoda sin cortarse ni quedar con partes tapadas (con la muesca a un costado, el contenido no pasa por debajo de ella). Al volver a vertical, queda todo como antes y no se perdió lo escrito.

> No hace falta que sea lindo en horizontal; lo importante es que se pueda usar y no se rompa.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

## 10. Aviso de nueva versión después de un despliegue

Este punto necesita que **Claude publique una versión nueva** mientras vos tenés la app instalada. Coordinalo así:

### 10.1 · Recibir el aviso

1. Dejá la app **instalada** con la sesión abierta (cualquier rol).
2. Avisale a Claude: «Publicá una versión nueva en staging». Esperá a que te confirme que terminó (tarda unos 2 minutos).
3. En el teléfono, mandá la app al fondo (volvé a la pantalla de inicio), esperá unos 10 segundos y volvé a abrirla. Si no aparece nada, cerrala del todo y abrila de nuevo. (La app también busca versiones nuevas sola una vez por hora.)

**Tiene que pasar:** Aparece un cartel que dice **Hay una versión nueva de la aplicación** con el botón **Actualizar ahora**. La app **no se recarga sola** mientras no lo toques.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 10.2 · Actualizar

1. Tocá **Actualizar ahora**.

**Tiene que pasar:** La app se recarga sola, **sigue con tu sesión abierta** y el cartel desaparece. Si volvés a abrirla más tarde, no vuelve a aparecer el mismo cartel.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 10.3 · «Más tarde» (opcional)

1. Si podés pedir otro despliegue, cuando aparezca el cartel tocá **Más tarde**.

**Tiene que pasar:** El cartel se oculta y la app sigue funcionando con la versión anterior, sin errores. Vuelve a aparecer más adelante.

> Si no hay forma de pedir otro despliegue, dejá esta fila en blanco y anotalo en Observaciones.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

## 11. Sin conexión

**Qué tiene que pasar y qué no.** La app instalada se abre aunque no haya internet (se guarda la «carcasa» de la app), pero **no guarda datos**: sin internet no se ven los servicios nuevos ni se puede fichar. Eso es lo esperado. Lo importante es que avise bien, no se rompa, y se recupere sola al volver internet.

### 11.1 · Abrir sin internet

1. Con la app instalada y la sesión abierta, cerrala del todo.
2. Activá el **modo avión** (y apagá el wifi si se prendió).
3. Tocá el ícono **Ext. Servicios**.

**Tiene que pasar:** La app abre (no aparece el dinosaurio ni «Sin conexión a internet» del navegador). Las pantallas que necesitan datos pueden quedar cargando o mostrar un aviso de error: **no es falla**, siempre que no quede la pantalla en blanco para siempre.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 11.2 · Aviso al intentar fichar

1. Con la cuenta de **empleado**, con el modo avión puesto, intentá entrar a **Fichar** o a un servicio en curso.

**Tiene que pasar:** Aparece el mensaje **Estás sin conexión** (por ejemplo «Conectate para poder fichar»), y el botón para registrar no deja guardar nada. En un servicio en curso, se sigue viendo el servicio.

> Si la pantalla no llega a cargar por falta de datos, anotalo en Observaciones con lo que se veía.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

### 11.3 · Volver la conexión

1. Desactivá el modo avión y esperá unos segundos.
2. Volvé a abrir o actualizar la pantalla (deslizá hacia abajo o cerrá y abrí la app).

**Tiene que pasar:** La app vuelve a traer los datos y se puede fichar de nuevo. No hace falta reinstalarla ni volver a iniciar sesión.

| Teléfono  | Resultado (OK / Falla) | Observaciones |
| --------- | ---------------------- | ------------- |
| Android 1 |                        |               |
| Android 2 |                        |               |
| iPhone    |                        |               |

---

## Problemas encontrados

Un renglón por problema (los puntos que dieron **Falla**, con más detalle). Después se los pasás a Claude para que los clasifique.

| N.º | Punto | Teléfono | Qué esperabas | Qué pasó | Captura (nombre del archivo) |
| --- | ----- | -------- | ------------- | -------- | ---------------------------- |
| 1   |       |          |               |          |                              |
| 2   |       |          |               |          |                              |
| 3   |       |          |               |          |                              |
| 4   |       |          |               |          |                              |
| 5   |       |          |               |          |                              |

## Resumen

| Teléfono  | Puntos OK | Puntos con Falla | Puntos que no aplican | ¿Se puede usar la app en este teléfono? (sí / con problemas / no) |
| --------- | --------- | ---------------- | --------------------- | ----------------------------------------------------------------- |
| Android 1 |           |                  |                       |                                                                   |
| Android 2 |           |                  |                       |                                                                   |
| iPhone    |           |                  |                       |                                                                   |

## Criterio de aceptación (F17)

Según `08_Fases_y_Backlog.md`, F17 se da por cumplida en dispositivos cuando:

- Las tareas de administración se completan desde un celular de 390 px **sin scroll horizontal** (puntos 6.1 a 6.3).
- La app instalada **abre a pantalla completa** (1.5) y **se actualiza sola tras un despliegue** (10.1 y 10.2).

Cualquier **Falla** en los puntos 1, 2, 3, 5, 6 y 10 es bloqueante para cerrar F17; el resto se evalúa caso por caso.
