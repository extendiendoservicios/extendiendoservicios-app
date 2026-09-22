import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from '@/app/router'
import { AuthProvider } from '@/features/auth/AuthProvider'
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
    <AuthProvider>
      <RouterProvider router={router} />
      {/* Montado una sola vez en la raíz (DS-010): cualquier pantalla puede
          llamar a `toast(...)` de "sonner" sin volver a montar el Toaster. */}
      <Toaster />
    </AuthProvider>
  </StrictMode>,
)
