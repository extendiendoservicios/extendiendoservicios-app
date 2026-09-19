# Design system

Fuente: `07_Design_System.md` del Plan Maestro. Este documento explica cómo
está implementado en el repositorio, no repite los valores de diseño (para
eso está `07`).

Estado: F5 · DS-001 a DS-012, DS-017. Tokens, shadcn/ui, acciones,
entradas, selectores, tarjetas, `StatusBadge`, tablas, avatares, avisos,
diálogos, timeline y lista de tareas, con `/dev/design` completo para todo
este paquete (P05.1 a P05.3). Todavía sin shells ni router con
`RequireRole` (P05.4), sin íconos PWA (P05.5).

## Tokens (`src/styles/tokens.css`)

Todos los valores de `07` sección 1 (color, foco, radios, sombras,
contenedores) son variables CSS en `:root`, con los mismos nombres que usa el
mockup (`--primary`, `--bg`, `--surface`, `--text-2`, `--r-lg`, `--sh-card`,
etc.). Es **el único lugar del repo** donde puede aparecer un valor de color,
radio o sombra escrito a mano (un hex, un `rgba(...)`, un `px` de radio). En
cualquier otro archivo, esos valores se usan siempre a través de un token:

- Como variable CSS: `var(--primary-800)`.
- Como utilidad de Tailwind: `bg-primary`, `text-text-2`, `rounded-lg`,
  `shadow-card` (ver el mapeo a Tailwind más abajo).

**No se agregan colores, radios ni sombras sueltos fuera de `tokens.css`.**
Si un componente necesita un valor que no está en `07`, se agrega el token
ahí primero (y se avisa si no está claro cuál debería ser), nunca se escribe
un literal en el componente.

Los mismos tokens tienen un segundo nombre, el que espera shadcn/ui
(`--background`, `--foreground`, `--card`, `--muted-foreground`,
`--destructive`, `--border`, `--input`, `--ring`, `--radius`), declarado
justo debajo de los crudos y apuntando a ellos con `var()`. Son alias, no
valores nuevos: sirven para que los componentes de `src/components/ui/`
(escritos por la CLI de shadcn contra esos nombres) automáticamente respeten
la paleta del mockup sin tocar su código.

Solo modo claro por ahora (P-118). Un tema oscuro futuro se agrega
redefiniendo el mismo bloque de variables bajo `:root[data-theme="dark"]` (o
`.dark`); como todo el resto del CSS lee los tokens con `var()`, no debería
hacer falta tocar ningún componente.

## Tailwind CSS 4 (`@theme` en `tokens.css`)

Tailwind se instala con `@tailwindcss/vite` (plugin en `vite.config.ts`) y se
configura en CSS, no en `tailwind.config.ts` (ADR-021). El bloque
`@theme inline` de `tokens.css` mapea los tokens de arriba a la paleta y a la
escala de Tailwind:

- Breakpoints del plan: `sm` 480, `md` 768, `lg` 1024, `xl` 1280 (Tailwind
  trae 640/768/1024/1280/1536 por defecto; acá solo cambia `sm`, el resto
  coincide).
- Colores: `bg-primary`, `text-text-3`, `bg-success-bg`, `text-danger-800`,
  `bg-background`, `text-muted-foreground`, etc.
- Radios: la escala de Tailwind (`rounded-sm` … `rounded-2xl`) está acotada a
  los tres radios del plan (8, 12, 14 px — nunca 7, 9 ni 10, `07` sección 4).
  La píldora (badges, avatares) no se mapea: `rounded-full` de Tailwind ya es
  un radio infinito, visualmente igual a 999px en cualquier tamaño de
  control; para CSS a medida está `--r-pill`.
- Sombras: `shadow-card`, `shadow-pop`, `shadow-fab`.
- Fuente: `font-sans` (ver abajo).

`@import "tailwindcss"` incluye el preflight (reset) de Tailwind. Se importa
desde `src/styles/globals.css`, junto con `tokens.css` y las declaraciones
`@font-face` de Inter.

## Tipografía: Inter self-hosted

Inter está self-hosted en `public/fonts/` (pesos 400, 500, 600 y 700,
subset **latin** — cubre español de Argentina: á é í ó ú ñ Ñ ü ¿ ¡ — con
`font-display: swap`). Sin Google Fonts en runtime.

Los archivos salen de la fuente de verdad de la propia fundición
(`@fontsource/inter`, instalado como devDependency): es un paquete que
empaqueta los `.woff2` oficiales de Inter separados por peso e idioma/script,
no un servicio en runtime. `pnpm add -D @fontsource/inter` los descarga a
`node_modules/@fontsource/inter/files/`, y de ahí se copiaron una sola vez a
`public/fonts/inter-latin-{400,500,600,700}.woff2`; `globals.css` los declara
con `@font-face` propio (no se usa el CSS que trae el paquete, para no
importar los subsets de otros scripts que no hacen falta acá). Para sumar un
peso nuevo el día de mañana: repetir esa copia con el peso que falte y
agregar su `@font-face`.

