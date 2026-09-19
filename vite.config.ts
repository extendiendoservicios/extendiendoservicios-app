import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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

// https://vite.dev/config/
export default defineConfig({
  // Tailwind CSS 4 se configura en CSS (`@theme` en src/styles/tailwind.css),
  // no en tailwind.config.ts (ADR-021).
  plugins: [
    react(),
    tailwindcss(),
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
    sourcemap: Boolean(sentryAuthToken),
  },
})
