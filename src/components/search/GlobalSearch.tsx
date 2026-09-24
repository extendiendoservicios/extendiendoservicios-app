import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Search } from 'lucide-react'
import { cn } from 'cn'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { IconButton } from '@/components/IconButton'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  searchResultPath,
  SEARCH_MIN_LENGTH,
  useGlobalSearchResults,
  type SearchResultItem,
} from './useGlobalSearch'

/**
 * `GlobalSearch` (EMP-012, CONFIRMADO por Mike el 24 sep 2026 en P09.0):
 * buscador global de la topbar del `AdminShell`, solo para dueño y
 * administradores — no se monta nunca en `MobileShell` (empleado y
 * supervisor no tienen esta capacidad, `06_API.md` sección 3). Empleados,
 * clientes y sedes en una sola lista agrupada, con navegación por teclado
 * (la aporta `Command`, de `cmdk`), atajo `Ctrl K` (o `Cmd K` en Mac) y
 * `/` para abrir, y `Escape` para cerrar (lo maneja el propio `Dialog` de
 * Radix por debajo de `CommandDialog`).
 *
 * En escritorio (1024 px o más, con sidebar) se ve como un campo de
 * búsqueda de mentira en la topbar que abre el diálogo real al hacer clic
 * — más liviano que un input de verdad ahí (el input real vive adentro del
 * diálogo). Por debajo de 1024 px (tabbar, `AdminShell` responsive) el
 * mismo botón se reduce a una lupa de 34×34, y el diálogo pasa a ocupar
 * toda la pantalla.
 */
export function GlobalSearch() {
  const navigate = useNavigate()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)
  const { status, groups } = useGlobalSearchResults(debouncedQuery)

  // Ctrl K / Cmd K abre y cierra desde cualquier parte de la vía de
  // administración; "/" solo abre, y solo si la persona no está
  // escribiendo en otro campo (un formulario con un campo de texto no
  // puede perder la tecla "/" a manos de este atajo).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isShortcutKey =
        event.key === 'k' && (event.metaKey || event.ctrlKey)
      if (isShortcutKey) {
        event.preventDefault()
        setOpen((current) => !current)
        return
      }
      if (event.key === '/' && !open) {
        const target = event.target as HTMLElement | null
        const isTypingElsewhere =
          target !== null &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        if (!isTypingElsewhere) {
          event.preventDefault()
          setOpen(true)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setQuery('')
    }
  }

  function handleSelect(item: SearchResultItem) {
    handleOpenChange(false)
    void navigate(searchResultPath(item))
  }

  const trimmedLength = query.trim().length
  const hasAnyResult = groups.some((group) => group.items.length > 0)

  return (
    <>
      {isDesktop ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-8 w-[220px] items-center gap-2 rounded-2xl border border-transparent bg-input/50 px-3 text-left text-[12px] text-text-3 outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          <Search aria-hidden="true" className="size-4 shrink-0 opacity-60" />
          <span className="flex-1 truncate">Buscar…</span>
          <kbd className="rounded-lg bg-muted-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold text-text-3">
            Ctrl K
          </kbd>
        </button>
      ) : (
        <IconButton
          icon={Search}
          aria-label="Buscar empleados, clientes o sedes"
          onClick={() => setOpen(true)}
          // Área táctil de 44 px (`07` sección 5) sobre el botón de 34 px:
          // mismo criterio que el menú de usuario de `AdminShell` en este
          // mismo rango de ancho.
          className="relative after:absolute after:-inset-[5px]"
        />
      )}

      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Buscador global"
        description="Buscá empleados, clientes o sedes por nombre, legajo, DNI o dirección."
        className={cn(
          !isDesktop &&
            'top-0 h-dvh max-h-dvh w-full max-w-none translate-y-0 rounded-none',
        )}
      >
        {/* `label` (no `aria-label` del input): `cmdk` lo usa para armar el
            nombre accesible real del campo de búsqueda (con `aria-labelledby`
            hacia una etiqueta propia, que sin esto queda vacía y pisa
            cualquier `aria-label` puesto directo en `CommandInput`). */}
        <Command
          shouldFilter={false}
          label="Buscar empleados, clientes o sedes"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Buscar empleados, clientes o sedes…"
          />
          <CommandList>
            {trimmedLength < SEARCH_MIN_LENGTH ? (
              <CommandEmpty>
                Escribí al menos {SEARCH_MIN_LENGTH} caracteres para buscar.
              </CommandEmpty>
            ) : status === 'loading' ? (
              <p className="py-6 text-center text-[12px] text-text-3">
                Buscando…
              </p>
            ) : status === 'error' ? (
              <p className="py-6 text-center text-[12px] text-text-3">
                No pudimos buscar. Probá de nuevo.
              </p>
            ) : !hasAnyResult ? (
              <CommandEmpty>
                No encontramos resultados para &quot;{query.trim()}&quot;.
              </CommandEmpty>
            ) : (
              groups.map(
                (group) =>
                  group.items.length > 0 && (
                    <CommandGroup key={group.kind} heading={group.label}>
                      {group.items.map((item) => (
                        <CommandItem
                          key={item.id}
                          value={item.id}
                          onSelect={() => handleSelect(item)}
                        >
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate">{item.title}</span>
                            {item.subtitle && (
                              <span className="truncate text-[11px] text-text-3">
                                {item.subtitle}
                              </span>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ),
              )
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
