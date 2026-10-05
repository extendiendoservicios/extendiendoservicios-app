# Informe de pruebas de la Fase 18 (TEST-028 y TEST-029)

Plataforma Base de Extendiendo Servicios, versión de la aplicación `0.14.0` (la `0.15.0` se etiqueta al cerrar la fase). Fecha del informe: 5 de octubre de 2026. Código probado: rama `develop` en el commit `b52d6e7` (con todo P18.1 a P18.6), más los dos ajustes de pruebas de este paquete (commits `3b7a612` y `d285924`, sección 3.3). Entorno: `App_dev` (build local contra la base de desarrollo; producción no se tocó).

Este documento es el acta de pruebas de la fase. Está escrito para leerse sin conocimientos técnicos: la sección 1 alcanza para saber cómo quedó todo; el resto es el detalle.

## 1. Resumen

**Qué se probó.** Todo lo que la Plataforma Base promete a sus tres tipos de usuario: la administración (escritorio y celular), el empleado (celular) y el supervisor (celular). Se probó entrando como cada uno, haciendo lo que hace en el día a día y comprobando lo que no puede hacer, en tres navegadores (Chrome, Safari de iPhone y Edge). Aparte, una matriz de 1.619 casos intenta, **por API directa**, leer o escribir lo que cada rol no debería poder, y se midieron la accesibilidad y la carga.

**Resultado.**

- Los 25 casos borde del plan (CB-01 a CB-25) tienen test y pasan.
- De las 48 filas aplicables de la matriz de trazabilidad, 43 tienen test y pasan; las 5 restantes no son de esta fase (F19, F20 y la restauración de respaldos, P18.8). TEST-026 no aplica (el cliente no mandó los ejemplos; decisión de Mike).
- Todos los defectos encontrados en la fase (DEF-01 a DEF-04, DEF-A01, DEF-P01 a DEF-P13 y los hallazgos de seguridad SEG-01, 02, 03, 07 y 08) están **corregidos y verificados**. SEG-04 y SEG-05 quedan como están por decisión de Mike, y SEG-06 se cerró actualizando el plan (sección 5).
- **Estabilidad (TEST-029): cumplida.** La suite completa de F18 (1.781 tests: 162 con navegador y 1.619 de permisos) corrió tres veces seguidas contra `App_dev` sin ningún fallo ni intermitencia (corridas 7, 8 y 9 del 5 de octubre, de 19 a 22 minutos cada una). Antes hubo que corregir tres intermitencias de las pruebas y un cuelgue del navegador de pruebas en Windows (sección 3.3).
- Este paquete no encontró defectos nuevos de la aplicación. Encontró tres intermitencias que eran de las pruebas frente a un `App_dev` cargado o a WebKit, y las corrigió; además vio un cuelgue del navegador de pruebas en Windows que no es de la aplicación (sección 3.3).

## 2. Las suites: qué cubre cada una

Cada suite usa su propio juego de cuentas de prueba (`e2e-fijo-*`), así que pueden correr al mismo tiempo sin pisarse. Los tiempos son los de la última corrida limpia, en la máquina de desarrollo.

| Suite                                    | Qué cubre                                                                                                                                                                                                                                                                                                                                                                   | Tests                                                                                                                           | Navegadores y dispositivos                    | Tiempo (aprox.)                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------- |
| Administración, `chromium` y `mobile`    | 15 archivos: ingreso por rol, clientes y sedes, empleados, generación de turnos, planificación y asignaciones, turno cancelado, asistencia y cierre, plantillas de tareas, supervisiones y calificaciones, permisos por capacidad, dos administradores a la vez, usuarios y sesiones, los recorridos completos del administrador y del dueño y el celular de administración | 31 (30 en escritorio 1280 px y 1 en celular 390 px)                                                                             | Chrome de escritorio y Chrome en celular      | 4 a 4,5 min                         |
| Administración en Edge                   | Los mismos 14 archivos de escritorio                                                                                                                                                                                                                                                                                                                                        | 30                                                                                                                              | Microsoft Edge                                | 3,5 min                             |
| Accesibilidad de administración (`a11y`) | axe-core sobre las pantallas de administración y del dueño, en escritorio y celular                                                                                                                                                                                                                                                                                         | 4                                                                                                                               | Chrome                                        | 2,5 a 3,5 min                       |
| Configuración del dueño (`dueno-config`) | Feriados, criterios de calificación, registro de seguridad, logo y teléfono de soporte (edita la configuración de la empresa, por eso corre sola al final)                                                                                                                                                                                                                  | 7                                                                                                                               | Chrome                                        | 1 min                               |
| Empleado en celular                      | Hoy, detalle del servicio, fichar con ubicación concedida y negada, servicio en curso, tareas y observación, avisos, Más y perfil, desactivado con la app abierta, sin calificaciones, accesibilidad                                                                                                                                                                        | 25                                                                                                                              | Chrome en celular 390 px táctil               | 5,5 a 6 min                         |
| Empleado en iPhone                       | Los mismos archivos que el celular                                                                                                                                                                                                                                                                                                                                          | 25 (24 corren y 1 se saltea a propósito: el borde exacto de CB-06 espera unos 3 minutos de reloj real y corre solo en `mobile`) | Safari de iPhone 14 (WebKit)                  | 3,5 a 4,5 min                       |
| Supervisor                               | Hoy, supervisiones, detalle, inicio y fin con ubicación concedida y negada, calificar, editar, cerrar, historial, doble rol, negativos, accesibilidad                                                                                                                                                                                                                       | 26 (13 por navegador)                                                                                                           | Chrome en celular y Safari de iPhone          | 8 a 9 min                           |
| `e2e-auth`                               | Credenciales inválidas, recuperación de contraseña, usuario desactivado y persistencia de la sesión                                                                                                                                                                                                                                                                         | 14                                                                                                                              | Chrome de escritorio y celular                | 30 s                                |
| Matriz de permisos                       | 12 archivos: cada tabla, vista, función de servidor, depósito de archivos y Edge Function, con siete perfiles (anónimo, empleado, supervisor, doble rol, administrador sin capacidades, administrador con todas y dueño)                                                                                                                                                    | 1.619 casos                                                                                                                     | Sin navegador (API directa con `supabase-js`) | 5,75 min                            |
| **Total por corrida**                    |                                                                                                                                                                                                                                                                                                                                                                             | **1.781** (162 con navegador y 1.619 por API)                                                                                   |                                               | 19 a 22 min con dos suites a la vez |

