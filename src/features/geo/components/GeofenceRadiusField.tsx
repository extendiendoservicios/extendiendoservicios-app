import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GEOFENCE_RADIUS_MAX_M, GEOFENCE_RADIUS_MIN_M } from '@/lib/geo'
import { geoErrorMessage } from '../errors'
import {
  useCompanyGeofenceQuery,
  useSetGeofenceRadiusMutation,
} from '../queries'
import { generalRadiusSchema } from '../schemas'

interface GeofenceRadiusFieldProps {
  /** Dueño o administrador: puede editarlo (`set_geofence_radius`). Para el resto, solo lectura. */
  canEdit: boolean
}

/**
 * Radio general de validación (B-02, B-16), junto al mapa de Clientes: de 50 a
 * 1000 m, lo editan el dueño y los administradores. No recalcula fichajes
 * anteriores (B-08). El radio propio de cada sede se edita en su formulario.
 */
function GeofenceRadiusField({ canEdit }: GeofenceRadiusFieldProps) {
  const query = useCompanyGeofenceQuery()
  const setRadius = useSetGeofenceRadiusMutation()
  const saved = query.data?.radiusM
  // `null`: el campo no se tocó y muestra el valor guardado.
  const [draft, setDraft] = useState<string | null>(null)

  const text = draft ?? (saved != null ? String(saved) : '')
  const validation = generalRadiusSchema.safeParse({ radius: text })
  const error =
    draft != null && !validation.success
      ? validation.error.issues[0]?.message
      : undefined
  const isDirty = draft != null && draft.trim() !== String(saved ?? '')

  async function handleSave() {
    if (!validation.success) return
    try {
      await setRadius.mutateAsync(Number(validation.data.radius))
      setDraft(null)
      toast.success('Guardamos el radio general.')
    } catch (err) {
      toast.error(geoErrorMessage(err, 'No pudimos guardar el radio general.'))
    }
  }

  if (!canEdit) {
    return (
      <p className="text-[12.5px] text-text-2">
        Radio general de validación:{' '}
        <span className="font-semibold text-text">
          {saved != null ? `${saved} m` : '—'}
        </span>
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="geofence-general-radius"
          className="text-[13px] font-medium text-text"
        >
          Radio general (m)
        </label>
        <Input
          id="geofence-general-radius"
          type="number"
          inputMode="numeric"
          min={GEOFENCE_RADIUS_MIN_M}
          max={GEOFENCE_RADIUS_MAX_M}
          step={1}
          className="w-24"
          value={text}
          disabled={query.isLoading}
          aria-invalid={Boolean(error)}
          aria-describedby="geofence-general-radius-help"
          onChange={(event) => setDraft(event.target.value)}
        />
        {isDirty && (
          <Button
            size="sm"
            loading={setRadius.isPending}
            disabled={!validation.success}
            onClick={() => void handleSave()}
          >
            Guardar
          </Button>
        )}
      </div>
      <p
        id="geofence-general-radius-help"
        className={
          error ? 'text-[11.5px] text-danger-800' : 'text-[11.5px] text-text-3'
        }
        role={error ? 'alert' : undefined}
      >
        {error ??
          `Entre ${GEOFENCE_RADIUS_MIN_M} y ${GEOFENCE_RADIUS_MAX_M} metros. Vale para las sedes sin radio propio; los fichajes anteriores no se recalculan.`}
      </p>
    </div>
  )
}

export { GeofenceRadiusField }
