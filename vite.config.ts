import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// La versión visible de la app (ADR-020) se inyecta en el build desde
// package.json, no desde una variable de entorno declarada a mano.
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string }

// INFRA-021: el plugin oficial de Sentry para Vite sube los source maps del build y los asocia
// a una release solo cuando hay SENTRY_AUTH_TOKEN (secreto de CI; nunca en local ni en un build
// de un colaborador). Sin el token -- `pnpm dev`/`pnpm build` locales, y cualquier build en CI
// antes de que Mike cargue el secreto -- el plugin ni se agrega y `build.sourcemap` queda en
// `false` más abajo: no se generan `.map`, así que no hay nada que pueda filtrarse sin subir.
//
// La organización de Sentry ("extendiendo-servicios") vive en la región de datos Unión Europea
// (docs/environments.md): la API que usan la CLI y los plugins de build para esa región es
// `de.sentry.io`, no `sentry.io` (que es la región EE. UU. y el valor por omisión del plugin) --
// verificado contra la documentación de Sentry sobre almacenamiento de datos por región.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN

// RESP-001 / P-089 (CONFIRMADO en 02_Decisiones.md): manifest, íconos, pantalla completa
// (sin la barra del navegador -- `display: 'standalone'`, no `'fullscreen'`, que además
// ocultaría la barra de estado del celular) y service worker que cachea solo la aplicación,
// nunca datos. Detalle completo de cada decisión en docs/design-system.md, sección "PWA"
// (el documento dedicado, docs/pwa.md, llega recién con RESP-012/DOC-017 en F17).
const pwaPlugin = VitePWA({
  // 'generateSW' (default): Workbox arma el service worker a partir del build, sin escribir
  // ninguno a mano -- no hace falta la estrategia 'injectManifest' porque esta entrega no
  // necesita lógica de cacheo a medida (nada de datos, nada de Supabase).
  strategies: 'generateSW',
  // 'prompt' (decisión del orquestador, P05.5, se mantiene en RESP-009): el service worker
  // nuevo instala y queda esperando (`skipWaiting`/`clientsClaim` en falso); se activa recién
  // cuando `PwaUpdateProvider` (`src/app/PwaUpdateProvider.tsx`) le manda la señal, nunca
  // solo. Un empleado podría estar fichando en otra pestaña -- recargar solo por una
  // actualización lo interrumpiría; con `autoUpdate` esto pasaría sin avisar.
  registerType: 'prompt',
  // `false`: el registro del service worker no lo arma el script genérico que este plugin
  // inyectaría solo (`registerSW.js`, sin ningún aviso), sino `PwaUpdateProvider`, con
  // `virtual:pwa-register/react` (RESP-009) -- necesita ser quien registra para enterarse de
  // cuándo hay una versión nueva esperando y poder avisar.
  injectRegister: false,
  // Nunca en `pnpm dev`: sin esto, el navegador registraría un service worker que serviría
  // el `index.html` de un build viejo por encima del servidor de desarrollo de Vite.
  devOptions: { enabled: false },
  manifest: {
    name: 'Extendiendo Servicios',
    short_name: 'Ext. Servicios',
    description: 'Plataforma de gestión de Extendiendo Servicios.',
    lang: 'es-AR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Mismo teal de marca que el isotipo de los íconos (`--primary`, `07` sección 1.1): el
    // splash de instalación se arma con este color de fondo y el ícono blanco encima, igual
    // que `pwa-*.png`/`apple-touch-icon-180x180.png` (Images/recortes/README.md).
    theme_color: '#569EA4',
    background_color: '#569EA4',
    icons: [
      {
        src: '/icons/pwa-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/pwa-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/pwa-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    // Precache exclusivamente lo que Vite emite en `dist/` (JS, CSS, HTML, fuentes e
    // íconos del propio build). Sin `runtimeCaching`: ninguna llamada a Supabase, Nominatim
    // o los tiles de OpenStreetMap pasa por el service worker -- los datos nunca se cachean
    // (P-089).
    globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
    // SPA: cualquier navegación que no matchee un archivo precacheado (todas las rutas de
    // React Router) sirve `index.html` desde el cache, para que la app abra sin conexión.
    navigateFallback: '/index.html',
  },
})

// https://vite.dev/config/
export default defineConfig({
  // Tailwind CSS 4 se configura en CSS (`@theme` en src/styles/tailwind.css),
  // no en tailwind.config.ts (ADR-021).
  plugins: [
    react(),
    tailwindcss(),
    pwaPlugin,
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: 'extendiendo-servicios',
            project: 'extendiendoservicios-app',
            authToken: sentryAuthToken,
            url: 'https://de.sentry.io/',
            release: { name: pkg.version },
            sourcemaps: {
              // Se suben a Sentry y se borran de `dist/` en este mismo paso del build: los
              // `.map` nunca llegan a publicarse (INFRA-021). Los workflows de despliegue borran
              // igual cualquier `.map` remanente como respaldo (deploy-staging.yml,
              // deploy-production.yml) por si esto no llegara a ejecutarse.
              filesToDeleteAfterUpload: ['dist/**/*.map'],
            },
            // Una falla al subir los source maps (red, token vencido, límite de Sentry) no
            // tiene que bloquear el despliegue: Sentry es observabilidad, no una dependencia
            // dura del build.
            errorHandler: (error) => {
              console.warn(
                '[Sentry] No se pudieron subir los source maps:',
                error,
              )
            },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  build: {
    // Solo se generan si se van a subir a Sentry (arriba). Sin SENTRY_AUTH_TOKEN no hace falta
    // pagar el costo de generarlos, y no queda ningún `.map` que pueda terminar publicado.
    // 'hidden': el JS publicado no lleva el comentario `sourceMappingURL` hacia un `.map` que
    // se borra después de subirlo. Sentry no lo necesita: asocia cada archivo por debug ID.
    sourcemap: sentryAuthToken ? 'hidden' : false,
  },
})