Otras capas, que no entran en las tres corridas pero respaldan la trazabilidad: pgTAP (41 archivos de la base de datos), las pruebas de la Edge Function (Deno, 19 de 19 en P18.6) y las unitarias de Vitest (900 de 900 en P18.6). Las unitarias se repitieron en este paquete: **911 de 911 pasan** (`pnpm test`, 5 de octubre).

Además hay 11 carpetas de suites viejas (`tests/e2e-*`, 56 tests) que se conservan como pruebas manuales y no forman parte de esta acta; `docs/test-inventory.md` (sección 8) dice qué quedó de cada una.

## 3. Estabilidad (TEST-029)

### 3.1 Cómo se corrió

El criterio del plan: la suite completa de F18 corre **tres veces seguidas sin ningún fallo ni intermitencia** (una prueba que falla y pasa al reintentar), sin tocar nada entre corridas. Las suites de Playwright están configuradas **sin reintentos**, de modo que cualquier intermitencia aparece como fallo: no hay forma de que una prueba "pase de casualidad en el segundo intento".

Cada corrida repite lo que hace el nocturno (`.github/workflows/e2e-app-dev.yml`): primero el barrido único (deja listas las cuentas de todos los conjuntos y borra residuos `e2e-`), después las suites con `E2E_SKIP_SWEEP=1` y su `E2E_CONJUNTO`, con `dueno-config` al final y solo. Para no saturar `App_dev` se corrieron **como mucho dos suites a la vez**, en dos carriles:

- carril A: administración (chromium y mobile), Edge, accesibilidad, matriz de permisos;
- carril B: supervisor, `e2e-auth`, empleado en celular, empleado en iPhone (así las dos suites de WebKit nunca coinciden);
- al terminar los dos: `dueno-config`.

Un solo servidor local de la aplicación sirvió a todas (`vite preview` en el puerto 5173), compilado desde el mismo código. Cuenta de cada corrida: tests, pasados, fallados, intermitentes (pasó en un reintento; siempre 0 porque no hay reintentos) y tiempo.

### 3.2 Resultado de las corridas

**Cuenta válida: las corridas 7, 8 y 9, tres seguidas, sin ningún fallo ni intermitencia** (código del commit `d285924`, sin tocar nada entre ellas). Cada celda dice: pasados de total / fallados / intermitentes / saltados · tiempo de la suite. El «saltado» de WebKit es el borde exacto de CB-06 (corre solo en `mobile`, a propósito). Las corridas 1 y 2 repartieron las suites de otro modo (sin carriles fijos); de la 3 en adelante se usaron los dos carriles de arriba. Las suites corrieron de a dos, por eso el tiempo de la corrida entera (19 a 22 minutos) es menor que la suma de las suites.

| Suite                               | Corrida 7: pasados / fallados / intermitentes / saltados Â· tiempo | Corrida 8: pasados / fallados / intermitentes / saltados Â· tiempo | Corrida 9: pasados / fallados / intermitentes / saltados Â· tiempo |
| ----------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| AdministraciÃ³n (chromium + mobile) | 31 de 31 / 0 / 0 / 0 Â· 3 min 57 s                                 | 31 de 31 / 0 / 0 / 0 Â· 4 min 12 s                                 | 31 de 31 / 0 / 0 / 0 Â· 4 min 38 s                                 |
| AdministraciÃ³n en Edge             | 30 de 30 / 0 / 0 / 0 Â· 3 min 23 s                                 | 30 de 30 / 0 / 0 / 0 Â· 3 min 33 s                                 | 30 de 30 / 0 / 0 / 0 Â· 3 min 45 s                                 |
| Accesibilidad (axe)                 | 4 de 4 / 0 / 0 / 0 Â· 2 min 23 s                                   | 4 de 4 / 0 / 0 / 0 Â· 3 min 26 s                                   | 4 de 4 / 0 / 0 / 0 Â· 2 min 47 s                                   |
| ConfiguraciÃ³n del dueÃ±o           | 7 de 7 / 0 / 0 / 0 Â· 0 min 56 s                                   | 7 de 7 / 0 / 0 / 0 Â· 0 min 56 s                                   | 7 de 7 / 0 / 0 / 0 Â· 1 min 25 s                                   |
| Empleado en celular                 | 25 de 25 / 0 / 0 / 0 Â· 5 min 34 s                                 | 25 de 25 / 0 / 0 / 0 Â· 6 min 02 s                                 | 25 de 25 / 0 / 0 / 0 Â· 5 min 24 s                                 |
| Empleado en iPhone (WebKit)         | 24 de 25 / 0 / 0 / 1 Â· 3 min 40 s                                 | 24 de 25 / 0 / 0 / 1 Â· 3 min 31 s                                 | 24 de 25 / 0 / 0 / 1 Â· 4 min 41 s                                 |
| Supervisor                          | 26 de 26 / 0 / 0 / 0 Â· 7 min 44 s                                 | 26 de 26 / 0 / 0 / 0 Â· 7 min 55 s                                 | 26 de 26 / 0 / 0 / 0 Â· 8 min 56 s                                 |
| `e2e-auth`                          | 14 de 14 / 0 / 0 / 0 Â· 0 min 23 s                                 | 14 de 14 / 0 / 0 / 0 Â· 0 min 30 s                                 | 14 de 14 / 0 / 0 / 0 Â· 0 min 34 s                                 |
| Matriz de permisos                  | 1619 de 1619 / 0 / 0 / 0 Â· 5 min 44 s                             | 1619 de 1619 / 0 / 0 / 0 Â· 5 min 44 s                             | 1619 de 1619 / 0 / 0 / 0 Â· 5 min 47 s                             |
| **Total**                           | **1780 de 1781 / 0 / 0 / 1** Â· 18 min 48 s de corrida entera      | **1780 de 1781 / 0 / 0 / 1** Â· 19 min 36 s de corrida entera      | **1780 de 1781 / 0 / 0 / 1** Â· 21 min 30 s de corrida entera      |

Historial completo de las nueve corridas, para que quede constancia de todo lo que pasó:

