import {
  Avatar as AvatarRoot,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'

/**
 * Avatar (DS-009): `07` sección 2.3 — 28 px con foto o iniciales, sobre los
 * seis colores fijos del mockup (`.av.a`…`.av.f`, `ds.css`), asignados por
 * hash determinístico del `id` (normaliza `07` sección 4: "colores de avatar
 * asignados a mano → asignación determinística por hash del id").
 */

/** Los seis colores fijos, en el mismo orden que `ds.css` (`.av.a`…`.av.f`). */
const AVATAR_COLOR_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const
type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number]

/**
 * Hash determinístico y estable de una cadena (DJB2). Puro: mismo `id` →
 * mismo resultado siempre, en cualquier máquina o corrida (no usa
 * `Math.random` ni nada dependiente del entorno).
 */
function hashString(value: string): number {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return hash >>> 0
}

/** Color fijo (`a`…`f`) para un id dado (DS-009). */
function getAvatarColorKey(id: string): AvatarColorKey {
  const index = hashString(id) % AVATAR_COLOR_KEYS.length
  return AVATAR_COLOR_KEYS[index]!
}

/** Iniciales para el fallback: primera letra del primer y el último nombre. */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return ''
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }
  return (
    parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)
  ).toUpperCase()
}

interface AvatarProps {
  /** Id estable de la persona: define el color (hash determinístico). */
  id: string
  /** Nombre completo: de acá salen las iniciales del fallback. */
  name: string
  /** Foto (`storage avatars`). Si falta o no carga, se ve el fallback. */
  src?: string | null
  /** 28 px (default), 26 px para `DataTable` "compact", u 80 px para la vista previa de `AvatarUpload` (`lg`). */
  size?: 'default' | 'compact' | 'lg'
  className?: string
}

function Avatar({ id, name, src, size = 'default', className }: AvatarProps) {
  const colorKey = getAvatarColorKey(id)
  const initials = getInitials(name)

  return (
    <AvatarRoot size={size} className={className}>
      {src && <AvatarImage src={src} alt="" aria-hidden="true" />}
      <AvatarFallback
        style={{ backgroundColor: `var(--avatar-${colorKey})` }}
        aria-hidden="true"
      >
        {initials}
      </AvatarFallback>
      {/* El nombre visible siempre viene de `PersonCell` o de quien use
          `Avatar`; este span es la única forma en que el nombre llega a un
          lector de pantalla cuando el Avatar se usa suelto. */}
      <span className="sr-only">{name}</span>
    </AvatarRoot>
  )
}

export { Avatar, getAvatarColorKey, getInitials }
export type { AvatarProps }
