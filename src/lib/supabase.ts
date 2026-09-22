import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Cliente único de Supabase (AUTH-001, `03_Plan_Maestro_Tecnico.md` sección
 * 2 y 15, `06_API.md` sección 0). Lo usan `AuthProvider`
 * (`src/features/auth/AuthProvider.tsx`) para la sesión y, a partir de las
 * fases de dominio, los módulos de `src/api/` para `from()`/`rpc()`.
 *
 * - `persistSession`/`autoRefreshToken`: sesión persistente con JWT de 1
 *   hora renovado en segundo plano (P-015, ADR-008) — sin esto, recargar la
 *   página cerraría la sesión.
 * - `detectSessionInUrl`: ya es `true` por defecto en `@supabase/supabase-js`
 *   2.x, pero se deja explícito porque `/restablecer` (COM-03, AUTH-006,
 *   paquete siguiente) depende de que el cliente lea el token de
 *   recuperación de la URL del enlace que manda Supabase por email.
 * - Tipado con `Database` (`src/lib/database.types.ts`, generado por
 *   backend-supabase): autocompletado y chequeo de tipos en `from()`/`rpc()`
 *   para cualquier feature que use este cliente.
 * - Solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (públicas por
 *   diseño, lo que protege es RLS — `03` sección 15). La `service_role`
 *   nunca aparece acá ni en ningún archivo de `src/`: vive solo en
 *   `.env.local` (scripts de un solo uso, nunca en el bundle) y en la Edge
 *   Function `admin-users`.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Revisá .env.local (docs/environments.md sección 4).',
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