| Corrida | Fecha y hora de inicio | Código    | Resultado                                                                                                                                                                                                                                                             | Cuenta                                        |
| ------- | ---------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1       | 5 oct, 06:54           | `b52d6e7` | Limpia: 1780 pasados, 1 saltado y 0 fallados (23 min)                                                                                                                                                                                                                 | Descartada: el código cambió después          |
| 2       | 5 oct, 07:17           | `b52d6e7` | **2 fallos**: administración (`supervisiones-calificaciones`) y empleado en iPhone (`fichar`, CB-21)                                                                                                                                                                  | Se investigó y se corrigió (sección 3.3)      |
| 3       | 5 oct, 07:46           | `3b7a612` | Limpia (21 min)                                                                                                                                                                                                                                                       | Descartada: apareció la tercera intermitencia |
| 4       | 5 oct, 08:07           | `3b7a612` | **1 fallo**: supervisor en iPhone (`permisos`), «Frame load interrupted»                                                                                                                                                                                              | Se investigó y se corrigió (sección 3.3)      |
| 5       | 5 oct, 08:30           | `d285924` | Limpia (22 min)                                                                                                                                                                                                                                                       | Válida, pero no queda seguida: la 6 se anuló  |
| 6       | 5 oct, 08:53           | `d285924` | Las pruebas pasaron (26 de 26 del supervisor, etc.), pero el proceso de Playwright del supervisor **no terminó** (WebKit de Windows, sección 3.3) y se cortó a los 30 minutos; después, al intentar limpiar, se interrumpió por error la suite de empleado en celular | Anulada                                       |
| 7       | 5 oct, 09:32           | `d285924` | Limpia: 1780 de 1781 y 1 saltado (19 min)                                                                                                                                                                                                                             | **Cuenta 1 de 3**                             |
| 8       | 5 oct, 09:51           | `d285924` | Limpia (20 min)                                                                                                                                                                                                                                                       | **Cuenta 2 de 3**                             |
| 9       | 5 oct, 10:11           | `d285924` | Limpia (22 min)                                                                                                                                                                                                                                                       | **Cuenta 3 de 3**                             |

Sin errores de red ni de Auth 429 en ninguna corrida: no hizo falta esperar ni reintentar por esa causa.

### 3.3 Intermitencias encontradas y qué se hizo

Cada vez que algo falló se abrió la traza de Playwright, se repitió la prueba sola (todas pasaron solas) y se decidió de quién era el problema. **Ninguna fue un defecto de la aplicación.** Tras cada corrección la cuenta de tres volvió a empezar, por eso hubo nueve corridas.

| Corrida | Test                                                                                                                  | Qué pasó (traza de Playwright)                                                                                                                                                                                                           | Causa                                                                                                                                                                                         | Qué se hizo                                                                                                                                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2       | Administración, `supervisiones-calificaciones`: el listado filtra por empleado, supervisor, cliente y estado (RB-A09) | Al elegir el cliente en el filtro, la lista quedó en «Cargando datos…» más de 10 segundos. Las dos consultas del filtro (`v_supervisions_admin` y `ratings`) tardaron **11,3 s**, cuando las anteriores habían tardado entre 0,3 y 1,2 s | Una demora puntual de `App_dev` con otra suite en marcha. La pantalla funcionó cuando el servidor respondió. Solo, el test pasó 8 de 8                                                        | La espera de las comprobaciones posteriores a cada filtro sube de 10 a 30 s (un filtro vuelve a pedir la lista al servidor)                                                                                                                                            |
| 2       | Empleado en iPhone, `fichar`: «rechaza el consentimiento» (CB-21)                                                     | El clic en «Registrar fin» esperó 14 s a que el botón estuviera «estable» (ya estaba dibujado y habilitado); los clics anteriores del mismo test habían tardado 0,1 s                                                                    | WebKit sin recursos mientras corría otra suite de navegador. Solo, el test pasó 6 de 6                                                                                                        | El `actionTimeout` de las suites móviles sube de 15 a 30 s, y las dos suites de WebKit pasan al mismo carril para que no corran a la vez. Commit `3b7a612`                                                                                                             |
| 4       | Supervisor en iPhone, `permisos`: la supervisión de otra persona no es accesible (RB-S02, RB-S03)                     | `page.goto('/admin')` terminó con «Frame load interrupted»: la aplicación redirige a `/sup` desde el cliente y en WebKit esa redirección interrumpe la navegación                                                                        | Carrera de la prueba, no de la pantalla: el resultado (llegar a `/sup`) se comprueba con `toHaveURL` y era correcto. Es un problema conocido de WebKit                                        | Nuevo ayudante `irARedirigida` (ignora solo ese error de navegación) y se usa en los cuatro lugares que navegaban así (`permisos`, `doble-rol`, `sin-calificaciones` y `desactivado`). Commit `d285924`                                                                |
| 6       | Supervisor, fin de la suite                                                                                           | Los 26 tests pasaron en 8 minutos, pero el proceso de Playwright no terminó y se cortó a los 30 minutos («Timed out waiting 1800s»). Quedó un proceso `WebKitNetworkProcess` huérfano, que retiene la tubería de Playwright              | Problema de Windows con el navegador WebKit de pruebas al cerrar (también se había visto una vez en P18.6); no es de la aplicación ni de la lógica del test. En el nocturno (Linux) no se vio | La corrida se anuló (no cuenta). Para las corridas 7 a 9 un vigilante local mata los procesos de WebKit si una suite ya mostró todos sus resultados y lleva 150 s sin avanzar; **no se disparó ninguna vez** en las tres corridas válidas. No es parte del repositorio |

Los dos primeros cambios (esperas) y el tercero (`irARedirigida`) son de las pruebas (`tests/`); no se tocó `src/` ni `supabase/`.

Lectura para el nocturno: si falla una prueba que pasa sola, mirar primero la carga de `App_dev` (otra corrida, un respaldo o una restauración al mismo tiempo) antes de sospechar de la aplicación.

## 4. Trazabilidad: la matriz de `09_Trazabilidad.md`, fila por fila

Cómo se lee la columna **Resultado**:

- **Pasa**: hay al menos un test de Playwright o de la matriz de permisos que ejerce la fila y pasó en las corridas válidas de la sección 3 (sin fallos ni intermitencias). Si además hay pruebas de otras capas (pgTAP, unitarias, Deno), se citan; esas capas **no se corrieron en este paquete**: su último resultado es el de P18.6 (pgTAP 41 archivos, Deno, unitarias 900 de 900; el pgTAP se corrió con `supabase db query --linked` porque Docker no arrancaba, y lo repite la integración continua del Pull Request).
- **No aplica a F18**: la fila es de otra fase o de otro agente; se dice cuál.