`--font-sans` (`tokens.css`) es `"Inter", "Segoe UI", system-ui, sans-serif`
y es la fuente de `font-sans`/`body` y del preflight de Tailwind. Los números
tabulares (horas, contadores, tablas) están disponibles con la utilidad
estándar de Tailwind `tabular-nums`.

## Cómo se agregan componentes de shadcn/ui

`components.json` ya está configurado (estilo `radix-rhea`: base Radix,
íconos lucide, más cerca del pedido de `07` — ver "Decisiones" abajo). Para
agregar un componente nuevo del catálogo:

```bash
pnpm dlx shadcn@4.18.0 add <componente>
```

Puntos a tener en cuenta en este repo:

- **Fijar la versión de la CLI** (acá `4.18.0`) en vez de `@latest`: pnpm
  tiene `minimumReleaseAge` activo y puede rechazar una versión recién
  publicada; usar siempre una con unos días de antigüedad.
- El componente se copia a `src/components/ui/` ya conectado a los tokens de
  arriba (usa las clases `bg-primary`, `border-input`, etc., no colores
  sueltos). **No se le cambian las variantes ni los tamaños en este paquete**
  (DS-001/002): el mockup se aplica en P05.2 y P05.3.
- La CLI a veces no instala alguna dependencia que el componente necesita
  (visto con `class-variance-authority` y `lucide-react` durante DS-002).
  Después de agregar un componente conviene revisar sus imports
  (`grep -n "^import" src/components/ui/<archivo>.tsx`) contra
  `package.json` y agregar a mano lo que falte, siempre con una versión
  exacta (sin `^`) publicada hace más de un par de semanas.
- Correr `pnpm format` después: el código que trae la CLI no sigue el estilo
  de Prettier del repo (comillas dobles, sin punto y coma).

## Decisiones de esta entrega (DS-001/DS-002)

- **Estilo de shadcn**: `07` sección 6 pedía el estilo `"default"`. La CLI
  actual ya no lo ofrece: en su lugar tiene ocho preajustes (Nova, Vega,
  Maia, Lyra, Mira, Luma, Sera, Rhea) más una opción manual. Se eligió
  **Rhea** (`Lucide / Inter`) por ser el que ya coincide con dos reglas fijas
  del plan (`07` sección 1.4: lucide-react; sección 1.2: Inter) sin agregar
  nada extra. Como en este paquete no se tocan variantes ni colores del
  preajuste (se sobrescriben todos por los tokens de `tokens.css`), la
  elección no compromete nada a futuro.
- **`form` → `field`**: `07` sección 2.2 pide el componente `form` de shadcn
  (react-hook-form + zod). En la CLI actual, `form` es un ítem del registro
  vacío (deprecado); su reemplazo es `field` (`Field`, `FieldLabel`,
  `FieldDescription`, `FieldError`, `FieldGroup`, etc.), la pieza de
  presentación pensada para usarse junto con `react-hook-form` (ya
  instalado) y `zod` de la misma forma que antes envolvía `<Form>`. Se
  instaló `field` en su lugar.
- **`cn` en vez de `clsx` + `tailwind-merge`**: los componentes de este
  preajuste importan la función `cn` desde el paquete `cn` (de la propia
  organización de shadcn/ui), que reemplaza a la combinación clásica
  `clsx` + `tailwind-merge`. No se agregó ninguna librería fuera de lo que
  trae shadcn.
- **`radix-ui` en vez de paquetes `@radix-ui/react-*` sueltos**: este
  preajuste importa los primitivos desde el paquete único `radix-ui` (que
  reexporta todo Radix), en vez de un paquete por componente. Sigue siendo
  Radix (ADR-003); solo cambia cómo se lo importa.
- **Alias `@/*` duplicado en `tsconfig.json`**: el repo resuelve el alias en
  `tsconfig.app.json` (vía project references). La CLI de shadcn en Windows
  no resuelve `references` y, sin el alias en el `tsconfig.json` raíz,
  escribía los componentes en una carpeta literal `@/` en la raíz del repo
  en lugar de `src/`. Se agregó `compilerOptions.paths` también en
  `tsconfig.json` (con un comentario explicando por qué): no compila nada
  (`files: []`), es solo para que herramientas que leen únicamente ese
  archivo encuentren el alias. **Sin `baseUrl`** (P05.3, TypeScript 6 lo
  marca obsoleto): con `moduleResolution` `bundler`, `paths` solo alcanza
  (se resuelve relativo al propio `tsconfig.json`), y la CLI de shadcn
  sigue encontrando el alias igual — probado agregando y descartando
  `breadcrumb` (DS-011).
