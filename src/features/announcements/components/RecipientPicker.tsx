import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { rolesText } from '@/features/announcements/helpers'

/** Persona que se puede elegir como destinataria (empleado o supervisor activo). */
export interface RecipientCandidate {
  profileId: string
  name: string
  /** Legajo (el empleado lo tiene; se muestra en la fila). */
  employeeNumber: number | null
  roles: string[]
}

/** Texto sin tildes ni mayúsculas, para buscar. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** Filtra por nombre o legajo. */
export function filterCandidates(
  candidates: RecipientCandidate[],
  search: string,
): RecipientCandidate[] {
  const text = normalize(search.trim())
  if (text === '') {
    return candidates
  }
  return candidates.filter(
    (candidate) =>
      normalize(candidate.name).includes(text) ||
      (candidate.employeeNumber !== null &&
        String(candidate.employeeNumber) === text),
  )
}

interface RecipientPickerProps {
  candidates: RecipientCandidate[]
  value: string[]
  onValueChange: (next: string[]) => void
  loading?: boolean
}

/**
 * Lista con casillas y búsqueda para «Elegir personas». «Seleccionar todos» y
 * «Ninguno» actúan sobre lo filtrado, sin tocar lo ya elegido que quedó fuera
 * del filtro.
 */
export function RecipientPicker({
  candidates,
  value,
  onValueChange,
  loading = false,
}: RecipientPickerProps) {
  const [search, setSearch] = useState('')
  const visible = useMemo(
    () => filterCandidates(candidates, search),
    [candidates, search],
  )
  const selected = useMemo(() => new Set(value), [value])

  function toggle(profileId: string) {
    onValueChange(
      selected.has(profileId)
        ? value.filter((id) => id !== profileId)
        : [...value, profileId],
    )
  }

  function selectVisible() {
    const next = new Set(value)
    for (const candidate of visible) {
      next.add(candidate.profileId)
    }
    onValueChange([...next])
  }

  function clearVisible() {
    const hidden = new Set(visible.map((candidate) => candidate.profileId))
    onValueChange(value.filter((id) => !hidden.has(id)))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-3"
        />
        <Input
          aria-label="Buscar personas por nombre o legajo"
          placeholder="Buscar por nombre o legajo"
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-text-3">
          {value.length === 1
            ? '1 persona elegida'
            : `${value.length} personas elegidas`}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={selectVisible}
            disabled={visible.length === 0}
          >
            Seleccionar todos
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearVisible}
            disabled={visible.length === 0}
          >
            Seleccionar ninguno
          </Button>
        </div>
      </div>

      <ul
        aria-label="Personas"
        className="max-h-80 overflow-y-auto rounded-md border border-border"
      >
        {loading && (
          <li className="px-3 py-4 text-[12.5px] text-text-3">
            Cargando personas…
          </li>
        )}
        {!loading && visible.length === 0 && (
          <li className="px-3 py-4 text-[12.5px] text-text-3">
            No encontramos personas con ese criterio.
          </li>
        )}
        {visible.map((candidate) => {
          const inputId = `recipient-${candidate.profileId}`
          return (
            <li
              key={candidate.profileId}
              className="border-b border-border last:border-b-0"
            >
              <label
                htmlFor={inputId}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-bg"
              >
                <Checkbox
                  id={inputId}
                  checked={selected.has(candidate.profileId)}
                  onCheckedChange={() => toggle(candidate.profileId)}
                />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">
                  {candidate.name}
                </span>
                <span className="shrink-0 text-[11px] text-text-3">
                  {candidate.employeeNumber !== null
                    ? `Legajo ${candidate.employeeNumber} · `
                    : ''}
                  {rolesText(candidate.roles)}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
