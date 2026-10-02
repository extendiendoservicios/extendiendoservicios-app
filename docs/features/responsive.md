# Responsive (F17 · RESP-001 a RESP-012, DOC-017)

Cómo se adapta la plataforma a cada ancho de pantalla: qué cambia en cada corte, cómo se resuelven el
área segura, el teclado y los objetivos táctiles, y cómo se prueba. La fuente de las reglas es
`05_Pantallas_y_Navegacion.md` sección 7; los componentes y sus API están en
[`../design-system.md`](../design-system.md) y la instalación como aplicación en [`../pwa.md`](../pwa.md).
Acá no se repite lo que ya está ahí: cada sección remite a la suya.

## Cortes

Los breakpoints de Tailwind (`tokens.css`) son `sm` 480, `md` 768, `lg` 1024 y `xl` 1280 px. Los anchos
**390 / 768 / 1024 / 1280** son los que se usan para diseñar y probar: 390 es un celular típico, y los
otros tres coinciden con los cortes `md`, `lg` y `xl`. Los dos que cambian la estructura son 1024
(`useMediaQuery('(min-width: 1024px)')`: shell, tablas, drawers) y 1280 (ancho de la sidebar).

| Ancho           | Qué se ve                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| menos de 768 px | Celular. Tabbar, tarjetas, paneles de acción a pantalla completa, objetivos táctiles de 44 px.             |
| 768 a 1023 px   | Tablet. Igual que el celular, pero los paneles de acción miden 452 px y los controles vuelven a su tamaño. |
| 1024 a 1279 px  | Escritorio chico. Sidebar de 60 px (solo íconos), tablas, drawers de 452 px.                               |
| 1280 px o más   | Escritorio. Sidebar de 236 px con texto.                                                                   |

Las vías de empleado y supervisor (`/app`, `/sup`) son móviles en todos los anchos: en escritorio se
ven centradas en una columna de 480 px (`MobileShell`, P-016).

## Qué cambia en cada corte (administración, `/admin`)

| Elemento                    | Menos de 1024 px                                                                                    | 1024 px o más                             |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Navegación                  | Tabbar inferior: Hoy, Planificar, Asistencia, Supervisiones y **Más**.                              | Sidebar con las ocho secciones de P-121.  |
| Tablas (`DataTable`)        | Lista de `RowCard`.                                                                                 | Tabla.                                    |
| Drawers de ruta             | Página completa: ADM-06, ADM-14 y ADM-15.                                                           | Panel lateral de 452 px sobre el listado. |
| Paneles de acción (`Sheet`) | Pantalla completa por debajo de 768 px; **452 px** de 768 a 1023 px (decisión de Mike, 2 oct 2026). | 452 px.                                   |
| Calendario mensual (ADM-03) | Lista de días con el conteo de cada uno.                                                            | Calendario mensual.                       |
| Grilla semanal (ADM-04)     | Un empleado por vez, con el selector "Elegir empleado".                                             | Grilla de toda la semana.                 |
| Banner de instalación       | Se muestra en ADM-02 (COM-06).                                                                      | No se muestra.                            |

- **Tabbar y "Más".** `ADMIN_TABBAR_ITEMS` son cuatro ítems y el quinto, **Más**, abre un `Sheet`
  inferior con Empleados, Clientes y sedes, Tareas y Configuración (`ADMIN_MORE_ITEMS`). "Más" se marca
  activo cuando la pantalla actual es una de esas cuatro. Así las ocho secciones se alcanzan a 390 px
  sin scroll horizontal. La tabbar de empleado es Hoy, Fichar (el botón central) y Más; la de
  supervisor, Hoy, Supervisiones, Historial y Más (`src/app/shells/mobileNav.ts`).
- **Sidebar.** 236 px desde 1280; entre 1024 y 1279 se colapsa a 60 px con solo el isotipo y los
  íconos, con un tooltip por ítem.
- **Tablas a `RowCard`.** `DataTable` decide por ancho y cada pantalla le da el `RowCard` de sus filas;
  `RowCard` lleva `data-slot="row-card"` (la suite responsive lo usa para detectarlo). Detalle en
  `design-system.md`, "`DataTable` y `RowCard`".
- **Drawers.** Los de ruta (ADM-06, 14 y 15) tienen URL propia y por debajo de 1024 son una página. Los
  paneles que abre una acción (por ejemplo ADM-08, ADM-11, el alta de un administrador o de un
  criterio) son un `Sheet`: ocupan toda la pantalla solo en celular y quedan de 452 px en tablet.
- **Pantallas móviles** (`/app`, `/sup`): no cambian con el ancho; solo se centran a 480 px.

## Área segura

`viewport-fit=cover` en `index.html` hace que el contenido llegue a los bordes y que
`env(safe-area-inset-*)` valga algo en celulares con muesca, isla o barra de inicio. Los cuatro valores
están en `tokens.css` como `--safe-top`, `--safe-right`, `--safe-bottom` y `--safe-left`. La tabbar
(`tabbar-safe`) crece con el área inferior en lugar de apretar los ítems; las cabeceras suman
`--safe-top`; `ActionBar` aplica abajo, izquierda y derecha. Si agregás un elemento fijo al borde,
sumale la variable que corresponda. Detalle en `design-system.md`, "Área segura, teclado virtual y
objetivos táctiles".

