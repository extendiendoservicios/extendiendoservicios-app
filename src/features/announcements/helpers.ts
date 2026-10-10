import { format } from 'date-fns'
import { tz } from '@date-fns/tz'
import type {
  AnnouncementAudience,
  AnnouncementRecipient,
  AnnouncementStatus,
} from '@/api/announcements'
import { BUENOS_AIRES_TIME_ZONE, formatTime } from '@/lib/format'

/** Texto de destinatarios del listado: «Empleados», «Supervisores», «Todos», «N personas». */
export function audienceText(
  audience: AnnouncementAudience,
  recipientCount: number,
): string {
  switch (audience) {
    case 'employees':
      return 'Empleados'
    case 'supervisors':
      return 'Supervisores'
    case 'all':
      return 'Todos'
    case 'custom':
      return recipientCount === 1 ? '1 persona' : `${recipientCount} personas`
  }
}

/** `yyyy-MM-dd` → `dd/mm/aaaa`, sin pasar por zonas horarias. */
export function formatDmy(isoDate: string): string {
  const [year = '', month = '', day = ''] = isoDate.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

/** «Hasta el dd/mm/aaaa» o «Sin vencimiento». */
export function validityText(visibleUntil: string | null): string {
  return visibleUntil
    ? `Hasta el ${formatDmy(visibleUntil)}`
    : 'Sin vencimiento'
}

/** «Leído por X de Y». */
export function readByText(readCount: number, recipientCount: number): string {
  return `Leído por ${readCount} de ${recipientCount}`
}

export const ANNOUNCEMENT_STATUS_VARIANT: Record<
  AnnouncementStatus,
  'success' | 'neutral' | 'warning'
> = {
  active: 'success',
  expired: 'warning',
  archived: 'neutral',
}

/** «Leído el dd/mm hh:mm» (hora de Buenos Aires) o «Todavía no». */
export function readAtText(readAt: string | null): string {
  if (!readAt) {
    return 'Todavía no'
  }
  const day = format(readAt, 'dd/MM', { in: tz(BUENOS_AIRES_TIME_ZONE) })
  return `Leído el ${day} ${formatTime(readAt)}`
}

const ROLE_LABELS: Record<string, string> = {
  employee: 'Empleado',
  supervisor: 'Supervisor',
}

/** «Empleado», «Supervisor» o «Empleado y supervisor». */
export function rolesText(roles: string[]): string {
  const labels = ['employee', 'supervisor']
    .filter((role) => roles.includes(role))
    .map((role) => ROLE_LABELS[role] as string)
  if (labels.length === 0) {
    return '—'
  }
  return labels.length === 2 ? 'Empleado y supervisor' : (labels[0] as string)
}

/**
 * Orden de «Quién lo leyó»: primero quienes no lo leyeron (por apellido y
 * nombre); después quienes sí, del más reciente al más antiguo.
 */
export function sortRecipients(
  recipients: AnnouncementRecipient[],
): AnnouncementRecipient[] {
  const byName = (a: AnnouncementRecipient, b: AnnouncementRecipient) =>
    `${a.lastName} ${a.firstName}`.localeCompare(
      `${b.lastName} ${b.firstName}`,
      'es',
    )
  return [...recipients].sort((a, b) => {
    if (a.readAt === null && b.readAt !== null) {
      return -1
    }
    if (a.readAt !== null && b.readAt === null) {
      return 1
    }
    if (a.readAt !== null && b.readAt !== null && a.readAt !== b.readAt) {
      return a.readAt < b.readAt ? 1 : -1
    }
    return byName(a, b)
  })
}
