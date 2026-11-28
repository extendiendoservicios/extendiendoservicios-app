import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AgendaItem } from '@/api/agenda'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { NEW_SLOTS, NEW_SLOT_NAMES, groupNewBySlot } from '../agendaMonth'
import type { AgendaSuggestions } from '../useAgendaSuggestions'
import { AgendaNewCard } from './AgendaNewCard'

interface AgendaNewSectionProps {
  /** Elementos del mes (se filtran los de tipo «nuevo»). */
  items: AgendaItem[]
  /** Primer día del mes (`YYYY-MM-01`). */
  month: string
  suggestions: AgendaSuggestions
}

/**
 * «Nuevos» (AG-08): siete columnas, cada una con sus bloques apilados y su «+»
 * al pie. En el celular (AG-20) es una sola columna con todos los bloques y un
 * solo «+»: la columna se elige dentro del bloque.
 */
function AgendaNewSection({
  items,
  month,
  suggestions,
}: AgendaNewSectionProps) {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const columns = groupNewBySlot(items)
  // Borradores abiertos: uno por columna como máximo.
  const [drafts, setDrafts] = useState<number[]>([])

  function openDraft(slot: number) {
    setDrafts((current) =>
      current.includes(slot) ? current : [...current, slot],
    )
  }
  function closeDraft(slot: number) {
    setDrafts((current) => current.filter((value) => value !== slot))
  }

  if (isMobile) {
    const all = columns.flat()
    return (
      <section aria-label="Nuevos" className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold text-text">Nuevos</h2>
        {all.map((item) => (
          <AgendaNewCard
            key={item.id}
            item={item}
            slot={item.slot ?? 0}
            month={month}
            suggestions={suggestions}
          />
        ))}
        {drafts.includes(0) && (
          <AgendaNewCard
            item={null}
            slot={0}
            month={month}
            suggestions={suggestions}
            onClose={() => closeDraft(0)}
          />
        )}
        <Button
          type="button"
          variant="ghost"
          icon={Plus}
          onClick={() => openDraft(0)}
        >
          Agregar bloque
        </Button>
      </section>
    )
  }

  return (
    <section aria-label="Nuevos" className="flex flex-col gap-2">
      <h2 className="text-[14px] font-semibold text-text">Nuevos</h2>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: NEW_SLOTS }, (_, slot) => (
          <div
            key={slot}
            className="flex min-w-0 flex-col gap-2"
            role="group"
            aria-label={NEW_SLOT_NAMES[slot]}
          >
            <h3 className="px-2 py-1.5 text-center text-[11px] font-semibold text-text-2">
              {NEW_SLOT_NAMES[slot]}
            </h3>
            {(columns[slot] ?? []).map((item) => (
              <AgendaNewCard
                key={item.id}
                item={item}
                slot={slot}
                month={month}
                suggestions={suggestions}
              />
            ))}
            {drafts.includes(slot) && (
              <AgendaNewCard
                item={null}
                slot={slot}
                month={month}
                suggestions={suggestions}
                onClose={() => closeDraft(slot)}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Plus}
              aria-label={`Agregar bloque en ${NEW_SLOT_NAMES[slot]}`}
              onClick={() => openDraft(slot)}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

export { AgendaNewSection }
