import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import {
  Camera,
  Download,
  Pin,
  PinOff,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { MediaGrid } from '@/components/media'
import { DatePicker } from '@/components/DatePicker'
import { EmptyState } from '@/components/EmptyState'
import { ProgressBar } from '@/components/ProgressBar'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { isApiError } from '@/api/errors'
import {
  createEvidenceSignedUrls,
  ORIGINAL_URL_TTL_SECONDS,
  type ShiftMediaRow,
} from '@/api/mediaAdmin'
import {
  useClientsQuery,
  useClientSitesQuery,
} from '@/features/clients/queries'
import { UpdatedAgo } from '@/features/attendance/components/UpdatedAgo'
import { useEmployeesQuery } from '@/features/employees/queries'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import {
  defaultMediaFilters,
  toApiFilters,
  withClient,
  withStateFilter,
  type MediaFilterState,
  type MediaStateFilter,
} from '@/features/media/filters'
import { extensionOfPath } from '@/api/mediaShared'
import { deleteToast, keepSplit, keepToast } from '@/features/media/bulk'
import {
  describeCounts,
  groupRowsByShift,
  toMediaItem,
} from '@/features/media/items'
import {
  useDeleteShiftMediaMutation,
  useSetMediaKeepManyMutation,
  useShiftMediaListQuery,
  useStorageUsageQuery,
  useThumbUrls,
} from '@/features/media/queries'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { mediaErrorMessage } from '@/lib/media/errors'
import { DeleteMediaDialog } from './DeleteMediaDialog'
import { EvidenceViewerHost } from './EvidenceViewerHost'
import { StorageMeter } from './StorageMeter'

/** Tope de archivos por ZIP: el ZIP se arma en el navegador y vive en memoria. */
export const MAX_ZIP_FILES = 50

/** `"YYYY-MM-DD"` -> `Date` para `DatePicker` (mismo criterio que el resto de las pantallas). */
function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

const STATE_OPTIONS: { value: MediaStateFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'keep', label: 'Conservadas' },
  { value: 'expiring', label: 'Por vencer en 7 días' },
]

const KIND_OPTIONS = [
  { value: 'all', label: 'Fotos y videos' },
  { value: 'photo', label: 'Solo fotos' },
  { value: 'video', label: 'Solo videos' },
] as const

interface ZipProgress {
  done: number
  total: number
}

/**
 * ADM-32 «Fotos y videos» (H-09, `modulos/H_evidencia_fotografica.md` §4):
 * medidor de espacio, filtros, grilla agrupada por turno, visor con
 * «Conservar» y «Descargar», y selección múltiple con «Descargar ZIP».
 *
 * Carga por partes: 48 archivos por página ("Ver más"); las miniaturas se
 * firman de a una página, nunca todas juntas.
 */
