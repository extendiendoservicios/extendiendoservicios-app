import { Link } from 'react-router'
import { Star } from 'lucide-react'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { PersonCell } from '@/components/PersonCell'
import { StarRating } from '@/components/StarRating'
import { formatDateOnly } from '@/features/settings/dateOnly'
import type { RatingListRow } from '@/api/ratings'
import { useRatingsQuery } from '@/features/supervisions/queries'

/**
 * ADM-17 pestaña "Calificaciones recibidas" (SUP-012, `05` línea 66: "lista,
 * solo admin"). Sin polling: es una pestaña dentro de una ficha, mismo
 * criterio que `EmployeeAttendanceHistoryTab`.
 */
function EmployeeRatingsTab({ profileId }: { profileId: string }) {
  const ratingsQuery = useRatingsQuery({ employeeId: profileId }, false)
  const rows = ratingsQuery.data ?? []

  const columns: DataTableColumnDef<RatingListRow>[] = [
    {
      id: 'date',
      header: 'Fecha',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <Link
          to={`/admin/supervisiones/${row.original.supervisionId}`}
          className="font-semibold text-text capitalize hover:text-primary-800"
        >
          {formatDateOnly(row.original.shiftDate)}
        </Link>
      ),
    },
    {
      id: 'site',
      header: 'Sede',
      meta: { card: 'subtitle' },
      cell: ({ row }) => row.original.siteName,
    },
    {
      id: 'supervisor',
      header: 'Supervisor',
      meta: { card: 'meta', cardLabel: 'Supervisor' },
      cell: ({ row }) => (
        <PersonCell
          id={row.original.supervisorId}
          name={`${row.original.supervisorFirstName} ${row.original.supervisorLastName}`}
        />
      ),
    },
    {
      id: 'score',
      header: 'Puntaje',
      meta: { card: 'meta', cardLabel: 'Puntaje' },
      cell: ({ row }) => (
        <StarRating value={row.original.score} readOnly size="sm" />
      ),
    },
    {
      id: 'comment',
      header: 'Comentario',
      meta: { card: 'meta', cardLabel: 'Comentario' },
      cell: ({ row }) => row.original.comment ?? '—',
    },
  ]

  return (
    <DataTable
      caption="Calificaciones recibidas"
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      isLoading={ratingsQuery.isLoading}
      emptyState={{
        icon: Star,
        title: 'Todavía no hay calificaciones para mostrar',
      }}
    />
  )
}

export { EmployeeRatingsTab }
