import { useLocation, useNavigate, useParams } from 'react-router'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { ShiftDetail } from '@/features/planning/components/ShiftDetail'

const DESKTOP_QUERY = '(min-width: 1024px)'

/**
 * ADM-06 "Detalle del turno" (ASSIGN-011, ASSIGN-014): `/admin/turnos/:id`,
 * enlazada desde el calendario mensual, la grilla semanal y la lista del día
 * (`05` sección 5: "ADM-06 (drawer sobre la vista anterior en escritorio;
 * página en móvil)"). `ShiftDetail` (`src/features/planning/components/`)
 * tiene el mismo contenido en las dos variantes; acá solo se decide el
 * envoltorio según el ancho (`07` sección 2.4: drawer de 452 px en
 * escritorio, `05` sección 7: página completa por debajo de 1024 px).
 *
 * En escritorio se llega siempre navegando (no hay un mecanismo de
 * "location de fondo" en `src/app/router.tsx`): al entrar por un enlace
 * directo, el panel se ve igual, con la topbar y la sidebar de `AdminShell`
 * detrás en vez del calendario. Decisión propia, documentada en el reporte
 * del encargo.
 */
export default function ShiftDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const isDesktop = useMediaQuery(DESKTOP_QUERY)

  if (!id) {
    return null
  }

  // Volver a la vista desde la que se abrió (mes, semana o día). Si se
  // entró por un enlace directo no hay a dónde volver (`key` 'default'): va
  // al calendario.
  function handleClose() {
    if (location.key === 'default') {
      void navigate('/admin/planificacion')
    } else {
      void navigate(-1)
    }
  }

  if (isDesktop) {
    return (
      <Sheet open onOpenChange={(open) => !open && handleClose()}>
        <SheetContent side="right" className="gap-0 overflow-y-auto p-6">
          <SheetHeader className="p-0 pb-4">
            <SheetTitle>Detalle del turno</SheetTitle>
          </SheetHeader>
          <ShiftDetail shiftId={id} />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <ShiftDetail shiftId={id} />
    </div>
  )
}
