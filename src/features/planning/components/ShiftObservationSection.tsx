import { useState } from 'react'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isApiError } from '@/api/errors'
import { ShiftObservationField } from '@/features/shifts/components/ShiftObservationField'
import { useUpdateShiftDetailsMutation } from '@/features/planning/queries'

interface ShiftObservationSectionProps {
  shiftId: string
  /** Dotación actual: la RPC `update_shift_details` la pide siempre. */
  requiredStaff: number
  notes: string | null
  /** null si el turno no tiene observación (se muestra tildada). */
  showInPrint: boolean | null
}

/**
 * AJ3-06: sección «Observación» del detalle del turno (ADM-06), siempre
 * visible para dueño y administrador. Texto, casilla «Mostrar en la
 * impresión» (tildada por defecto) y «Guardar» ahí mismo, con la misma
 * mutación que la dotación (`update_shift_details`). Si el turno cambia por
 * afuera (refresco de la consulta) y no hay edición sin guardar, se
 * resincroniza con lo del servidor.
 */
function ShiftObservationSection({
  shiftId,
  requiredStaff,
  notes,
  showInPrint,
}: ShiftObservationSectionProps) {
  const updateShiftDetails = useUpdateShiftDetailsMutation()
  const serverText = notes ?? ''
  const serverShow = showInPrint ?? true
  const [text, setText] = useState(serverText)
  const [show, setShow] = useState(serverShow)
  const [synced, setSynced] = useState({ serverText, serverShow })

  if (synced.serverText !== serverText || synced.serverShow !== serverShow) {
    const wasPristine = text === synced.serverText && show === synced.serverShow
    setSynced({ serverText, serverShow })
    if (wasPristine) {
      setText(serverText)
      setShow(serverShow)
    }
  }

  const isDirty = text !== serverText || show !== serverShow

  async function handleSave() {
    try {
      await updateShiftDetails.mutateAsync({
        shiftId,
        requiredStaff,
        notes: text.trim() ? text.trim() : null,
        showInPrint: show,
      })
      toast.success('Guardamos la observación del turno.')
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos guardar la observación del turno.',
      )
    }
  }

  return (
    <section
      aria-label="Observación del turno"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5"
    >
      <ShiftObservationField
        id="shift-detail"
        textareaProps={{
          value: text,
          onChange: (event) => setText(event.target.value),
          placeholder:
            'Escribí una observación para este turno (solo la ve la administración).',
        }}
        showInPrint={show}
        onShowInPrintChange={setShow}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          icon={Save}
          disabled={!isDirty}
          loading={updateShiftDetails.isPending}
          onClick={() => void handleSave()}
        >
          Guardar
        </Button>
      </div>
    </section>
  )
}

export { ShiftObservationSection }
