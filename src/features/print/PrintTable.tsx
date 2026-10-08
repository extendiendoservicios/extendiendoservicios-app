/**
 * Piezas de la hoja imprimible (AJ-06, AJ-09): tabla con encabezado repetido
 * en cada página, bloque de datos clave-valor y espacios de firma.
 */

export interface PrintColumn {
  key: string
  header: string
  align?: 'left' | 'right'
}

export type PrintRowData = Record<string, string> & { key: string }

interface PrintTableProps {
  columns: PrintColumn[]
  rows: PrintRowData[]
  /** Fila de totales al pie: la etiqueta ocupa todas las columnas menos la última, el valor va en la última. */
  footer?: { label: string; value: string }
  /** Texto cuando no hay filas. */
  emptyText: string
}

const cellClass = 'border border-neutral-400 px-2 py-1 align-top'

function PrintTable({ columns, rows, footer, emptyText }: PrintTableProps) {
  return (
    <table className="w-full text-[11.5px]">
      <thead>
        <tr className="bg-neutral-200">
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={`${cellClass} font-semibold ${column.align === 'right' ? 'text-right' : 'text-left'}`}
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
            <tr key={row.key}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`${cellClass} ${column.align === 'right' ? 'text-right tabular-nums' : ''}`}
                >
                  {row[column.key]}
                </td>
              ))}
            </tr>
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
            <td className={`${cellClass} text-right tabular-nums`}>
              {footer.value}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  )
}

/** Datos del documento en dos columnas (persona, período, cliente…). */
function PrintFacts({ facts }: { facts: { label: string; value: string }[] }) {
  return (
    <dl className="print-keep-together mb-4 grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.label} className="flex gap-1.5">
          <dt className="font-semibold">{fact.label}:</dt>
          <dd>{fact.value}</dd>
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
    <section className="print-keep-together mt-10">
      {intro && <p className="mb-8 text-[11.5px]">{intro}</p>}
      <div className="grid grid-cols-1 gap-10 sm:grid-cols-2">
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