- **`shadcn init` no se pudo usar**: en este entorno (Windows, Git Bash,
  pnpm) el comando `init` falla siempre con
  `Could not load the workspace config` al escribir `components.json`
  (probado en `4.19.0` y `4.18.0`). Se escribió `components.json` a mano con
  el mismo contenido que la CLI llega a imprimir antes de fallar, y de ahí en
  adelante se usó `shadcn add`, que sí funciona normalmente.
- **Sin body-level `bg-background`/`text-foreground`**: shadcn suele agregar
  esas clases al `<body>`. Acá no: la única pantalla que existe hoy es la
  portada "en construcción" (oscura, va a `app.extendiendoservicios.com` en
  F3) y no puede cambiar de aspecto. Queda para cuando exista un shell real
  (AdminShell/MobileShell) aplicarlo a su propio contenedor.

## Aislamiento de la portada "en construcción"

`src/pages/common/ConstructionPage.css` no depende de `body` ni de los
tokens nuevos: define sus propias variables (`--construction-bg`,
`--construction-text`, `--construction-muted`, `--construction-primary`) con
los mismos valores que tenía antes de F5, y fija su propia `font-family` sin
`"Inter"` en la lista. Así, tanto el preflight de Tailwind como la fuente
self-hosted y los tokens del tema claro quedan sin efecto sobre esta pantalla
hasta que F6 la reemplace por el login real.

## Utilidades de formato (`src/lib/format.ts`, DS-017)

Fechas y horas en español de Argentina, en la zona fija
`America/Argentina/Buenos_Aires` (ADR-019, el país no tiene horario de
verano). Usa `date-fns` 4 con el locale `es` y el contexto `tz(...)` de
`@date-fns/tz` — se eligió ese paquete (oficial del equipo de date-fns, para
usarse desde date-fns@4) en vez de calcular el desfase a mano porque nombra
la zona por su identificador IANA (lo que pide el ADR) y no por un offset
fijo, y evita depender de la hora "local" de `Date`, que es la del
dispositivo (o la de la máquina donde corre un test).

- `formatShortDate(date)` → `"jue 13 ago"`.
- `formatTime(date)` → `"08:00"`.
- `formatMinutes(totalMinutes)` → `"45 min"`, `"1 h"`, `"1 h 20 min"`.

`date` acepta lo que normalmente llega desde Supabase: `Date`, string ISO o
timestamp. Los tests (`format.test.ts`) fijan la zona de la máquina a una
bien distinta de Argentina (`vi.stubEnv('TZ', ...)`) para probar que el
resultado no cambia.

## Componentes de DS-003 a DS-007 (P05.2)

Estado: F5 · acciones, entradas, selectores, tarjetas y `StatusBadge`. Se
suman a los tokens y a los 22 componentes shadcn de P05.1. Todos están en
`/dev/design` (ver más abajo).

De este paquete, algunos son **componentes shadcn restyleados en el lugar**
(`src/components/ui/*.tsx`: `button`, `input`, `textarea`, `select`,
`switch`, `checkbox`, `radio-group`, `card`, `badge`) y otros son
**propios**, en `src/components/*.tsx` porque no tienen equivalente en el
catálogo de shadcn. La API de cada uno (para que `front-admin` y
`front-movil` los usen):

### Acciones (DS-003)

- **`Button`** (`ui/button.tsx`): `variant` — `primary | ghost | dark |
destructive | link` (default `primary`). `size` — `sm | md | mobile`
  (default `md`; `icon`/`icon-sm` existen pero son uso interno de
  `calendar`/`dialog`/`sheet`, no forman parte de la API pública). `icon`
  (componente de ícono, se muestra a la izquierda). `loading` (booleano:
  deshabilita el botón, cambia el ícono por un spinner y agrega un texto
  `sr-only` "Cargando" + `aria-busy`). Resto de props de `<button>`.
- **`IconButton`** (`src/components/IconButton.tsx`): sobre `Button`, fijo
  en tamaño `icon` (34×34). Requiere `icon` y `aria-label` (no lleva texto
  visible). `variant` default `ghost`.
- **`Fab`** (`src/components/Fab.tsx`): círculo de 46 px, `icon` (default
  `Fingerprint` de lucide-react — no está en el mapeo de íconos de `07`
  sección 1.4, se sumó porque representa "fichar" y ya viene con la
  librería), `aria-label` (default `"Fichar"`). Ya incluye el desplazamiento
  de `-14px` hacia arriba (`margin-top`): el shell que lo ubica en la
  tabbar (P05.4) no tiene que recalcularlo.

### Entrada (DS-004)

