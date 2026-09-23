import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * `v_public_branding` (04 sección 7.2, `06_API.md` no la lista aparte
 * porque es lectura directa de PostgREST): nombre, logo y teléfono de
 * soporte para pantallas SIN sesión (COM-01) y para COM-05 (sesión sin
 * ningún rol, pero igual sin nada más que mostrar). `anon` solo puede leer
 * estas tres columnas (`0017_grants.sql`) — comprobado contra `App_dev`
 * antes de escribir esta pantalla (encargo P06.3): hoy `logo_path` es
 * `null` en el seed, así que las dos pantallas usan la marca por omisión.
 *
 * No usa TanStack Query (parte del stack, `03` sección 2) a propósito:
 * es una única lectura pública, sin params ni invalidación, en pantallas
 * que ni siquiera tienen sesión — instalar `@tanstack/react-query` y su
 * `QueryClientProvider` para esto solo es una decisión de arquitectura más
 * grande que le corresponde a quien construya la primera pantalla de
 * datos de dominio (decisión menor, ver el reporte del encargo).
 */
export interface Branding {
  name: string | null
  logoPath: string | null
  supportPhone: string | null
}

interface BrandingState {
  status: 'loading' | 'ready' | 'error'
  branding: Branding | null
}

/** Bucket público `branding` (`0014_storage_buckets.sql`): URL servida sin pasar por RLS. */
export function brandingLogoUrl(logoPath: string): string {
  return supabase.storage.from('branding').getPublicUrl(logoPath).data.publicUrl
}

export function useBranding(): BrandingState {
  const [state, setState] = useState<BrandingState>({
    status: 'loading',
    branding: null,
  })

  useEffect(() => {
    let active = true
    supabase
      .from('v_public_branding')
      .select('name, logo_path, support_phone')
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error || !data) {
          setState({ status: 'error', branding: null })
          return
        }
        setState({
          status: 'ready',
          branding: {
            name: data.name,
            logoPath: data.logo_path,
            supportPhone: data.support_phone,
          },
        })
      })
    return () => {
      active = false
    }
  }, [])

  return state
}
