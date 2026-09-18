# Design system

Fuente: `07_Design_System.md` del Plan Maestro. Este documento explica cómo
está implementado en el repositorio, no repite los valores de diseño (para
eso está `07`).

Estado: F5 · DS-001, DS-002, DS-017. Todavía sin componentes propios, sin
shells y sin `/dev/design` (llegan en el resto de F5 y en P05.2/P05.3).

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
  en lugar de `src/`. Se agregó `compilerOptions.baseUrl`/`paths` también en
  `tsconfig.json` (con un comentario explicando por qué): no compila nada
  (`files: []`), es solo para que herramientas que leen únicamente ese
  archivo encuentren el alias.
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
