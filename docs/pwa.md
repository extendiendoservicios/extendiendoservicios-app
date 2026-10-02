# PWA: instalación, actualización y compatibilidad

`08_Fases_y_Backlog.md` F17, RESP-001, RESP-002, RESP-009, RESP-010 y RESP-012. La plataforma es una
aplicación web progresiva (PWA): se abre desde el navegador y se puede instalar en la pantalla de
inicio del celular, donde se ve a pantalla completa, sin la barra del navegador.

Este documento explica cómo funciona y qué hacer cuando algo no anda. Las decisiones de
implementación (por qué `standalone`, por qué `prompt`, el `short_name`) están en
[`design-system.md`](design-system.md), sección "PWA", y no se repiten acá.

## Qué es y qué no es

- **Es** la misma aplicación que se usa en el navegador, con ícono propio, pantalla completa y la
  capacidad de abrir sin conexión.
- **No sirve para trabajar sin conexión.** El service worker guarda solo el código de la aplicación
  (pantallas, estilos, fuentes, íconos). Los datos (turnos, asistencia, fichajes, usuarios) viajan
  siempre por la red y no se guardan en el dispositivo (P-089, `02_Decisiones.md`).
- No hay una versión distinta para instalar: es la misma dirección, con las mismas pantallas por rol.

## Manifest e íconos

El manifest se genera en cada build desde `vite.config.ts` (`VitePWA({ manifest })`) y queda en
`dist/manifest.webmanifest`. Valores relevantes:

| Campo                              | Valor                                                       |
| ---------------------------------- | ----------------------------------------------------------- |
| `name` / `short_name`              | `Extendiendo Servicios` / `Ext. Servicios`                  |
| `lang`                             | `es-AR`                                                     |
| `start_url` / `scope`              | `/` / `/`                                                   |
| `display`                          | `standalone` (sin barra del navegador, con barra de estado) |
| `theme_color` / `background_color` | `#569EA4` (el teal de marca, `--primary`)                   |

`index.html` repite el color en `<meta name="theme-color">` y enlaza el `apple-touch-icon`, que es lo
que usa Safari en iPhone (no lee los íconos del manifest).

### Dónde están los íconos

En `public/icons/`:

| Archivo                                  | Uso                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pwa-192x192.png`                        | Manifest, `purpose: any`.                                                                                                                                       |
| `pwa-512x512.png`                        | Manifest, `purpose: any`.                                                                                                                                       |
| `pwa-maskable-512x512.png`               | Manifest, `purpose: maskable` (Android recorta el ícono a círculo, cuadrado redondeado, etc.). El isotipo ocupa el 56 % del alto para quedar en la zona segura. |
| `apple-touch-icon-180x180.png`           | Safari en iOS ("Agregar a pantalla de inicio").                                                                                                                 |
| `isotipo_blanco_34px@2x.png` y `@3x.png` | Marca de la sidebar (no son de la PWA).                                                                                                                         |

Son el isotipo blanco de los PNG originales de la marca, compuesto sobre `#569EA4`.

### Cómo se regeneran

No hay un script en el repositorio: los íconos se generan **fuera** de `app/`, a partir de los
originales de `Images/`, y se copian a `public/icons/` con los mismos nombres. El procedimiento
(columnas y filas del recorte, porcentaje que ocupa el isotipo en cada tamaño) está en
`Images/recortes/README.md`. Cuando llegue el logo vectorial (IF-08) hay que regenerar los seis
archivos desde ahí: es la deuda **DS-020**. Si los nombres no cambian, no hace falta tocar
`vite.config.ts` ni `index.html`.

Después de cambiar un ícono: `pnpm build`, revisar `dist/manifest.webmanifest` y correr
`pnpm test:lighthouse --solo=login --modos=mobile` (comprueba que los tres íconos existan y midan lo
que el manifest declara). En un teléfono que ya tiene la app instalada, el ícono nuevo recién se ve
al desinstalar y volver a instalar.

## Service worker