Abreviaturas: **adm** = `tests/e2e/admin/`, **emp** = `tests/e2e/empleado/`, **sup** = `tests/e2e/supervisor/`, **perm** = `tests/permissions/suite/` (matriz por API directa), **(viejo)** = suites `tests/e2e-X/` que no entran al nocturno ni a las corridas (su último resultado es el del 4 de octubre).

### 4.1 Administración

| Fila   | Qué se prueba                              | Tests que la cubren                                                                                                                                          | Resultado |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| RB-A01 | Ingreso seguro, perfil y capacidades       | adm `cuentas-fijas`, `permisos-capacidades`, `recorrido-dueno`, `configuracion-dueno`, `usuarios-sesiones`; perm (CB-17); pgTAP 0003, 0013, 0019, 0020; Deno | Pasa      |
| RB-A02 | Alta y gestión de empleados y supervisores | adm `empleados-fichas`, `usuarios-sesiones`, `recorrido-dueno`; pgTAP 0006, 0012; Deno; e2e employees (viejo)                                                | Pasa      |
| RB-A03 | Clientes y sedes                           | adm `clientes-sedes` (CB-19, CB-20), `recorrido-administrador`; perm; pgTAP 0005, 0012; e2e clients-sites (viejo)                                            | Pasa      |
| RB-A04 | Servicios y asignación de personal         | adm `generacion-turnos`, `planificacion`, `turno-cancelado`, `recorrido-administrador`; perm; pgTAP 0007, 0023, 0024                                         | Pasa      |
| RB-A05 | Checklists y tareas por sede               | adm `plantillas-checklists` (CB-11), `permisos-capacidades`, `recorrido-administrador`; perm (`edit_checklists`); pgTAP 0008, 0025                           | Pasa      |
| RB-A06 | Cronograma y estado de la operación        | adm `planificacion` (mes, semana, día), `asistencia-cierre`; pgTAP 0011, 0018                                                                                | Pasa      |
| RB-A07 | Tablero del día                            | adm `recorrido-administrador`, `recorrido-dueno`, `admin-celular`; e2e tablero (viejo, 8 de 8 el 4 de octubre)                                               | Pasa      |
| RB-A08 | Avisos y asistencia en nombre de otro      | adm `asistencia-cierre` (CB-05, CB-07), `admin-celular`; perm; pgTAP 0027                                                                                    | Pasa      |
| RB-A09 | Consulta de supervisiones y calificaciones | adm `supervisiones-calificaciones` (filtros, CB-14); pgTAP 0029, 0010                                                                                        | Pasa      |

### 4.2 Empleado

| Fila   | Qué se prueba                 | Tests que la cubren                                                                                                   | Resultado |
| ------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------- |
| RB-E01 | Ingreso con su propio usuario | adm `cuentas-fijas`; emp `mas-perfil`, `desactivado` (CB-18); `e2e-auth` (credenciales, recuperación, sesión)         | Pasa      |
| RB-E02 | Jornada del día               | emp `hoy` (vacío, orden, 7 días, cambios, cancelado), `fichar` (CB-01); adm `turno-cancelado`; pgTAP 0011, 0026, 0028 | Pasa      |
| RB-E03 | Lugar, horario y tareas       | emp `detalle-servicio`; adm `clientes-sedes` (CB-20)                                                                  | Pasa      |
| RB-E04 | Inicio y fin de jornada       | emp `fichar` (ubicación concedida y negada, CB-21), `en-curso` (CB-04, CB-22); pgTAP 0026                             | Pasa      |
| RB-E05 | Estado de las tareas          | emp `en-curso` (CB-12); perm (`TASK_LOCKED`); pgTAP 0025                                                              | Pasa      |
| RB-E06 | Observaciones del servicio    | emp `en-curso` (guardar, detalle, resumen, `SHIFT_COMPLETED`); perm; pgTAP 0026                                       | Pasa      |
| RB-E07 | Aviso de ausencia o demora    | emp `avisos` (CB-06 exacto, rechazo tardío); adm `asistencia-cierre`; pgTAP 0027                                      | Pasa      |

### 4.3 Supervisor

| Fila   | Qué se prueba                            | Tests que la cubren                                                                                                                          | Resultado |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| RB-S01 | Ingreso y registro de su jornada         | adm `cuentas-fijas`; sup `flujo` (inicio y fin, ubicación concedida y negada), `doble-rol`                                                   | Pasa      |
| RB-S02 | Supervisiones asignadas del día          | sup `hoy-historial`, `permisos`; adm `supervisiones-calificaciones`, `admin-celular`, `recorrido-administrador`                              | Pasa      |
| RB-S03 | Servicios, sedes y personal a supervisar | sup `hoy-historial`, `permisos` (el turno ajeno no es accesible); perm; pgTAP 0011, 0012                                                     | Pasa      |
| RB-S04 | Calificación                             | sup `flujo`, `doble-rol` (CB-13), `permisos` (CB-14); adm `supervisiones-calificaciones`; emp `sin-calificaciones` (MOB-SUP-014); pgTAP 0029 | Pasa      |
| RB-S05 | Historial propio                         | sup `hoy-historial`, `flujo`; perm                                                                                                           | Pasa      |

### 4.4 Transversales

| Fila   | Qué se prueba                      | Tests que la cubren                                                                                                                                                | Resultado                                                                     |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| RB-X01 | Administración en tablet y celular | adm `admin-celular` (tablero, asignar, registrar en nombre de otro y asignar una supervisión, a 390 px); axe en 44 pantallas; Edge; e2e responsive (viejo, manual) | Pasa                                                                          |
| RB-X02 | Reglas de acceso por rol           | perm (1.619 casos); adm `permisos-capacidades`; pgTAP 0012, 0016, 0017, 0020, 0022                                                                                 | Pasa (la corrida contra producción es de F20)                                 |
| RB-X03 | Dominio, certificado, alojamiento  | —                                                                                                                                                                  | No aplica a F18: es de F20 (`INFRA-013`, `DEPLOY-008`)                        |
| RB-X04 | Criterios de calificación y escala | adm `configuracion-dueno` (alta y cierre de un criterio, vista previa); sup `hoy-historial`                                                                        | Pasa                                                                          |
| RB-X05 | Fuera de la Base                   | —                                                                                                                                                                  | Exclusión explícita del plan                                                  |
| RB-X06 | Aceptación en producción           | —                                                                                                                                                                  | No aplica a F18: es el checklist manual de F20                                |
| RB-X07 | Respaldos periódicos               | workflows `backup.yml` y `restore-test.yml`; no hay test de Playwright                                                                                             | No aplica a este paquete: la restauración real es TEST-024 y queda para P18.8 |

