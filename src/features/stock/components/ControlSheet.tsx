import { Fragment } from 'react'
import { PrintFacts } from '@/features/print/PrintTable'
import { PrintableLetterhead } from '@/features/print/PrintableLetterhead'
import type { StockItem } from '@/api/stock'
import { formatQty } from '@/features/stock/money'

/** Medidas de las columnas en mm; suman 180 mm, el ancho útil de un A4 con 15 mm de margen. */
const COLUMNS = [
  { key: 'code', header: 'Código', width: 20 },
  { key: 'name', header: 'Artículo', width: 42 },
  { key: 'presentation', header: 'Presentación', width: 22 },
  { key: 'system', header: 'Stock del sistema', width: 16 },
  { key: 'counted', header: 'Contado', width: 22 },
  { key: 'tick', header: '✓', width: 10 },
  { key: 'diff', header: '+ / −', width: 16 },
  { key: 'note', header: 'Observación', width: 32 },
] as const

const cellClass = 'border border-neutral-500 px-1.5 align-middle'
const headerCellClass = `${cellClass} bg-neutral-200 py-1 text-left font-semibold`

interface ControlSheetProps {
  items: readonly StockItem[]
  /** Nombre de la categoría si se filtró por una; `null` si son todas. */
  categoryName: string | null
  issuedAt: Date
  /** Fecha de emisión ya formateada («26 de octubre de 2026»). */
  issuedDateLabel: string
}

/**
 * Contenido de la planilla imprimible de control (IS-15, IS-17), para
 * `PrintSheet`. Encabezado con membrete, título, fecha, «Revisó: ____» y la
 * categoría si se filtró. Una fila por artículo con código, artículo,
 * presentación, stock del sistema y espacio para escribir a mano: la cantidad
 * contada, un casillero para tildar, «+ / −» y la observación. Pie con
 * observaciones generales, firma, aclaración y fecha. La tabla repite su
 * encabezado en cada hoja (`print.css`) y cada fila mide 9 mm para escribir.
 */
function ControlSheet({
  items,
  categoryName,
  issuedAt,
  issuedDateLabel,
}: ControlSheetProps) {
  const facts = [
    { label: 'Fecha', value: issuedDateLabel },
    { label: 'Revisó', value: '______________________________' },
    ...(categoryName ? [{ label: 'Categoría', value: categoryName }] : []),
  ]

  return (
    <div data-testid="control-sheet">
      <PrintableLetterhead
        title="Planilla de control de stock"
        issuedAt={issuedAt}
      />
      <PrintFacts facts={facts} />

      <table className="w-full table-fixed border-collapse text-[11px]">
        <colgroup>
          {COLUMNS.map((column) => (
            <col key={column.key} style={{ width: `${column.width}mm` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`${headerCellClass} ${column.key === 'system' ? 'text-right' : ''} ${column.key === 'tick' ? 'text-center' : ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td
                colSpan={COLUMNS.length}
                className={`${cellClass} py-3 text-center text-neutral-700`}
              >
                No hay artículos activos para controlar.
              </td>
            </tr>
          ) : (
            items.map((item, index) => {
              const previous = items[index - 1]
              const startsCategory =
                categoryName === null &&
                (previous === undefined ||
                  previous.categoryId !== item.categoryId)
              return (
                <Fragment key={item.id}>
                  {startsCategory && (
                    <tr data-testid="control-sheet-category">
                      <th
                        scope="colgroup"
                        colSpan={COLUMNS.length}
                        className={`${cellClass} bg-neutral-100 py-0.5 text-left font-semibold`}
                      >
                        {item.categoryName}
                      </th>
                    </tr>
                  )}
                  <tr data-testid="control-sheet-row" className="h-[9mm]">
                    <td className={`${cellClass} font-mono text-[10px]`}>
                      {item.code}
                    </td>
                    <td className={`${cellClass} [overflow-wrap:break-word]`}>
                      {item.name}
                    </td>
                    <td className={`${cellClass} [overflow-wrap:break-word]`}>
                      {item.presentation ?? ''}
                    </td>
                    <td className={`${cellClass} text-right tabular-nums`}>
                      {formatQty(item.stockQty)}
                    </td>
                    <td className={cellClass} />
                    <td className={`${cellClass} text-center`}>
                      <span
                        aria-hidden="true"
                        className="inline-block size-[4mm] border border-black align-middle"
                      />
                    </td>
                    <td className={cellClass} />
                    <td className={cellClass} />
                  </tr>
                </Fragment>
              )
            })
          )}
        </tbody>
      </table>

      <section
        data-print-signatures
        className="print-keep-together mt-[calc(1.5rem+var(--sig-push,0px))]"
      >
        <p className="mb-1 text-[11.5px] font-semibold">
          Observaciones generales
        </p>
        <div className="flex flex-col">
          {[0, 1, 2, 3].map((line) => (
            <div key={line} className="h-[8mm] border-b border-neutral-500" />
          ))}
        </div>
        <div className="mt-6 grid grid-cols-3 gap-8 text-[11.5px]">
          <div>
            <div className="h-12 border-b border-black" />
            <p className="mt-1 font-semibold">Firma</p>
          </div>
          <div>
            <div className="h-12 border-b border-black" />
            <p className="mt-1 font-semibold">Aclaración</p>
          </div>
          <div>
            <div className="h-12 border-b border-black" />
            <p className="mt-1 font-semibold">Fecha</p>
          </div>
        </div>
      </section>
    </div>
  )
}

export { ControlSheet, COLUMNS as CONTROL_SHEET_COLUMNS }