Lo genera Workbox (`strategies: 'generateSW'`) en cada build, como `dist/sw.js`. No se escribe a mano.

**Qué cachea:** el precache contiene exactamente lo que emite `dist/` con extensión `js`, `css`,
`html`, `woff2`, `png`, `svg` e `ico`. Con la carga diferida por pantalla (RESP-010) son unos 200
archivos y alrededor de 2 MB, que se bajan una sola vez por versión. Cualquier ruta de la aplicación
que no sea un archivo (`/admin/...`, `/app/...`) responde con `index.html` desde el cache
(`navigateFallback`), para que abra sin conexión.

**Qué no cachea:** nada más. No hay `runtimeCaching`, así que las llamadas a Supabase (datos, Auth,
Storage, Edge Function), a Nominatim y los mosaicos de OpenStreetMap nunca pasan por el cache del
service worker. Tampoco se guarda nada de `/dev/*` (solo existe en desarrollo).

**En desarrollo no hay service worker** (`devOptions.enabled: false`): evita que `pnpm dev` sirva un
`index.html` viejo.

**Cabeceras:** `public/_headers` manda `Cache-Control: no-cache` para `/sw.js` y
`/manifest.webmanifest`. Son los dos únicos archivos sin hash en el nombre; sin eso, una copia vieja
en el CDN impediría que llegara una versión nueva.

### Estrategia `prompt`: la versión nueva nunca se aplica sola

Cuando se publica una versión, el navegador baja el service worker nuevo, lo instala y lo deja
**esperando**. No toma el control hasta que la persona lo pida. Es a propósito: un empleado puede estar
fichando o cargando una observación, y una recarga automática le haría perder lo que está haciendo.

## Aviso de versión nueva (RESP-009)

`PwaUpdateProvider` (`src/app/PwaUpdateProvider.tsx`, montado en `main.tsx`) registra el service
worker y le pregunta al navegador si hay una versión nueva **cada hora** mientras la app está abierta,
y de nuevo cada vez que la persona vuelve a la app después de tenerla en segundo plano. El navegador
por sí solo lo haría como mucho una vez cada 24 horas, y una SPA no recarga la página al cambiar de
pantalla. Sin conexión el chequeo se saltea.

Cuando hay una versión esperando, `PwaUpdateBanner` muestra "Hay una versión nueva de la aplicación"
en la parte inferior, por encima de la tabbar:

- **Actualizar ahora**: le manda `SKIP_WAITING` al service worker nuevo, espera a que quede activo y
  recarga la página. Es el único momento en que se recarga.
- **Más tarde**: oculta el aviso sin aplicar nada. Si aparece una versión todavía más nueva, vuelve a
  mostrarse solo.

En los shells de empleado y supervisor el aviso aparece solo en las pestañas raíz (Hoy, Fichar, Más),
nunca en una subpágina, para no tapar la `ActionBar` a quien está llenando un formulario.

### Recarga única ante un chunk de una versión anterior (P17.4.1)

Con la carga diferida por pantalla, cada pantalla es un archivo (chunk) con hash en el nombre. Si
alguien deja la aplicación abierta y se publica una versión nueva, al navegar a una pantalla que no
había abierto todavía el navegador pide un chunk que ya no existe en el servidor, y la navegación
fallaría.

Para ese caso hay una red de seguridad (`src/app/routes/lazyPage.ts` y el listener de
`vite:preloadError` en `src/main.tsx`): se recarga la página **una vez** para tomar la versión nueva.
Para no recargar en bucle si el archivo falta de verdad, la marca se guarda en `sessionStorage` y
dentro de los 30 segundos siguientes no se vuelve a recargar; el segundo fallo se muestra como error
normal.

Es complementaria al aviso: el aviso es la vía prolija (la persona elige cuándo); la recarga única es
lo que evita una pantalla rota si no lo vio.

## Banner de instalación (COM-06)

`InstallBanner` (`src/components/InstallBanner.tsx`) ofrece instalar la aplicación. Se muestra en:

| Pantalla                        | Quién                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| EMP-03 Hoy                      | Empleado.                                                                                       |
| SUP-02 Hoy                      | Supervisor.                                                                                     |
| ADM-02 Resumen (administración) | Dueño y administradores, **solo en celular** (menos de 1024 px; decisión de Mike, 26 sep 2026). |

Reglas:

- **Dos variantes.** Si el navegador ofreció la instalación (Chrome en Android), el banner tiene un
  botón **Instalar**, que abre el diálogo nativo, y **Ahora no**. En Safari de iPhone y iPad muestra un
  texto con los pasos manuales y una "X" para cerrarlo.
- **No aparece** si la app ya corre instalada (`display-mode: standalone`, o `navigator.standalone` en
  iOS), ni en un navegador de escritorio que no ofrezca la instalación.
- **Si se cierra**, no vuelve a aparecer durante 7 días (`src/lib/installBannerDismiss.ts`, en
  `localStorage`; sin almacenamiento disponible, como en modo privado, se ofrece siempre).
- **Se captura temprano.** Chrome dispara `beforeinstallprompt` una sola vez por carga de página. Por
  eso `main.tsx` lo escucha antes de montar React (`src/lib/installPrompt.ts`) y el banner lee el
  estado con `useInstallPrompt`. Sin esto, el banner no aparecía si la persona entraba por la pantalla
  de ingreso (se vio en la prueba en un Android real, MOB-EMP-018).

## Instalar la aplicación, por navegador

### Chrome en Android

1. Abrir la dirección en **Chrome**.
2. Tocar **Instalar** en el banner de Hoy. Si no aparece (lo cerraron, o Chrome todavía no lo
   ofreció): menú de los tres puntitos, **Instalar aplicación** (en algunos teléfonos dice **Agregar a
   la pantalla principal**).
3. Confirmar en el cartel del teléfono. Aparece el ícono en la pantalla de inicio y la app abre sin la
   barra del navegador.

### Safari en iPhone y iPad (iOS 16.4 o superior)

Safari **no dispara `beforeinstallprompt`**, así que no hay botón "Instalar": el banner solo explica
los pasos y hay que hacerlos a mano. Solo funciona desde Safari (no desde Chrome ni otros navegadores
en iPhone):

1. Abrir la dirección en **Safari**.
2. Tocar **Compartir** (el cuadrado con la flecha hacia arriba).
3. Elegir **Agregar a pantalla de inicio** y confirmar con **Agregar**.

La app instalada en iOS tiene su propio almacenamiento: la sesión iniciada en Safari no pasa a la app
instalada, hay que ingresar de nuevo la primera vez.

### Escritorio

Chrome y Edge permiten instalarla desde la barra de direcciones. No es un uso previsto (las vías
móviles se ven centradas a 480 px en escritorio), pero funciona; el banner no se ofrece ahí.

## Sin conexión

- La aplicación **abre** (el código está en el precache) y se puede navegar entre pantallas.
- Los datos **no se muestran ni se guardan**: las pantallas que los piden muestran su estado de error
  o de carga, y se reintentan al volver la red.
- En el flujo de empleado, los botones que necesitan el servidor se deshabilitan sin conexión
  (consentimiento de ubicación EMP-06 y registro de inicio en `ClockTabPage`), con `useOnlineStatus`
  (`src/features/employee/useOnlineStatus.ts`). **No hay cola de fichajes**: un fichaje sin conexión no
  se guarda para después.

## Navegadores soportados (P-090)

| Sistema              | Navegador | Versión mínima                                                                    |
| -------------------- | --------- | --------------------------------------------------------------------------------- |
| Android 8 o superior | Chrome    | 111 (Chrome se actualiza por Play Store: en un Android 8 al día queda por encima) |
| iOS 16.4 o superior  | Safari    | 16.4                                                                              |

