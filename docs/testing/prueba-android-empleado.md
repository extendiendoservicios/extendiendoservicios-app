# Prueba en un Android real — App del empleado (MOB-EMP-018)

Esta guía es para hacerla a mano, con un teléfono Android de verdad, sin nada
de programación. Sirve para comprobar cosas que una prueba automática no
puede ver bien: el permiso de ubicación que pide el propio teléfono, cómo se
instala la aplicación, si el cronómetro sigue corriendo con la pantalla
bloqueada, y qué pasa en modo avión.

Dirección para probar: **https://dev.extendiendoservicios.com**

No es la aplicación real de la empresa (esa es otra dirección): esta es la
de pruebas, donde no pasa nada si algo sale mal.

## Antes de empezar

Pedile esto a Claude ANTES de arrancar:

- [ ] El email de un usuario de prueba con rol empleado. La contraseña la
      tenés vos o te la pasa quien administra las cuentas: **no la escribas
      en este archivo** (el repositorio es público). Si imprimís la guía,
      anotala a mano en el papel.
- [ ] Confirmación de que ese usuario tiene, para el día en que hagas la
      prueba, **un servicio de hoy** cargado (un cliente, una sede, un
      horario) con al menos dos tareas cargadas (para poder marcar una como
      hecha y otra como "no hecha").
- [ ] Confirmación de que ese servicio todavía no fue iniciado por nadie
      (si ya tiene el inicio registrado, la prueba no va a poder repetir
      esa parte).

Si no tenés esto, no arranques: avisá y esperá a que te lo den.

## Qué vas a necesitar

- Un teléfono Android (no un iPhone) con Chrome instalado.
- Que el teléfono tenga la ubicación (GPS) activada en el sistema, para
  poder aceptar el permiso cuando lo pida.
- Un lugar tranquilo donde puedas dejar el teléfono con la pantalla
  bloqueada un rato (para probar el cronómetro).

## Cómo anotar lo que encuentres

Para cada paso de esta guía hay una casilla para marcar si salió bien. Si
algo NO sale como se espera, no sigas de largo: anotalo en la sección
"Problemas encontrados" al final, con:

- En qué paso pasó (el número).
- Qué esperabas que pasara.
- Qué pasó en realidad.
- Si podés, una captura de pantalla (el botón de encender + bajar volumen
  al mismo tiempo, en la mayoría de los teléfonos Android).

Después seguí con el resto de la guía igual, salvo que el problema te
impida continuar — en ese caso, anotalo y avisá.

---

## Parte 1 — Entrar por primera vez y el permiso de ubicación

1. [ ] Abrí Chrome en el teléfono y entrá a `https://dev.extendiendoservicios.com`.
       ¿Se ve la pantalla de "Ingresar" con los campos de email y contraseña?
2. [ ] Escribí el email y la contraseña que te dieron y tocá "Ingresar".
       ¿Entraste a la pantalla "Hoy", con el servicio de hoy visible en una
       tarjeta grande?
3. [ ] Tocá el botón "Fichar" (abajo, en el medio).
       ¿Aparece un texto que dice algo como "Antes de registrar el inicio, te
       pedimos tu consentimiento de ubicación"? Tocá "Continuar".
4. [ ] Ahora tiene que aparecer una pantalla de la aplicación que explica
       para qué se usa la ubicación, con dos botones: "Aceptar y continuar" y
       "Continuar sin ubicación". Tocá **"Aceptar y continuar"**.
