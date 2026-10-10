import { useState } from 'react'
import { Megaphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatShortDate } from '@/lib/format'
import type { MyAnnouncement } from '@/api/myAnnouncements'

/**
 * Tarjeta de un anuncio pendiente (AJ2-03): título, texto completo
 * (`whitespace-pre-line`, sin HTML), fecha de publicación corta y el botón
 * "Entendido" (≥ 44 px). Al tocarlo se desvanece y el padre la saca de la lista
 * (actualización optimista).
 */
export function AnnouncementCard({
  announcement,
  onAcknowledge,
  disabled = false,
}: {
  announcement: MyAnnouncement
  onAcknowledge: (id: string) => void
  disabled?: boolean
}) {
  const [leaving, setLeaving] = useState(false)

  return (
    <section
      aria-label={`Anuncio: ${announcement.title}`}
      tabIndex={-1}
      data-announcement-id={announcement.id}
      className={`rounded-xl border border-primary-200 bg-surface p-4 shadow-sm transition-opacity duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring ${leaving ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="flex items-start gap-2">
        <Megaphone
          aria-hidden="true"
          className="mt-[2px] size-4 shrink-0 text-primary-800"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-text">
            {announcement.title}
          </h2>
          <p className="text-[11px] text-text-3">
            {formatShortDate(announcement.createdAt)}
            {announcement.wasEdited && (
              <span className="ml-2 font-semibold text-warning-800">
                Actualizado
              </span>
            )}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[13px] break-words whitespace-pre-line text-text-2">
        {announcement.body}
      </p>
      <Button
        type="button"
        size="mobile"
        className="mt-3 min-h-11"
        disabled={disabled}
        onClick={() => {
          // Desvanece 150 ms y recién después saca la tarjeta (si falla la
          // red, el padre la monta de nuevo y arranca visible).
          setLeaving(true)
          window.setTimeout(() => onAcknowledge(announcement.id), 150)
        }}
      >
        Entendido
      </Button>
    </section>
  )
}