### 4.5 Decisiones de Mike con implementación específica (sección 5 de `09`)

| Decisión                                            | Tests que la cubren                                                                                            | Resultado                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| P-013, P-042 varios roles por persona               | sup `doble-rol` (CB-13); e2e employees `dual-role-cross-access` (viejo); unitarias de Más                      | Pasa                                                                    |
| P-015 cerrar sesiones ajenas                        | adm `usuarios-sesiones` (la sesión ajena queda revocada); Deno                                                 | Pasa                                                                    |
| P-017, P-022 dueño y capacidades                    | adm `permisos-capacidades`, `recorrido-dueno`; pgTAP 0003, 0013                                                | Pasa                                                                    |
| P-023 mapa de sedes                                 | adm `clientes-sedes`; e2e clients-sites `site-map` (viejo)                                                     | Pasa                                                                    |
| P-029 restricciones informativas                    | emp `detalle-servicio` (las tres restricciones, sin bloquear el inicio)                                        | Pasa                                                                    |
| P-033 licencias con fechas                          | adm `planificacion` (CB-25); e2e employees (viejo); pgTAP 0006                                                 | Pasa                                                                    |
| P-034, P-035 habilitación y disponibilidad          | adm `empleados-fichas`, `planificacion`; pgTAP 0024                                                            | Pasa                                                                    |
| P-037 foto de perfil                                | emp `mas-perfil` (subir, ver y quitar); unitarias de `AvatarUpload`; pgTAP 0014                                | Pasa                                                                    |
| P-044 generación mensual                            | adm `generacion-turnos` (CB-08, CB-24); pgTAP 0023                                                             | Pasa                                                                    |
| P-050 feriados                                      | adm `configuracion-dueno` (alta, baja y nacionales sin duplicar), `planificacion`, `generacion-turnos` (CB-09) | Pasa                                                                    |
| P-053 superposición                                 | adm `planificacion` (CB-02, CB-10); pgTAP 0007, 0023, 0024                                                     | Pasa                                                                    |
| P-058, P-059 plantillas por cliente y sede          | adm `recorrido-administrador`, `plantillas-checklists`; e2e checklists (viejo); pgTAP 0008, 0025               | Pasa                                                                    |
| P-067, P-091 geoposición con consentimiento         | emp `fichar` (concedida y negada); sup `flujo` (concedida y negada)                                            | Pasa                                                                    |
| P-069, P-075 registro y cierre por administración   | adm `asistencia-cierre`, `admin-celular`; pgTAP 0027                                                           | Pasa                                                                    |
| P-080, P-087 puntaje único y criterios con vigencia | adm `configuracion-dueno`; pgTAP 0010, 0029                                                                    | Pasa                                                                    |
| P-083 ventana de edición                            | adm `supervisiones-calificaciones` (CB-14, por pantalla y por API); sup `permisos`                             | Pasa                                                                    |
| P-092, P-093 cambios al abrir                       | emp `hoy` (cambios), `avisos`; pgTAP 0028, 0011                                                                | Pasa                                                                    |
| P-097, P-098 plantilla Excel e importación          | La plantilla existe; el script de importación es de F19 (`DATA-005`)                                           | No aplica a F18: es de F19                                              |
| P-104 logs de seguridad                             | adm `configuracion-dueno` (filtros), `recorrido-dueno`; pgTAP 0004, 0019                                       | Pasa                                                                    |
| P-110, P-113 respaldos a R2                         | workflows `backup.yml` y `restore-test.yml`                                                                    | No aplica a este paquete: restauración real pendiente (TEST-024, P18.8) |
| P-117 logo personalizado                            | adm `configuracion-dueno` (estructura de ADM-28 y teléfono de soporte en el ingreso)                           | Pasa                                                                    |

**Cobertura de `09`:** de las 48 filas aplicables (27 de las secciones 1 a 4, sin RB-X05, más 21 de la sección 5), **43 pasan** y 5 no tienen test de la suite por no ser de esta fase: RB-X03, RB-X06 (F20), RB-X07 y P-110/P-113 (restauración, P18.8) y P-097/P-098 (F19).

### 4.6 Flujos críticos de `03` sección 14.2

| #   | Flujo                                                                                    | Tests                                                                      | Resultado                       |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| 1   | Ingreso por rol y redirección; el desactivado no entra                                   | adm `cuentas-fijas`; emp `desactivado`; `e2e-auth`; pgTAP 0020, 0022       | Pasa                            |
| 2   | El dueño crea un administrador y ajusta capacidades; efecto en interfaz y API            | adm `permisos-capacidades`, `recorrido-dueno`; pgTAP 0003, 0013            | Pasa                            |
| 3   | Cliente, sede con coordenadas, servicio y generación del mes                             | adm `recorrido-administrador`, `generacion-turnos`                         | Pasa                            |
| 4   | Asignación con advertencias, superposición, quitar con motivo y cancelar                 | adm `planificacion`, `turno-cancelado`                                     | Pasa                            |
| 5   | Empleado: Hoy, detalle, inicio, tareas, observación, fin y resumen                       | emp `hoy`, `detalle-servicio`, `fichar`, `en-curso` (celular e iPhone)     | Pasa                            |
| 6   | Aviso antes del inicio, rechazo después y el tablero lo refleja                          | emp `avisos`; adm `asistencia-cierre`                                      | Pasa                            |
| 7   | El administrador registra el inicio y cierra en nombre de otro; «sin registro»           | adm `asistencia-cierre`, `admin-celular`                                   | Pasa                            |
| 8   | Supervisión: asignar, ver, iniciar, calificar, terminar y consultar desde administración | sup `flujo`; adm `supervisiones-calificaciones`, `recorrido-administrador` | Pasa                            |
| 9   | El empleado no ve calificaciones ni datos de otros, por pantalla ni por API              | emp `sin-calificaciones`; perm (cero filas en `ratings`, CB-15)            | Pasa                            |
| 10  | Respaldo y restauración                                                                  | `restore-test.yml` (infra)                                                 | No aplica a este paquete: P18.8 |

### 4.7 Casos borde de `08` sección 3

