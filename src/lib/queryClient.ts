import { QueryClient } from '@tanstack/react-query'

/**
 * Instancia única de `QueryClient` (P07.2, primer dominio con datos reales
 * — `06_API.md` sección 16, `03_Plan_Maestro_Tecnico.md` sección 2:
 * "TanStack Query 5 para servidor"). Se monta una sola vez en
 * `src/main.tsx`, por encima de `<RouterProvider>`, igual que
 * `<AuthProvider>`.
 *
 * `staleTime` por defecto en 60 s: la mayoría de las listas de
 * administración pollean cada 60 s (regla común de polling); las pantallas
 * que necesitan 30 s (tablero, asistencia de hoy) o "nunca" (formularios,
 * `staleTime: Infinity`) lo pisan en su propio `useQuery`. `retry: 1` evita
 * la cadena larga de reintentos por defecto de TanStack Query (3) contra
 * errores de dominio que no van a cambiar por reintentar (por ejemplo
 * `FORBIDDEN`).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
  },
})