- **`Input`** / **`Textarea`** (`ui/input.tsx`, `ui/textarea.tsx`): `icon`
  (solo `Input`, a la izquierda), `error` (string: pinta el borde de
  `--danger` y muestra el mensaje en 11 px debajo, con `aria-invalid` y
  `aria-describedby`), `mobile` (booleano: variante de 12×13 con 14 px de
  fuente). Resto de props nativas.
- **`Select`** (`ui/select.tsx`): sin cambios de API sobre shadcn/Radix,
  solo restyleado (borde `--border-strong`, radio 8, 13 px).
- **`Combobox`** (`src/components/Combobox.tsx`): `options`
  (`{ value, label }[]`), `value`, `onValueChange`, `placeholder`,
  `searchPlaceholder`, `emptyText`, `aria-label`. Sobre `command` +
  `popover`.
- **`Switch`** (`ui/switch.tsx`): sin props nuevas, restyleado a 38×22.
- **`ToggleRow`** (`src/components/ToggleRow.tsx`): `title`, `description`
  y el resto de las props de `Switch` (incluye `checked`/`defaultChecked`/
  `onCheckedChange`).
- **`Checkbox`** (`ui/checkbox.tsx`) y **`RadioGroup`/`RadioGroupItem`**
  (`ui/radio-group.tsx`): sin props nuevas, restyleados (17×17, radio del
  checkbox en un token nuevo `--r-xs` de 5 px — ver "Decisiones" abajo).

### Selección y fecha/hora (DS-005)

- **`SegmentedControl`** (`src/components/SegmentedControl.tsx`): `options`
  (`{ value, label, critical? }[]`), `value`, `onValueChange`, `mobile`
  (booleano, ancho completo), `aria-label`. Patrón ARIA `radiogroup`/`radio`
  con foco itinerante (flechas, Home, End). `critical` pinta la etiqueta en
  `--danger` cuando esa opción está seleccionada (p. ej. "Ausencia").
- **`OptionCard`** (`src/components/OptionCard.tsx`): `value`, `title`,
  `description`, y el resto de props de `RadioGroupItem`. Se usa dentro de
  un `RadioGroup`.
- **`Stepper`** (`src/components/Stepper.tsx`): `value`, `onValueChange`,
  `min`, `max`, `step` (default 1), `aria-label` (del grupo),
  `decrementLabel`/`incrementLabel` (de cada botón, default "Restar"/
  "Sumar"), `formatValue`. Deshabilita cada botón en su límite.
- **`WeekdayPicker`** (`src/components/WeekdayPicker.tsx`): `value:
number[]` y `onValueChange`, con `0` = domingo (igual que
  `services.weekdays`, `04_Modelo_de_Datos.md`). Muestra L M M J V S D (la
  semana empieza en lunes) pero el valor no asume ningún orden.
- **`TimeInput`** (`src/components/TimeInput.tsx`): `input type="time"`
  nativo en las dos variantes (`mobile`, `error`) — ver "Decisiones".
- **`DatePicker`** / **`MonthPicker`** (`src/components/DatePicker.tsx`,
  `MonthPicker.tsx`): `value`, `onValueChange`, `placeholder`,
  `aria-label`. Español, semana desde el lunes. `MonthPicker` arma su
  propia grilla de 12 meses (`react-day-picker` trabaja por día).

### Presentación (DS-006 y DS-007)

- **`Card`** (`ui/card.tsx`): `variant` — `default | flush | hero` (default
  `default`). `flush` le saca el padding a `CardContent` (para una tabla a
  ancho completo); `hero` es la variante móvil con borde y sombra teal.
  Subcomponentes: `CardHeader`, `CardTitle`, `CardDescription`,
  `CardAction`, `CardContent`, `CardFooter`.
- **`KpiCard`** (`src/components/KpiCard.tsx`): `label`, `value`, `detail`,
  `icon`, `variant` — `default | accent | ok | warn | crit`.
- **`EmptyState`** (`src/components/EmptyState.tsx`): `icon`, `title`,
  `description`, `action`.
- **`ProgressBar`** (`src/components/ProgressBar.tsx`): `value` (0-100),
  `variant` — `default | ok | warn`, `label` (accesible, `role="progressbar"`).
- **`StatusBadge`** (`src/components/status/`): `domain` +`status` (unión
  discriminada — TypeScript exige el `status` correcto para cada
  `domain`), y `minutes` opcional para `domain: 'assignment'` con
  `delay_notified`/`early_leave` (agrega el sufijo "· n min"). Dominios:
  `shift`, `assignment`, `task`, `supervision`, `employee`, `client`,
  `site`, `user`. El mapa completo (la única fuente de verdad de estados de
  toda la app, `07` sección 3) vive en `statusMap.ts`; también exporta
  `getStatusMeta` y el helper de filas de tabla `getTableRowVariant` +
  `TABLE_ROW_CLASS_NAME` (`crit`/`warn`, `07` sección 3 in fine).