| CB    | Caso                                                   | Test que lo cubre                                             | Resultado                                                      |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------- |
| CB-01 | Dos turnos el mismo día en sedes distintas             | emp `fichar`                                                  | Pasa                                                           |
| CB-02 | Superposición por un minuto                            | adm `planificacion`; pgTAP                                    | Pasa                                                           |
| CB-03 | Cancelar con el empleado presente                      | adm `turno-cancelado`; emp `hoy` (el empleado ve «Cancelado») | Pasa (con DEF-01 corregido)                                    |
| CB-04 | Inicio a las 23:59 de un turno de 22:00 a 23:30        | emp `en-curso`                                                | Pasa                                                           |
| CB-05 | El empleado nunca registra el fin                      | adm `asistencia-cierre`                                       | Pasa                                                           |
| CB-06 | Aviso a las 7:59 de un turno de 8:00                   | emp `avisos` (borde exacto, solo en `mobile`)                 | Pasa                                                           |
| CB-07 | Avisó la ausencia y después registra el inicio         | adm `asistencia-cierre`                                       | Pasa                                                           |
| CB-08 | Generar el mes dos veces                               | adm `generacion-turnos`                                       | Pasa                                                           |
| CB-09 | Feriado con un servicio que no trabaja feriados        | adm `generacion-turnos`, `planificacion`                      | Pasa                                                           |
| CB-10 | Cambiar la franja y pasar a solaparse                  | adm `planificacion` (el mensaje nombra al empleado)           | Pasa (con DEF-03 corregido)                                    |
| CB-11 | Plantilla de sede dada de baja                         | adm `plantillas-checklists`                                   | Pasa (la baja de la plantilla se prueba por API; sección 5)    |
| CB-12 | Tarea «no realizada» sin motivo                        | emp `en-curso` (pantalla y API)                               | Pasa                                                           |
| CB-13 | El supervisor también es empleado del turno            | sup `doble-rol`                                               | Pasa                                                           |
| CB-14 | Calificar al día siguiente                             | adm `supervisiones-calificaciones`; sup `permisos`            | Pasa                                                           |
| CB-15 | El empleado consulta `ratings` por API                 | perm; emp `sin-calificaciones`; sup `permisos`                | Pasa (cero filas)                                              |
| CB-16 | Último dueño                                           | e2e users (viejo); pgTAP 0003, 0013; Deno                     | Pasa (capas viejas: último resultado del 4 de octubre y P18.6) |
| CB-17 | Administrador sin `cancel_shifts` llama `cancel_shift` | adm `permisos-capacidades`; perm                              | Pasa                                                           |
| CB-18 | Desactivado con la app abierta                         | emp `desactivado`; `e2e-auth`                                 | Pasa                                                           |
| CB-19 | Cliente suspendido con turnos generados                | adm `clientes-sedes`                                          | Pasa                                                           |
| CB-20 | Sede sin coordenadas                                   | adm `clientes-sedes`                                          | Pasa                                                           |
| CB-21 | El empleado niega la ubicación                         | emp `fichar`; sup `flujo`                                     | Pasa                                                           |
| CB-22 | Sin conexión                                           | emp `en-curso`                                                | Pasa                                                           |
| CB-23 | Dos administradores editan el mismo turno              | adm `dos-administradores` (gana el último que guarda)         | Pasa                                                           |
| CB-24 | Mes de 31 días y vigencia que termina el 15            | adm `generacion-turnos`; pgTAP 0023                           | Pasa                                                           |
| CB-25 | Empleado de licencia asignado                          | adm `planificacion`; pgTAP 0024                               | Pasa                                                           |

Los 25 casos borde tienen test y pasan. **TEST-026** (ejemplos reales del cliente, IF-15) **no aplica**: el cliente no los mandó y Mike decidió omitirlo.

## 5. Defectos encontrados en F18

Todos se encontraron con estas suites antes de cerrar la fase. Los detalles de cada hallazgo están en los reportes de `Docs/Plan_Maestro/reportes/P18.1` a `P18.6`, en `docs/test-inventory.md` (sección 9) y en `docs/security-review.md`. Las correcciones llegaron en tres Pull Requests de P18.6: **#120** (base de datos y `admin-users`, migraciones 0030 y 0031), **#119** (cierre de sesión local, etiqueta de la foto y «Cancelar turno») y **#121** (compañeros por vista, turno cancelado en Hoy y logo sin SVG).

### 5.1 Defectos de las suites de pantalla

| ID      | Severidad | Qué pasaba                                                                                          | Cómo se corrigió                                                                     | PR          | Estado               |
| ------- | --------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------- | -------------------- |
| DEF-01  | Mayor     | El empleado no veía los turnos cancelados en Hoy y no se enteraba (P-049, CB-03)                    | `v_my_day` incluye cancelados con un indicador; Hoy muestra «Cancelado» sin acciones | #120 y #121 | Cerrado y verificado |
| DEF-02  | Menor     | ADM-06 no ofrecía «Cancelar turno»                                                                  | El detalle ofrece «Cancelar turno» con motivo                                        | #119        | Cerrado y verificado |
| DEF-03  | Menor     | El rechazo por superposición no nombraba al empleado afectado (CB-10)                               | El mensaje agrega «Afecta a: Nombre Apellido.»                                       | #120 y #121 | Cerrado y verificado |
| DEF-04  | Menor     | «Cerrar sesión» cerraba las sesiones de la cuenta en todos los dispositivos                         | El cierre es local: solo termina la sesión del dispositivo                           | #119        | Cerrado y verificado |
| DEF-A01 | Menor     | COM-04: el campo de la foto de perfil no tenía etiqueta accesible (axe, crítico, en los tres roles) | El campo tiene etiqueta; axe da cero críticos                                        | #119        | Cerrado y verificado |

### 5.2 Defectos de la matriz de permisos (DEF-P01 a DEF-P13)

Eran 13 causas raíz que hacían fallar 50 casos de la matriz (marcados `expected fail`). Desde P18.6 los 1.619 casos pasan sin excepciones.

