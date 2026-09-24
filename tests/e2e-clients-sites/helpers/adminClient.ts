// tests/e2e-clients-sites/helpers/adminClient.ts — CLIENT-008/SITE-008/TEST-005 (P08.5)
//
// Cliente `supabase-js` con la clave de servicio: se usa SOLO para preparar datos de precondición
// (por ejemplo, el cliente dueño de una sede que un spec de SITE-008 necesita para arrancar, sin
// gastar pasos de interfaz en algo que no es lo que ese test prueba) y para la limpieza de todo
// lo que cada spec crea, aun si el test falla (`try/finally`). Nunca para probar qué puede hacer
// un rol: eso es `tests/permissions/`.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readE2eClientsSitesEnv } from './env.ts'

let cached: SupabaseClient | null = null

export function getAdminClient(): SupabaseClient {
  if (cached) return cached
  const env = readE2eClientsSitesEnv()
  if (!env) {
    throw new Error('getAdminClient() llamado sin .env.local completo.')
  }
  cached = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}

/**
 * Prefijo reconocible (regla común 7, "Independencia"): todo lo que esta suite crea en
 * `App_dev` lo lleva en la razón social o el nombre de la sede, distinto del de
 * `tests/e2e-auth/` (`e2e-auth-`), `tests/e2e-users/` (`e2e-p074-`) y `tests/permissions/`, para
 * identificar de un vistazo qué suite dejó cada fila si algo quedara a medio limpiar.
 */
export const E2E_NAME_PREFIX = 'E2E-P085'

/** Nombre descartable único por corrida (razón social de cliente o nombre de sede). */
export function disposableName(slug: string): string {
  return `${E2E_NAME_PREFIX} ${slug} ${Date.now()}`
}

/**
 * CUIT de 11 dígitos, único por corrida: `20` (prefijo típico de persona jurídica) + los 8
 * dígitos menos significativos de `Date.now()` + un dígito al azar, para no chocar ni con el
 * seed ni con otra corrida en el mismo milisegundo. El formulario (`clientFormSchema`) solo
 * exige "11 dígitos, sin puntos ni guiones" (`04_Modelo_de_Datos.md` sección 2.2) — no valida
 * dígito verificador, así que no hace falta calcularlo.
 */
export function disposableCuit(): string {
  const timestampDigits = Date.now().toString().slice(-8)
  const randomDigit = Math.floor(Math.random() * 10).toString()
  return `20${timestampDigits}${randomDigit}`
}

/**
 * Crea un cliente directo (sin pasar por la interfaz), para las precondiciones de los specs que
 * no están probando el alta de cliente en sí (por ejemplo, SITE-008: "crear sede con
 * coordenadas", que necesita un cliente ya existente). `created_by: null` (`clients.created_by`
 * es opcional, `0005_clients_sites.sql`): esta suite no depende de un actor humano para las
 * filas que arma por API directa.
 */
export async function createDisposableClient(
  admin: SupabaseClient,
  overrides: Partial<{
    legalName: string
    cuit: string | null
    status: 'active' | 'suspended' | 'closed'
  }> = {},
): Promise<{ id: string; legalName: string; cuit: string | null }> {
  const legalName = overrides.legalName ?? disposableName('Cliente')
  const cuit = overrides.cuit ?? disposableCuit()
  const status = overrides.status ?? 'active'
  const { data, error } = await admin
    .from('clients')
    .insert({ legal_name: legalName, cuit, status })
    .select('id, legal_name, cuit')
    .single()
  if (error) {
    throw new Error(
      `No se pudo crear el cliente de precondición: ${error.message}`,
    )
  }
  return {
    id: data.id as string,
    legalName: data.legal_name as string,
    cuit: data.cuit as string | null,
  }
}

/**
 * Crea una sede directa (sin pasar por la interfaz) para un cliente ya existente: precondición
 * de los specs que no están probando el alta de sede en sí (el cliente de control de
 * `site-map.spec.ts`, la sede que `mobile-screenshots.spec.ts` necesita para ADM-22 y ADM-24).
 * `created_by: null`, mismo criterio que `createDisposableClient`.
 */
export async function createDisposableSite(
  admin: SupabaseClient,
  clientId: string,
  overrides: Partial<{
    name: string
    address: string
    latitude: number
    longitude: number
    status: 'active' | 'inactive'
  }> = {},
): Promise<{ id: string; name: string }> {
  const name = overrides.name ?? disposableName('Sede')
  const address = overrides.address ?? 'Dirección de prueba, sin importancia'
  const latitude = overrides.latitude ?? -34.6037
  const longitude = overrides.longitude ?? -58.3816
  const status = overrides.status ?? 'active'
  const { data, error } = await admin
    .from('sites')
    .insert({ client_id: clientId, name, address, latitude, longitude, status })
    .select('id, name')
    .single()
  if (error) {
    throw new Error(
      `No se pudo crear la sede de precondición: ${error.message}`,
    )
  }
  return { id: data.id as string, name: data.name as string }
}

/**
 * Borra en cascada (a mano, sin `on delete cascade` en el esquema — decisión del modelo,
 * `04_Modelo_de_Datos.md` sección 0 ("Baja lógica"): nada se borra físicamente salvo un alta de prueba
 * descartable como esta) todo lo que un cliente de esta suite pudo haber dejado: sus sedes y sus
 * contactos, y por último el cliente. Solo para clientes `E2E-P085*` creados por la propia
 * suite; nunca para un cliente real.
 */
export async function deleteDisposableClient(
  admin: SupabaseClient,
  clientId: string,
): Promise<void> {
  const { error: sitesError } = await admin
    .from('sites')
    .delete()
    .eq('client_id', clientId)
  if (sitesError) {
    throw new Error(
      `No se pudieron borrar las sedes del cliente ${clientId} en la limpieza: ${sitesError.message}`,
    )
  }
  const { error: contactsError } = await admin
    .from('client_contacts')
    .delete()
    .eq('client_id', clientId)
  if (contactsError) {
    throw new Error(
      `No se pudieron borrar los contactos del cliente ${clientId} en la limpieza: ${contactsError.message}`,
    )
  }
  const { error: clientError } = await admin
    .from('clients')
    .delete()
    .eq('id', clientId)
  if (clientError) {
    throw new Error(
      `No se pudo borrar el cliente ${clientId} en la limpieza: ${clientError.message}`,
    )
  }
}
