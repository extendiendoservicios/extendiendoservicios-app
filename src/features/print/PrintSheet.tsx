import { useEffect, useRef, useState } from 'react'
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
 * se achica con `transform: scale()` hasta entrar entera (el diseño de
 * 210 mm no se reacomoda). Al imprimir no se escala. Al imprimir, el ancho
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
/** Escala de la hoja y tamaño que ocupa en pantalla ya escalada. */
interface SheetFit {
  scale: number
  width: number
  height: number
}

/** Medidas de la hoja A4 en px de CSS (1 mm = 96/25.4 px). */
const MM = 96 / 25.4
const PAGE_HEIGHT = 297 * MM
const PAGE_MARGIN = 15 * MM
const PAGE_USABLE_HEIGHT = PAGE_HEIGHT - 2 * PAGE_MARGIN

interface PageLayout {
  /** Páginas A4 completas que ocupa la hoja. */
  pages: number
  /** Empuje (px) que lleva el bloque de firmas al comienzo de la página siguiente. */
  push: number
}

/**
 * Paginación simulada de la vista previa. La hoja mide siempre un múltiplo de
 * 297 mm. El bloque de firmas no se parte: si cruzaría el fondo útil de su
 * página (297 mm menos los márgenes) se lo empuja al comienzo de la siguiente.
 * Es una aproximación: el navegador es el que decide los cortes al imprimir.
 */
export function computePageLayout(input: {
  /** Alto del contenido sin el empuje. */
  contentHeight: number
  signaturesTop: number | null
  signaturesHeight: number
}): PageLayout {
  let push = 0
  const { signaturesTop: top, signaturesHeight: height } = input
  if (top != null && height > 0 && height <= PAGE_USABLE_HEIGHT) {
    const page = Math.floor(top / PAGE_HEIGHT)
    if (top + height > page * PAGE_HEIGHT + PAGE_USABLE_HEIGHT) {
      push = (page + 1) * PAGE_HEIGHT - top
    }
  }
  const total = input.contentHeight + push + 2 * PAGE_MARGIN
  return { pages: Math.max(1, Math.ceil(total / PAGE_HEIGHT - 0.001)), push }
}

/** Margen mínimo a cada lado de la hoja cuando se achica, en px. */
const SHEET_SIDE_GAP = 8

/**
 * Escala para que la hoja (`sheetWidth` px) entre en `availableWidth`: nunca
 * agranda (máximo 1). Devuelve también el ancho y alto resultantes. Con
 * medidas en cero (sin layout) no escala.
 */
export function computeSheetFit(
  availableWidth: number,
  sheetWidth: number,
  sheetHeight: number,
): SheetFit {
  if (availableWidth <= 0 || sheetWidth <= 0) {
    return { scale: 1, width: 0, height: 0 }
  }
  const scale = Math.min(
    1,
    Math.max(0.1, (availableWidth - SHEET_SIDE_GAP * 2) / sheetWidth),
  )
  return {
    scale,
    width: sheetWidth * scale,
    height: sheetHeight * scale,
  }
}

function PrintSheet({ children, onClose, documentTitle }: PrintSheetProps) {
  const [isEditing, setEditing] = useState(false)
  // Contenido congelado desde la primera edición: null = se sigue al original.
  const [frozen, setFrozen] = useState<React.ReactNode | null>(null)
  const [contentKey, setContentKey] = useState(0)
  const portalRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const pushRef = useRef(0)
  const [fit, setFit] = useState<SheetFit>({ scale: 1, width: 0, height: 0 })
  // Paginación simulada: cantidad de páginas A4 y empuje del bloque de firmas.
  const [layout, setLayout] = useState<PageLayout>({ pages: 1, push: 0 })

  // En pantalla angosta la hoja (210 mm, diseño intacto) se achica para entrar
  // entera en el ancho disponible. Se recalcula al cambiar la ventana o el
  // alto del contenido (al editar o refrescar datos).
  useEffect(() => {
    const portal = portalRef.current
    const sheet = sheetRef.current
    if (!portal || !sheet) {
      return
    }
    function measure() {
      if (!portal || !sheet) {
        return
      }
      const body = bodyRef.current
      if (body) {
        const signatures = body.querySelector<HTMLElement>(
          '[data-print-signatures]',
        )
        const nextLayout = computePageLayout({
          contentHeight: body.offsetHeight - pushRef.current,
          signaturesTop: signatures
            ? signatures.offsetTop - pushRef.current
            : null,
          signaturesHeight: signatures?.offsetHeight ?? 0,
        })
        pushRef.current = nextLayout.push
        setLayout((prev) =>
          prev.pages === nextLayout.pages && prev.push === nextLayout.push
            ? prev
            : nextLayout,
        )
      }
      const next = computeSheetFit(
        portal.clientWidth,
        sheet.offsetWidth,
        sheet.offsetHeight,
      )
      setFit((prev) =>
        prev.scale === next.scale &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
      )
    }
    measure()
    window.addEventListener('resize', measure)
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(portal)
    observer.observe(sheet)
    if (bodyRef.current) {
      observer.observe(bodyRef.current)
    }
    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [])

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
      ref={portalRef}
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
          className="mx-auto box-border w-[210mm] max-w-full shrink-0 px-4 pt-3 text-[12px] text-text-2 print:hidden"
          style={fit.scale < 1 ? { width: fit.width } : undefined}
        >
          Los cambios valen solo para esta impresión: no se guardan en la app.
        </p>
      )}
      <div
        data-testid="print-frame"
        className="print-sheet-frame mx-auto my-4 shrink-0 print:m-0"
        style={
          fit.scale < 1 ? { width: fit.width, height: fit.height } : undefined
        }
      >
        <div
          ref={sheetRef}
          data-testid="print-sheet"
          className="print-sheet box-border w-[210mm] shrink-0 origin-top-left bg-white p-[15mm] text-[12px] text-black shadow-card print:m-0 print:w-auto print:p-0 print:shadow-none"
          style={{
            minHeight: `${layout.pages * 297}mm`,
            ...(fit.scale < 1 ? { transform: `scale(${fit.scale})` } : {}),
          }}
        >
          <div
            ref={bodyRef}
            data-testid="print-body"
            className="relative"
            style={{ '--sig-push': `${layout.push}px` } as React.CSSProperties}
          >
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
        </div>
      </div>
    </div>,
    document.body,
  )
}

export { PrintSheet }
