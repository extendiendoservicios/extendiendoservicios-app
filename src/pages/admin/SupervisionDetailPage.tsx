import { useLocation, useNavigate, useParams } from 'react-router'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { SupervisionDetail } from '@/features/supervisions/components/SupervisionDetail'

const DESKTOP_QUERY = '(min-width: 1024px)'

/**
 * ADM-15 "Supervisión · detalle" (SUP-011): `/admin/supervisiones/:id`,
 * enlazada desde ADM-13 y desde la sección "Supervisiones" de ADM-06. Mismo
 * criterio que `ShiftDetailPage` (`05` sección 7: drawer de 452 px en
 * escritorio, página completa por debajo de 1024 px).
 */
export default function SupervisionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const isDesktop = useMediaQuery(DESKTOP_QUERY)

  if (!id) {
    return null
  }

  // Vuelve a la vista desde la que se abrió (ADM-13 o ADM-06). Si se entró
  // por un enlace directo no hay a dónde volver: va al listado.
  function handleClose() {
    if (location.key === 'default') {
      void navigate('/admin/supervisiones')
    } else {
      void navigate(-1)
    }
  }

  if (isDesktop) {
    return (
      <Sheet open onOpenChange={(open) => !open && handleClose()}>
        <SheetContent side="right" className="gap-0 overflow-y-auto p-6">
          <SheetHeader className="p-0 pb-4">
            <SheetTitle>Detalle de la supervisión</SheetTitle>
          </SheetHeader>
          <SupervisionDetail supervisionId={id} />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <SupervisionDetail supervisionId={id} />
    </div>
  )
}
