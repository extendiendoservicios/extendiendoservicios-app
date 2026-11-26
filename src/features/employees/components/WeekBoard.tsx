import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreVertical, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { isApiError } from '@/api/errors'
import {
  fetchEmployeeFixedPattern,
  saveEmployeeWeekBoard,
  type WeekBoard,
  type WeekBoardBlock,
} from '@/api/employeeFixed'
import { formatShortDate, formatTime } from '@/lib/format'
import { CLIENT_COLORS } from '@/features/planning/clientColors'
import {
  employeeFixedKeys,
  useEmployeeFixedPatternQuery,
  useEmployeeWeekBoardQuery,
} from '@/features/employees/fixedQueries'
import {
  addBlock,
  type BoardBlockClient,
  blocksFromPattern,
  boardBlockColor,
  clientsByService,
  withoutClientColors,
  blocksOfWeekday,
  BOARD_WEEKDAY_LABELS,
  canAddBlock,
  type ColumnRect,
  duplicateBlock,
  editBoardTime,
  MAX_BOARD_BLOCKS,
  MAX_LABEL_LENGTH,
  moveBlock,
  removeBlock,
  SCREEN_WEEKDAYS,
  updateBlock,
  weekdayAtPoint,
} from '@/features/employees/weekBoard'
import {
  ClientColorConfirmDialog,
  ClientColorSubmenu,
  type ClientColorRequest,
} from '@/features/planning/components/ClientColorChange'
import { blockColors, TimeCell } from './blockParts'
import { DRAG_THRESHOLD_PX } from './UncoveredPanel'

/** Espera antes de guardar tras un cambio: junta varios cambios seguidos en un solo guardado. */
export const BOARD_SAVE_DEBOUNCE_MS = 600

/** Nombre del bloque que se edita tocándolo (Enter confirma, Esc cancela). */
function LabelCell({
  value,
  editable,
  suppressClick,
  onCommit,
}: {
  value: string
  editable: boolean
  suppressClick: () => boolean
  onCommit: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const finished = useRef(false)

  function finish(confirm: boolean) {
    if (finished.current) {
      return
    }
    finished.current = true
    setEditing(false)
    if (confirm && draft !== value) {
      onCommit(draft)
    }
  }

  const className =
    'min-w-0 flex-1 px-0.5 text-center text-[10px] leading-[14px] font-bold line-clamp-2 [overflow-wrap:anywhere]'
  if (editing) {
    return (
      <Input
        ref={(element) => element?.focus()}
        aria-label="Nombre del bloque"
        value={draft}
        maxLength={MAX_LABEL_LENGTH}
        className="h-5 rounded-none px-0.5 py-0 text-[10px]"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(false)
          }
        }}
        onBlur={() => finish(true)}
      />
    )
  }
  const shown = value.trim() === '' ? '(sin nombre)' : value
  if (!editable) {
    return <span className={className}>{shown}</span>
  }
  return (
    <button
      type="button"
      aria-label={`Editar el nombre: ${shown}`}
      title={shown}
      className={`${className} cursor-text hover:underline`}
      onClick={() => {
        if (suppressClick()) {
          return
        }
        finished.current = false
        setDraft(value)
        setEditing(true)
      }}
    >
      {shown}
    </button>
  )
}

interface BoardBlockViewProps {
  block: WeekBoardBlock
  /** D-05: cliente del bloque (por su servicio); `null` = texto libre o servicio que ya no es fijo. */
  client: BoardBlockClient | null
  /** Color con el que se pinta: el del cliente, o el propio si no tiene. */
  colorIndex: number | null
  onColorRequest: (request: ClientColorRequest) => void
  editable: boolean
  dragging: boolean
  canDuplicate: boolean
  onDragMove: (block: WeekBoardBlock, x: number, y: number) => void
  onDragEnd: (block: WeekBoardBlock, x: number, y: number) => void
  onDragCancel: () => void
  onTimeCommit: (
    block: WeekBoardBlock,
    edge: 'start' | 'end',
    value: string,
  ) => void
  onLabelCommit: (block: WeekBoardBlock, value: string) => void
  onDuplicate: (block: WeekBoardBlock) => void
  onColor: (block: WeekBoardBlock, colorIndex: number) => void
  onMoveTo: (block: WeekBoardBlock, weekday: number) => void
  onDelete: (block: WeekBoardBlock) => void
}