| ID      | Severidad | Qué pasaba                                                                         | Cómo se corrigió                                                         | PR          | Estado               |
| ------- | --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------- | -------------------- |
| DEF-P13 | Mayor     | Un administrador, aun sin capacidades, desactivaba a cualquiera, incluido el dueño | Disparador en `profiles` con las reglas del plan                         | #120        | Cerrado y verificado |
| DEF-P04 | Mayor     | El supervisor leía DNI, CUIL, domicilio y contacto de emergencia de sus empleados  | Se quitó la política; nombre y foto por la vista `v_people_basic`        | #120        | Cerrado y verificado |
| DEF-P07 | Mayor     | Cualquiera, aun sin ingresar, listaba el depósito de fotos de perfil (es SEG-01)   | Se quitó el listado público; las fotos siguen por su dirección           | #120        | Cerrado y verificado |
| DEF-P01 | Mayor     | El administrador cambiaba el teléfono de soporte y el consentimiento de la empresa | Disparador: el administrador solo cambia el logo                         | #120        | Cerrado y verificado |
| DEF-P03 | Mayor     | Empleado y supervisor leían teléfono y correo de los compañeros                    | Se quitaron las políticas; `v_people_basic`                              | #120 y #121 | Cerrado y verificado |
| DEF-P05 | Mayor     | El empleado leía CUIT, domicilio administrativo y notas del cliente                | `clients` solo para el supervisor; el empleado usa `v_clients_basic`     | #120        | Cerrado y verificado |
| DEF-P06 | Mayor     | El empleado leía la observación de sus compañeros                                  | El empleado ve solo sus asignaciones; los compañeros por `v_shift_peers` | #120 y #121 | Cerrado y verificado |
| DEF-P02 | Mayor     | Leer `shift_tasks` sin filtro tardaba más de 6 segundos                            | Políticas con subconsultas y funciones por conjunto: de 6.574 a 86 ms    | #120        | Cerrado y verificado |
| DEF-P08 | Menor     | `sign_out_user` no verificaba que la persona existiera                             | Responde `PROFILE_NOT_FOUND`                                             | #120        | Cerrado y verificado |
| DEF-P09 | Menor     | Un desactivado con la sesión vigente leía feriados y configuración                 | Las dos tablas exigen perfil activo                                      | #120        | Cerrado y verificado |
| DEF-P10 | Menor     | Un desactivado con la sesión vigente subía a su carpeta de fotos                   | Las políticas de escritura usan el perfil activo                         | #120        | Cerrado y verificado |
| DEF-P11 | Menor     | La función interna `rls_auto_enable()` estaba expuesta como RPC (es SEG-08)        | Se le quitó el permiso de ejecución                                      | #120        | Cerrado y verificado |
| DEF-P12 | Menor     | `mark_changes_seen` funcionaba para un desactivado                                 | Responde `FORBIDDEN` si el perfil no está activo                         | #120        | Cerrado y verificado |

### 5.3 Hallazgos de la revisión de seguridad (SEG-01 a SEG-08)

| ID     | Severidad | Qué era                                                                                  | Cómo se corrigió o qué se decidió                                                                                                                          | PR          | Estado               |
| ------ | --------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------- |
| SEG-01 | Mayor     | Listado público del depósito `avatars` (igual a DEF-P07)                                 | Ver DEF-P07                                                                                                                                                | #120        | Cerrado y verificado |
| SEG-02 | Menor     | Se aceptaban imágenes SVG como logo                                                      | La base y la pantalla de carga rechazan SVG                                                                                                                | #120 y #121 | Cerrado y verificado |
| SEG-03 | Menor     | El límite de acciones por minuto de `admin-users` no contaba los intentos rechazados     | Los rechazos también cuentan (`admin_action_rejected`)                                                                                                     | #120        | Cerrado y verificado |
| SEG-04 | Menor     | Contraseña mínima de 8 caracteres y sin reglas de complejidad                            | Coincide con el plan; **Mike decidió dejarlo como está**                                                                                                   | —           | Aceptado por Mike    |
| SEG-05 | Mayor     | La contraseña de las cuentas ficticias de `App_dev` es una palabra corriente             | **Mike decidió dejarla como está** (solo afecta a `App_dev`, sin datos reales); la revisión recomendaba rotarla                                            | —           | Aceptado por Mike    |
| SEG-06 | Menor     | `config.toml` dice JWT de 15 minutos y el plan (`03` §15) dice 1 hora                    | Era de documentación: el cambio a 15 minutos lo decidió Mike el 23 de septiembre; `03` §15 actualizado el 4 de octubre (`docs/security.md` ya decía 900 s) | —           | Cerrado              |
| SEG-07 | Menor     | `localhost:5173` figuraba en la lista de orígenes permitidos de `admin-users` desplegada | Solo por un secreto extra cargado en `App_dev`; no se carga en producción                                                                                  | #120        | Cerrado y verificado |
| SEG-08 | Menor     | `rls_auto_enable()` expuesta (igual a DEF-P11)                                           | Ver DEF-P11                                                                                                                                                | #120        | Cerrado y verificado |

### 5.4 Preguntas del plan que Mike resolvió durante la fase

| Tema            | Pregunta                                                                                               | Qué quedó                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CB-18           | Qué pasa con un usuario desactivado con la app abierta                                                 | Al renovar la sesión queda fuera y vuelve a COM-01 con «Esta cuenta está desactivada»; no puede volver a entrar (confirmado el 3 de octubre, P18.2; está en `08` §3). El test `desactivado` lo comprueba       |
| CB-23           | Dos administradores editan el mismo turno                                                              | Gana el último que guarda, sin aviso ni bloqueo (confirmado el 3 de octubre, P18.1; `08` §3). Test `dos-administradores`                                                                                       |
| EMP-09          | Hasta cuándo se edita la observación                                                                   | Mientras el turno no esté completado; con un solo empleado se cierra cuando ficha el fin (confirmado el 3 de octubre, P18.2; `05`). Test `en-curso`                                                            |
| CB-11           | ¿Se ofrece en ADM-26 la baja de la plantilla de una sede?                                              | ADM-26 sigue sin ofrecer esa baja (solo ítems); el caso se prueba por API con la sesión del administrador, y la pantalla vuelve a «usa la plantilla del cliente». **Mike decidió dejarlo así** el 4 de octubre |
| SEG-04 y SEG-05 | Política de contraseñas y contraseña del seed                                                          | Se dejan como están por decisión de Mike (3 de octubre, sección 5.3)                                                                                                                                           |
| MOB-SUP-014     | El empleado no tiene pantalla de calificaciones: ¿alcanza con la redirección y las cero filas por API? | Sí, **confirmado por Mike el 3 de octubre**: el test `sin-calificaciones` carga una calificación real y comprueba que las rutas de supervisión y administración redirigen y que la API devuelve cero filas     |
| TEST-026        | Ejemplos reales del cliente (IF-15)                                                                    | No aplica: el cliente no los mandó; Mike decidió omitirlo                                                                                                                                                      |

> Las decisiones de esta tabla están asentadas en `Docs/Plan_Maestro/12_Registro_de_Progreso.md`, sección de F18. CB-23 también se aplica por formulario entero: el segundo que guarda pisa todos los campos (Mike, 4 de octubre).

