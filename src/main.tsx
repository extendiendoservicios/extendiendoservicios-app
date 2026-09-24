import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { router } from '@/app/router'
import { PwaUpdateProvider } from '@/app/PwaUpdateProvider'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { queryClient } from '@/lib/queryClient'
import { initSentry } from '@/lib/sentry'
import { Toaster } from '@/components/ui/sonner'
import '@/styles/globals.css'

// INFRA-021: no hace nada si falta VITE_SENTRY_DSN (ver src/lib/sentry.ts).
initSentry()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('No se encontró el elemento #root en index.html.')
}

createRoot(rootElement).render(
  <StrictMode>
    {/* Una sola instancia para todo el árbol de rutas (AUTH-002): la
        sesión persistida se lee una vez acá arriba, no en cada shell. */}
    {/* Una sola instancia de TanStack Query para toda la app (P07.2,
        `06_API.md` sección 16): los hooks de `src/features/<dominio>/
        queries.ts` la comparten vía `useQuery`/`useMutation`, sin crear un
        cliente por pantalla. */}
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Registra el service worker una sola vez para toda la sesión de la
            pestaña (RESP-009), sin importar la vía en la que esté la persona
            -- el chequeo periódico tiene que seguir corriendo incluso en
            `/ingresar`, antes de cualquier shell. */}
        <PwaUpdateProvider>
          <RouterProvider router={router} />
          {/* Montado una sola vez en la raíz (DS-010): cualquier pantalla
              puede llamar a `toast(...)` de "sonner" sin volver a montar el
              Toaster. */}
          <Toaster />
        </PwaUpdateProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
