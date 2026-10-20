import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PencilLine, Printer, Undo2, X } from 'lucide-react'
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
 *
 * Ancho fijo: la hoja mide siempre 210 mm (A4) con 15 mm de margen interno,
 * sin importar la ventana ni el contenido. En pantallas angostas el contenedor
 * se desplaza en horizontal (la hoja no se reacomoda). Al imprimir, el ancho
 * pasa a ser el útil de la página (210 mm menos los 15 mm de margen de
 * `@page` a cada lado = los mismos 180 mm de la vista previa).
 *
 * AJ3-03: «Editar texto» vuelve `contentEditable` el contenido de la hoja
 * (menos el membrete, que se marca `contentEditable={false}`) para corregir
 * texto antes de imprimir. Los cambios viven solo en el DOM de esta vista
 * previa: no se guardan. Para que React no pise lo escrito, al empezar a
 * editar se congela el contenido (`frozen`) y los refrescos de datos ya no se
 * reflejan hasta «Deshacer cambios» (que descarta lo editado y re-renderiza
 * con otra `key`). Como todos los imprimibles pasan por `PrintSheet`, la
 * edición vale para todos.
 */
function PrintSheet({ children, onClose, documentTitle }: PrintSheetProps) {
  const [isEditing, setEditing] = useState(false)
  // Contenido congelado desde la primera edición: null = se sigue al original.
  const [frozen, setFrozen] = useState<React.ReactNode | null>(null)
  const [contentKey, setContentKey] = useState(0)

  function toggleEditing() {
    if (!isEditing && frozen === null) {
      setFrozen(children)
    }
    setEditing(!isEditing)
  }

  function undoChanges() {
    setFrozen(isEditing ? children : null)
    setContentKey((key) => key + 1)
  }

  useEffect(() => {
    const previousTitle = document.title
    document.title = documentTitle
    return () => {
      document.title = previousTitle
    }
  }, [documentTitle])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Mientras se edita, Escape no cierra: se perdería lo escrito.
      if (event.key === 'Escape' && !isEditing) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, isEditing])

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
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={isEditing ? 'primary' : 'ghost'}
            icon={PencilLine}
            aria-pressed={isEditing}
            onClick={toggleEditing}
          >
            {isEditing ? 'Terminar edición' : 'Editar texto'}
          </Button>
          {frozen !== null && (
            <Button
              size="sm"
              variant="ghost"
              icon={Undo2}
              onClick={undoChanges}
            >
              Deshacer cambios
            </Button>
          )}
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
      {isEditing && (
        <p
          role="status"
          className="mx-auto w-[210mm] shrink-0 px-4 pt-3 text-[12px] text-text-2 print:hidden"
        >
          Los cambios valen solo para esta impresión: no se guardan en la app.
        </p>
      )}
      <div className="print-sheet mx-auto my-4 box-border w-[210mm] shrink-0 bg-white p-[15mm] text-[12px] text-black shadow-card print:m-0 print:w-auto print:p-0 print:shadow-none">
        <div
          key={contentKey}
          data-testid="print-content"
          contentEditable={isEditing || undefined}
          suppressContentEditableWarning
          spellCheck={isEditing}
          className={
            isEditing
              ? 'rounded-sm bg-warning-bg/40 outline-2 outline-offset-4 outline-primary outline-dashed print:bg-transparent print:outline-none'
              : undefined
          }
        >
          {frozen ?? children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export { PrintSheet }
