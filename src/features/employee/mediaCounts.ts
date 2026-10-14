/**
 * Texto de cuántas fotos y videos subió la persona en el turno
 * (EMP-11): «3 fotos y 1 video», «2 fotos», «Ninguno».
 */
export function formatMediaCounts(photos: number, videos: number): string {
  const parts: string[] = []
  if (photos > 0) parts.push(`${photos} ${photos === 1 ? 'foto' : 'fotos'}`)
  if (videos > 0) parts.push(`${videos} ${videos === 1 ? 'video' : 'videos'}`)
  return parts.length > 0 ? parts.join(' y ') : 'Ninguno'
}