5. [ ] Acá es el momento importante: el **sistema Android** (no la
       aplicación) tiene que mostrar su propio cartel pidiendo permiso de
       ubicación (algo como "¿Permitir que dev.extendiendoservicios.com acceda
       a la ubicación de este dispositivo?"). Tocá **"Mientras se usa la
       aplicación"** o **"Permitir"**.
   - ¿Apareció ese cartel del sistema (no de la página)? \_\_\_
   - ¿Pudiste aceptarlo sin problemas? \_\_\_
6. [ ] Después de aceptar, tenés que volver a la pantalla de "Fichar", ahora
       mostrando el servicio y la hora actual, con un botón grande "Registrar
       inicio". **Todavía no lo toques** — seguí con la Parte 2 primero.

## Parte 2 — Instalar la aplicación (PWA)

7. [ ] Volvé a la pantalla "Hoy" (tocá el ícono de "Hoy" abajo, si hay uno,
       o el botón de atrás del teléfono).
       ¿Ves un cartel o botón que dice algo como "Instalar" en la parte de
       arriba de la pantalla?
8. [ ] Tocá "Instalar" y confirmá en el cartel que muestra Chrome (algo como
       "Instalar aplicación" o "Agregar a la pantalla de inicio").
       ¿Aparece un ícono nuevo en la pantalla de inicio del teléfono, con el
       logo de Extendiendo Servicios?
9. [ ] Abrí la aplicación desde ese ícono nuevo (no desde Chrome).
       ¿Se abre sin la barra de direcciones de Chrome arriba, como si fuera una
       aplicación de verdad (pantalla completa)?
10. [ ] Volvé a entrar con el mismo usuario si te lo pide.

De acá en más, seguí siempre desde la aplicación instalada (el ícono
nuevo), no desde Chrome.

## Parte 3 — Registrar el inicio y el cronómetro con la pantalla bloqueada

11. [ ] Andá a "Fichar" y tocá **"Registrar inicio"**.
        ¿Te lleva a una pantalla que dice "Servicio en curso" con un cronómetro
        corriendo (números que cambian solos, tipo 00:05, 00:06, 00:07...)?
12. [ ] Mirá el cronómetro un momento y anotá el número que ves:
        \_\_\_\_\_\_\_\_
13. [ ] **Bloqueá la pantalla del teléfono** (botón de encender) y esperá
        un minuto completo sin tocar nada.
14. [ ] Desbloqueá el teléfono y volvé a la aplicación (no hace falta
        volver a entrar).
        ¿El cronómetro sigue corriendo, y ahora muestra un número bastante más
        alto que el que anotaste antes (por lo menos un minuto más)?
        Anotalo: \_\_\_\_\_\_\_\_
    - Si el cronómetro se quedó "pegado" en el mismo número de antes, o
      volvió a cero, es un problema: anotalo en "Problemas encontrados".

## Parte 4 — Tareas y observación

15. [ ] Tocá "Tareas".
        ¿Ves la lista de tareas de este servicio?
16. [ ] Tocá el casillero de la primera tarea para marcarla como
        completada. ¿Se pone verde y dice "Completada" con la hora?
17. [ ] En otra tarea, tocá el botón "No realizada". Escribí cualquier
        motivo corto (por ejemplo "Prueba de MOB-EMP-018") y confirmá.
        ¿Queda marcada en rojo, con el motivo escrito debajo?
18. [ ] Volvé ("Volver" o el botón de atrás) y entrá a "Observaciones".
        Escribí una frase corta (por ejemplo "Prueba desde un Android real") y
        tocá "Guardar". ¿Aparece un aviso de "Observación guardada"?
19. [ ] Salí de esa pantalla y volvé a entrar a "Observaciones".
        ¿Sigue ahí el texto que escribiste?

## Parte 5 — Modo avión (sin conexión)

20. [ ] Con el teléfono en la pantalla "Servicio en curso" o "Tareas",
        activá el **modo avión** (deslizá desde arriba y tocá el ícono del
        avión, o desde Configuración).
21. [ ] Con el modo avión activado, mirá si aparece algún aviso en la
        pantalla que diga algo como "Estás sin conexión".
        ¿Apareció ese aviso? \_\_\_
22. [ ] Intentá tocar un botón que guarde algo (por ejemplo, marcar otra
        tarea, o el botón "Guardar" de Observaciones).
        ¿El botón está apagado/deshabilitado, sin dejarte tocarlo? \_\_\_
23. [ ] Desactivá el modo avión (volvé a tener wifi o datos).
        ¿El aviso de "sin conexión" desaparece solo, sin que hayas tenido que
        recargar la página?

## Parte 6 — Finalizar el servicio

24. [ ] Andá a "Finalizar servicio".
        ¿Ves un resumen con el inicio, la hora actual, cuántas tareas están
        completadas y si hay una observación cargada?
25. [ ] Tocá "Registrar fin".
26. [ ] El sistema Android puede volver a pedir el permiso de ubicación en
        este paso (depende del teléfono). Si aparece, aceptalo igual que antes.
27. [ ] ¿Te lleva a una pantalla de "Resumen" con el inicio, el fin, la
        duración, las tareas (una completada, una no realizada) y la
        observación que escribiste?

## Parte 7 — Verificación final

28. [ ] Cerrá la aplicación del todo (no solo minimizarla: desde los
        programas recientes del teléfono, deslizala para cerrarla) y volvé a
        abrirla desde el ícono instalado.
        ¿Te pide iniciar sesión de nuevo, o entra directo? Anotalo (cualquiera
        de las dos cosas puede estar bien, es solo para que quede registrado).
29. [ ] Andá a "Hoy". El servicio que acabás de terminar, ¿aparece marcado
        como finalizado (no como pendiente)?

---

## Problemas encontrados

Anotá acá cada cosa que no salió como se esperaba. Un renglón por
problema, con la mayor cantidad de detalle posible.

| Paso N.° | Qué esperabas | Qué pasó en realidad | Captura (sí/no) |
| -------- | ------------- | -------------------- | --------------- |
|          |               |                      |                 |
|          |               |                      |                 |
|          |               |                      |                 |

## Datos del teléfono usado (para que quede registrado)

- Marca y modelo: ****\*\*\*\*****\_\_\_****\*\*\*\*****
- Versión de Android: ****\*\*\*\*****\_\_\_****\*\*\*\*****
- Versión de Chrome: ****\*\*\*\*****\_\_\_****\*\*\*\*****
- Fecha en que hiciste la prueba: ****\*\*\*\*****\_\_\_****\*\*\*\*****

Cuando termines, avisale a Claude con esta planilla completa (todas las
casillas marcadas o explicadas, y la tabla de problemas si hubo alguno).
