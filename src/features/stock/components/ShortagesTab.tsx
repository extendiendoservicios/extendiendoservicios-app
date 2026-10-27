import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { CheckCircle2, MessageSquareWarning } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { isApiError } from '@/api/errors'
import type { ShortageReport } from '@/api/stock'
import { UpdatedAgo } from '@/features/attendance/components/UpdatedAgo'
import {
  useResolveShortageMutation,
  useShortageReportsQuery,
} from '@/features/stock/queries'
import { supplyLabel } from '@/features/stock/filters'
import { describeShortagePlace, formatDateTime } from '@/features/stock/labels'

/** Qué falta: el artículo del catálogo (con presentación) o la descripción libre. */
export function describeShortageTarget(report: ShortageReport): string {
  if (report.supplyName) {
    return supplyLabel({
      name: report.supplyName,
      presentation: report.supplyPresentation,
    })
  }
  return report.description ?? 'Sin descripción'
}

/**
 * Pestaña «Faltantes» de Insumos (IS-29, IS-30): los avisos de empleados y
 * coordinadores, abiertos primero. Cada uno muestra quién avisó, cuándo, qué
 * falta (el artículo o la descripción libre), el turno o la sede y el
 * comentario. «Resolver» pide una nota obligatoria y lo puede hacer cualquier
 * dueño o administrador, tenga o no `manage_stock` (IS-21). Los resueltos
 * muestran quién, cuándo y la nota.
 */
function ShortagesTab() {
  const reportsQuery = useShortageReportsQuery()
  const resolve = useResolveShortageMutation()
  const [resolving, setResolving] = useState<ShortageReport | null>(null)
  const reports = reportsQuery.data ?? []
  const openCount = reports.filter((report) => report.status === 'open').length

  function handleResolve(note: string) {
    if (!resolving) return
    resolve.mutate(
      { reportId: resolving.id, note },
      {
        onSuccess: () => {
          toast.success('El aviso quedó resuelto.')
          setResolving(null)
        },
        onError: (error) => {
          toast.error(
            isApiError(error) ? error.message : 'No pudimos resolver el aviso.',
          )
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-text-2" aria-live="polite">
          {reportsQuery.isLoading
            ? 'Cargando avisos…'
            : openCount === 0
              ? 'No hay avisos abiertos.'
              : openCount === 1
                ? '1 aviso abierto.'
                : `${openCount} avisos abiertos.`}
        </p>
        {reportsQuery.dataUpdatedAt > 0 && (
          <UpdatedAgo dataUpdatedAt={reportsQuery.dataUpdatedAt} />
        )}
      </div>

      {reportsQuery.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={MessageSquareWarning}
          title="Todavía no hay avisos de faltante"
          description="Los avisos que mandan empleados y coordinadores desde el celular aparecen acá."
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Avisos de faltante">
          {reports.map((report) => (
            <ShortageCard
              key={report.id}
              report={report}
              onResolve={() => setResolving(report)}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={resolving != null}
        onOpenChange={(open) => {
          if (!open) setResolving(null)
        }}
        title="Resolver aviso de faltante"
        description={
          resolving
            ? `${describeShortageTarget(resolving)}. Contale a quien avisó qué pasó con una nota breve.`
            : undefined
        }
        reasonLabel="Nota de resolución"
        reasonPlaceholder="Por ejemplo: Se compró, o Hay en el depósito"
        confirmLabel="Resolver"
        isLoading={resolve.isPending}
        onConfirm={handleResolve}
      />
    </div>
  )
}

function ShortageCard({
  report,
  onResolve,
}: {
  report: ShortageReport
  onResolve: () => void
}) {
  const isOpen = report.status === 'open'
  const place = describeShortagePlace(report)
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
      data-testid="shortage-card"
      data-status={report.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-text">
            {report.supplyId && report.supplyName ? (
              <Link
                to={`/admin/insumos/${report.supplyId}`}
                className="hover:text-primary-800 hover:underline"
              >
                {describeShortageTarget(report)}
              </Link>
            ) : (
              <span>{describeShortageTarget(report)}</span>
            )}
            <Badge variant={isOpen ? 'warning' : 'success'}>
              {isOpen ? 'Abierto' : 'Resuelto'}
            </Badge>
            {!report.supplyName && (
              <Badge variant="neutral">No está en el catálogo</Badge>
            )}
          </p>
          <p className="text-[12px] text-text-3">
            Avisó {report.reportedByName ?? 'una persona'} ·{' '}
            {formatDateTime(report.createdAt)}
          </p>
        </div>
        {isOpen && (
          <Button
            variant="ghost"
            size="sm"
            icon={CheckCircle2}
            onClick={onResolve}
            aria-label={`Resolver el aviso de ${describeShortageTarget(report)}`}
          >
            Resolver
          </Button>
        )}
      </div>
      {place && <p className="text-[12.5px] text-text-2">{place}</p>}
      {report.comment && (
        <p className="text-[12.5px] text-text">{report.comment}</p>
      )}
      {!isOpen && (
        <p className="rounded-md bg-success-bg px-3 py-2 text-[12px] text-success-800">
          Resolvió {report.resolvedByName ?? 'la administración'}
          {report.resolvedAt ? ` · ${formatDateTime(report.resolvedAt)}` : ''}
          {report.resolutionNote ? `: ${report.resolutionNote}` : ''}
        </p>
      )}
    </li>
  )
}

export { ShortagesTab }
