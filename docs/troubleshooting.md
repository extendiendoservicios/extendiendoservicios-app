# Problemas frecuentes y qué hacer

DOC-021 (`08_Fases_y_Backlog.md` F19; `03_Plan_Maestro_Tecnico.md` sección 17). Para empleados, supervisores, administradores y para quien da soporte técnico.

Cada problema tiene tres partes: **qué ves** (el síntoma), **por qué pasa** (la causa) y **qué hacer**. Lo que resuelve cada persona está separado en tres niveles:

- **Lo resolvés vos:** pasos que puede hacer cualquier usuario desde su celular o su computadora.
- **Lo resuelve Administración:** pasos que hace el dueño o un administrador desde la plataforma (las guías explican cómo: [`guia-admin.md`](guia-admin.md)).
- **Lo resuelve el soporte técnico:** cosas que no se arreglan desde la app (servidor, correo, versión).

Los textos entre comillas son los que muestra la app, tal cual.

## Índice

1. [Ingreso y sesión](#1-ingreso-y-sesión)
2. [Ubicación](#2-ubicación)
3. [Instalación y actualización de la app](#3-instalación-y-actualización-de-la-app)
4. [Sin conexión y servicio caído](#4-sin-conexión-y-servicio-caído)
5. [Registro de jornada, avisos y tareas (empleados)](#5-registro-de-jornada-avisos-y-tareas-empleados)
6. [Supervisiones (supervisores)](#6-supervisiones-supervisores)
7. [Administración](#7-administración)
8. [Antes de pedir ayuda al soporte técnico](#8-antes-de-pedir-ayuda-al-soporte-técnico)

---

## 1. Ingreso y sesión

### 1.1. "El email o la contraseña no son correctos."

- **Por qué pasa:** el email o la contraseña están mal escritos. Por seguridad, la app no dice cuál de los dos falló.
- **Lo resolvés vos:**
  1. Tocá el ojito del campo de la contraseña para ver lo que escribiste.
  2. Revisá que no haya mayúsculas de más ni un espacio al final (el teclado del celular suele agregar una mayúscula al principio).
  3. Si no te acordás de la contraseña, tocá **¿Olvidaste tu contraseña?** (ver 1.2).
- **Lo resuelve Administración:** si el email de login que tiene la persona cargado no es el que ella usa, el dueño o un administrador con permiso "Gestionar usuarios" lo corrige desde **Configuración**, **Usuarios**, menú de la persona, **Cambiar email**. También puede **Resetear contraseña** y pasarle la nueva por un canal seguro (nunca por un grupo).

### 1.2. No llega el correo para recuperar la contraseña

- **Qué ves:** pediste el cambio y aparece "Si ese email tiene una cuenta, te mandamos un correo con instrucciones para restablecer la contraseña." Pero no llega nada.
- **Por qué pasa:** ese mensaje se muestra siempre, exista o no la cuenta (para no revelar quién tiene usuario). Las causas más comunes: el email está mal escrito, no es el email de login de la persona, el correo cayó en **Spam** o **Promociones**, o tardó unos minutos.
- **Lo resolvés vos:** esperá cinco minutos, revisá Spam y Promociones, y confirmá que escribiste el mismo email con el que ingresás. Si aparece "Hiciste demasiados pedidos. Esperá un momento y probá de nuevo.", esperá unos minutos antes de volver a pedirlo.
- **Lo resuelve Administración:** verificar el email de login de la persona y, si hace falta, **Cambiar email** o **Resetear contraseña** (ver 1.1). Con una contraseña nueva la persona no necesita el correo.
- **Lo resuelve el soporte técnico:** si a nadie le llegan los correos, revisar el envío de correo de la plataforma (Resend, ADR-022) y los registros de envío del proyecto en Supabase.

### 1.3. El enlace del correo no funciona o está vencido

- **Qué ves:** al tocar el enlace no se abre la pantalla para elegir la contraseña nueva, o aparece un error.
- **Por qué pasa:** los enlaces de recuperación duran poco y sirven una sola vez. Si ya lo usaste, o pasó mucho tiempo, no sirve.
- **Lo resolvés vos:** pedí un correo nuevo desde **¿Olvidaste tu contraseña?** y usá el enlace más reciente, desde el mismo celular o computadora donde lo pediste. Elegí una contraseña de al menos 8 caracteres.
- **Lo resuelve Administración:** si no hay manera, **Resetear contraseña** desde la ficha de la persona.

### 1.4. "Tu sesión venció. Volvé a iniciar sesión." o la app me llevó a la pantalla de ingreso

- **Por qué pasa:** la sesión normalmente no se vence sola: queda abierta en el celular. Se cierra cuando:
  - Administración usó **Cerrar sesiones** o **Resetear contraseña** sobre tu usuario.
  - Te quitaron un rol (al quitarlo se cierran las sesiones).
  - Cambiaste tu contraseña en otro dispositivo.
  - Borraste los datos del navegador, o desinstalaste y reinstalaste la app.
  - En iPhone, abriste la app instalada por primera vez: tiene su propio almacenamiento y no comparte la sesión con Safari.
- **Lo resolvés vos:** volvé a ingresar con tu email y contraseña. No perdés nada de lo ya registrado.
- **Lo resuelve Administración:** si le pasa a una persona todos los días, revisar que no se esté cerrando su sesión desde otro lado y que nadie use su usuario en otro teléfono.

### 1.5. "Sin acceso" o "Esta cuenta está desactivada."

- **Qué ves:** al ingresar aparece "Sin acceso: Tu cuenta no tiene ningún rol asignado en Extendiendo Servicios, o fue desactivada. Comunicate con Administración para resolverlo."
- **Por qué pasa:** la persona fue dada de baja, o su usuario se quedó sin rol.
- **Lo resolvés vos:** llamá a Administración (si está cargado, el teléfono aparece en la misma pantalla).
- **Lo resuelve Administración:**
  - Si la persona tiene que volver a trabajar: el **dueño** va a **Configuración**, **Usuarios**, activa **Mostrar desactivados**, abre el menú de la persona y elige **Reactivar**. Reactivar es solo del dueño.
  - Si le falta el rol: el **dueño** abre el menú de la persona, **Editar roles y capacidades**, marca el rol y **Guardar roles**.

### 1.6. "Hiciste demasiados intentos. Esperá un momento y probá de nuevo."

- **Por qué pasa:** el sistema limita los intentos de ingreso seguidos desde una misma conexión.
- **Lo resolvés vos:** esperá unos minutos y probá de nuevo, con calma y viendo la contraseña con el ojito. Si estás varias personas en el mismo wifi probando a la vez (por ejemplo, en una capacitación), probá con los datos móviles.

---

## 2. Ubicación

La ubicación es **opcional**. Registrar el inicio y el fin funciona igual sin ella: solo queda sin la ubicación adjunta. La plataforma nunca muestra las coordenadas en pantalla.

### 2.1. La app no me pide permiso de ubicación

- **Por qué pasa:** la app pide el permiso del teléfono recién después de que aceptás el consentimiento ("Aceptar y continuar" en la pantalla "Tu ubicación al fichar"). Si elegiste **Continuar sin ubicación**, el teléfono no te va a preguntar nada.
- **Lo resolvés vos:** abrí **Más**, **Mi perfil**, y en la sección **Ubicación** tocá **Dar mi consentimiento**. La próxima vez que registres un inicio o un fin, el teléfono te va a preguntar.

### 2.2. Bloqueé el permiso por error y ahora no puedo volver a darlo

- **Por qué pasa:** cuando el teléfono te pregunta y tocás **No permitir**, algunos teléfonos no vuelven a preguntar: hay que cambiarlo a mano.
- **Lo resolvés vos:**
  - **Android (Chrome):** mantené apretado el ícono de la app, tocá **Información de la app**, **Permisos**, **Ubicación**, y elegí **Permitir solo mientras la app está en uso**. Si abrís la página desde Chrome (sin instalar): botón del candado a la izquierda de la dirección, **Permisos**, **Ubicación**, **Permitir**.
  - **iPhone (Safari):** **Ajustes**, **Privacidad y seguridad**, **Localización**, buscá **Safari** (o el nombre de la app instalada) y elegí **Al usar la app**. Revisá también que **Localización** esté activada arriba de todo.
  - Después cerrá la app del todo y volvé a abrirla.
- **Si no querés dar la ubicación:** no pasa nada. Registrá el inicio y el fin igual. Si tenías dado el consentimiento y querés sacarlo, en **Mi perfil**, sección **Ubicación**, tocá **Quitar consentimiento**.

### 2.3. Registré el inicio pero Administración dice que no tiene mi ubicación

- **Por qué pasa:** el teléfono tardó más de seis segundos en encontrar la ubicación (dentro de edificios suele tardar), o el permiso estaba bloqueado. La app no espera más para no demorar el registro.
- **Qué hacer:** nada. El inicio **sí quedó registrado**, con la hora del servidor. La ubicación es un dato extra, no una condición.

---

## 3. Instalación y actualización de la app

Cómo se instala paso a paso está en las guías ([empleado](guia-empleado.md#instalar-la-app-en-tu-celular), [supervisor](guia-supervisor.md#instalar-la-app-en-tu-celular)). La explicación técnica está en [`pwa.md`](pwa.md).

### 3.1. No aparece el botón o el cartel para instalar la app

- **Por qué pasa:**
  - Ya la instalaste (la app instalada no ofrece instalarse de nuevo).
  - Cerraste el cartel hace menos de 7 días: no vuelve a aparecer por una semana.
  - Estás en un navegador que no la puede instalar (por ejemplo, Chrome en iPhone o el navegador de una aplicación de mensajes).
- **Lo resolvés vos:**
  - **Android:** abrí la dirección en **Chrome**, tocá los tres puntitos de arriba a la derecha y elegí **Instalar aplicación** (en algunos teléfonos dice **Agregar a la pantalla principal**).
  - **iPhone:** abrí la dirección en **Safari** (no en Chrome), tocá **Compartir** (el cuadrado con la flecha hacia arriba), **Agregar a pantalla de inicio** y **Agregar**.
  - Si el enlace te llegó por WhatsApp, abrilo en Chrome o Safari antes de instalar (menú de tres puntitos, **Abrir en el navegador**).

### 3.2. En iPhone no hay botón de "Instalar"

- **Por qué pasa:** Safari no ofrece ese botón. La app solo muestra los pasos para hacerlo a mano (ver 3.1).
- **Requisito:** iPhone con iOS 16.4 o más nuevo.

### 3.3. Instalé la app y me pide ingresar de nuevo

- **Por qué pasa:** en iPhone, la app instalada guarda sus datos aparte de Safari. Es normal la primera vez.
- **Lo resolvés vos:** ingresá con tu email y tu contraseña. Después la sesión queda abierta.

### 3.4. Sigo viendo la versión vieja de la app

- **Por qué pasa:** cuando se publica una versión nueva, la app **no se actualiza sola**: te avisa para que elijas el momento (así nadie pierde lo que está cargando).
- **Lo resolvés vos:**
  1. Si aparece el cartel "Hay una versión nueva de la aplicación", tocá **Actualizar ahora**. Si estás en medio de algo, tocá **Más tarde** y actualizá después.
  2. Si no aparece, cerrá la app del todo (sacala de las aplicaciones recientes) y abrila de nuevo. La app busca versiones nuevas cada hora y cada vez que volvés a ella.
  3. Para saber qué versión tenés: abajo de **Más** dice "Versión x.y.z" (en la computadora, al pie del menú lateral).
  4. Si sigue igual: desinstalá la app y volvé a instalarla (ver 3.5).
- **Lo resuelve el soporte técnico:** si pasaron más de 24 horas de una publicación y nadie ve la versión nueva, revisar que la publicación haya terminado.

### 3.5. Desinstalar y volver a instalar

- **Android:** mantené apretado el ícono, **Desinstalar** (o **Información de la app**, **Almacenamiento**, **Borrar datos**). Después abrí la dirección en Chrome e instalá de nuevo.
- **iPhone:** mantené apretado el ícono y elegí **Eliminar app**. Para borrar también los datos del sitio: **Ajustes**, **Safari**, **Avanzado**, **Datos de sitios web**, buscá el sitio y borralo. Volvé a instalar desde Safari.
- Al reinstalar tenés que volver a ingresar. No se pierde nada de lo ya registrado: los datos están en el servidor, no en el celular.

### 3.6. Apareció una pantalla de error al cambiar de pantalla, o la app se recargó sola una vez

- **Por qué pasa:** se publicó una versión nueva mientras tenías la app abierta. La app se recarga sola una única vez para tomar la versión nueva.
- **Lo resolvés vos:** si el error aparece de nuevo, cerrá la app del todo y abrila.

### 3.7. La pantalla se ve sin colores o con el diseño roto

- **Por qué pasa:** el celular es muy viejo. La plataforma necesita **Chrome 111 o más nuevo** en Android 8 o superior, o **Safari de iOS 16.4 o más nuevo** en iPhone.
- **Lo resolvés vos:** actualizá Chrome desde Play Store, o el sistema del iPhone desde **Ajustes**, **General**, **Actualización de software**.
- **Lo resuelve Administración:** si el celular no se puede actualizar, usar otro (el de un compañero) o hacer las tareas desde la computadora de la oficina.

---

## 4. Sin conexión y servicio caído

### 4.1. Estoy sin conexión

- **Qué ves:** la app abre y se puede pasar de pantalla en pantalla, pero no muestra tus turnos, o aparece "No pudimos cargar tu jornada. Probá de nuevo en un momento." Los botones que guardan cosas (**Registrar inicio**, **Registrar fin**, **Guardar**, **Confirmar aviso**) aparecen apagados con un aviso de que no hay conexión.
- **Por qué pasa:** la app instalada abre sin internet, pero **no guarda datos en el teléfono** ni deja registros "para después". Un fichaje sin conexión no se guarda.
- **Lo resolvés vos:** conectate (wifi o datos móviles) y volvé a intentar. No se guarda nada a medias: si el botón se apagó, nada se registró todavía.
- **Si la sede no tiene señal:** avisale a Administración y registrá el inicio o el fin apenas tengas señal. Administración puede cargar la hora en tu nombre (ver 5.5).

### 4.2. "No pudimos cargar..." aunque tengo internet

- **Por qué pasa:** puede ser un corte momentáneo del servicio, o que el servicio de pruebas esté pausado (ver 4.3).
- **Lo resolvés vos:** esperá un minuto, volvé atrás y entrá de nuevo. Cerrá la app y abrila. Probá con otra red (datos móviles en lugar de wifi).
- **Lo resuelve el soporte técnico:** si pasa en producción y a varias personas a la vez, revisar el estado del proyecto en Supabase y los avisos de error en Sentry.

### 4.3. La versión de pruebas (staging) no responde: `App_dev` pausado

Este problema **solo afecta al entorno de pruebas** (`dev.extendiendoservicios.com`), el que se usa para la prueba de aceptación y las capacitaciones. La plataforma en producción (`app.extendiendoservicios.com`) no tiene este problema.

- **Qué ves:** la pantalla de ingreso carga, pero al ingresar dice "No pudimos iniciar sesión. Probá de nuevo en un momento.", o todas las pantallas muestran "No pudimos cargar...". El cartel amarillo "Entorno de prueba: los datos de esta versión no son reales" confirma que estás en pruebas.
- **Por qué pasa:** el plan gratuito de Supabase **pausa automáticamente** los proyectos que pasan una semana sin actividad. Para evitarlo hay una consulta automática todos los lunes (`keepalive.yml`), pero si esa tarea falló o se desactivó, el proyecto se pausa.
- **Lo resolvés vos:** nada. Avisá al soporte técnico.
- **Lo resuelve el soporte técnico:**
  1. Entrar al panel de Supabase con la cuenta del proyecto y verificar que el proyecto sea `App_dev`.
  2. Si dice "Paused", tocar **Restore project** y esperar a que termine (unos minutos).
  3. Ejecutar `pnpm db:recuperar-dev` en el repositorio de la app: aplica lo que falte, comprueba el Auth y deja el entorno utilizable (`docs/deployment.md`, `docs/restore-test.md` sección 8).
  4. Revisar por qué falló `keepalive.yml` (pestaña Actions de GitHub).
- **Antes de una sesión de prueba con el cliente:** abrir el entorno de pruebas el día anterior e ingresar con una cuenta. Si no responde, recuperarlo con tiempo.

### 4.4. Veo el cartel "Entorno de prueba: los datos de esta versión no son reales"

- **Por qué pasa:** estás en el entorno de pruebas, no en la plataforma real. Lo que cargues ahí no pasa a producción.
- **Qué hacer:** si querías trabajar en la plataforma real, usá la dirección `app.extendiendoservicios.com`.

---

## 5. Registro de jornada, avisos y tareas (empleados)

### 5.1. No veo mi servicio en **Hoy**

- **Por qué pasa:** el servicio no te fue asignado todavía, es de más de siete días en adelante, o es de otra fecha. **Hoy** muestra solo los tuyos: los de hoy y los próximos siete días.
- **Lo resolvés vos:** cerrá la app y abrila para que se actualice. Si sigue sin aparecer, avisá a Administración.
- **Lo resuelve Administración:** abrir el turno en **Planificación** y mirar la **Dotación**: si no figurás, **Asignar empleado**.

### 5.2. "Este turno no es de hoy."

- **Por qué pasa:** el inicio solo se puede registrar el día del turno (desde las 00:00 hasta las 23:59 de ese día, hora de Argentina). No hay ventana de horario: podés registrar el inicio a cualquier hora de ese día.
- **Lo resolvés vos:** revisá la fecha del servicio en **Hoy**. Si se trataba de un servicio de ayer que no llegaste a registrar, avisá a Administración.
- **Lo resuelve Administración:** cargar la hora en nombre de la persona (ver 5.5).

### 5.3. "Ya registraste el inicio."

- **Por qué pasa:** ya habías tocado **Registrar inicio** en este servicio (a veces desde otro celular o con la conexión lenta).
- **Lo resolvés vos:** entrá a **Fichar**: la app te lleva al servicio en curso, con el cronómetro.

### 5.4. "El aviso tiene que hacerse antes de la hora de inicio."

- **Por qué pasa:** los avisos de demora y de ausencia solo se pueden mandar desde la app **antes** de la hora de inicio del servicio.
- **Lo resolvés vos:** llamá a Administración.
- **Lo resuelve Administración:** abrir el turno o **Asistencia**, **Registrar en nombre** y cargar la demora o la ausencia. Para la ausencia, Administración puede registrarla también después de la hora de inicio.

### 5.5. Me olvidé de registrar el inicio o el fin

- **Por qué pasa:** pasa. La plataforma no cierra los servicios sola.
- **Lo resolvés vos:** si el servicio todavía es de hoy, registralo ahora. Si ya pasó, avisá a Administración.
- **Lo resuelve Administración:** en **Asistencia** (o en el detalle del turno), **Registrar en nombre**, y elegir **Inicio**, **Fin** o **Cierre manual**. La hora puede ser cualquiera desde las 00:00 del día del servicio hasta ahora, nunca una hora futura, y hay que escribir un motivo. Queda anotado que lo cargó Administración. Hace falta el permiso "Registrar asistencia por otros".

### 5.6. "Las tareas se marcan entre el inicio y el fin del servicio."

- **Por qué pasa:** las tareas solo se pueden marcar con el servicio en curso: después de registrar el inicio y antes de registrar el fin.
- **Lo resolvés vos:** registrá primero el inicio. Si ya registraste el fin y te faltó una tarea, avisá a Administración: ellos pueden marcarla desde el detalle del turno.

### 5.7. Quiero corregir mi observación del servicio

- **Qué hacer:** entrá al servicio en curso, **Observaciones**, corregí y tocá **Guardar**. Si el servicio es de una sola persona y ya registraste el fin, la observación ya no se puede cambiar: pedile a Administración que la corrija.

---

## 6. Supervisiones (supervisores)

### 6.1. No veo mi supervisión en **Hoy**

- **Por qué pasa:** Administración todavía no te la asignó, o es de una fecha que no es hoy (en **Hoy** ves las de hoy y los próximos siete días; en **Supervisiones** ves todas las pendientes).
- **Lo resolvés vos:** revisá la pestaña **Supervisiones**. Si no está, avisá a Administración.
- **Lo resuelve Administración:** **Supervisiones**, **Asignar supervisión**, elegir fecha, turno y supervisor. Necesita el permiso "Asignar supervisiones".

### 6.2. No me deja calificar: "El plazo para editar esta calificación terminó."

- **Por qué pasa:** podés crear y editar las calificaciones mientras dure el turno (o hasta que registres el fin de tu supervisión, lo que ocurra último).
- **Lo resolvés vos:** avisá a Administración.
- **Lo resuelve Administración:** el dueño, o un administrador con el permiso "Editar calificaciones", edita la calificación desde **Supervisiones**, la supervisión, **Calificar** (o **Editar**) sin límite de plazo.

### 6.3. No puedo completar la supervisión

- **Por qué pasa:** hay que registrar el **fin de la supervisión** antes de **Completar supervisión**. Si faltan empleados por calificar, la app te avisa pero te deja completar igual ("Faltan 3 empleados por calificar. Podés completar igual.").
- **Lo resolvés vos:** en la supervisión, tocá **Registrar fin de supervisión** y después **Cerrar supervisión**, **Completar supervisión**. Si no pudiste hacerla, usá **No se pudo realizar** y escribí el motivo.

### 6.4. "No podés calificarte a vos mismo."

- **Por qué pasa:** si sos supervisora y también empleada en el mismo turno, no podés calificarte.
- **Lo resuelve Administración:** al asignar la supervisión, la pantalla avisa si la persona está asignada como empleada en ese turno: conviene elegir otra supervisora.

---

## 7. Administración

### 7.1. No me aparece un botón (por ejemplo "Cancelar turno" o "Generar turnos del mes")

- **Por qué pasa:** algunas acciones necesitan un permiso especial que el dueño le da a cada administrador. Sin el permiso, el botón no aparece (y aunque se lo intente por otro camino, el servidor lo rechaza).
- **Lo resuelve el dueño:** **Configuración**, **Usuarios**, menú del administrador, **Editar roles y capacidades**, y activar el permiso. Los permisos se guardan solos al activarlos. Son siete:

  | Permiso en la pantalla         | Qué habilita                                                |
  | ------------------------------ | ----------------------------------------------------------- |
  | Gestionar usuarios             | Crear, desactivar y resetear usuarios empleado o supervisor |
  | Cancelar turnos                | **Cancelar turno**                                          |
  | Editar calificaciones          | Editar las calificaciones de los supervisores               |
  | Editar plantillas de tareas    | Crear y cambiar las listas de tareas                        |
  | Registrar asistencia por otros | Registrar inicio, fin y avisos en nombre de un empleado     |
  | Generar turnos del mes         | **Generar turnos del mes**                                  |
  | Asignar supervisiones          | **Asignar supervisión** y cancelar supervisiones            |

### 7.2. "El turno ya empezó: para asignar o quitar personal hace falta el permiso de asistencia."

- **Por qué pasa:** después de la hora de inicio de un turno, asignar o quitar personal requiere el permiso "Registrar asistencia por otros".
- **Lo resuelve el dueño:** darle ese permiso al administrador (ver 7.1), o hacerlo el dueño.

### 7.3. "El empleado ya tiene otro turno en ese horario."

- **Por qué pasa:** la plataforma no permite que una persona esté en dos turnos que se superponen. No se puede forzar.
- **Qué hacer:** elegí otra persona, o cambiá la franja propia de la asignación, o quitá a la persona del otro turno. En la lista de candidatos al asignar, la etiqueta roja "Se superpone con ..." avisa antes de confirmar. La etiqueta gris "También en ..." solo informa que el mismo día tiene otro turno en un horario que no choca.

### 7.4. "Asignamos igual, con advertencias"

- **Qué significa:** la persona se asignó, pero la plataforma te avisa que no figura habilitada para ese cliente, que la franja no coincide con la disponibilidad que declaró, o que tiene una licencia cargada en esa fecha. Es un aviso, no un bloqueo: decidís vos.
- **Qué hacer:** si no era lo que querías, abrí el turno y usá **Quitar** en esa persona.

### 7.5. Creé un servicio pero no aparecen los turnos

- **Por qué pasa:** crear un servicio no genera turnos solo. Los turnos se generan mes a mes.
- **Qué hacer:** **Planificación**, **Generar turnos del mes**, elegí el mes y tocá **Generar turnos del mes**. Es seguro repetirlo: solo crea los turnos que todavía no existen y nunca borra ni cambia los ya generados. El resultado dice cuántos creó, cuántos omitió por existir y cuántos por caer en feriado.
- **Si cambiaste un servicio:** los turnos ya generados **no cambian**. Para un turno puntual usá **Editar franja** en su detalle.

### 7.6. Cambié la lista de tareas pero los turnos siguen con la anterior

- **Por qué pasa:** cambiar una plantilla no modifica los turnos ya generados.
- **Qué hacer:** abrí el turno (que todavía no haya empezado) y tocá **Recargar tareas** en la sección **Tareas**.

### 7.7. Una sede no aparece en el mapa

- **Por qué pasa:** la sede no tiene coordenadas. En el mapa se ven solo las sedes con ubicación; arriba se indica cuántas quedaron afuera.
- **Qué hacer:** abrí la sede, **Editar**, escribí la dirección en **Buscar dirección** y tocá el botón **Buscar dirección**; si el marcador no cae donde corresponde, movelo a mano. Guardá.

### 7.8. Una persona cambió de celular o se le olvidó la contraseña

- **Qué hacer:** **Empleados**, ficha de la persona, **Resetear contraseña** (escribí una contraseña nueva y pasásela por un canal seguro). Si quedó abierta en un celular perdido, **Cerrar sesiones**.

### 7.9. Un empleado dejó de trabajar

- **Qué hacer:** ficha de la persona, **Dar de baja**. No puede iniciar sesión y queda marcada como baja; el historial se conserva. No se borra nada. Para que vuelva, el dueño la reactiva (ver 1.5).

---

## 8. Antes de pedir ayuda al soporte técnico

Juntá estos datos: el mensaje de ayuda sale mucho más rápido.

1. **Quién sos** y con qué rol entrás (empleado, supervisor, administrador, dueño).
2. **Qué estabas haciendo** y qué esperabas que pasara.
3. **Qué pasó**, con el texto exacto del mensaje y, si podés, una captura de pantalla.
4. **Cuándo** pasó (día y hora).
5. **Desde dónde:** celular (marca y modelo) o computadora, y el navegador. Si la app está instalada, decilo.
6. **Qué versión tenés:** abajo de **Más** (en la computadora, al pie del menú lateral) dice "Versión x.y.z".
7. **Si te pasa a vos sola o a más gente.**

**Importante:** nunca mandes tu contraseña por mensaje, ni a Administración ni al soporte técnico. Si hace falta, se resetea y se entrega una nueva por un canal seguro.