## 6. Accesibilidad, carga y permisos

### 6.1 Accesibilidad (axe-core, TEST-023)

axe-core audita **44 pantallas** (login y recuperar contraseña; administración y dueño; empleado EMP-03 a EMP-13; supervisor SUP-02 a SUP-09) en escritorio (1280 px) y celular (390 px). El criterio es cero violaciones **críticas** y **graves**. Resultado después de P18.6: **cero críticas y cero graves en todas las pantallas** (la única crítica, DEF-A01 en COM-04, se corrigió). Observaciones que no hacen fallar (impacto moderado o menor): contenido fuera de una región de la página en el celular (`region`), pantallas de empleado y supervisor sin título principal `h1` (`page-has-heading-one`) y encabezados de tabla vacíos en tres pantallas de configuración. El **contraste de color** se informa aparte sin hacer fallar: Mike aceptó en F17 que algunos colores del Design System queden por debajo de 4,5 a 1; se anota cuántos elementos incumplen en las pantallas representativas (por ejemplo ADM-02, 40 en escritorio y 38 en celular).

Lighthouse (PWA y accesibilidad de 90 o más sobre staging) se midió en P17 (RESP-010) y no se repitió en este paquete.

### 6.2 Carga ligera (TEST-022) y el efecto de P18.6

`pnpm test:load` simula 5 administradores y 30 empleados con el polling real de la aplicación durante 5 minutos contra `App_dev`.

| Medida (35 usuarios)                             | Antes de P18.6 | Después de P18.6 |
| ------------------------------------------------ | -------------- | ---------------- |
| `v_my_day`, arranque (todos abren a la vez), p95 | 6,4 a 7,1 s    | 2,5 a 3,5 s      |
| `v_my_day`, régimen, p95                         | 0,33 a 0,66 s  | 0,13 a 0,17 s    |
| `shift_tasks` del empleado, lectura sin filtro   | 6.574 ms       | 86 ms            |
| `v_my_day` de un empleado, medido solo           | 340 ms         | 12 a 14 ms       |
| Errores 5xx y rechazos de conexión               | 0              | 0                |

(Los rangos son de dos o tres mediciones distintas de los reportes de P18.4 y P18.6.) El único límite que apareció fue el de **ingresos de Auth (HTTP 429)** al ingresar 35 cuentas seguidas desde una misma IP: el reintento con espera lo resolvió; en uso real puede pasar un lunes a las 8:00 si 30 personas ingresan con contraseña desde la misma red del cliente.

### 6.3 Permisos (TEST-019)

La matriz `tests/permissions/suite/` ejecuta **1.619 casos** por API directa con siete perfiles: cada tabla de `public` (leer, insertar, modificar y borrar), cada vista, cada RPC, los depósitos de archivos y la Edge Function `admin-users`. Resultado esperado: cero filas, `FORBIDDEN` o error de política. Incluye CB-15 (el empleado lee `ratings` y obtiene cero filas) y CB-17. **Pasan los 1.619 en todas las corridas** (antes de P18.6 pasaban 1.530 y 50 estaban marcados como fallo esperado).

| Archivo                 | Casos     |
| ----------------------- | --------- |
| `00-inventario`         | 10        |
| `10-tablas-lectura`     | 175       |
| `11-tablas-escritura`   | 588       |
| `12-columnas-sensibles` | 22        |
| `13-rendimiento`        | 2         |
| `20-vistas`             | 169       |
| `30-rpc`                | 259       |
| `40-capacidades`        | 15        |
| `50-storage`            | 90        |
| `60-edge`               | 68        |
| `70-escalamiento`       | 44        |
| `80-desactivado`        | 177       |
| **Total**               | **1.619** |

## 7. Riesgos y observaciones abiertas

1. **`App_dev` es sensible a la carga.** Con tres o más suites a la vez, o con 35 usuarios abriendo al mismo tiempo, la base de desarrollo se pone lenta y aparecen demoras de 10 segundos o más que no son defectos de la aplicación (sección 3.3). En el nocturno cada suite corre en su propio equipo pero **comparten `App_dev`**: ante una falla intermitente conviene mirar primero la carga (otra corrida, un respaldo o una restauración al mismo tiempo; el nocturno y la restauración comparten `concurrency` justamente por eso).
2. **Arranque en frío de las vistas del tablero.** `v_assignments_board` y `v_supervisions_admin` tardan unos 3,5 s (p95) cuando 35 usuarios abren a la vez, contra 0,2 a 0,4 s en régimen. Es el momento real de «todos fichan a las 8:00». P18.6 lo bajó a la mitad para `v_my_day`; las dos vistas del tablero quedan como observación (no hay un criterio de aceptación que lo fije).
3. **Edge y el nocturno todavía no se probaron en GitHub.** Edge corre bien en local (Windows, 30 de 30), pero en `ubuntu-latest` falta verificarlo en la primera corrida manual del flujo `e2e-app-dev.yml` (que además debe durar menos de 15 minutos, no chocar con el límite de ingresos 429 por IP y subir los artefactos). Después se activa `E2E_NOCTURNO_ENABLED=true` (`docs/deployment.md` sección 14.7). Hasta entonces las tres corridas de este informe son locales.
4. **Restauración de respaldo pendiente (TEST-024).** El flujo `restore-test.yml` está listo (PR #112) pero la restauración real contra `App_dev` se hace en P18.8. Hasta entonces RB-X07, P-110 y P-113 no tienen resultado.
5. **Capas no repetidas en este paquete.** pgTAP (41 archivos), Deno y las pruebas de la base se corrieron por última vez en P18.6; las cubre además la integración continua de cada Pull Request.
6. **Preguntas abiertas.** Ninguna: SEG-04 y SEG-05 quedan aceptados por Mike, SEG-06 cerrado, y CB-18 confirmado (vuelve a COM-01 con «Esta cuenta está desactivada», que es lo que hace la aplicación).
7. **Producción.** Antes de F20 hay que aplicar las migraciones 0030 y 0031 y desplegar `admin-users` en producción, sin cargar el secreto `ALLOWED_ORIGINS_EXTRA` (reporte P18.6), y correr la matriz de permisos contra producción con cuentas de prueba desactivadas después (RB-X02).
8. **La limpieza de datos.** Las suites crean datos con el prefijo `e2e-` y los borran al terminar; nada se borra físicamente de las cuentas (P-014). El barrido previo elimina residuos de corridas cortadas.
