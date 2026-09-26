import { useState } from 'react'
import { useParams } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { isApiError } from '@/api/errors'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import {
  useMyDayQuery,
  useSetAssignmentNotesMutation,
} from '@/features/employee/queries'

/** `06_API.md` sección 8, `set_assignment_notes`: por encima de esto, `NOTES_TOO_LONG`. */
const MAX_NOTES_LENGTH = 2000

/**
 * EMP-09 · Observaciones (MOB-EMP-010, `05` fila EMP-09, P-062,
 * `set_assignment_notes`): un campo de texto por asignación, con contador y
 * guardado explícito (no autoguardado -- el botón "Guardar" es la única
 * forma de mandar el texto al servidor). Texto vacío o solo espacios se
 * guarda como "sin observación" (lo resuelve el propio servidor, ver el
 * comentario de `setAssignmentNotes` en `src/api/attendance.ts`).
 */
export default function NotesPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const online = useOnlineStatus()
  const { data: myDay, isLoading } = useMyDayQuery()
  const assignment = myDay?.find((a) => a.assignmentId === assignmentId)
  const setNotes = useSetAssignmentNotesMutation()

  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (!assignment) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No encontramos ese servicio. Volvé a Hoy e intentá de nuevo.
        </AlertDescription>
      </Alert>
    )
  }

  // El texto arranca en lo que ya estaba guardado; una vez que la persona
  // empieza a escribir, `text` (no `null`) manda -- así el contador refleja
  // lo que se ve en pantalla, no lo último que vino del servidor.
  const value = text ?? assignment.notes ?? ''
  const isTooLong = value.length > MAX_NOTES_LENGTH
  const disabled = !online || setNotes.isPending

  async function handleSave() {
    setError(null)
    setSaved(false)
    try {
      await setNotes.mutateAsync({
        assignmentId: assignment!.assignmentId,
        notes: value,
      })
      setSaved(true)
    } catch (mutationError) {
      setError(
        isApiError(mutationError)
          ? mutationError.message
          : 'No pudimos guardar la observación. Probá de nuevo.',
      )
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <p className="text-[12.5px] text-text-3">
        Contá cómo fue este servicio: algo para tener en cuenta, un problema que
        encontraste, o lo que te parezca útil dejar registrado.
      </p>

      <Textarea
        mobile
        rows={8}
        value={value}
        onChange={(event) => {
          setText(event.target.value)
          setSaved(false)
        }}
        placeholder="Escribí tu observación (opcional)…"
        disabled={disabled}
        error={isTooLong ? 'La observación es demasiado larga.' : undefined}
      />
      <p className="self-end text-[11px] text-text-3">
        {value.length}/{MAX_NOTES_LENGTH}
      </p>

      {!online && (
        <Alert variant="warn">
          <AlertDescription>
            Estás sin conexión: no podés guardar la observación hasta que
            vuelvas a tener señal.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="crit">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved && !error && (
        <Alert variant="info">
          <AlertDescription>Observación guardada.</AlertDescription>
        </Alert>
      )}

      <Button
        size="mobile"
        onClick={() => void handleSave()}
        loading={setNotes.isPending}
        disabled={disabled || isTooLong}
        className="mt-auto"
      >
        Guardar
      </Button>
    </div>
  )
}