### `/dev/design` (adelanto parcial de DS-016)

`src/pages/dev/Design.tsx` muestra todos los componentes de este paquete con
sus variantes y estados (normal, con error, deshabilitado, cargando), a
ancho completo y — para las variantes explícitamente móviles del mockup —
dentro de un contenedor de 390 px. Se registra en `src/app/router.tsx` bajo
`if (import.meta.env.DEV)`: Vite resuelve esa constante en build time y
elimina la rama completa (y el `import()` que arma el chunk de la página)
del bundle de producción — verificado en este encargo revisando `dist/`. La
portada de `/` no cambia. P05.5 va a completar esta página con el resto de
los componentes (`DataTable`, `PersonCell`, `Alert`/`Toast`/`Dialog`,
`Timeline`/`Tabs`/etc., `StarRating`, `MapPicker`/`MapView`).

### Decisiones de esta entrega (DS-003 a DS-007)

- **Contradicción de radios en `07`**: la sección 2.2 dice "radio 10" para
  la variante móvil de `Input`, pero la sección 4 (normalización) lista
  explícitamente los inputs entre los elementos cuyos radios sueltos
  (7/9/10) se llevan a 8/12/14. Se resolvió a favor de la normalización:
  8 px en las dos variantes.
- **Tamaños de fuente en medios píxeles sin resolver en `07`**: donde la
  sección 2 de `07` no fija un entero final (a diferencia de `Button`, que
  sí lo hace explícitamente con "12.5 px" para `md`), se aplicó la regla de
  la sección 4 ("12.5 → 13 en formularios"): `Input`/`Select`/`ToggleRow`
  en 13 px de escritorio, `Input` móvil en 14 px (extendiendo la misma
  lógica a su 13.5 px, que la sección 4 no cubre con un caso explícito).
- **`destructive` en `Button`**: no existe un `.btn-destructive` en el
  mockup; se construyó con el mismo patrón sólido + texto blanco que
  `primary`/`dark`, sobre `--danger`/`--danger-800` (hover).
- **Bug de `data-checked`/`data-open` heredado de DS-002**: los componentes
  shadcn escritos en P05.1 (`checkbox`, `switch`, `radio-group`, y también
  `dialog`/`sheet`/`popover` para sus animaciones) usaban clases Tailwind
  `data-checked:`/`data-open:`/`data-closed:`, asumiendo que Radix
  agregaba esos atributos booleanos. La versión de `radix-ui` instalada
  (1.6.7) en realidad usa `data-state="checked"/"open"/"closed"`: esas
  clases nunca coincidían (no hay ningún `@custom-variant` en el repo que
  las traduzca). Se corrigió a `data-[state=checked]:` en `checkbox.tsx`,
  `switch.tsx`, `radio-group.tsx` y `OptionCard.tsx` (que ahora sí muestran
  el estado marcado/seleccionado). **No se tocó** `dialog.tsx`/`sheet.tsx`/
  `popover.tsx` más que lo mínimo para que compilaran (están fuera de
  alcance de este paquete): sus animaciones de apertura/cierre siguen sin
  aplicarse — abren y cierran igual (los controla React, no la clase CSS),
  solo sin transición. **Corregido en P05.3** (ajuste pendiente, ver el
  "Corregido" de esa entrega en el CHANGELOG): además del mismo bug en
  `select.tsx`/`tooltip.tsx`/`tabs.tsx`/`separator.tsx`/`command.tsx`/
  `field.tsx`, hacía falta agregar las utilidades de animación (`.
animate-in`, `fade-in-0`, etc.), que tampoco existían — ver
  `src/styles/animations.css`.
- **Nuevos tokens en `tokens.css`**: `--r-xs` (5 px, radio del `Checkbox`,
  fuera de la escala de tres radios de `07` sección 1.3 porque esa escala
  es para botones/inputs/sidebar, no para controles compactos);
  `--primary-200` (`#CFE2E4`, reutilizado en `Card` "hero", `KpiCard`
  "accent" y el futuro `Alert` "info"); `--sh-hero` (sombra teal de `Card`
  "hero"); `--ring-soft` (anillo de selección de `OptionCard`). Todos evitan
  repetir un color/sombra suelto en más de un componente (regla de
  `tokens.css`).
- **`TimeInput` nativo en las dos variantes**: `07` permite "dos campos o
  `input type='time'` nativo en móvil"; se usó el nativo en las dos para no
  mantener dos implementaciones del mismo campo.
