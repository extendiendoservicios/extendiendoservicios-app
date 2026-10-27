import { useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, FieldLabel } from '@/components/ui/field'
import { PrintSheet } from '@/features/print/PrintSheet'
import { formatIssuedAt } from '@/features/print/PrintableLetterhead'
import type { StockItem, SupplyCategory } from '@/api/stock'
import { controlSheetItems } from '@/features/stock/controlSheet'
import { ControlSheet } from './ControlSheet'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'

/** «26 de octubre de 2026» a partir del texto largo de emisión («26 de octubre de 2026, 14:05»). */
function issuedDateOnly(issuedAt: Date): string {
  return formatIssuedAt(issuedAt).split(',')[0] ?? ''
}

/**
 * «Imprimir planilla» (IS-15, IS-17): elegir la categoría (opcional) y abrir
 * la vista previa imprimible. Solo la ve quien tiene `manage_stock`.
 */
function ControlSheetAction({
  items,
  categories,
  defaultCategoryId,
}: {
  items: readonly StockItem[]
  categories: readonly SupplyCategory[]
  /** Categoría que ya está filtrada en la tabla de Stock (`all` si ninguna). */
  defaultCategoryId: string
}) {
  const [chooserOpen, setChooserOpen] = useState(false)
  const [categoryId, setCategoryId] = useState(defaultCategoryId)
  const [sheet, setSheet] = useState<{ categoryId: string; at: Date } | null>(
    null,
  )

  const sheetItems = sheet ? controlSheetItems(items, sheet.categoryId) : []
  const categoryName =
    sheet && sheet.categoryId !== 'all'
      ? (categories.find((category) => category.id === sheet.categoryId)
          ?.name ?? null)
      : null

  return (
    <>
      <Button
        variant="ghost"
        icon={Printer}
        onClick={() => {
          setCategoryId(defaultCategoryId)
          setChooserOpen(true)
        }}
      >
        Imprimir planilla
      </Button>

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Planilla de control</DialogTitle>
            <DialogDescription>
              Se imprimen los artículos activos, con el mismo orden que la tabla
              de Stock. Podés limitarla a una categoría.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>Categoría</FieldLabel>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger aria-label="Categoría de la planilla">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las categorías</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                    {category.active ? '' : ' (desactivada)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChooserOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setSheet({ categoryId, at: new Date() })
                setChooserOpen(false)
              }}
            >
              Ver planilla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {sheet && (
        <PrintSheet
          documentTitle={`Planilla de control de stock ${todayInBuenosAires()}`}
          onClose={() => setSheet(null)}
        >
          <ControlSheet
            items={sheetItems}
            categoryName={categoryName}
            issuedAt={sheet.at}
            issuedDateLabel={issuedDateOnly(sheet.at)}
          />
        </PrintSheet>
      )}
    </>
  )
}

export { ControlSheetAction }
