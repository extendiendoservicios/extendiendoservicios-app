import type { OwnerDeleteKind, OwnerDeletePreview } from '@/api/ownerDelete'
import type { Role } from '@/api/users'

/**
 * Lógica pura del borrado del dueño (P27.7, OD-22 y OD-23), sin React ni
 * Supabase. El servidor vuelve a verificar todo; acá solo se decide qué
 * mostrar y cuándo habilitar «Eliminar».
 */

/** Solo el dueño ve las acciones de «Eliminar» (OD-22). */
export function canOwnerDelete(actor: { roles: Role[] }): boolean {
  return actor.roles.includes('owner')
}

/** Igual que el servidor: sin mayúsculas, sin espacios de más. */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Nombres que se aceptan para confirmar. Siempre el que muestra el diálogo
 * (`name`); para el cliente también la razón social y el nombre comercial; para
 * el empleado, «Nombre Apellido» y «Apellido Nombre».
 */
export function acceptedNames(
  kind: OwnerDeleteKind,
  preview: Pick<OwnerDeletePreview, 'name' | 'alternativeNames'>,
): string[] {
  const names = [preview.name, ...preview.alternativeNames]
  if (kind === 'employee') {
    const words = preview.name.trim().split(/\s+/)
    if (words.length >= 2) {
      names.push(`${words.slice(-1).join(' ')} ${words.slice(0, -1).join(' ')}`)
      names.push(`${words.slice(1).join(' ')} ${words[0]}`)
    }
  }
  return names
}

/** ¿Lo que escribió la persona alcanza para confirmar? El turno no pide nombre. */
export function confirmNameMatches(
  kind: OwnerDeleteKind,
  preview: Pick<OwnerDeletePreview, 'name' | 'alternativeNames'>,
  typed: string,
): boolean {
  if (kind === 'shift') {
    return true
  }
  const given = normalizeName(typed)
  if (given === '') {
    return false
  }
  return acceptedNames(kind, preview).some(
    (name) => normalizeName(name) === given,
  )
}

/** Texto de un renglón de «qué se va a borrar»: «Asignaciones de empleados: 3». */
export function describeItem(item: { label: string; count: number }): string {
  return `${item.label}: ${item.count}`
}