- **`Usuario` en `StatusBadge`**: `07` sección 3 escribe sus estados en
  español (`activo`/`desactivado`) a diferencia de todos los demás
  dominios, que son los enums reales de `04_Modelo_de_Datos.md`. Se
  mantuvieron tal cual literalmente (no hay un enum `user_status` en el
  modelo: es un concepto de Auth).

## Componentes de DS-008 a DS-012 (P05.3)

Estado: F5 · tablas, avatares, avisos, diálogos, timeline y lista de
tareas. Todos están en `/dev/design` (ver más abajo), con datos de ejemplo
realistas de la Base (mismos nombres y horarios que D01/D06/D10/M10 del
mockup, con estados de la Base, no los recortados).

### `DataTable` y `RowCard` (DS-008)

`src/components/DataTable.tsx`, sobre `@tanstack/react-table` 8 (ver
"Decisiones" abajo por qué 8 y no 9) y `ui/table.tsx` restyleado.

- **`DataTable<TData>`**: `columns` (`DataTableColumnDef<TData>[]` — un
  `ColumnDef` de TanStack Table con `meta` tipado, ver abajo), `data`,
  `caption` (nombre accesible de la tabla, va a un `<caption
class="sr-only">` — **obligatorio**), `getRowId?`, `compact?`
  (booleano: menos padding, `PersonCell`/`Avatar` a 26 px si los usás
  dentro de las celdas), `isLoading?` + `skeletonRows?` (default 5),
  `emptyState?` (`{ icon?, title, description? }`, default genérico),
  `rowVariant?: (row: TData) => 'crit' | 'warn' | undefined` (pintá la
  fila completa con el helper de `src/components/status`), `sorting?` /
  `onSortingChange?` (controlado; sin ellos, estado interno), `className?`.
  - **Paginación, siempre controlada desde afuera** (`07`: "paginación por
    rango... preparada para datos del servidor"): `pagination?:
{ pageIndex, pageSize }`, `onPaginationChange?`, `pageCount?` (total
    de páginas, si se conoce — sin él, "Siguiente" solo se deshabilita si
    además pasás `rowCount` y ya mostraste todo), `rowCount?` (total de
    filas, para el texto "Mostrando 1–10 de 42"). `data` es **siempre**
    exactamente lo que hay que mostrar en la página actual: `DataTable`
    nunca la recorta sola, ni siquiera con paginación "solo cliente" —
    quien lo usa le pasa el slice correspondiente (con un array en
    memoria alcanza `data.slice(pageIndex * pageSize, ...)`, como hace
    `/dev/design`).
  - **Ordenamiento**, siempre local sobre el array `data` que recibe
    (columna por columna, clic en el encabezado). Si además pasás
    `sorting`/`onSortingChange` controlados (por ejemplo para pedirle el
    orden al servidor), es responsabilidad de quien lo usa volver a pedir
    `data` ya ordenada — `DataTable` no tiene forma de distinguir "ordená
    vos esto" de "ya te lo mandé ordenado".
  - **Por debajo de 1024 px** (`05_Pantallas_y_Navegacion.md` sección 7)
    se renderiza sola como una lista de `RowCard` en vez de tabla, sin
    scroll horizontal. Cada columna dice, con `meta.card`, qué lugar
    ocupa en la tarjeta: `'title'` (una sola columna; típicamente un
    `PersonCell`), `'subtitle'` (debajo del título), `'trailing'`
    (arriba a la derecha; típicamente un `StatusBadge`), `'meta'` (pares
    etiqueta/valor en una grilla de dos columnas debajo — la etiqueta
    sale de `meta.cardLabel`) o sin indicar/`'hidden'` (no aparece en la
    tarjeta). `meta.align` (`'start'` default, `'end'`, `'center'`) solo
    afecta la tabla de escritorio.
  - El quiebre lo decide `useMediaQuery('(min-width: 1024px)')`
    (`src/hooks/useMediaQuery.ts`, nuevo: hook mínimo sobre
    `window.matchMedia` con `useSyncExternalStore`, reutilizable para
    cualquier otro componente que necesite reaccionar a un breakpoint).
  - `DataTableColumnDef<TData>`/`DataTableColumnMeta` se exportan del
    mismo archivo para tipar `columns` en otras vías.

### `Avatar` y `PersonCell` (DS-009)

- **`Avatar`** (`src/components/Avatar.tsx`): `id` (define el color —
  hash DJB2 determinístico, siempre el mismo resultado para el mismo id),
  `name` (de acá salen las iniciales del fallback: primera letra del
  primer y el último nombre), `src?` (si falta o no carga, se ve el
  fallback), `size` — `default` (28 px) | `compact` (26 px, para
  `DataTable` "compact"). También exporta `getAvatarColorKey`/
  `getInitials` (los usa el test, y sirven si alguna pantalla necesita el
  mismo color en otro lado sin repetir el `Avatar` entero).
- **`PersonCell`** (`src/components/PersonCell.tsx`): `id`, `name`,
  `subtitle?`, `avatarSrc?`, `size?` (mismo que `Avatar`), `className?`.
  Nombre en peso 600, subtítulo 11 px `--text-3`.

### `Alert`, `Toaster` y `ConfirmDialog` (DS-010)

- **`Alert`** (`ui/alert.tsx`): `variant` — `crit | warn | info` (sin
  default: elegilo siempre). Primer hijo directo = ícono (17 px, como en
  `ds.css`, no un slot separado); `AlertTitle`, `AlertDescription`,
  `AlertActions` (opcional, botones debajo de la descripción).
- **`Toaster`** (`ui/sonner.tsx`), montado una vez en `main.tsx`: llamá a
  `toast(...)`/`toast.success(...)`/`toast.error(...)` (de `sonner`,
  reexportado tal cual — no hay wrapper propio) desde cualquier pantalla.
  Siempre `theme="light"` (P-118).
- **`ConfirmDialog`** (`src/components/ConfirmDialog.tsx`): `open`,
  `onOpenChange`, `title`, `description?`, `reasonLabel?` (default
  "Motivo"), `reasonPlaceholder?`, `cancelLabel?` (default "Cancelar"),
  `confirmLabel?` (default "Confirmar"), `variant?` — `primary |
destructive` (default `primary`), `isLoading?` (deshabilita el
  formulario y muestra el spinner del botón mientras se resuelve la
  RPC — vos cerrás el diálogo cuando termine bien), `onConfirm: (reason:
string) => void`. El motivo es obligatorio: el botón de confirmar
  queda deshabilitado mientras esté vacío (o sean solo espacios), y se
  devuelve ya recortado (`trim()`). No llama a ninguna API. Reutilizado
  por `TaskItem` para "no realizada".

### `Timeline`, `Tabs`, `Breadcrumb`, `Tooltip`, `Skeleton` (DS-011)

- **`Timeline`** (`src/components/Timeline.tsx`): `items:
{ id, title, description?, variant? }[]`. `variant` —
  `'pending' | 'on' | 'ok' | 'crit'` (default `'pending'`, el punto hueco
  sin marcar de `ds2.css`; los otros tres son los que pide `07`).
- **`Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`** (`ui/tabs.tsx`):
  misma API de Radix, restyleados a la única variante del mockup
  (subrayado teal de 2 px) — se sacó la variante "píldora" de shadcn
  porque ese lugar ya lo cubre `SegmentedControl` (DS-005).
- **`Breadcrumb`/`BreadcrumbList`/`BreadcrumbItem`/`BreadcrumbLink`/
  `BreadcrumbPage`/`BreadcrumbSeparator`/`BreadcrumbEllipsis`**
  (`ui/breadcrumb.tsx`, agregado con la CLI en este paquete): API
  estándar de shadcn, restyleada (11 px, `--text-3` los eslabones,
  `--text` el actual).
- **`Tooltip`/`TooltipContent`/`TooltipTrigger`/`TooltipProvider`**
  (`ui/tooltip.tsx`): sin cambios de API, restyleado (fondo `--dark`,
  11 px).
- **`Skeleton`** (`ui/skeleton.tsx`): sin cambios (ya estaba bien desde
  DS-002; `animate-pulse` es una utilidad núcleo de Tailwind, no
  necesitaba el arreglo de animaciones de abajo).

### `TaskList` y `TaskItem` (DS-012)

- **`TaskList`** (`src/components/TaskList.tsx`): `tasks:
{ id, title, description?, status, isRequired?, notDoneReason?,
completedAt? }[]` (`status`: `TaskStatus` de `@/components/status`),
  `readOnly?`, `onComplete?`, `onMarkNotDone?`, `onUndo?`. Calcula sola
  cuál tarea es "next" (resaltada): la que está `in_progress`, o si
  ninguna lo está, la primera `pending` en el orden de `tasks` — como
  mucho una a la vez.
- **`TaskItem`** (`src/components/TaskItem.tsx`, usable suelto si
  hiciera falta): mismas props que un elemento de `tasks` más `isNext?`,
  `readOnly?` y los tres callbacks. Casilla de 22 px con área táctil de
  44 px (`after` invisible, no cambia el tamaño visual); `done`
  atenuada (texto `--text-3`); `isNext` resaltada (fondo
  `--primary-050`); "No realizada" abre un `ConfirmDialog` (motivo
  obligatorio) y al confirmar llama a `onMarkNotDone(id, reason)`;
  clic en la casilla de una tarea `done`/`not_done` llama a `onUndo`, si
  lo pasaste. Etiqueta "Opcional" cuando `isRequired` es `false`
  (P-059). En modo `readOnly` no se ve ninguna acción y ningún callback
  se dispara (ni siquiera al clickear la casilla, deshabilitada). No
  llama a ninguna API.

### Decisiones de esta entrega (DS-008 a DS-012)

- **TanStack Table 8, no 9** (ADR-021 pedía probar la 9 primero): se
  instaló, la API pública principal cambió por completo a un modelo "por
  slots" (`tableFeatures`/`useTable`) que ni shadcn/ui ni prácticamente
  ningún ejemplo del ecosistema usan todavía; la única forma de recuperar
  la API clásica (`useReactTable`/`ColumnDef`/`flexRender`) es
  `@tanstack/react-table/legacy`, marcada `@deprecated` en cada export de
  su propio `.d.ts` ("compatibility layer for migrating from v8"). Se
  consideró que construir el `DataTable` de todo el design system sobre
  una capa de compatibilidad pensada solo para migrar, no para código
  nuevo, calificaba como el "incompatible con los componentes de
  shadcn/ui" que prevé ADR-021, así que se usó la excepción y se instaló
  la 8 (ver CHANGELOG para las fechas de publicación de las dos).
- **`meta.align`/`meta.card`/`meta.cardLabel` sin ampliar `ColumnMeta` de
  la librería**: TanStack Table permite declarar estos campos
  "oficialmente" con fusión de declaraciones (`declare module
'@tanstack/react-table' { interface ColumnMeta<...> {...} }`, el
  patrón documentado por la librería). Se probó (en `DataTable.tsx` y
  también en un `.d.ts` aparte) y en los dos casos el linteo con
  información de tipos (`projectService` de typescript-eslint) no
  resolvía el tipo ampliado y marcaba cada lectura como insegura
  (`no-unsafe-member-access`), aunque `tsc -b` sí lo aceptaba — una
  discrepancia entre el compilador real y el programa que arma
  typescript-eslint para lintear, no algo que dependiera de dónde vivía
  la ampliación. En vez de silenciar la regla, `DataTableColumnDef<TData>`
  define el `meta` propio por intersección (`ColumnDef<TData> & { meta?:
DataTableColumnMeta }`), sin tocar el tipo de la librería: como
  `ColumnMeta` de la librería hoy no declara ningún campo propio, es
  estructuralmente compatible con cualquier forma de `meta` (todos los
  campos son opcionales), así que no hace falta ningún casteo ni al
  definir `columns` ni al leer `meta` de vuelta.
- **`RowCard` sin el "sangrado" de márgenes negativos de `.task.next`**:
  ver la nota de `TaskItem` en "Decisiones" más abajo — mismo criterio
  para el fondo resaltado de una fila en `RowCard`, aunque acá no aplica
  (`RowCard` no tiene una variante "next", solo `crit`/`warn`).
- **`TaskItem` "next" sin el sangrado de `.task.next`**: `ds2.css` logra
  el fondo resaltado con `margin: 0 -15px; padding: 0 15px`, asumiendo
  que el contenedor tiene exactamente 15 px de padding (el de la pantalla
  móvil del mockup). Un componente reutilizable no puede asumir el
  padding de cualquier contenedor donde se lo use, así que el fondo y el
  radio quedan autocontenidos (`rounded-sm`, sin márgenes negativos) —
  visualmente equivalente, sin el supuesto frágil.
- **Radio de 6 px de la casilla de `TaskItem`**: `.tbox` de `ds2.css` usa
  6 px, fuera de la escala de 8/12/14 de `07` sección 1.3 (igual que el
  `Checkbox` de DS-004, que ya tiene su propio `--r-xs` de 5 px para el
  mismo motivo). Se agregó `--r-task-box` en `tokens.css` en vez de
  reusar `--r-xs` (son valores distintos, 6 px y 5 px).
- **Checklist de `not_done` con ícono propio**: el mockup no define un
  estado visual para la casilla cuando la tarea es "no realizada" (solo
  tiene "marcada"/"vacía"). Se agregó una tercera apariencia (casilla
  roja con un ícono de X) para que se distinga de "pendiente" a simple
  vista, coherente con el rojo que ya usa `StatusBadge` para `not_done`.
- **Colores nuevos en `tokens.css`**: `--danger-border`/`--warning-border`
  (bordes de `Alert` `crit`/`warn`, `.a-crit`/`.a-warn` de `ds.css`),
  `--avatar-a`…`--avatar-f` (los seis colores fijos de `Avatar`; `a` es
  literalmente `var(--primary)`, mismo valor que ya usaba `ds.css`),
  `--table-header-bg` (`#FAFBFC`, encabezado de `DataTable`), `--r-task-box`
  (radio de la casilla de `TaskItem`, ver arriba).

## Cómo ver los componentes

`pnpm dev` y abrir `http://localhost:5173/dev/design`. La página no existe
en el build de producción.
