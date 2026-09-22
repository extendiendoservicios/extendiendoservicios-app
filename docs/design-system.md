# Design system

Fuente: `07_Design_System.md` del Plan Maestro. Este documento explica cómo
está implementado en el repositorio, no repite los valores de diseño (para
eso está `07`).

Estado: F5 completa · DS-001 a DS-020, RESP-001. Tokens, shadcn/ui,
acciones, entradas, selectores, tarjetas, `StatusBadge`, tablas, avatares,
avisos, diálogos, timeline y lista de tareas (P05.1 a P05.3); `AdminShell`,
`MobileShell` y el router con `RequireRole` sobre una sesión provisoria
(P05.4); marca de la sidebar e íconos PWA desde un PNG temporal (deuda
`DS-020`), `vite-plugin-pwa` y `/dev/design` completo (P05.5). `/dev/design`
sigue sin `StarRating` (F15), `MapPicker`/`MapView` (F8) y `Calendar`/
`WeekGrid` (F11) — llegan con sus fases de dominio.

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
  instaló `field` en su lugar. **Restyleado recién en P05.5 (DS-016)**: se
  instaló tal cual de la CLI en este paquete y quedó sin tocar (sin
  ningún consumidor todavía) hasta que la vidriera de `/dev/design`
  expuso el hueco — `FieldLabel`/`FieldDescription`/`FieldError` ahora
  siguen `.lbl`/`.hint` de `ds2.css` (11 px, `--text-2`/`--text-3`) y
  `FieldGroup`/`Field` el espaciado de `.field` (13 px entre campos, 5 px
  entre etiqueta/control/ayuda). Detalle en la sección "Field / FormField"
  de más abajo.
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
- **`Field`/`FieldLabel`/`FieldDescription`/`FieldError`/`FieldGroup`**
  (`ui/field.tsx`, restyleado en P05.5 — ver "Decisiones de esta entrega
  (DS-001/DS-002)" arriba): API sin cambios sobre la CLI de shadcn
  (`Field` es un `<div role="group">`, `FieldLabel` envuelve `Label`,
  `FieldError` acepta `children` o `errors: Array<{ message?: string }>`
  para mostrarlos como lista si hay más de uno — pensado para el array de
  errores de un campo de react-hook-form). Un `Field` es una etiqueta +
  control + ayuda/error; un `FieldGroup` agrupa varios `Field` con 13 px
  entre ellos. Las grillas `row2`/`row3` del mockup no son una prop: se
  logran con `className="grid grid-cols-2 gap-3"` (o `grid-cols-3`) en el
  `FieldGroup` — ver el ejemplo en `/dev/design`.

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

### `/dev/design` (adelanto parcial de DS-016 en este paquete)

`src/pages/dev/Design.tsx` muestra todos los componentes de este paquete con
sus variantes y estados (normal, con error, deshabilitado, cargando), a
ancho completo y — para las variantes explícitamente móviles del mockup —
dentro de un contenedor de 390 px. Se registra en `src/app/router.tsx` bajo
`if (import.meta.env.DEV)`: Vite resuelve esa constante en build time y
elimina la rama completa (y el `import()` que arma el chunk de la página)
del bundle de producción — verificado en este encargo revisando `dist/`. La
portada de `/` no cambia. **DS-016 se completa en P05.5** (ver más abajo)
con el resto de los componentes (`DataTable`, `PersonCell`, `Alert`/`Toast`/
`Dialog`, `Timeline`/`Tabs`/etc., `DropdownMenu`, `Drawer`/`Sheet`,
`ActionBar`, `StagingBanner`); quedan afuera `StarRating` (F15) y
`MapPicker`/`MapView` (F8).

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

## Shells, router y sesión (DS-013 a DS-015, P05.4; sesión real desde P06.2)

Estado: `AdminShell`, `MobileShell` y el router con `RequireRole` sobre
todas las rutas de `05_Pantallas_y_Navegacion.md` sección 5, como
placeholders. **La sesión que sigue documentada más abajo ("Sesión
provisoria") es la de F5 y ya no existe** — P06.2 (AUTH-001/002/008/010) la
reemplazó por `AuthProvider`/`useAuth` de verdad; ver la sección nueva
"Autenticación real" más abajo, después de "PWA". El resto de esta sección
(shells, router, `RequireRole` como wrapper de experiencia) sigue vigente
tal cual.

### `AdminShell` (`src/app/shells/AdminShell.tsx`, DS-013)

Se monta como `element` de la ruta `admin` en `router.tsx` (dentro de
`RequireRole`), con las 27 rutas de administración de `05` sección 5 como
`children` — cada pantalla llega por `<Outlet />`.

- **Sidebar** teal de 236 px (`--sidebar-w`): dos secciones, "Operación"
  (Resumen, Planificación, Asistencia, Supervisiones, Empleados, Clientes y
  sedes, Tareas) y "Configuración" (un solo ítem, a
  `/admin/configuracion/usuarios`) — las ocho secciones de P-121
  (`src/app/shells/adminNav.ts`, `ADMIN_NAV_OPERATION`/
  `ADMIN_NAV_CONFIGURATION`). Ítem activo con fondo blanco al 20 %
  (`bg-white/20`), calculado por prefijo de ruta (`isAdminNavItemActive`,
  con `matchPrefixes` por ítem para los casos donde varias rutas cuelgan de
  una sección — p. ej. "Clientes y sedes" también se resalta en
  `/admin/sedes/...` y `/admin/servicios/...`). Usuario al pie (avatar +
  nombre + rol, de `useSession()`).
- Entre 1024 y 1279 px (`useMediaQuery('(min-width: 1024px)')` sin llegar a
  `1280px`) la sidebar **colapsa a íconos de 60 px** con `Tooltip` (nuevo
  `aria-label` en el link para que el nombre siga siendo accesible aunque
  no se vea el texto). Por debajo de 1024 px la sidebar no se monta: en su
  lugar, **tabbar inferior** de 66 px con Hoy, Planificar, Asistencia,
  Supervisiones (`src/app/shells/adminNav.ts`,
  `ADMIN_TABBAR_ITEMS`) y un botón "Más" que abre un `Sheet` (`side="bottom"`)
  con el resto de las secciones (Empleados, Clientes y sedes, Tareas,
  Configuración) — "Más (resto)" de `05` sección 7 no es una pantalla
  propia, así que no tiene ruta ni `screenId`, solo ese menú.
- **Topbar**: título y subtítulo del `handle` de la ruta activa
  (`useRouteHandle`, ver más abajo) y menú de usuario (`DropdownMenu`, DS-013
  agrega el componente que faltaba de `07` sección 2.1) con "Mi perfil"
  (`/perfil`) y "Cerrar sesión" (en esta etapa, limpia el rol simulado y
  manda a `/ingresar` — ver "Sesión provisoria" abajo).
- **Buscador global**: no implementado (P09.0, EMP-012). El único punto de
  extensión es la prop `topbarEnd?: ReactNode` de `AdminShell` — vacía hoy,
  sin ningún input que no funcione.
- **Capacidades del administrador** (`admin_capabilities`, F7): esta
  entrega no filtra ítems por capacidad todavía. El punto de extensión es
  `ADMIN_NAV_ITEMS`/`ADMIN_MORE_ITEMS` (`adminNav.ts`): agregar un campo
  opcional `capability?: AdminCapability` a `AdminNavItem` y filtrar el
  arreglo antes de mapearlo alcanza, sin tocar `AdminShell` en sí.

### `MobileShell` (`src/app/shells/MobileShell.tsx`, DS-014)

Un único componente para empleado y supervisor (`variant: 'employee' |
'supervisor'`), montado como `element` de `app`/`sup` en `router.tsx`. En
escritorio se centra a 480 px con sombra (`05` sección 0: "las pantallas
móviles funcionan también en escritorio, centradas a 480 px").

- **Cabecera**: dos variantes, elegidas solas según la ruta activa (sin que
  cada pantalla lo declare): la raíz exacta (`/app`, `/sup`) muestra el
  saludo teal ("Hola, {nombre}", fecha con `formatShortDate` de
  `src/lib/format.ts` — zona fija de ADR-019, ver DS-017 — y avatar con
  link a `/perfil`, M02); cualquier otra ruta muestra la navbar de
  subpágina (teal, con o sin flecha de "volver"). La flecha aparece salvo
  en los otros ítems del propio tabbar (`/app/mas`,
  `/sup/supervisiones`, `/sup/historial`): siguen siendo una pestaña, no
  una subpágina, y ahí el tabbar sigue visible.
- **Tabbar** de 66 px (`src/app/shells/mobileNav.ts`,
  `EMPLOYEE_TABBAR_ITEMS`/`SUPERVISOR_TABBAR_ITEMS`): empleado "Hoy · Fichar
  · Más" con el `Fab` de DS-003 integrado entre los otros dos (navega a
  `/app/fichar`, el punto de entrada de EMP-14); supervisor "Hoy ·
  Supervisiones · Historial · Más". Ítem activo en `--primary`. Visible solo
  en la raíz y en los otros ítems del propio tabbar — las subpáginas no
  llevan tabbar (M04/M09/M16 del mockup tampoco lo muestran).
- **`ActionBar`** (`src/app/shells/ActionBar.tsx`): franja de botones
  apilados para subpáginas (`.m-actions` de `ds.css`, ej. M16 "Volver al
  servicio" / "Registrar salida"). `MobileShell` no la monta: la pantalla
  que la necesite la agrega como su propio último elemento, **hijo directo
  de `<main>`** (devolver un fragmento, no envolverla en otro `div`) —
  `position: sticky; bottom: 0` alcanza para que quede pegada al pie de la
  ventana sin necesitar un slot ni contexto compartido entre la página y
  el shell (ver "Decisiones" abajo). Ocupa todo el ancho (márgenes
  negativos sobre el `p-4` de `<main>`) y respeta
  `env(safe-area-inset-bottom)`.

**Scroll en los dos shells** (corregido en la revisión de P05.4): scrollea
el documento, nunca un contenedor interno. La topbar de `AdminShell`, la
navbar de subpágina de `MobileShell` y los dos tabbar son `sticky`; la
sidebar es `sticky` con `h-dvh` y scroll propio. `<main>` no lleva
`overflow`: si lo llevara, sería el contenedor de referencia de cualquier
`sticky` de una pantalla (como `ActionBar`) y dejaría de anclarse a la
ventana. El saludo de la raíz de `MobileShell` sí se va con el scroll.
Ninguna pantalla debería agregar su propio contenedor de scroll vertical a
página completa.

### Router (`src/app/router.tsx`, `src/app/routes/*`, DS-015)

- **Todas las rutas de `05` sección 5** (27 de administración, 11 de
  empleado, 8 de supervisor, más las 5 comunes) como placeholders
  (`src/app/routes/placeholder.tsx`, `placeholderRoute()`): cada una
  muestra su `screenId`, título, subtítulo opcional y "Pantalla en
  construcción.", dentro del shell que corresponda. Faltan a propósito
  ADM-08, ADM-11 y ADM-24 (drawers/pestañas de otra pantalla, sin fila
  propia en la tabla de rutas de `05`) y EMP-05 (comparte `/app/fichar` con
  EMP-14). Los parámetros de consulta que cambian de pantalla sin cambiar
  de ruta (`?vista=`, `?pestana=`, `?fecha=`, `?cliente=`, `?sede=`) quedan
  documentados en el subtítulo de cada placeholder; la lectura real la hace
  la pantalla cuando exista.
- **`RouteHandle`** (`{ screenId, title, subtitle? }`,
  `src/app/routes/placeholder.tsx`): cada ruta placeholder lo declara una
  sola vez (`placeholderRoute` arma el `element` y el `handle` con los
  mismos valores). `useRouteHandle()` lo lee del último `match` con
  `handle` (`useMatches()`) — lo usan la topbar de `AdminShell` y la
  cabecera de `MobileShell`. **Cuando front-admin/front-movil reemplacen un
  placeholder por la pantalla real, tienen que seguir declarando el mismo
  `handle`** (`screenId`, `title`, `subtitle` opcional) en su ruta para que
  la topbar/cabecera no se quede vacía — es la única obligación que les deja
  esta entrega.
- **`RequireRole`** (`src/features/auth/RequireRole.tsx`): un wrapper por
  grupo — `admin` (`allow={['owner', 'admin']}`), `app`
  (`allow={['employee']}`), `sup` (`allow={['supervisor']}`), y `perfil`
  (los cuatro roles, el shell lo elige `ProfileLayout` según
  `useSession()`). Sin sesión → `/ingresar`; con sesión pero ningún rol de
  `allow` → la vía propia de sus roles (`homePathForRoles` en
  `session.ts`: un empleado que abre `/admin` termina en `/app`), o
  `/sin-acceso` si no tiene ningún rol; si no, renderiza. AUTH-004 usa la
  misma `homePathForRoles` para el redirect de `/`. Es solo experiencia (`07`
  sección 5): la protección real de los datos es RLS, `RequireRole` nunca
  la reemplaza.
- **`/`** sigue siendo `ConstructionPage` (sin cambios): es lo que hoy sirve
  `app.extendiendoservicios.com`, verificado por
  `tests/e2e/construction-page.spec.ts`. El redirect según sesión y rol de
  `05` sección 5 ("/ → redirige según sesión y rol") es AUTH-004 (F6); hasta
  entonces `/` no llama a `useSession` ni pasa por `RequireRole`.
- **404** (`src/pages/common/NotFoundPage.tsx`): cualquier ruta que no
  matchea ninguna de las anteriores (`path: '*'`), con la marca
  (`favicon.png`, ver "Decisiones" abajo).
- **Banner de staging** (`src/components/StagingBanner.tsx`, INFRA-022):
  un único punto de montaje, `RootLayout` (la raíz sin `path` de todo el
  árbol de rutas, en `router.tsx`) — así "todos los layouts, incluida la
  portada" lo muestran sin que cada uno se acuerde de agregarlo. Franja
  `role="status"` con "Entorno de prueba…", visible solo con
  `VITE_APP_ENV=staging` (nunca en `production` ni en `local`); en flujo
  normal del documento (no `sticky`/`fixed`), nunca tapa contenido.
- **Carga diferida por vía** (`React.lazy`, `src/app/shells/lazyShells.tsx`):
  `AdminShell` y `MobileShell` están detrás de `lazy()` + `Suspense`
  (`RouteFallback`, spinner centrado sobre `--bg`) — un mismo módulo
  (`lazyShells.tsx`) para que `router.tsx` **y** `commonRoutes.tsx`
  (`/perfil`, que puede necesitar cualquiera de los dos shells) usen la
  misma referencia lazy, y así el chunk de `AdminShell` nunca viaje al
  bundle de quien nunca lo va a usar. Tamaños del build (`pnpm build`,
  ver el reporte del encargo para la comparación completa): `AdminShell`
  ~107 kB (~35 kB gzip) y `MobileShell` ~35 kB (~10 kB gzip) quedan en
  chunks separados del bundle principal.

### Sesión provisoria (histórico, F5 — reemplazada en P06.2)

**Esta subsección queda como registro histórico de F5, no como estado
actual**: P06.2 borró `devRole.ts` entero y el `useSession`/`SessionState`
de `session.ts` (ver "Autenticación real", después de "PWA", para el
reemplazo). Se conserva sin reescribir porque el contrato que describe
("`RequireRole`/los shells no cambian, solo la implementación de la
sesión") es exactamente lo que P06.2 cumplió — vale como prueba de que el
diseño de F5 funcionó como estaba pensado.

Contrato que tenía que respetar la sesión real para reemplazar esto sin
tocar `router.tsx` ni los shells (cumplido: los shells sí cambiaron una
línea — `useSession()` por `useAuth()` — porque P06.2 decidió no dejar un
re-export de compatibilidad; ver "Autenticación real"):

- `useSession(): SessionState` es el único punto que leen `RequireRole`,
  `AdminShell` y `MobileShell`. `SessionState` ya tiene la forma final
  (`{ status: 'loading' }`, `{ status: 'unauthenticated' }` o
  `{ status: 'authenticated', roles: Role[], displayName: string }`) aunque
  la implementación provisoria nunca produce `'loading'` (no hay ninguna
  llamada asíncrona todavía).
- `Role` es literalmente `app_role` (`04_Modelo_de_Datos.md`: `'owner' |
'admin' | 'employee' | 'supervisor'`) y `roles` es un arreglo porque una
  persona puede tener más de uno (acceso cruzado, `05` sección 3).
- **Para reemplazarlo**: `AuthProvider`/`useAuth` de F6 pueden vivir en
  `src/features/auth/` junto a este archivo; lo mínimo es que
  `session.ts` siga exportando un `useSession` con esta misma forma (puede
  ser un `re-export` de `useAuth`, o esta función puede pasar a leer el
  `AuthProvider` por dentro) — ni `RequireRole` ni `AdminShell`/
  `MobileShell` necesitan cambiar una línea más allá de eso.
- **`/dev/rol`** (`src/pages/dev/DevRole.tsx`, solo en desarrollo, mismo
  patrón que `/dev/design`: `lazy()` + `if (import.meta.env.DEV)` en
  `router.tsx`) simula un rol para recorrer los shells sin backend: guarda
  la elección en `localStorage` (`src/features/auth/devRole.ts`,
  `getDevRoleSelection`/`setDevRoleSelection`/`subscribeDevRoleSelection`,
  con `useSyncExternalStore`, mismo patrón que `useMediaQuery`). Ninguna de
  estas funciones hace nada fuera de `import.meta.env.DEV` (devuelven
  `'none'`/no escriben nada): verificado que ni la página ni la clave de
  `localStorage` (`es-dev-role`) quedan en `dist/` (`pnpm build` +
  `grep` sobre `dist/assets/*.js`, ver el reporte del encargo). En
  producción y en staging, sin sesión, toda ruta protegida redirige a
  `/ingresar` — no hay ninguna forma de "simular" nada fuera de desarrollo.
- Seis opciones en `/dev/rol`: sin sesión, dueño, administrador, empleado,
  supervisor, y empleado+supervisor a la vez (para probar el acceso
  cruzado en "Más"). Nombres de ejemplo, iguales a los del mockup (Andrea
  Ríos, María Gómez, Paula Lemos).

### Decisiones de esta entrega (DS-013 a DS-015)

- **Marca de la sidebar sin el vectorial (IF-08)**: en esta entrega (P05.4)
  se usó el lockup completo (`public/logo.png`) como imagen única, porque
  los PNG de `Images/` tienen el isotipo y el texto ya compuestos en un
  solo bitmap. **Resuelto en P05.5 (DS-018) con un PNG temporal**: ver
  "Marca de la sidebar (DS-018, PNG temporal)" más abajo — deuda `DS-020`
  hacia el vectorial.
- **`favicon.png` para el 404, no `logo.png`**: `favicon.png` (128×128) ya
  es el isotipo **en color** (recortado del logo original en INFRA-001),
  apto para fondos claros; `logo.png` es la versión blanca, pensada para
  fondos oscuros/teal (sidebar, portada) — sobre `--bg` sería invisible.
- **Bug de `asChild` en `Button` (`ui/button.tsx`), corregido acá**: nunca
  se había usado `<Button asChild>` en el repo hasta `/dev/rol` (DS-015).
  `Slot.Root` (Radix, lo que arma `asChild`) exige exactamente un elemento
  hijo; el `return` original de `Button` le pasaba tres nodos sueltos
  (ícono/spinner, `children`, texto de carga), y con `asChild` eso
  reventaba con "Slot failed to slot onto its children" apenas se probó en
  el navegador (no lo agarra ningún test que no monte de verdad el
  componente). Se corrigió armando un único nodo `content` — con `asChild`
  es directamente `children` (ícono y `loading` dejan de tener efecto ahí,
  igual que en el patrón estándar de shadcn); sin `asChild`, un solo `<>`
  con lo de antes, que a un `<button>` real no le importa recibir envuelto
  en un Fragment. Test de regresión en `button.test.tsx`.
- **`DropdownMenu` instalado en este paquete**: `07` sección 2.1 ya lo
  documenta como parte de "Acciones" (origen shadcn), pero no se había
  agregado en DS-003. Hacía falta para el menú de usuario de `AdminShell`
  (Mi perfil / Cerrar sesión). Mismo bug de `data-open:`/`data-closed:` que
  el resto de los componentes shadcn de este repo (ver el "Corregido" de
  P05.2/P05.3 en el `CHANGELOG`): corregido a `data-[state=open]:`/
  `data-[state=closed]:` en los mismos tres lugares (`Content`,
  `SubTrigger`, `SubContent`).
- **"Más" del tabbar de administración es un `Sheet`, no una ruta**: `05`
  sección 7 lo describe como "Más (resto)", sin ID de pantalla propio (a
  diferencia de EMP-13/SUP-09, que sí son pantallas con su `screenId`). Se
  implementó como un menú (`Sheet` inferior) con enlaces a las secciones
  que no entran en el tabbar, en vez de inventarle una ruta que `05` no
  pide.
- **`ActionBar` sin slot/contexto**: en vez de que `MobileShell` reserve un
  hueco fijo y las páginas le "manden" su contenido (patrón de contexto de
  layout, más plumbing), `ActionBar` se apoya en `position: sticky` sobre
  el scroll del documento — mientras sea el último hijo de `<main>`, se
  comporta como el pie fijo del mockup sin acoplar el shell a lo que cada
  pantalla necesite mostrar ahí.
- **Botón "Volver" de la navbar de subpágina usa `navigate(-1)`**: la forma
  estándar y más simple de "volver" en una SPA. No calcula una ruta
  "padre" a partir del path (no hay ninguna tabla que la declare por
  pantalla): si alguien entra directo a una subpágina por URL, sin
  historial previo dentro de la app, "volver" puede no tener a dónde ir —
  limitación conocida, aceptable para esta entrega.

## `/dev/design` completo (DS-016)

Contra el inventario de `07` sección 2 (detalle completo, tabla por tabla,
en el reporte del encargo), lo que faltaba y se agregó en este paquete:

- **`DropdownMenu`** (sección "IconButton, FAB y DropdownMenu"): dos
  ejemplos reales de la Base — "más acciones" de una fila (`IconButton` +
  `MoreHorizontal`) y el menú de usuario de la sidebar (avatar + "Mi
  perfil"/"Cerrar sesión", el mismo marcado que `AdminShell`).
- **`Drawer`/`Sheet`** (sección propia): el drawer de 452 px a la derecha
  de `07` sección 2.4 (cabecera, cuerpo con scroll propio, pie con dos
  botones a ancho completo) — hasta ahora el único uso en el repo era el
  `Sheet side="bottom"` del menú "Más" de `AdminShell`, que no mostraba
  esta variante.
- **`ActionBar`** (sección propia): el ejemplo de M16 ("Volver al
  servicio" / "Registrar salida", nota debajo) dentro del contenedor
  móvil de 390 px.
- **`StagingBanner`** (sección propia): como el componente real solo se
  ve con `VITE_APP_ENV=staging` (no el valor de `pnpm dev` normal), la
  fila "Componente real" queda vacía a propósito en desarrollo — se
  explica en el propio texto — y se agrega una réplica estática con el
  mismo marcado para que la vidriera muestre su aspecto sin cambiar de
  entorno.
- **`Field`/`FormField`** (sección propia, "Field / FormField"): estaba
  instalado desde DS-002 (P05.1) pero nunca restyleado ni mostrado — al
  agregarlo a la vidriera se encontró que su tipografía no seguía `07`
  (`text-sm`/`font-medium` de la CLI en vez de 11 px/`--text-2`/
  `--text-3`). Se corrigió `ui/field.tsx` (`FieldLabel`/
  `FieldDescription`/`FieldError`, más el espaciado de `FieldGroup`/
  `Field`) y se agregaron cuatro ejemplos: campo con ayuda, campo con
  error, y las grillas `row2`/`row3` de `07` (un `className` de Tailwind
  sobre `FieldGroup`, no una prop). Detalle en "Entrada (DS-004)" más
  arriba.

`AdminShell`/`MobileShell` completos, `Calendar`/`WeekGrid` (F11),
`StarRating` (F15) y `MapPicker`/`MapView` (F8) quedan fuera de
`/dev/design` a propósito — motivos en el docstring de
`src/pages/dev/Design.tsx` y en la sección "Cómo ver los componentes" de
más abajo.

## Marca de la sidebar (DS-018, PNG temporal), íconos PWA y deuda DS-020

**Sin el vectorial (IF-08)** — Mike decidió (19 sep 2026) recortar el
isotipo directamente de los PNG originales en vez de esperarlo. El
orquestador generó los recortes (`Images/recortes/README.md`: columnas 347
a 1023 y filas 72 a 825 de los tres PNG de 1371×1147, sin redibujar ni
recolorear) y este paquete los copió tal cual a `public/icons/`:

```text
public/icons/isotipo_blanco_34px@2x.png    61×68,  sidebar expandida y colapsada
public/icons/isotipo_blanco_34px@3x.png    92×102, srcSet de alta densidad
public/icons/pwa-192x192.png               isotipo blanco sobre #569EA4
public/icons/pwa-512x512.png               ídem, 512
public/icons/pwa-maskable-512x512.png      ídem, con margen de seguridad (80 %) para maskable
public/icons/apple-touch-icon-180x180.png  ídem, 180×180
```

- **Sidebar de `AdminShell`** (`AdminSidebar`, dentro de
  `src/app/shells/AdminShell.tsx`): ahora sigue el patrón de `07` sección
  1.5 y `.sb-brand`/`.sb-mark`/`.brand-name` de `Mockup/assets/ds.css`
  (verificado contra `Mockup/png/D01.png`) en vez del lockup completo como
  imagen única de P05.4:
  - isotipo blanco de 34 px de alto fijo en los dos estados de la sidebar
    (`src="…@2x.png"`, `srcSet="…@2x.png 2x, …@3x.png 3x"`);
  - lockup de texto "EXTENDIENDO / SERVICIOS" en dos líneas (`<br />`
    dentro de un único `<span>`, no dos elementos separados: son la misma
    frase, no dos líneas con semántica propia), 12.5 px, peso 700,
    mayúsculas, tracking 1.3 px, con una regla de 26×2 px
    (`bg-white/55`) debajo;
  - colapsada (60 px): el bloque de texto no se monta (`{!collapsed && …}`),
    solo el isotipo, centrado;
  - **sin nombres duplicados**: el `<Link to="/admin">` ya no lleva
    `aria-label="Ir al resumen"` — antes esa etiqueta fija tapaba
    cualquier contenido interno, así que daba lo mismo qué `alt` llevara
    la imagen. Ahora el nombre accesible del link lo computa el navegador
    a partir de su contenido: con el lockup de texto visible, `alt=""` en
    la imagen (decorativa, el texto visible ya lo dice — evita que un
    lector de pantalla anuncie "Extendiendo Servicios" dos veces);
    colapsada, sin texto visible, la imagen lleva
    `alt="Extendiendo Servicios"` (única fuente del nombre accesible ahí).
- **`index.html`**: `apple-touch-icon` apunta a
  `/icons/apple-touch-icon-180x180.png` (antes `favicon.png`, 128 px). El
  `<meta name="theme-color">` pasa de `#0E1017` (el de la portada oscura) al
  teal de marca `#569EA4`, igual que el `theme_color` del manifest:
  `index.html` lo sirven todas las rutas, y en el navegador del celular una
  barra oscura sobre la cabecera teal de los shells desentonaba. La portada
  es temporal y solo vive en `/` (corrección del orquestador en la revisión
  de P05.5).
- Los isotipos a resolución completa (677×754) quedan solo en
  `Images/recortes/`, fuera del repo: nada los usa, y el patrón `png` de
  Workbox los metía en la precarga (unos 176 KB por instalación).
- **`public/logo.png` no se toca**: lo sigue usando la portada
  (`ConstructionPage`), el 404 (`NotFoundPage`) y el `og:image` de
  `index.html` — ninguno de los tres es parte de este paquete.
- **Deuda `DS-020`**: cuando llegue el vectorial (IF-08), hay que
  regenerar los seis archivos de `public/icons/` desde ahí (mismos
  recortes/composiciones, sin el paso intermedio por PNG) y, si el
  vectorial permite separar el isotipo del logo compuesto con más
  fidelidad, revisar si el recorte actual (columnas/filas fijas del PNG)
  sigue siendo el más prolijo. No hace falta tocar ningún componente: los
  nombres de archivo en `public/icons/` y las referencias en
  `AdminShell.tsx`/`vite.config.ts`/`index.html` quedarían iguales.
- **Sin tocar `favicon.png`**: sigue siendo el que generó INFRA-001 (128 px,
  isotipo en color); no forma parte de este paquete.

## PWA (`vite-plugin-pwa`, RESP-001)

`vite.config.ts` agrega `VitePWA(...)` (`vite-plugin-pwa` 1.3.0 — peer
`vite: "^3 || ^4 || ^5 || ^6 || ^7 || ^8"`, compatible con Vite 8 sin forzar
nada; publicada el 5 may 2026, muy por delante de cualquier
`minimumReleaseAge` de pnpm). Documentación completa de responsive/PWA
(prompt de actualización con interfaz, Lighthouse, dispositivos reales)
llega con RESP-012/DOC-017 en F17 (`docs/pwa.md`, todavía no existe); acá
solo las decisiones de este paquete.

- **`strategies: 'generateSW'`**: Workbox arma el service worker desde el
  build, sin escribir uno a mano (`injectManifest` no hacía falta: no hay
  lógica de cacheo a medida).
- **`display: 'standalone'`, no `'fullscreen'`**: P-089 dice "pantalla
  completa"; se interpretó como "sin la barra del navegador"
  (`standalone`), no como ocultar también la barra de estado del celular
  (`fullscreen`, que además suele pedir gestos propios para salir).
- **`theme_color`/`background_color`: `#569EA4`** (el teal de marca,
  `--primary`): el splash de instalación se arma con este fondo y el
  isotipo blanco de los íconos encima, coherente con
  `pwa-*.png`/`apple-touch-icon-180x180.png` (que ya vienen compuestos
  así, `Images/recortes/README.md`).
- **Íconos**: 192 y 512 `purpose: 'any'`, más 512 `purpose: 'maskable'`
  (el isotipo ocupa el 56 % del alto ahí, dentro de la zona segura del
  80 %, ya resuelto en el PNG que llegó del orquestador — nada que hacer
  del lado del plugin). Sin maskable de 192: `07`/RESP-001 solo piden
  "192, 512 y maskable 512".
- **`short_name: 'Ext. Servicios'`**: es el nombre debajo del ícono de la
  app instalada, porque `name` no entra. Lo confirmó Mike el 19 sep 2026,
  sabiendo que algunos launchers de Android lo cortan a unos 12
  caracteres.
- **`registerType: 'prompt'`, sin interfaz todavía** (decisión del
  orquestador para este paquete): el service worker nuevo instala y queda
  esperando — nunca llama `self.skipWaiting()`/`clientsClaim()` por su
  cuenta (verificado leyendo `dist/sw.js`: el único disparador de
  `skipWaiting()` es un listener de `message` con
  `{ type: 'SKIP_WAITING' }`, que nadie envía todavía). Se activa recién
  cuando se cierran todas las pestañas o la app instalada — nunca solo,
  para no interrumpir a un empleado que puede estar fichando. El aviso
  "hay una versión nueva" con botón para actualizar es RESP-009 (F17):
  ese código va a llamar `postMessage({ type: 'SKIP_WAITING' })` al
  service worker en espera; este paquete no agrega ninguna interfaz.
- **`devOptions: { enabled: false }`** (el valor por omisión, dejado
  explícito): sin service worker en `pnpm dev`. Si estuviera habilitado,
  el navegador podría servir un `index.html` de un build viejo por encima
  del servidor de Vite.
- **`workbox.globPatterns`**: `js`, `css`, `html`, `woff2`, `png`, `svg`,
  `ico` — exactamente lo que emite `dist/` (código, estilos, fuentes,
  íconos). **Sin `runtimeCaching`**: ninguna llamada a Supabase, Nominatim
  ni a los tiles de OpenStreetMap pasa por el service worker; los datos
  nunca se cachean (P-089, `02` sección 21). `navigateFallback:
'/index.html'` para que cualquier ruta de React Router abra sin
  conexión.
- **Nada de `/dev/*` en el precache**: `/dev/design` y `/dev/rol` ya
  estaban afuera de `dist/` desde P05.4 (`import.meta.env.DEV`); este
  paquete lo volvió a verificar (`pnpm build` + `grep` sobre
  `dist/assets/*.js` y sobre la lista de `precacheAndRoute` de
  `dist/sw.js`) después de agregar el plugin.
- **`public/_headers` (INFRA-018, de infra-devops — este paquete solo
  tocó las reglas de caché, no el resto)**: se agregaron dos bloques
  nuevos, `/sw.js` y `/manifest.webmanifest`, con
  `Cache-Control: no-cache` — sin esto, un CDN o el navegador podrían
  quedarse con una copia vieja de cualquiera de los dos y una versión
  nueva del build nunca llegaría a una app ya instalada (`sw.js` y
  `manifest.webmanifest` no llevan hash de contenido en el nombre, a
  diferencia de `dist/assets/*`). Verificado con `wrangler pages dev`
  (`docs/deployment.md` sección 10.4: Cloudflare Pages combina las
  cabeceras de todos los bloques que matchean un mismo path) que las dos
  rutas siguen recibiendo intactas las cabeceras de seguridad del bloque
  `/*` (CSP, HSTS, etc.) más el `Cache-Control` nuevo. La CSP existente
  (`default-src 'self'`) ya dejaba cargar el service worker y el manifest
  sin ningún cambio — `worker-src`/`manifest-src` sin declarar caen al
  `default-src`, y las dos rutas son del mismo origen — verificado sin
  errores de consola con Playwright contra `pnpm preview`.
- **Verificación de punta a punta** (ver el reporte del encargo para el
  detalle): `pnpm build` deja `dist/manifest.webmanifest` y `dist/sw.js`
  con los íconos correctos; contra `pnpm preview` + Playwright, el
  service worker llega a `state: 'activating'` en la primera instalación
  y el manifest se lee con `content-type: application/manifest+json` y
  cero errores de consola.

## Autenticación real (AUTH-001, AUTH-002, AUTH-008, AUTH-010, P06.2)

Reemplaza la sesión provisoria de F5 (ver más arriba, "Sesión provisoria
(histórico)"). Archivos nuevos: `src/lib/supabase.ts` (AUTH-001),
`src/features/auth/claims.ts`, `src/features/auth/AuthProvider.tsx`
(AUTH-002, AUTH-010). `RequireRole.tsx` (AUTH-008), `AdminShell.tsx`,
`MobileShell.tsx`, `commonRoutes.tsx` (`ProfileLayout`) y `main.tsx` pasan
de `useSession()` a `useAuth()` — ese único cambio en cada uno, nada de
forma. `session.ts` se achicó a lo que quedó sin dueño de React: `Role`
(ahora `Database['public']['Enums']['app_role']`, no una unión a mano),
`ROLE_LABELS`, `homePathForRoles`.

### `src/lib/supabase.ts` (AUTH-001)

Cliente único de `supabase-js`, tipado con `Database`
(`src/lib/database.types.ts`), `persistSession: true`,
`autoRefreshToken: true`, `detectSessionInUrl: true` (para `/restablecer`,
AUTH-006, paquete siguiente). Solo `VITE_SUPABASE_URL`/
`VITE_SUPABASE_ANON_KEY` — nunca `service_role` (verificado: no aparece en
ningún archivo de `src/`, ni en `dist/` tras `pnpm build`).

### `AuthProvider`/`useAuth` (AUTH-002, `AuthProvider.tsx`)

Contexto de React montado una sola vez en `main.tsx`, por encima de
`<RouterProvider>`. `useAuth()` devuelve:

```ts
{
  status: 'loading' | 'unauthenticated' | 'authenticated'
  userId: string | null
  email: string | null
  roles: Role[]              // [] salvo authenticated
  capabilities: Capability[] // [] salvo authenticated y no-admin
  profile: AuthProfile | null // { id, firstName, lastName, displayName, contactEmail, phone, avatarPath }
  displayName: string        // profile.displayName ?? email ?? 'Cuenta' — ya resuelto, sin chequear status
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}
```

- `status`/`roles`/`capabilities` salen de `supabase.auth.onAuthStateChange`
  y del `access_token` de esa sesión, decodificado por
  `decodeAccessTokenClaims` (`claims.ts`) — el mismo claim `roles`/
  `capabilities` que arma `app.custom_access_token_hook` (`0003`, `0016`) y
  que leen las políticas RLS (`app.has_role`/`app.is_admin`/
  `app.has_capability`). `TOKEN_REFRESHED` (renovación automática, o al
  recuperar la conexión) vuelve a decodificar solo — un cambio de rol se ve
  en el próximo refresh, no antes (ver "La decisión de AUTH-010" abajo).
- `profile` sale de una lectura aparte a `public.profiles` (el JWT no trae
  nombre/apellido), con reintento (0, 300 ms, 900 ms) ante un hipo de red.
  Se pide una sola vez por `userId` (no se repite en cada
  `TOKEN_REFRESHED`). `refreshProfile()` la vuelve a pedir a demanda — para
  COM-04 ("Mi perfil", paquete siguiente) después de guardar cambios, o
  para `AvatarUpload` (EMP-011) después de subir una foto nueva.
- `signOut()` es `auth.signOut()` local (`06_API.md` sección 1). El cierre
  GLOBAL ("cerrar todas las sesiones de otra persona") es la Edge Function
  `admin-users`/`sign_out_user` (F7) — no algo que la propia sesión haga
  sobre sí misma.

**Qué necesitan las pantallas COM-01 a COM-05 (paquete siguiente,
AUTH-003/005/006/007) de este `AuthProvider`, para que no haga falta
tocarlo:**

- COM-01 (`/ingresar`): llama `supabase.auth.signInWithPassword(...)`
  directo (como ya hace `/dev/rol`) y no necesita nada nuevo de
  `useAuth()` — `AuthProvider` reacciona solo al cambio de sesión.
- COM-02/COM-03 (recuperar/restablecer): `auth.resetPasswordForEmail`/
  `auth.updateUser({password})`, tampoco tocan `AuthProvider`.
- COM-04 ("Mi perfil"): lee `profile`/`displayName` de `useAuth()`, edita
  con `from('profiles').update(...)` (`06_API.md` sección 2.2) y llama
  `refreshProfile()` al guardar.
- Si alguna pantalla necesita "¿soy owner o admin con esta capacidad?",
  ya está en `capabilities` (arreglo de `admin_capability`, `claims.ts`) —
  no hace falta agregar nada.

### `RequireRole` real (AUTH-008)

Mismo contrato de siempre (wrapper por grupo de rutas, `allow: Role[]`),
ahora contra `useAuth()`: `'loading'` → `RouteFallback` (el mismo spinner
del `Suspense` de los shells, evita un parpadeo a `/ingresar` mientras
`supabase-js` lee la sesión persistida — dura milisegundos con sesión
guardada, nunca pega a la red en ese caso); `'unauthenticated'` →
`/ingresar`; con sesión pero sin ningún rol de `allow` → la vía propia
(`homePathForRoles`) o `/sin-acceso`.

### La decisión de AUTH-010: confiar en el claim (con evidencia)

**Pregunta:** si a alguien se le saca un rol, ¿el `AuthProvider` tiene que
volver a consultar `user_roles`/`admin_capabilities` para "adelantarse", o
alcanza con confiar en el claim del JWT vigente?

**Se leyeron las funciones, no se supuso.** `app.has_role`/`app.is_admin`/
`app.has_capability` (`0003_profiles_roles_capabilities.sql`) llaman a
`app.jwt_roles()`/`app.jwt_capabilities()`, que leen
`auth.jwt() -> 'roles'`/`'capabilities'` — el claim del token, sin ninguna
subconsulta a las tablas. Las 69 políticas de `0012_rls_policies.sql` usan
exclusivamente esas funciones (el propio encabezado del archivo lo dice:
"sin subconsultas contra user_roles/admin_capabilities -- el hook ya los
puso en el token"). Conclusión: **la base confía en el claim**, no lo
revalida contra las tablas en cada pedido.

Como el frontend y las políticas RLS leen exactamente el mismo dato
(`decodeAccessTokenClaims` decodifica el mismo `access_token` que
`auth.jwt()` del lado del servidor), el `AuthProvider` no gana nada
sondeando `user_roles` por su cuenta: no hay ningún estado "más
actualizado" que pudiera mostrar sin mentir sobre lo que el servidor va a
autorizar en ese momento. Sondear solo agregaría latencia y consultas sin
cerrar ninguna ventana real.

**Ventana de exposición, medida en vivo contra `App_dev` (no supuesta),
con una cuenta del seed (`maria.gomez@extendiendoservicios.com`):**

1. Login normal (`signInWithPassword`) → `access_token` con
   `roles: ['employee']`.
2. `from('profiles').select(...)` con ese token → responde bien (RLS lo
   deja pasar).
3. `service_role.auth.admin.signOut(access_token, 'global')` — lo mismo
   que hace `sign_out_user`/`deactivate_user` (`06_API.md` sección 2.1) al
   sacarle un rol o desactivar a alguien.
4. **El mismo `from('profiles').select(...)` con el MISMO `access_token`
   viejo, otra vez → sigue respondiendo bien.** PostgREST valida el JWT
   solo por firma y `exp`, no contra `auth.sessions`: no tiene forma de
   saber que esa sesión fue revocada.
5. Un `fetch` directo a `/auth/v1/user` con el mismo token viejo sí lo
   rechaza (`403 session_not_found`) — GoTrue (los endpoints propios de
   Auth) sí valida la sesión viva; PostgREST (`from`/`rpc`, el 100 % de las
   RPC y consultas de la app) no.
6. Un intento de `refreshSession()` con el `refresh_token` viejo falla
   ("Invalid Refresh Token: Refresh Token Not Found") — bloquea la
   RENOVACIÓN, no el `access_token` ya emitido.
7. **Más todavía** (leyendo `_callRefreshToken` en el
   `@supabase/auth-js` instalado, no solo probándolo): la propia librería,
   a propósito, distingue un refresh "proactivo" (el `access_token`
   vigente no venció) de uno "reactivo" (ya venció). Si un refresh
   proactivo falla — exactamente este caso, revocación mientras el token
   de una hora sigue vigente — la librería CONSERVA la sesión en
   `localStorage` y NO dispara `SIGNED_OUT`, a propósito, para no
   desloguear a alguien cuyo `access_token` todavía funciona. Verificado
   en vivo: forzar `supabase.auth.refreshSession()` a mano después de
   revocar devuelve el error de (6) pero deja la sesión intacta — la
   pantalla sigue mostrando a la persona como autenticada.

**Conclusión, sin atenuarla:** revocar una sesión (por sacar un rol, por
desactivar a alguien) NO tiene efecto inmediato sobre ningún dato ni
ninguna RPC — sigue vigente hasta que el `access_token` expira de verdad
(hasta una hora, `jwt_expiry = 3600` en `supabase/config.toml`), momento en
el que recién el temporizador interno de `autoRefreshToken` (reintenta
cada 30 s, `AUTO_REFRESH_TICK_DURATION_MS`, empieza a intentar 90 s antes
del vencimiento, `EXPIRY_MARGIN_MS`) cae en la rama "reactiva", el refresh
falla contra el refresh token ya revocado, y ahí sí `supabase-js` limpia
la sesión y dispara `SIGNED_OUT` — `AuthProvider` lo recibe como cualquier
cierre de sesión (`session` llega `null`) y `RequireRole` redirige solo a
`/ingresar`. Esa es la "salida limpia" del encargo, con la demora real de
hasta una hora, no antes — y ningún sondeo, reintento ni `refreshSession()`
manual desde el frontend la acorta (probado: no la acorta).

Esto **contradice lo que asume `04_Modelo_de_Datos.md` línea 421**
("cuando el cambio es restrictivo... la Edge Function además revoca las
sesiones del usuario para que el efecto sea inmediato"): revocar la sesión
bloquea la renovación y los endpoints de Auth, pero no es inmediato para
los datos. **Este paquete no puede cerrar esa ventana** — es una decisión
de infraestructura (bajar `jwt_expiry`, agregar una verificación de sesión
viva dentro de cada política RLS, o algo equivalente) que le toca a
backend-supabase o a Mike, no al frontend: ningún código en `src/` cambia
lo que PostgREST ya le permitió a un token válido por firma. Queda
anotado como pendiente en el reporte del encargo, no tapado con un sondeo
cosmético.

### `/dev/rol`: de simulador a atajo real (decisión menor)

`devRole.ts` (F5, sesión simulada en `localStorage`) se borró entero.
`/dev/rol` (`src/pages/dev/DevRole.tsx`, sigue solo en desarrollo, mismo
patrón `lazy()` + `if (import.meta.env.DEV)`) pasó a ser un formulario de
login real contra una cuenta del seed: botones con las 14 cuentas (rellenan
el email) + campos de email/contraseña que llaman al mismo
`supabase.auth.signInWithPassword` que va a usar COM-01. La contraseña
(`SEED_DEV_PASSWORD`) no está en el código — es una variable sin prefijo
`VITE_`, Vite no la expone al bundle — se escribe a mano una vez. Verificado
que ni la página, ni los emails del seed, ni ningún rastro de `/dev/rol`
llegan a `dist/` (`pnpm build` + `grep` sobre `dist/assets/*.js`).

## Pantallas de autenticación (AUTH-003 a AUTH-007, P06.3)

Cierra el círculo que dejó P06.2: `/ingresar`, `/recuperar`, `/restablecer`,
`/sin-acceso` y `/perfil` dejan de ser placeholders. Archivos nuevos:
`src/pages/auth/` (`LoginPage`, `ForgotPasswordPage`, `ResetPasswordPage`,
`NoAccessPage`, `AuthScreenLayout`), `src/pages/common/ProfilePage.tsx`,
`src/features/auth/authErrors.ts`, `src/features/auth/useBranding.ts`.
`commonRoutes.tsx` reemplaza los cinco placeholders por estas páginas;
`router.tsx` reemplaza `ConstructionPage` (borrada) por el redirect de `/`
que pedía `05` sección 5 desde F5.

### COM-01 · Ingreso (`LoginPage.tsx`, AUTH-003/AUTH-004)

`react-hook-form` + `zod` (email, contraseña obligatoria — sin mínimo: el
login no compone reglas, solo `signInWithPassword`). Logo de
`v_public_branding` (`useBranding.ts`, lectura pública, `anon`) o
`/favicon.png` (isotipo en color, ya usado por `NotFoundPage` sobre
`--bg` claro) si `logo_path` es `null` — hoy lo es en el seed, comprobado
contra `App_dev` antes de escribir la pantalla (`{"name":"Extendiendo
Servicios","logo_path":null,"support_phone":"11 4000-0000"}`, ver el
reporte del encargo). Teléfono de soporte solo si está cargado, con
`tel:`.

**AUTH-004 (la redirección al entrar) vive DENTRO de `LoginPage`, no en el
router**: mientras `status !== 'authenticated'` la pantalla se queda
quieta; en cuanto `AuthProvider` confirma la sesión (el mismo
`onAuthStateChange` que ya dispara `signInWithPassword`), el mismo render
calcula `homePathForRoles(roles, isDesktop)` y redirige con `<Navigate>` —
cubre "acabo de loguearme" y "ya tenía sesión y entré a `/ingresar` por
las mías" con una sola rama.

**Error de login: un solo mensaje genérico, y por qué alcanza.** Probado
en vivo contra `App_dev` (no supuesto, `authErrors.ts` lo documenta):
`signInWithPassword` devuelve el mismo `error.code` ('invalid_credentials',
"Invalid login credentials", 400) para una contraseña incorrecta de una
cuenta real Y para un email que no existe en absoluto —

```
carlos.medina@extendiendoservicios.com | status 400 | error_code: invalid_credentials
esta-cuenta-no-existe-xyz@... | status 400 | error_code: invalid_credentials
```

Supabase Auth ya unifica los dos casos del lado del servidor. `authErrors.ts`
(`loginErrorMessage`) traduce ese único código a "El email o la contraseña
no son correctos." — sin una rama aparte para "no existe": agregar esa
distinción inventaría una fuga que el propio servidor no comete. Mismo
mapa de errores para `over_request_rate_limit`, `user_banned` (no puede
pasar hoy, la desactivación es F7, pero el código ya existe en
`@supabase/auth-js`) y `email_address_invalid`.

### `homePathForRoles(roles, isDesktopWidth)`: el quiebre de ancho (`session.ts`)

`05` sección 3, fila COM-01, tiene CINCO casos, no cuatro: "owner o admin y
el ancho es de escritorio → ADM-02" y, por separado, "admin en móvil →
ADM-02 responsive" son el MISMO destino contado dos veces para dejar
explícito que owner/admin sin otro rol también entra por acá en el
celular — el ancho no cambia el destino de un owner/admin "puro". Donde sí
importa: alguien que además de owner/admin tiene un rol con experiencia
mobile-first propia (empleado o supervisor) entra por esa vía en el
celular, no por el `AdminShell` colapsado — un administrador que abre la
app desde el teléfono para fichar su propio turno cae en `/app`, no en
`/admin`. En escritorio, owner/admin sigue ganando siempre. El parámetro
tiene un valor por omisión (`true`, el comportamiento de siempre) para no
tocar `RequireRole` (que sigue sin el caso del ancho: eso es "al entrar",
no la protección general de rutas) — decisión menor, ver el reporte.

Verificado en vivo (no solo en el test unitario): `andrea.rios@…`
(admin) en escritorio (1440 px) cae en `/admin`; `maria.gomez@…`
(employee) en el MISMO ancho de escritorio cae en `/app`.

### COM-02 · Recuperar (`ForgotPasswordPage.tsx`, AUTH-005)

Un email, un mensaje de confirmación genérico
(`FORGOT_PASSWORD_CONFIRMATION`, `authErrors.ts`). Igual que el login,
comprobado contra `App_dev`: `resetPasswordForEmail` no devuelve error para
un email sin cuenta — el mismo resultado "sin error" que para una cuenta
real. El único caso que cambia el mensaje es `over_email_send_rate_limit`
(no tiene nada que ver con si el email existe).

### COM-03 · Restablecer (`ResetPasswordPage.tsx`, AUTH-005/AUTH-006): el hallazgo del token

**Cómo llega de verdad (leído en el código de `@supabase/auth-js`
instalado, no supuesto):** con el flujo implícito (`flowType` por omisión,
no se pisa en este proyecto), el enlace del correo apunta a
`{SUPABASE_URL}/auth/v1/verify?token=…&type=recovery&redirect_to=…`.
GoTrue verifica el token server-side y responde `303` a `redirect_to` con
la sesión completa en el fragmento de la URL
(`#access_token=…&refresh_token=…&type=recovery`). `detectSessionInUrl:
true` (`supabase.ts`, ya declarado a propósito en P06.2) hace que
`GoTrueClient._initialize()` procese ese fragmento SOLO — llama a
`/auth/v1/user` para validar el `access_token` (un viaje de red real) antes
de armar la sesión, así que el `AuthProvider` (montado en `main.tsx`, por
encima del router) siempre llega a tiempo para capturar el evento: no
`SIGNED_IN`, sino **`PASSWORD_RECOVERY`** (`GoTrueClient.js`, ~línea 424).

Por eso `AuthProvider` (`AuthProvider.tsx`) agrega `isPasswordRecovery:
boolean` al contexto: se prende con el evento `PASSWORD_RECOVERY` y se
apaga con `USER_UPDATED` (la contraseña ya se cambió, `auth.updateUser`)
o `SIGNED_OUT`. Es la señal que distingue "llegué con el enlace del
email" (sesión completa, pero por ESTE evento) de "ya tenía sesión y entré
a `/restablecer` por mi cuenta" (sesión completa, pero por `SIGNED_IN`/
`INITIAL_SESSION`) — las dos dejan `status: 'authenticated'`, así que sin
esta señal no habría forma de distinguirlas. `ResetPasswordPage` usa
`isPasswordRecovery` así:

- Sin sesión → "el enlace venció o ya se usó", con un enlace a `/recuperar`.
- Con sesión pero NO por el enlace → `<Navigate to="/perfil" />` (ahí ya
  vive "cambiar contraseña" para alguien que ya inició sesión de la forma
  normal).
- Con sesión Y `isPasswordRecovery` → el formulario. Al guardar
  (`auth.updateUser({password})`), el evento `USER_UPDATED` apaga la
  bandera y la pantalla navega a `homePathForRoles(roles, isDesktop)` — el
  mismo ancho que usa COM-01, mismo criterio ("Navega a: Según rol", `05`).

**Ruta "intermedia", no pública ni protegida por `RequireRole`:** no puede
exigir un rol (nadie con `roles: []` podría cambiar su contraseña si la
desactivación existiera hoy) pero tampoco puede tratar "tiene sesión" como
"vino del enlace" — de ahí que la protección sea la bandera de arriba, no
un wrapper de ruta.

**Sobre el `redirect_to` (corregido por el orquestador al revisar P06.3).**
El encargo reportó que `additional_redirect_urls` no se respetaba en
`App_dev`. No es así, y conviene que quede escrito para que nadie salga a
"arreglar" algo que funciona. El endpoint de administración
`/auth/v1/admin/generate_link` toma `redirect_to` como **parámetro de
consulta en la URL**, no dentro del cuerpo del pedido; pasándolo en el
cuerpo, GoTrue lo ignora y cae al `site_url` — el síntoma que se vio.
Repetida la prueba con el parámetro de consulta, contra `App_dev`:

| `redirect_to` pedido                               | Devuelto   |
| -------------------------------------------------- | ---------- |
| `https://dev.extendiendoservicios.com/restablecer` | igual      |
| `http://localhost:5173/restablecer`                | igual      |
| un destino fuera de la lista blanca                | `site_url` |

La lista blanca funciona, y el tercer caso es la protección haciendo su
trabajo. El enlace real del correo de COM-02 llega bien a `/restablecer`,
porque `resetPasswordForEmail` pide `${origin}/restablecer` y ese origen
está declarado.

El redirect defensivo de `RootLayout` se conserva, pero por otro motivo:
cualquier origen fuera de la lista blanca (una URL de vista previa de
Cloudflare Pages, por ejemplo) vuelve al `site_url` por diseño, y ahí la
persona aterriza en `/` con el token en el hash. `detectSessionInUrl`
procesa ese hash sin importar qué ruta esté montada, así que el redirect lo
recupera.

**Circuito completo, verificado de punta a punta contra `App_dev` (no solo
leído):** `auth.admin.generateLink` para `carlos.medina@…` → `fetch` con
`redirect: manual` para capturar el fragmento real de sesión → Playwright
carga `http://localhost:5173/#<fragmento real>` (simulando dónde cae el
enlace hoy) → rebota solo a `/restablecer` → formulario → contraseña nueva
→ termina en `/app` como "Carlos". Sin errores de consola. La contraseña
de prueba se restauró a `SEED_DEV_PASSWORD` con `auth.admin.updateUserById`
apenas terminó la prueba (confirmado con un login real después).

### COM-04 · Perfil propio (`ProfilePage.tsx`, AUTH-007)

Sin shell propio: cuelga de `ProfileLayout` (`commonRoutes.tsx`, sin
cambios) y sin `<h1>` propio — el `handle` de la ruta (`{screenId:
'COM-04', title: 'Mi perfil'}`) ya lo muestra el topbar/cabecera de cada
shell (`useRouteHandle`). Cuatro `Card`: datos de la cuenta (nombre y
email de login de solo lectura — el encargo lo remarca explícitamente;
roles con `Badge`), contacto (`contact_email`/`phone`, `update profiles`),
cambiar contraseña (`auth.updateUser`, mismo `updatePasswordErrorMessage`
que COM-03) y ubicación (P-091/P-108: estado con fecha si ya consintió,
más el texto de `company_settings.location_consent_text` — leído en vivo
del seed, no un placeholder propio). La foto NO va acá (EMP-011, otra
fase).

**`location_consent_at`** no estaba en `AuthProfile` (`AuthProvider.tsx`,
P06.2 solo trajo `contact_email`/`phone`/`avatar_path`): se agregó acá
porque EMP-06 (front-movil, consentimiento antes de fichar) también lo va
a necesitar — mejor una sola fuente en el contexto que cada pantalla
pidiéndolo aparte.

### COM-05 · Sin acceso (`NoAccessPage.tsx`, AUTH-006)

A dónde manda `RequireRole` a quien tiene sesión sin ningún rol. Mensaje,
teléfono de soporte (misma `useBranding`) y un botón "Cerrar sesión"
(`auth.signOut()`, no automático — la persona ve el mensaje antes de que
la sesión se vaya). Sin sesión (alguien llega a la URL directo) →
`/ingresar`: no tiene sentido "sin acceso" sin sesión.

### `AuthScreenLayout.tsx`: el layout compartido de las cinco

"En móvil ocupa toda la pantalla; en escritorio, tarjeta centrada sobre
fondo claro" (`05`, fila COM-01) se escribe una sola vez para COM-01/02/03/
05 (COM-04 no la usa: lleva shell). Quiebre puro CSS (`sm:`, 480 px) sin
`useMediaQuery`: a diferencia del redirect de AUTH-004, acá el ancho solo
cambia estilo, no una decisión de navegación.

### `/dev/rol`: se conserva (decisión menor)

Ahora que COM-01 existe de verdad, `/dev/rol` podría borrarse — se decidió
CONSERVARLA: sigue siendo más rápida para recorrer cada vía durante el
desarrollo (un clic sobre una de las 14 cuentas rellena el email). Se le
agregó un enlace a `/ingresar` en el pie. Nunca llega a `dist/` (mismo
patrón de siempre).

### Otras decisiones menores

- **Sin `TanStack Query` todavía** (`useBranding.ts`,
  `useLocationConsentText` en `ProfilePage.tsx`): son lecturas únicas, sin
  parámetros ni invalidación, en pantallas que ni siquiera tienen sesión
  (COM-01). Instalar `@tanstack/react-query` (no está en `package.json`
  hoy) y su `QueryClientProvider` es una decisión de arquitectura más
  grande que le corresponde a quien construya la primera pantalla de
  datos de dominio (polling, paginación, invalidación de verdad).
- **Sin toggle de "mostrar contraseña"** en los campos de contraseña: no
  lo pide `05`, y el `Input` del design system no trae esa variante —
  no se inventó una para esta tarea.
- **Consentimiento de ubicación editable en los dos sentidos** (dar y
  quitar) en COM-04: la RLS de `profiles` permite las dos direcciones por
  igual (`location_consent_at` es una columna más de "propio"), y P-091
  ("el registro funciona igual si se niega") no excluye poder retractarse
  después.
- **`ConstructionPage` borrada entera** (componente, CSS y test), junto
  con el e2e que la probaba (renombrado a `root-redirect.spec.ts`, ahora
  prueba el redirect de `/` a `/ingresar`): dejó de tener ningún punto de
  montaje una vez que `/` pasó a redirigir según sesión y rol.

## Revisión visual de cierre de F5 (P05.6)

El orquestador recorrió `/dev/design`, los tres shells, sus menús y
overlays, y las pantallas comunes a 1440, 1024, 768 y 390 px. En los
cuatro anchos no hay desborde horizontal, imágenes rotas ni texto cortado.
Correcciones (detalle en `CHANGELOG.md`):

- **Sidebar colapsada**: los links son cuadrados de 44 px (`size-11`). Con
  la sidebar en `items-center`, un link sin ancho propio mide lo que su
  ícono.
- **Borde por defecto**: `globals.css` fija `border-color: var(--border)`
  en la capa base. Cualquier `border` sin color explícito toma ese gris,
  no el color del texto (comportamiento de Tailwind 4).
- **`Sheet` a los costados**: 452 px desde 768 px (`md`), toda la pantalla
  por debajo. Ya no hace falta pasarle el ancho por `className`.
- **Objetivos táctiles** (`07`: ≥ 44 px en móvil): cuando el control es
  más chico a propósito (avatar de 28 px, X de 28 px, "Volver" de 36 px),
  el área se agranda con `after:absolute after:-inset-*` y el control se
  ve igual. Ojo con `Button`: tiene borde de 1 px y el `::after` se
  posiciona desde el borde interno, así que la X usa `-inset-[9px]`
  (26 + 18 = 44), no `-inset-2`.
- **Textos**: ningún componente muestra textos en inglés, tampoco los
  `sr-only`. Al agregar un componente de shadcn, traducir "Close",
  "Search…" y similares.

Queda para F17 (RESP): el `index.html` no tiene `viewport-fit=cover`, así
que hoy `env(safe-area-inset-bottom)` vale 0. Si se agrega, el tabbar de
66 px de alto fijo tiene que crecer con el área segura; si no, los ítems
quedan apretados en los iPhone con barra de inicio.

## Cómo ver los componentes

`pnpm dev` y abrir `http://localhost:5173/dev/design`. Para recorrer
`AdminShell`/`MobileShell` con un rol simulado, `http://localhost:5173/dev/rol`
(DS-015). Ninguna de las dos existe en el build de producción.
