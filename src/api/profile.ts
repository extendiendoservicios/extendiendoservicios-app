import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'

/**
 * Preferencias propias de `public.profiles`. `set_my_high_contrast` (AJ2-02)
 * guarda en la cuenta si la persona usa el tema de alto contraste.
 */
export async function setMyHighContrast(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_my_high_contrast', {
    p_enabled: enabled,
  })
  if (error) throw fromPostgrestError(error)
}