function MediaScreen() {
  const today = todayInBuenosAires()
  const [filters, setFilters] = useState<MediaFilterState>(() =>
    defaultMediaFilters(today),
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [zip, setZip] = useState<ZipProgress | null>(null)
  // En el celular los filtros se pliegan; desde 640 px están siempre a la vista.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const zipAbort = useRef<AbortController | null>(null)

  function changeFilters(next: MediaFilterState) {
    setFilters(next)
    // Lo elegido puede quedar fuera de los resultados nuevos.
    setSelectedIds([])
  }

  const usageQuery = useStorageUsageQuery({ poll: true })
  const listQuery = useShiftMediaListQuery(toApiFilters(filters, today))
  const clientsQuery = useClientsQuery({})
  const sitesQuery = useClientSitesQuery(
    filters.clientId === 'all' ? undefined : filters.clientId,
  )
  const peopleQuery = useEmployeesQuery({ status: 'all' })

  const rows = useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [listQuery.data],
  )
  const groups = useMemo(() => groupRowsByShift(rows), [rows])
  const thumbUrls = useThumbUrls(rows)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedRows = rows.filter((row) => selected.has(row.id) && row.hasFile)
  const tooManyForZip = selectedRows.length > MAX_ZIP_FILES
  const keepMany = useSetMediaKeepManyMutation()
  const deleteMany = useDeleteShiftMediaMutation()
  const { toKeep, toRelease } = keepSplit(selectedRows)
  const busy = keepMany.isPending || deleteMany.isPending

  async function handleKeep(keep: boolean) {
    const ids = keep ? toKeep : toRelease
    try {
      const changed = await keepMany.mutateAsync({ ids, keep })
      toast.success(keepToast(changed, keep))
      setSelectedIds([])
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cambiar la marca.',
      )
    }
  }

  async function handleDelete() {
    try {
      const result = await deleteMany.mutateAsync(
        selectedRows.map((row) => row.id),
      )
      toast.success(deleteToast(result))
      if (result.storageFailedCount > 0) {
        toast.info(
          'Algunos archivos tardan en liberar el espacio: se terminan de borrar esta noche.',
        )
      }
      setConfirmDelete(false)
      setSelectedIds([])
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos eliminar los archivos.',
      )
      setConfirmDelete(false)
    }
  }

  async function handleZip() {
    if (selectedRows.length === 0 || tooManyForZip) return
    const controller = new AbortController()
    zipAbort.current = controller
    setZip({ done: 0, total: selectedRows.length })
    try {
      const urls = await createEvidenceSignedUrls(
        selectedRows.map((row) => row.storagePath),
        // Varios archivos tardan: más margen que para abrir uno solo.
        ORIGINAL_URL_TTL_SECONDS * 3,
      )
      const items = selectedRows.flatMap((row) => {
        const url = urls.get(row.storagePath)
        return url
          ? [
              {
                url,
                date: row.shiftDate,
                client: row.clientName,
                site: row.siteName,
                person: row.uploaderName,
                extension: extensionOfPath(row.storagePath),
              },
            ]
          : []
      })
      const { downloadZip } = await import('@/lib/media/download')
      await downloadZip(items, {
        zipName: `fotos-y-videos-${today}`,
        signal: controller.signal,
        onProgress: (done, total) => setZip({ done, total }),
      })
      toast.success(
        items.length === selectedRows.length
          ? 'Listo: se bajó el ZIP.'
          : 'Se bajó el ZIP, pero algunos archivos no estaban disponibles.',
      )
      setSelectedIds([])
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(
          isApiError(error) ? error.message : mediaErrorMessage(error),
        )
      }
    } finally {
      zipAbort.current = null
      setZip(null)
    }
  }

  function toggleGroup(group: { rows: ShiftMediaRow[] }) {
    const ids = group.rows.filter((row) => row.hasFile).map((row) => row.id)
    const all = ids.every((id) => selected.has(id))
    const next = new Set(selected)
    for (const id of ids) {
      if (all) next.delete(id)
      else next.add(id)
    }
    setSelectedIds(Array.from(next))
  }

  const clientOptions = (clientsQuery.data ?? []).map((client) => ({
    id: client.id,
    name: client.tradeName ?? client.legalName,
  }))
  const siteOptions = (sitesQuery.data ?? []).map((site) => ({
    id: site.id,
    name: site.name,
  }))
  const personOptions = (peopleQuery.data ?? []).map((person) => ({
    id: person.profileId,
    name: `${person.firstName} ${person.lastName}`,
  }))

  return (
    <div className="flex flex-col gap-4">
      {usageQuery.isLoading ? (
        <Skeleton className="h-28" />
      ) : usageQuery.data ? (
        <StorageMeter usage={usageQuery.data} />
      ) : (
        <p role="alert" className="text-[12px] text-danger">
          {isApiError(usageQuery.error)
            ? usageQuery.error.message
            : 'No pudimos calcular el espacio usado.'}
        </p>
      )}

      <Button
        variant="ghost"
        size="sm"
        icon={SlidersHorizontal}
        aria-expanded={filtersOpen}
        aria-controls="media-filters"
        className="self-start sm:hidden"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        {filtersOpen ? 'Ocultar filtros' : 'Filtros'}
      </Button>

      <div
        id="media-filters"
        className={`${filtersOpen ? 'grid' : 'hidden'} grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center`}
      >
        <div className="col-span-2 flex flex-col gap-1 sm:col-span-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="text-[11px] font-semibold text-text-2">Desde</span>
          <DatePicker
            aria-label="Desde"
            value={
              filters.dateFrom ? isoDateToDate(filters.dateFrom) : undefined
            }
            onValueChange={(next) =>
              changeFilters({
                ...filters,
                dateFrom: next ? localDateToIsoDate(next) : '',
              })
            }
            className="w-full sm:w-60"
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1 sm:col-span-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="text-[11px] font-semibold text-text-2">Hasta</span>
          <DatePicker
            aria-label="Hasta"
            value={filters.dateTo ? isoDateToDate(filters.dateTo) : undefined}
            onValueChange={(next) =>
              changeFilters({
                ...filters,
                dateTo: next ? localDateToIsoDate(next) : '',
              })
            }
            className="w-full sm:w-60"
          />
        </div>
        <Select
          value={filters.clientId}
          onValueChange={(value) => changeFilters(withClient(filters, value))}
        >
          <SelectTrigger
            aria-label="Filtrar por cliente"
            className="col-span-2 w-full min-w-0 sm:col-span-1 sm:w-52"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los clientes</SelectItem>
            {clientOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.siteId}
          disabled={filters.clientId === 'all'}
          onValueChange={(value) =>
            changeFilters({ ...filters, siteId: value })
          }
        >
          <SelectTrigger
            aria-label="Filtrar por sede"
            className="col-span-2 w-full min-w-0 sm:col-span-1 sm:w-52"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {filters.clientId === 'all'
                ? 'Elegí primero un cliente'
                : 'Todas las sedes'}
            </SelectItem>
            {siteOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.uploadedBy}
          onValueChange={(value) =>
            changeFilters({ ...filters, uploadedBy: value })
          }
        >
          <SelectTrigger
            aria-label="Filtrar por persona"
            className="col-span-2 w-full min-w-0 sm:col-span-1 sm:w-52"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las personas</SelectItem>
            {personOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.kind}
          onValueChange={(value) =>
            changeFilters({
              ...filters,
              kind: value as MediaFilterState['kind'],
            })
          }
        >
          <SelectTrigger
            aria-label="Filtrar por tipo"
            className="col-span-2 w-full min-w-0 sm:col-span-1 sm:w-44"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.state}
          onValueChange={(value) =>
            changeFilters(
              withStateFilter(filters, value as MediaStateFilter, today),
            )
          }
        >
          <SelectTrigger
            aria-label="Filtrar por conservación"
            className="col-span-2 w-full min-w-0 sm:col-span-1 sm:w-52"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="col-span-2 sm:col-span-1">
          <UpdatedAgo dataUpdatedAt={listQuery.dataUpdatedAt} />
        </div>
      </div>

      {selectedRows.length > 0 && (
        <div
          role="region"
          aria-label="Selección"
          className="sticky top-0 z-10 flex flex-col gap-2 rounded-lg border border-primary-200 bg-primary-50 p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-primary-800">
              {selectedRows.length}{' '}
              {selectedRows.length === 1 ? 'seleccionado' : 'seleccionados'}
            </p>
            <div className="flex flex-wrap gap-2">
              {zip ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  onClick={() => zipAbort.current?.abort()}
                >
                  Cancelar
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds([])}
                  >
                    Quitar selección
                  </Button>
                  {toKeep.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Pin}
                      disabled={busy}
                      onClick={() => void handleKeep(true)}
                    >
                      Conservar
                    </Button>
                  )}
                  {toRelease.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={PinOff}
                      disabled={busy}
                      onClick={() => void handleKeep(false)}
                    >
                      Quitar Conservar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    icon={Download}
                    disabled={tooManyForZip || busy}
                    onClick={() => void handleZip()}
                  >
                    Descargar ZIP
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    icon={Trash2}
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Eliminar
                  </Button>
                </>
              )}
            </div>
          </div>
          {tooManyForZip && (
            <p className="text-[12px] text-danger-800">
              Un ZIP admite hasta {MAX_ZIP_FILES} archivos. Sacá algunos de la
              selección y bajá el resto en otro ZIP.
            </p>
          )}
          {zip && (
            <div className="flex flex-col gap-1">
              <ProgressBar
                value={(zip.done / zip.total) * 100}
                label="Progreso del ZIP"
              />
              <p aria-live="polite" className="text-[12px] text-text-2">
                Armando el ZIP: {zip.done} de {zip.total}
              </p>
            </div>
          )}
        </div>
      )}

      {listQuery.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-32" />
        </div>
      ) : listQuery.isError ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {isApiError(listQuery.error)
            ? listQuery.error.message
            : 'No pudimos cargar las fotos y videos.'}
        </p>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Camera}
          title="No hay fotos ni videos con estos filtros"
          description="Probá con otro rango de fechas o sacá algún filtro."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => {
            const available = group.rows.filter((row) => row.hasFile)
            const allSelected =
              available.length > 0 &&
              available.every((row) => selected.has(row.id))
            return (
              <section
                key={group.shiftId}
                aria-label={group.title}
                className="flex flex-col gap-2"
              >
                <header className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-semibold break-words text-text">
                      <Link
                        to={`/admin/turnos/${group.shiftId}`}
                        aria-label={group.title}
                        className="hover:text-primary-800 hover:underline"
                      >
                        {/* Solo la fecha va con la primera letra en mayúscula: el cliente y la sede, como están cargados. */}
                        <span className="capitalize">{group.dateLabel}</span>
                        {group.restLabel ? ` · ${group.restLabel}` : ''}
                      </Link>
                    </h3>
                    <p className="text-[12px] text-text-2">
                      {describeCounts(group.rows)}
                    </p>
                  </div>
                  {available.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group)}
                      className="min-h-11 shrink-0 rounded-md px-2 text-[12.5px] font-semibold text-primary-800 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
                    >
                      {allSelected ? 'Quitar selección' : 'Seleccionar todo'}
                    </button>
                  )}
                </header>
                <MediaGrid
                  items={group.rows.map((row) => toMediaItem(row, thumbUrls))}
                  selectable
                  selectedIds={selectedIds}
                  onSelectedIdsChange={setSelectedIds}
                  onOpen={(item) => setOpenId(item.id)}
                />
              </section>
            )
          })}

          {listQuery.hasNextPage && (
            <Button
              variant="ghost"
              className="self-center"
              loading={listQuery.isFetchingNextPage}
              onClick={() => void listQuery.fetchNextPage()}
            >
              Ver más
            </Button>
          )}
        </div>
      )}

      <DeleteMediaDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        count={selectedRows.length}
        keepCount={selectedRows.filter((row) => row.keep).length}
        isLoading={deleteMany.isPending}
        onConfirm={() => void handleDelete()}
      />

      <EvidenceViewerHost
        rows={rows}
        thumbUrls={thumbUrls}
        openId={openId}
        onOpenIdChange={setOpenId}
      />
    </div>
  )
}

export { MediaScreen }
