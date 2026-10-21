/**
 * Piezas de la hoja imprimible (AJ-06, AJ-09): tabla con encabezado repetido
 * en cada página, bloque de datos clave-valor y espacios de firma.
 */

export interface PrintColumn {
  key: string
  header: string
  align?: 'left' | 'right'
  /**
   * Columna de texto largo (cliente, sede, observaciones, motivo…): puede
   * partir el texto en renglones, siempre por palabras. Sin esta marca la
   * columna es corta (fecha, franja, horas…) y nunca parte su contenido.
   */
  wrap?: boolean
}

export type PrintRowData = Record<string, string> & { key: string }

/**
 * Celda unida de una fila: el valor de la columna `from` ocupa desde `from`
 * hasta `to` (inclusive) y las columnas del medio no se dibujan.
 */
export interface PrintRowSpan {
  from: string
  to: string
}

interface PrintTableProps {
  columns: PrintColumn[]
  rows: PrintRowData[]
  /** Fila de totales al pie: la etiqueta ocupa todas las columnas menos la última, el valor va en la última. */
  footer?: { label: string; value: string }
  /** Filas con celda unida, por `key` de fila. */
  spans?: Record<string, PrintRowSpan>
  /** Texto cuando no hay filas. */
  emptyText: string
}

const cellClass = 'border border-neutral-400 px-1.5 py-1 align-top'
/** Columna corta: nunca se parte (ancho mínimo = el del contenido). */
const shortCellClass = 'whitespace-nowrap'
/** Columna larga: parte por palabras (no a mitad de palabra salvo que no entre una sola). */
const longCellClass = '[overflow-wrap:break-word]'

function columnClass(column: PrintColumn): string {
  return column.wrap ? longCellClass : shortCellClass
}

function PrintTable({
  columns,
  rows,
  footer,
  spans,
  emptyText,
}: PrintTableProps) {
  return (
    <table className="w-full table-auto text-[11px]">
      <thead>
        <tr className="bg-neutral-200">
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={`${cellClass} ${columnClass(column)} font-semibold ${column.align === 'right' ? 'text-right' : 'text-left'}`}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={columns.length}
              className={`${cellClass} text-center text-neutral-700`}
            >
              {emptyText}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.key}>{renderCells(columns, row, spans?.[row.key])}</tr>
          ))
        )}
      </tbody>
      {footer && (
        <tfoot>
          <tr className="bg-neutral-100 font-semibold">
            <td
              colSpan={Math.max(1, columns.length - 1)}
              className={`${cellClass} text-right`}
            >
              {footer.label}
            </td>
            <td
              className={`${cellClass} ${shortCellClass} text-right tabular-nums`}
            >
              {footer.value}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  )
}

function renderCells(
  columns: PrintColumn[],
  row: PrintRowData,
  span: PrintRowSpan | undefined,
) {
  const fromIndex = span ? columns.findIndex((c) => c.key === span.from) : -1
  const toIndex = span ? columns.findIndex((c) => c.key === span.to) : -1
  const merged = fromIndex >= 0 && toIndex > fromIndex
  const cells: React.ReactNode[] = []
  columns.forEach((column, index) => {
    if (merged && index > fromIndex && index <= toIndex) {
      return
    }
    const isMerged = merged && index === fromIndex
    cells.push(
      <td
        key={column.key}
        colSpan={isMerged ? toIndex - fromIndex + 1 : undefined}
        className={`${cellClass} ${isMerged ? longCellClass : columnClass(column)} ${column.align === 'right' ? 'text-right tabular-nums' : ''}`}
      >
        {row[column.key]}
      </td>,
    )
  })
  return cells
}

/** Datos del documento en dos columnas (persona, período, cliente…). */
function PrintFacts({ facts }: { facts: { label: string; value: string }[] }) {
  return (
    <dl className="print-keep-together mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
      {facts.map((fact) => (
        <div key={fact.label} className="flex gap-1.5">
          <dt className="shrink-0 font-semibold">{fact.label}:</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Espacios de firma con aclaración, uno al lado del otro. Los dos juntos no
 * se parten entre páginas.
 */
function PrintSignatures({
  intro,
  signers,
}: {
  intro?: string
  signers: string[]
}) {
  return (
    <section
      data-print-signatures
      className="print-keep-together mt-[calc(2.5rem+var(--sig-push,0px))]"
    >
      {intro && <p className="mb-8 text-[11.5px]">{intro}</p>}
      <div className="grid grid-cols-2 gap-10">
        {signers.map((signer) => (
          <div key={signer} className="text-[11.5px]">
            <div className="h-14 border-b border-black" />
            <p className="mt-1 font-semibold">Firma</p>
            <div className="mt-6 border-b border-black" />
            <p className="mt-1">Aclaración</p>
            <p className="mt-3 font-semibold">{signer}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

export { PrintFacts, PrintSignatures, PrintTable }
