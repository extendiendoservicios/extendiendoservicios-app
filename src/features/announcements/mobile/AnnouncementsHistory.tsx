import { useState } from 'react'
import { Megaphone } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { formatShortDate } from '@/lib/format'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { ackErrorMessage } from './AnnouncementsBanner'
import {
  useAcknowledgeAnnouncementMutation,
  useMyAnnouncementsQuery,
} from './queries'

/**
 * Historial: todos los anuncios vigentes, leídos y pendientes. Cada uno
 * muestra "Leído el dd/mm" o el botón "Entendido".
 */
export function AnnouncementsHistory() {
  const { data, isLoading, isError } = useMyAnnouncementsQuery()
  const acknowledge = useAcknowledgeAnnouncementMutation()
  const online = useOnlineStatus()
  const [message, setMessage] = useState<string | null>(null)

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !data) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar los anuncios. Probá de nuevo en un momento.
        </AlertDescription>
      </Alert>
    )
  }
  if (data.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No hay anuncios vigentes"
        className="mt-4"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {message && (
        <Alert variant="warn" role="alert">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {data.map((a) => (
        <section
          key={a.id}
          aria-label={`Anuncio: ${a.title}`}
          className="rounded-xl border border-border bg-surface p-4"
        >
          <h2 className="text-[14px] font-semibold text-text">{a.title}</h2>
          <p className="text-[11px] text-text-3">
            {formatShortDate(a.createdAt)}
            {a.wasEdited && (
              <span className="ml-2 font-semibold text-warning-800">
                Actualizado
              </span>
            )}
          </p>
          <p className="mt-2 text-[13px] break-words whitespace-pre-line text-text-2">
            {a.body}
          </p>
          {a.readAt ? (
            <p className="mt-3 text-[12px] font-semibold text-text-3">
              Leído el {formatReadDate(a.readAt)}
            </p>
          ) : (
            <Button
              type="button"
              size="mobile"
              className="mt-3 min-h-11"
              disabled={!online}
              onClick={() => {
                setMessage(null)
                acknowledge.mutate(a.id, {
                  onError: (error) => setMessage(ackErrorMessage(error)),
                })
              }}
            >
              Entendido
            </Button>
          )}
        </section>
      ))}
    </div>
  )
}

/** `dd/mm` en hora de Buenos Aires (en-GB da siempre dos dígitos). */
function formatReadDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(iso))
}