El piso lo fija Tailwind CSS 4 (`@layer`, `@property` y `color-mix()`), no una decisión de la
plataforma. `browserslist` en `package.json` y `build.target` en `vite.config.ts` declaran el mismo
piso. **iOS 15 y 16.0 a 16.3 quedan fuera de lo garantizado**: la pantalla puede verse sin estilos o
con colores rotos. Detalle en [`design-system.md`](design-system.md), sección "Navegadores soportados".

## Cómo verificar la instalabilidad

`pnpm test:lighthouse` comprueba la instalabilidad además de medir rendimiento y accesibilidad
(Lighthouse 12 en adelante ya no trae la categoría PWA, así que `tests/lighthouse/instalabilidad.ts`
lo verifica a mano): service worker registrado, activado y controlando la página tras recargar;
manifest completo (`name`, `short_name`, `display`, `start_url` que responde 200, colores); íconos 192,
512 y maskable que existen y miden lo declarado; `theme-color`, `apple-touch-icon` y viewport;
contexto seguro; y cero errores en `Page.getInstallabilityErrors` de Chrome. Si algún punto falla,
termina con código 1.

```bash
pnpm test:lighthouse --solo=login --modos=mobile    # ingreso en celular, incluye instalabilidad
pnpm test:lighthouse --sin-instalabilidad           # sin esa comprobación
```

Solo acepta `dev.extendiendoservicios.com` (staging) o `localhost`; nunca producción. Necesita
`.env.local` completo. Detalle en `tests/lighthouse/README.md`. A mano, en Chrome: DevTools, pestaña
**Application**, **Manifest** (muestra los errores de instalabilidad) y **Service workers**.

## Dispositivos probados

La prueba en teléfonos reales (dos Android y un iPhone) se hace con la planilla
[`matriz-dispositivos.md`](matriz-dispositivos.md) (RESP-011): instalación, pantalla completa, sesión
por rol, fichaje, teclado, área segura, rotación, versión nueva y sin conexión.

**Los resultados de RESP-011 los completa Mike en P17.5.** Hasta entonces la planilla está en blanco y
este documento no afirma que ningún modelo concreto haya sido probado.

## Problemas frecuentes

**La app no se actualiza / sigo viendo la versión vieja**

1. Es lo esperado hasta aceptar el aviso: la versión nueva queda esperando. Si apareció "Hay una
   versión nueva de la aplicación", tocar **Actualizar ahora**.
2. Si no apareció: el chequeo es cada hora o al volver de segundo plano. Cerrar la app del todo
   (sacarla de las apps recientes) y abrirla de nuevo suele disparar el chequeo.
3. Si sigue igual: borrar los datos del sitio o desinstalar y reinstalar (más abajo).

**Aparece una pantalla de error al navegar, o la app se recargó sola una vez**

Se publicó una versión mientras la app estaba abierta. La recarga única (arriba) lo resuelve; si el
error reaparece, cerrar y abrir la app.

**El banner de instalación no aparece**

Puede estar cerrado hace menos de 7 días, la app ya estar instalada, o el navegador no ser compatible
(en iPhone, usar Safari). En Android se puede instalar desde el menú de Chrome, **Instalar
aplicación**.

**Desinstalar y reinstalar**

- Android: mantener presionado el ícono y elegir **Desinstalar** (o **Información de la app** y borrar
  el almacenamiento). Volver a abrir la dirección en Chrome e instalar de nuevo.
- iPhone: mantener presionado el ícono y elegir **Eliminar app**. Para borrar también los datos del
  sitio: **Ajustes**, **Safari**, **Avanzado**, **Datos de sitios web**, buscar el dominio y borrarlo.
  Reinstalar desde Safari.

Al reinstalar hay que volver a iniciar sesión.

**Para quien desarrolla**

- Probar la actualización necesita un service worker real: `pnpm build`, servir con `pnpm preview`,
  cambiar algo, volver a hacer `pnpm build` sin reiniciar el servidor y forzar
  `registration.update()`. Con `pnpm dev` no hay service worker.
- Si `pnpm build` falla con `Rolldown failed to resolve import "workbox-window"`, falta
  `workbox-window` como dependencia directa.
