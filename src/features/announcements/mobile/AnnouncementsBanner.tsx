import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { isApiError } from '@/api/errors'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { AnnouncementCard } from './AnnouncementCard'
import {
  pendingOf,
  useAcknowledgeAnnouncementMutation,
  useMyAnnouncementsQuery,
} from './queries'

const VISIBLE_BY_DEFAULT = 2

export const ACK_ERROR_NOT_AVAILABLE =
  'Ese anuncio ya no está disponible para vos.'
export const ACK_ERROR_NETWORK =
  'No pudimos registrar tu "Entendido". Revisá tu conexión e intentá de nuevo.'

/** Mensaje para mostrar cuando falla el "Entendido". */
export function ackErrorMessage(error: unknown): string {
  return isApiError(error) && error.hint === 'ANNOUNCEMENT_NOT_AVAILABLE'
    ? ACK_ERROR_NOT_AVAILABLE
    : ACK_ERROR_NETWORK
}

/**
 * Anuncios pendientes arriba de la portada (Hoy del empleado y del
 * supervisor, AJ2-03). No bloquea el resto de la portada: mientras carga o
 * si falla no muestra nada. Más de 2 pendientes: muestra 2 y "Ver N
 * anuncios más".
 */
export function AnnouncementsBanner() {
  const { data, isError } = useMyAnnouncementsQuery()
  const acknowledge = useAcknowledgeAnnouncementMutation()
  const online = useOnlineStatus()
  const [expanded, setExpanded] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const pending = pendingOf(data)
  if (isError || (pending.length === 0 && !message)) return null

  const shown = expanded ? pending : pending.slice(0, VISIBLE_BY_DEFAULT)
  const hidden = pending.length - shown.length

  function handleAcknowledge(id: string) {
    setMessage(null)
    // Foco: a la tarjeta vecina; si no queda ninguna, al contenido.
    const index = pending.findIndex((a) => a.id === id)
    const next = pending[index + 1] ?? pending[index - 1]
    acknowledge.mutate(id, {
      onError: (error) => setMessage(ackErrorMessage(error)),
    })
    window.setTimeout(() => {
      const target =
        (next &&
          document.querySelector<HTMLElement>(
            `[data-announcement-id="${next.id}"]`,
          )) ||
        document.querySelector<HTMLElement>('main')
      if (target) {
        if (!target.hasAttribute('tabindex')) target.tabIndex = -1
        target.focus({ preventScroll: true })
      }
    }, 220)
  }

  return (
    <div className="flex flex-col gap-3" data-testid="announcements-banner">
      {message && (
        <Alert variant="warn" role="alert">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {shown.map((announcement) => (
        <AnnouncementCard
          key={announcement.id}
          announcement={announcement}
          onAcknowledge={handleAcknowledge}
          disabled={!online}
        />
      ))}
      {hidden > 0 && (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={() => setExpanded(true)}
        >
          {hidden === 1 ? 'Ver 1 anuncio más' : `Ver ${hidden} anuncios más`}
        </Button>
      )}
    </div>
  )
}
