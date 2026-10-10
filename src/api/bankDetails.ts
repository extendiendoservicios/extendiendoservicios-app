import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'

/**
 * `src/api/bankDetails.ts` (AJ2-04): banco, CBU y alias de clientes y
 * empleados. Viven en tablas aparte (`client_bank_details`,
 * `employee_bank_details`, migración 0040) con su propia RLS: dueño y
 * administrador leen todo, el empleado lee solo su fila, el supervisor nada.
 * La escritura es solo por RPC (`set_client_bank_details`,
 * `set_employee_bank_details`): cada llamada reemplaza los tres campos y el
 * servidor normaliza el CBU (22 dígitos) y recorta el alias.
 *
 * Errores del servidor (`hint`): `FORBIDDEN`, `CLIENT_NOT_FOUND`,
 * `PROFILE_NOT_FOUND`, `INVALID_CBU`, `INVALID_ALIAS`, `BANK_NAME_TOO_LONG`.
 * El `message` ya viene en español.
 */

export interface BankDetails {
  bankName: string | null
  /** Solo dígitos (22); la pantalla lo agrupa con `formatCbu`. */
  cbu: string | null
  alias: string | null
}

export type BankDetailsInput = BankDetails

interface BankRow {
  bank_name: string | null
  cbu: string | null
  alias: string | null
}

function mapBankRow(row: BankRow): BankDetails {
  return { bankName: row.bank_name, cbu: row.cbu, alias: row.alias }
}

/** `true` si no hay ningún dato cargado. */
export function isBankDetailsEmpty(
  details: BankDetails | null | undefined,
): boolean {
  return !details || (!details.bankName && !details.cbu && !details.alias)
}

/** Datos bancarios de un cliente, o `null` si todavía no se cargaron (dueño y administrador). */
export async function fetchClientBankDetails(
  clientId: string,
): Promise<BankDetails | null> {
  const { data, error } = await supabase
    .from('client_bank_details')
    .select('bank_name, cbu, alias')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    throw fromPostgrestError(error)
  }
  return data ? mapBankRow(data) : null
}

/**
 * Datos bancarios de un empleado o supervisor, o `null` si no hay. Dueño y
 * administrador leen cualquiera; la propia persona, solo los suyos (RLS).
 */
export async function fetchEmployeeBankDetails(
  profileId: string,
): Promise<BankDetails | null> {
  const { data, error } = await supabase
    .from('employee_bank_details')
    .select('bank_name, cbu, alias')
    .eq('profile_id', profileId)
    .maybeSingle()

  if (error) {
    throw fromPostgrestError(error)
  }
  return data ? mapBankRow(data) : null
}

/** Guarda (alta o cambio) los tres datos de un cliente; vacío = se borra el dato. */
export async function setClientBankDetails(
  clientId: string,
  input: BankDetailsInput,
): Promise<BankDetails> {
  const { data, error } = await supabase.rpc('set_client_bank_details', {
    p_client_id: clientId,
    p_bank_name: input.bankName ?? undefined,
    p_cbu: input.cbu ?? undefined,
    p_alias: input.alias ?? undefined,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapBankRow(data)
}

/** Guarda (alta o cambio) los tres datos de un empleado o supervisor; vacío = se borra el dato. */
export async function setEmployeeBankDetails(
  profileId: string,
  input: BankDetailsInput,
): Promise<BankDetails> {
  const { data, error } = await supabase.rpc('set_employee_bank_details', {
    p_profile_id: profileId,
    p_bank_name: input.bankName ?? undefined,
    p_cbu: input.cbu ?? undefined,
    p_alias: input.alias ?? undefined,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapBankRow(data)
}
