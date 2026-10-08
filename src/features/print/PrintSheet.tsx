import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import './print.css'

interface PrintSheetProps {
  /** Contenido de la hoja (membrete, tabla, firmas). */
  children: React.ReactNode
  /** Cierra la vista previa. */
  onClose: () => void
  /**
   * Título del documento mientras la hoja está abierta: es el nombre de
   * archivo que propone el navegador al guardar como PDF.
   */
  documentTitle: string
}

/**
 * Vista previa imprimible (AJ-06, AJ-09): cubre la pantalla con una hoja A4
 * sobre fondo gris y una barra con «Imprimir» (`window.print()`) y «Cerrar».
 * Al imprimir, `print.css` oculta la app y la barra: el navegador imprime solo
 * la hoja (A4, con márgenes) o la guarda como PDF desde su diálogo. Sin
 * librerías de PDF.
 */
function PrintSheet({ children, onClose, documentTitle }: PrintSheetProps) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = documentTitle
    return () => {
      document.title = previousTitle
    }
  }, [documentTitle])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={documentTitle}
      className="print-portal fixed inset-0 z-[100] flex flex-col overflow-auto bg-bg"
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2 print:hidden">
        <p className="text-[13px] font-semibold text-text">
          Vista previa para imprimir
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            icon={Printer}
            onClick={() => {
              window.print()
            }}
          >
            Imprimir o guardar como PDF
          </Button>
          <Button size="sm" variant="ghost" icon={X} onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
      <div className="print-sheet mx-auto my-4 w-full max-w-[210mm] bg-white p-4 text-[12px] text-black shadow-card sm:p-[15mm] print:m-0 print:max-w-none print:p-0 print:shadow-none">
        {children}
      </div>
    </div>,
    document.body,
  )
}

export { PrintSheet }
