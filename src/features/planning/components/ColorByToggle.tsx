import { SegmentedControl } from '@/components/SegmentedControl'
import { COLOR_BY_OPTIONS, type ColorBy } from '@/features/planning/colorBy'

interface ColorByToggleProps {
  value: ColorBy
  onValueChange: (value: ColorBy) => void
}

/** «Colorear por: Estado | Cliente», a la derecha de los filtros (P24.8). */
function ColorByToggle({ value, onValueChange }: ColorByToggleProps) {
  return (
    <div className="ml-auto flex items-center gap-2">
      <span className="text-[12px] font-semibold text-text-3">
        Colorear por
      </span>
      <SegmentedControl
        aria-label="Colorear por"
        options={COLOR_BY_OPTIONS}
        value={value}
        onValueChange={onValueChange}
      />
    </div>
  )
}

export { ColorByToggle }
