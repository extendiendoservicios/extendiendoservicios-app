import { formatShortDate } from '@/lib/format'

/**
 * Constancia de un archivo que la dueña o un administrador eliminó a mano
 * (módulo H, P21.8b): «Eliminada por Ana Pérez el día jue 13 ago». Si el
 * servidor no trae el nombre, «Eliminada el día jue 13 ago».
 */
export function deletedNote(input: {
  deletedAt: string | null
  firstName?: string | null
  lastName?: string | null
}): string {
  const who = `${input.firstName ?? ''} ${input.lastName ?? ''}`.trim()
  const when = input.deletedAt ? formatShortDate(input.deletedAt) : ''
  const date = when ? ` el día ${when}` : ''
  return who ? `Eliminada por ${who}${date}` : `Eliminada${date}`
}
