import { createBrowserRouter } from 'react-router'
import { ConstructionPage } from '@/pages/common/ConstructionPage'

// React Router 7 en modo biblioteca (SPA, sin modo framework ni SSR — ADR-021).
// Única ruta de esta fase: la página "en construcción". El shell real
// (AdminShell, MobileShell, RequireRole) llega en F5.
export const router = createBrowserRouter([
  {
    path: '/',
    element: <ConstructionPage />,
  },
])
