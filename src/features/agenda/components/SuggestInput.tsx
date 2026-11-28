import { useId, useMemo, useState } from 'react'
import { cn } from 'cn'
import { Input } from '@/components/ui/input'

/**
 * Entrada libre con sugerencias (AG-07): mientras se tipea, ofrece nombres de
 * clientes, sedes o empleados existentes, pero acepta cualquier texto y no
 * guarda ningún vínculo. Con `multiple`, el campo lleva varios valores
 * separados por coma («Personas») y la sugerencia completa solo el último.
 */
interface SuggestInputProps {
  id?: string
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  multiple?: boolean
  /** Con el campo vacío ofrece todas las opciones (lista cerrada de sugeridos, como «Trabajo»). */
  listAllWhenEmpty?: boolean
  placeholder?: string
  'aria-label'?: string
  maxLength?: number
}

const MAX_SUGGESTIONS = 6

/** El tramo que se está escribiendo (el último, si es de varios valores). */
export function currentToken(value: string, multiple: boolean): string {
  if (!multiple) {
    return value.trim()
  }
  return (value.split(',').pop() ?? '').trim()
}

/** Reemplaza el tramo que se está escribiendo por la sugerencia elegida. */
export function applySuggestion(
  value: string,
  suggestion: string,
  multiple: boolean,
): string {
  if (!multiple) {
    return suggestion
  }
  const parts = value.split(',').map((part) => part.trim())
  parts.pop()
  return [...parts.filter(Boolean), suggestion].join(', ')
}

/** Las sugerencias que contienen lo escrito, sin tildes ni mayúsculas, sin repetir. */
export function filterSuggestions(
  suggestions: string[],
  token: string,
  alreadyChosen: string[] = [],
  listAllWhenEmpty = false,
): string[] {
  const normalize = (text: string) =>
    text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const needle = normalize(token)
  if (needle === '' && !listAllWhenEmpty) {
    return []
  }
  const chosen = new Set(alreadyChosen.map(normalize))
  const seen = new Set<string>()
  const result: string[] = []
  for (const suggestion of suggestions) {
    const key = normalize(suggestion)
    if (
      key.includes(needle) &&
      (key !== needle || needle === '') &&
      !chosen.has(key) &&
      !seen.has(key)
    ) {
      seen.add(key)
      result.push(suggestion)
    }
    if (result.length >= MAX_SUGGESTIONS) {
      break
    }
  }
  return result
}

function SuggestInput({
  id,
  value,
  onChange,
  suggestions,
  multiple = false,
  listAllWhenEmpty = false,
  placeholder,
  'aria-label': ariaLabel,
  maxLength,
}: SuggestInputProps) {
  const generatedId = useId()
  const listId = `${generatedId}-list`
  const [focused, setFocused] = useState(false)

  const options = useMemo(() => {
    const chosen = multiple
      ? value
          .split(',')
          .slice(0, -1)
          .map((part) => part.trim())
      : []
    return filterSuggestions(
      suggestions,
      currentToken(value, multiple),
      chosen,
      listAllWhenEmpty,
    )
  }, [suggestions, value, multiple, listAllWhenEmpty])

  const open = focused && options.length > 0

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        maxLength={maxLength}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-48 overflow-auto rounded-md border border-border bg-surface py-1 shadow-md"
        >
          {options.map((option) => (
            <li
              key={option}
              role="option"
              aria-selected={false}
              // `mousedown` (no `click`) para que el campo no pierda el foco antes de elegir.
              onMouseDown={(event) => {
                event.preventDefault()
                onChange(applySuggestion(value, option, multiple))
              }}
              className={cn(
                'cursor-pointer px-3 py-1.5 text-[12.5px] text-text hover:bg-bg max-md:py-2.5',
              )}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { SuggestInput }