## Teclado virtual

Tres piezas, las mínimas que cubren Chrome y Safari:

1. `interactive-widget=resizes-content` en el viewport: en Chrome el teclado achica la pantalla y la
   `ActionBar` queda arriba del teclado. Safari lo ignora y desplaza el campo a la vista.
2. `scroll-padding-bottom` en `html`: al enfocar un campo, queda por encima de las barras fijas.
3. `useEditingField()` (`src/hooks/useEditingField.ts`): en dispositivos táctiles, mientras el foco
   está en un campo de texto, oculta la tabbar de `AdminShell` y `MobileShell` para devolverle espacio
   al formulario.

No se usa `visualViewport`. El comportamiento real con teclado, que ningún test automático reproduce,
se verifica en los teléfonos con la planilla [`../matriz-dispositivos.md`](../matriz-dispositivos.md).

## Objetivos táctiles de 44 px

Por debajo de 768 px todo control tiene 44 px de área de toque (`07` sección 6); desde 768 px los
controles vuelven a su tamaño. Se resuelve en el componente, no por pantalla:

- `Button` (`sm` y `md`), `Input`, `PasswordInput`, `SelectTrigger`, `Combobox` y las opciones de
  `SegmentedControl` crecen de verdad (`max-md:min-h-11`).
- `IconButton` mide 34 px visibles y un `::after` transparente lleva el toque a 44 px. Como ese
  `::after` se recorta si el vecino lo tapa, **dos o más `IconButton` juntos van dentro de
  `IconButtonGroup`** (10 px de separación en celular, 4 px desde 768 px).
- `Checkbox`, `Switch` y la cámara de `AvatarUpload` usan `::after` más margen vertical.

La tabla completa y el motivo de cada decisión están en `design-system.md`, "Objetivos táctiles de
44 px en celular (RESP-003, P17.3)". Los enlaces en línea dentro de un texto quedan fuera de la regla.

## Pestañas con degradé y centrado

`TabsList` y `ConfigNav` (ADM-17 tiene 7 pestañas y ADM-27 a 31 una navegación propia) no entran en
390 px: se deslizan de costado. `useScrollFades` y `ScrollFadeEdges` (`src/components/ScrollFades.tsx`)
dibujan un degradé **solo del lado que tiene contenido oculto**, para que se note que hay más, y
centran la pestaña elegida al montar y al cambiar (sin animación con `prefers-reduced-motion`).
`TabsList` acepta `fadeClassName`: el degradé es `from-bg` por omisión; sobre tarjetas usá
`from-surface`.

## Carga diferida por pantalla

Para que el celular no descargue el código de administración, cada pantalla de `/admin`, `/app`, `/sup`
y `/perfil` es un chunk aparte (`lazyPage`, `src/app/routes/lazyPage.ts`, con `lazy` de React Router).
Login, recuperar, restablecer y sin acceso quedan en el chunk de entrada. Las librerías más pesadas del
arranque (React y Supabase) van en chunks propios (`vendor-react`, `vendor-supabase`). El efecto en el
build, medido en P17.4.1: el chunk de entrada pasó de 1.105 kB (302 kB comprimido) a 237 kB (73 kB). Si
se publica una versión con la app abierta, la recarga única ante un chunk inexistente está explicada
en [`../pwa.md`](../pwa.md). Al crear una pantalla nueva, registrala con `lazyPage` en la lista de
rutas de su vía; si la importás de forma estática, vuelve a entrar al chunk de entrada.

## Cómo se prueba

Tres capas que se complementan (panorama en `tests/README.md`, TEST-014):

| Capa                            | Comando                    | Qué comprueba                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capturas por ancho (Playwright) | `pnpm test:e2e:responsive` | Las pantallas ADM a 390, 768 y 1024 px (las 20 principales también a 1366 y 1440): sin scroll horizontal, tabbar o sidebar según el ancho, tarjetas, drawers como página, objetivos táctiles de 44 px, y `/app` y `/sup` con área segura simulada. Guarda una captura por pantalla y ancho. Ver `tests/e2e-responsive/README.md`. |
| Lighthouse en staging           | `pnpm test:lighthouse`     | Accesibilidad de 90 o más, rendimiento y buenas prácticas de referencia, e instalabilidad. Ver `tests/lighthouse/README.md`.                                                                                                                                                                                                      |
| Dispositivos reales             | Planilla, a mano           | Teclado, área segura, rotación, instalación y sin conexión en dos Android y un iPhone: [`../matriz-dispositivos.md`](../matriz-dispositivos.md) (RESP-011, la completa Mike en P17.5).                                                                                                                                            |

Las dos primeras necesitan `.env.local` completo y corren a mano, fuera del CI. Los tests unitarios
(`pnpm test`) cubren la lógica de cada pieza: `AdminShell` (ocho secciones alcanzables), `IconButton`,
`IconButtonGroup`, `ScrollFades`, `useEditingField` y `useInstallPrompt`.

Para revisar a mano en el navegador, abrí las herramientas de desarrollo en modo dispositivo y probá
390, 768, 1024 y 1280 px; a 390 px, además, con la simulación del área segura de la suite
(`--safe-top: 47px`, `--safe-bottom: 34px`).
