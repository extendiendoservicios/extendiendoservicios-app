import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import './calendarPrint.css'

/**
 * «Imprimir calendario» (OD-15), el mismo botón en las tres vistas. Al
 * apretarlo se monta la hoja (`children`: la vista de impresión de lo que hay
 * filtrado en pantalla) en un portal pegado al <body>, se llama a
 * `window.print()` y se desmonta al terminar (`afterprint`). La hoja es A4
 * apaisado por una página con nombre (`calendarPrint.css`).
 *
 * El encabezado dice el título de la vista y qué filtros se aplicaron. El
 * título del documento mientras se imprime es el nombre de archivo que
 * propone el navegador al guardar como PDF.
 */
interface CalendarPrintButtonProps {
  /** Por ejemplo «Calendario · octubre 2026». */
  title: string
  /** Líneas de `describeCalendarFilters`. */
  filterLines: string[]
  children: ReactNode
}

function CalendarPrintButton({
  title,
  filterLines,
  children,
}: CalendarPrintButtonProps) {
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (!printing) {
      return
    }
    const previousTitle = document.title
    document.title = title
    const finish = () => setPrinting(false)
    window.addEventListener('afterprint', finish)
    // Un cuadro después de montar la hoja, para que el navegador la dibuje.
    const frame = window.requestAnimationFrame(() => window.print())
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('afterprint', finish)
      document.title = previousTitle
    }
  }, [printing, title])

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        icon={Printer}
        onClick={() => setPrinting(true)}
      >
        Imprimir calendario
      </Button>
      {printing &&
        createPortal(
          <div className="calendar-print-portal" data-testid="calendar-print">
            <header className="mb-3 border-b border-black pb-2">
              <h1 className="text-[14pt] font-bold">{title}</h1>
              <p className="text-[9pt]" data-testid="calendar-print-filters">
                {filterLines.join(' · ')}
              </p>
            </header>
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}

export { CalendarPrintButton }