/** Un bloque de la pizarra: tres casillas (inicio, fin, nombre) con el color del cliente. */
function BoardBlockView({
  block,
  client,
  colorIndex,
  onColorRequest,
  editable,
  dragging,
  canDuplicate,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onTimeCommit,
  onLabelCommit,
  onDuplicate,
  onColor,
  onMoveTo,
  onDelete,
}: BoardBlockViewProps) {
  const origin = useRef<{ x: number; y: number; active: boolean } | null>(null)
  const justDragged = useRef(false)
  const label = block.label.trim() === '' ? 'sin nombre' : block.label

  return (
    <div
      data-testid="bloque"
      data-block-id={block.id}
      className={`flex flex-col rounded-sm border select-none ${
        editable ? 'cursor-grab' : ''
      } ${dragging ? 'opacity-50' : ''}`}
      style={blockColors(colorIndex)}
      onPointerDown={(event) => {
        // Sin arrastre táctil: en el celular se usa «Mover a» del menú.
        if (
          !editable ||
          event.button !== 0 ||
          event.pointerType === 'touch' ||
          (event.target as HTMLElement).closest('[data-menu]')
        ) {
          return
        }
        justDragged.current = false
        origin.current = { x: event.clientX, y: event.clientY, active: false }
      }}
      onPointerMove={(event) => {
        const state = origin.current
        if (!state) {
          return
        }
        if (
          !state.active &&
          Math.hypot(event.clientX - state.x, event.clientY - state.y) <
            DRAG_THRESHOLD_PX
        ) {
          return
        }
        if (!state.active) {
          state.active = true
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }
        onDragMove(block, event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        const state = origin.current
        origin.current = null
        if (state?.active) {
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          justDragged.current = true
          setTimeout(() => {
            justDragged.current = false
          }, 0)
          onDragEnd(block, event.clientX, event.clientY)
        }
      }}
      onPointerCancel={() => {
        if (origin.current?.active) {
          onDragCancel()
        }
        origin.current = null
      }}
    >
      <div className="grid grid-cols-2 gap-px">
        <TimeCell
          value={block.start}
          label={`Hora de inicio de ${label}`}
          editable={editable}
          suppressClick={() => justDragged.current}
          corner="left"
          onCommit={(value) => onTimeCommit(block, 'start', value)}
        />
        <TimeCell
          value={block.end ?? ''}
          placeholder="A terminar"
          label={`Hora de fin de ${label}`}
          editable={editable}
          suppressClick={() => justDragged.current}
          corner="right"
          onCommit={(value) => onTimeCommit(block, 'end', value)}
        />
      </div>
      <div className="flex items-start border-t border-inherit">
        <LabelCell
          value={block.label}
          editable={editable}
          suppressClick={() => justDragged.current}
          onCommit={(value) => onLabelCommit(block, value)}
        />
        {editable && (
          <span data-menu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Opciones del bloque ${label}`}
                  className="rounded p-0.5 hover:bg-black/10 max-md:min-h-6 max-md:min-w-6"
                >
                  <MoreVertical className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!canDuplicate}
                  onSelect={() => onDuplicate(block)}
                >
                  Duplicar
                </DropdownMenuItem>
                {client ? (
                  <ClientColorSubmenu
                    clientId={client.clientId}
                    clientName={client.clientName}
                    currentIndex={client.calendarColor}
                    onRequest={onColorRequest}
                  />
                ) : (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      Cambiar color
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {CLIENT_COLORS.map((color) => (
                        <DropdownMenuItem
                          key={color.index}
                          onSelect={() => onColor(block, color.index)}
                        >
                          <span
                            aria-hidden
                            className="inline-block size-3 rounded-full"
                            style={{ backgroundColor: color.hex }}
                          />
                          {color.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Mover a</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {SCREEN_WEEKDAYS.filter(
                      (weekday) => weekday !== block.weekday,
                    ).map((weekday) => (
                      <DropdownMenuItem
                        key={weekday}
                        onSelect={() => onMoveTo(block, weekday)}
                      >
                        {BOARD_WEEKDAY_LABELS[weekday]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onDelete(block)}
                >
                  Borrar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Cronograma semanal del empleado, la «pizarra» (OH-07, P30.4b): una tabla
 * chica de lunes a domingo con los mismos bloques de tres casillas que el
 * calendario. Es una referencia de los turnos fijos: se edita libremente y
 * NO toca turnos, asignaciones ni el calendario. La primera vez se arma con el
 * patrón fijo (sin guardar hasta el primer cambio); cada cambio se guarda con
 * `save_employee_week_board` tras una pequeña espera.
 */
function WeekBoardPanel({
  profileId,
  canEdit,
}: {
  profileId: string
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const boardQuery = useEmployeeWeekBoardQuery(profileId, canEdit)
  const saved = boardQuery.data
  // El patrón fijo arma la pizarra la primera vez (sin pizarra guardada) y,
  // siempre, dice a qué cliente pertenece cada bloque con servicio (D-05).
  const patternQuery = useEmployeeFixedPatternQuery(
    profileId,
    canEdit && boardQuery.isSuccess,
  )
  const patternBlocks = useMemo(
    () => (patternQuery.data ? blocksFromPattern(patternQuery.data) : []),
    [patternQuery.data],
  )
  const clients = useMemo(
    () => clientsByService(patternQuery.data ?? []),
    [patternQuery.data],
  )
  const [colorRequest, setColorRequest] = useState<ClientColorRequest | null>(
    null,
  )

  /** Cambios todavía no reflejados por el servidor; `null` = se ve lo guardado (o el patrón). */
  const [draft, setDraft] = useState<WeekBoardBlock[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmReload, setConfirmReload] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [drag, setDrag] = useState<{
    blockId: string
    target: number | null
    x: number
    y: number
  } | null>(null)

  const version = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<WeekBoardBlock[] | null>(null)
  const columnRefs = useRef(new Map<number, HTMLElement>())

  const saveMutation = useMutation({
    mutationFn: (blocks: WeekBoardBlock[]) =>
      saveEmployeeWeekBoard(profileId, blocks),
  })

  async function persist(blocks: WeekBoardBlock[], savedVersion: number) {
    setError(null)
    try {
      // D-05: los bloques con cliente se guardan sin color propio.
      const board: WeekBoard = await saveMutation.mutateAsync(
        withoutClientColors(blocks, clients),
      )
      queryClient.setQueryData(employeeFixedKeys.board(profileId), board)
      // Si no hubo cambios nuevos mientras guardaba, se muestra lo del servidor.
      if (savedVersion === version.current) {
        setDraft(null)
      }
    } catch (caught) {
      setError(
        isApiError(caught) ? caught.message : 'No pudimos guardar los cambios.',
      )
    }
  }

  function flush() {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const blocks = pending.current
    pending.current = null
    if (blocks) {
      void persist(blocks, version.current)
    }
  }

  // Al salir de la pantalla se guarda lo que haya quedado esperando.
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })
  useEffect(
    () => () => {
      flushRef.current()
    },
    [],
  )

  const blocks = draft ?? saved?.blocks ?? patternBlocks

  function commit(next: WeekBoardBlock[], immediate = false) {
    setDraft(next)
    version.current += 1
    pending.current = next
    if (timer.current) {
      clearTimeout(timer.current)
    }
    if (immediate) {
      flush()
      return
    }
    timer.current = setTimeout(flush, BOARD_SAVE_DEBOUNCE_MS)
  }

  function columnRects(): ColumnRect[] {
    const rects: ColumnRect[] = []
    for (const [weekday, element] of columnRefs.current) {
      const rect = element.getBoundingClientRect()
      rects.push({
        weekday,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })
    }
    return rects
  }

  function commitTime(
    block: WeekBoardBlock,
    edge: 'start' | 'end',
    value: string,
  ) {
    const result = editBoardTime(edge, value)
    if (!result.ok) {
      setError(result.message)
      return
    }
    commit(updateBlock(blocks, block.id, result.patch))
  }

  async function reloadFromFixed() {
    setReloading(true)
    setError(null)
    try {
      const rows = await queryClient.fetchQuery({
        queryKey: employeeFixedKeys.pattern(profileId),
        queryFn: () => fetchEmployeeFixedPattern(profileId),
        staleTime: 0,
      })
      commit(blocksFromPattern(rows), true)
      setConfirmReload(false)
    } catch (caught) {
      setError(
        isApiError(caught)
          ? caught.message
          : 'No pudimos leer los turnos fijos.',
      )
    } finally {
      setReloading(false)
    }
  }

  if (boardQuery.isLoading || (saved === null && patternQuery.isLoading)) {
    return <Skeleton className="h-24 w-full" />
  }
  if (boardQuery.isError) {
    return (
      <p role="alert" className="text-[12px] text-danger">
        No pudimos cargar el cronograma semanal.
      </p>
    )
  }

  const saving = saveMutation.isPending
  const fromFixed = draft == null && saved === null
  let status: string
  if (saving) {
    status = 'Guardando…'
  } else if (fromFixed) {
    status = 'Armado desde los fijos (todavía sin guardar)'
  } else if (draft != null) {
    status = 'Cambios sin guardar…'
  } else if (saved?.updatedAt) {
    const who = saved.updatedByName ? ` por ${saved.updatedByName}` : ''
    status = `Editado${who} el ${formatShortDate(saved.updatedAt)}, ${formatTime(saved.updatedAt)}`
  } else {
    status = ''
  }

  const draggedBlock = drag
    ? blocks.find((block) => block.id === drag.blockId)
    : undefined
  const addable = canAddBlock(blocks)

  return (
    <section
      aria-label="Cronograma semanal"
      data-testid="cronograma-semanal"
      className="flex w-full min-w-0 flex-col gap-1.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-semibold text-text">
          Cronograma semanal
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={RotateCcw}
          disabled={reloading || saving}
          onClick={() => setConfirmReload(true)}
        >
          Volver a cargar desde los fijos
        </Button>
      </div>
      <p className="text-[12px] text-text-3">
        Referencia de los turnos fijos. Los cambios no modifican el calendario.
      </p>

      <div className="overflow-x-auto rounded-md border border-border bg-white p-1.5">
        <table className="w-full min-w-[560px] table-fixed lg:min-w-0 border-collapse font-mono text-black">
          <thead>
            <tr>
              {SCREEN_WEEKDAYS.map((weekday) => (
                <th
                  key={weekday}
                  scope="col"
                  className="border border-neutral-700 bg-neutral-800 py-0.5 text-[10px] font-bold text-white"
                >
                  {BOARD_WEEKDAY_LABELS[weekday]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {SCREEN_WEEKDAYS.map((weekday) => {
                const isTarget = drag?.target === weekday
                return (
                  <td
                    key={weekday}
                    ref={(element) => {
                      if (element) {
                        columnRefs.current.set(weekday, element)
                      } else {
                        columnRefs.current.delete(weekday)
                      }
                    }}
                    data-testid={`columna-${weekday}`}
                    data-drop-target={isTarget ? 'true' : undefined}
                    className={`border border-neutral-700 p-0.5 align-top ${
                      isTarget
                        ? 'outline-2 -outline-offset-2 outline-primary'
                        : ''
                    }`}
                  >
                    <div className="flex min-h-10 flex-col gap-1">
                      {blocksOfWeekday(blocks, weekday).map((block) => (
                        <BoardBlockView
                          key={block.id}
                          block={block}
                          client={
                            block.serviceId
                              ? (clients.get(block.serviceId) ?? null)
                              : null
                          }
                          colorIndex={boardBlockColor(block, clients)}
                          onColorRequest={setColorRequest}
                          editable={canEdit}
                          dragging={drag?.blockId === block.id}
                          canDuplicate={addable}
                          onDragMove={(target, x, y) =>
                            setDrag({
                              blockId: target.id,
                              target: weekdayAtPoint(columnRects(), x, y),
                              x,
                              y,
                            })
                          }
                          onDragEnd={(target, x, y) => {
                            const column = weekdayAtPoint(columnRects(), x, y)
                            setDrag(null)
                            if (column != null && column !== target.weekday) {
                              commit(moveBlock(blocks, target.id, column))
                            }
                          }}
                          onDragCancel={() => setDrag(null)}
                          onTimeCommit={commitTime}
                          onLabelCommit={(target, value) =>
                            commit(
                              updateBlock(blocks, target.id, { label: value }),
                            )
                          }
                          onDuplicate={(target) =>
                            commit(duplicateBlock(blocks, target.id))
                          }
                          onColor={(target, colorIndex) =>
                            commit(
                              updateBlock(blocks, target.id, { colorIndex }),
                            )
                          }
                          onMoveTo={(target, day) =>
                            commit(moveBlock(blocks, target.id, day))
                          }
                          onDelete={(target) =>
                            commit(removeBlock(blocks, target.id))
                          }
                        />
                      ))}
                      {canEdit && (
                        <button
                          type="button"
                          disabled={!addable}
                          title={
                            addable
                              ? undefined
                              : `Llegaste al máximo de ${MAX_BOARD_BLOCKS} bloques.`
                          }
                          aria-label={`Agregar un bloque el ${BOARD_WEEKDAY_LABELS[weekday]?.toLowerCase()}`}
                          className="flex items-center justify-center rounded-sm border border-dashed border-neutral-400 py-0.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 max-md:min-h-6"
                          onClick={() => commit(addBlock(blocks, weekday))}
                        >
                          <Plus className="size-3" />
                        </button>
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <p
        aria-live="polite"
        data-testid="cronograma-estado"
        className="min-h-4 text-[11px] text-text-3"
      >
        {status}
      </p>
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}

      {drag && draggedBlock && (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white shadow-lg"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {draggedBlock.label}
          {drag.target != null ? ` → ${BOARD_WEEKDAY_LABELS[drag.target]}` : ''}
        </div>
      )}

      <ClientColorConfirmDialog
        request={colorRequest}
        onClose={() => setColorRequest(null)}
      />

      <Dialog open={confirmReload} onOpenChange={setConfirmReload}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Volver a cargar desde los fijos</DialogTitle>
            <DialogDescription>
              Se reemplaza el cronograma semanal por el que sale de los turnos
              fijos de hoy y se guarda. Los cambios que hiciste en la tabla se
              pierden. El calendario y los turnos no se modifican.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={reloading}
              onClick={() => setConfirmReload(false)}
            >
              Cancelar
            </Button>
            <Button loading={reloading} onClick={() => void reloadFromFixed()}>
              Volver a cargar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export { WeekBoardPanel }
