import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { WEEKDAY_OPTIONS } from '@/features/services/schemas'
import { WEEKS_OF_MONTH_OPTIONS } from '@/features/services/weeksOfMonth'

/**
 * Regla de repetición compartida (AJ3-05 servicios, AJ3-08 turno repetido):
 * días de la semana y «Se repite» (todas las semanas o solo algunas del
 * mes). Es un componente controlado, sin react-hook-form: cada formulario lo
 * conecta con sus propios `Controller`. `idPrefix` separa los `id` de cada
 * formulario (`service`, `shift`).
 */
export interface RepeatFieldsProps {
  idPrefix: string
  /** `'0'` (domingo) a `'6'` (sábado). */
  weekdays: string[]
  onWeekdaysChange: (next: string[]) => void
  weeksMode: 'all' | 'some'
  onWeeksModeChange: (next: 'all' | 'some') => void
  /** `'1'` a `'5'` (5 = última). */
  weeksOfMonth: string[]
  onWeeksOfMonthChange: (next: string[]) => void
  weekdaysError?: string
  weeksOfMonthError?: string
}

function toggle(current: string[], value: string): string[] {
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]
}

export function RepeatFields({
  idPrefix,
  weekdays,
  onWeekdaysChange,
  weeksMode,
  onWeeksModeChange,
  weeksOfMonth,
  onWeeksOfMonthChange,
  weekdaysError,
  weeksOfMonthError,
}: RepeatFieldsProps) {
  return (
    <>
      <div
        role="group"
        aria-label="Días de la semana"
        className="flex flex-wrap gap-3"
      >
        {WEEKDAY_OPTIONS.map((option) => (
          <label
            key={option.value}
            htmlFor={`${idPrefix}-weekday-${option.value}`}
            className="flex items-center gap-[6px] text-[13px] text-text"
          >
            <Checkbox
              id={`${idPrefix}-weekday-${option.value}`}
              checked={weekdays.includes(option.value)}
              onCheckedChange={() =>
                onWeekdaysChange(toggle(weekdays, option.value))
              }
            />
            {option.label}
          </label>
        ))}
      </div>
      {weekdaysError && (
        <p className="text-[11px] text-danger">{weekdaysError}</p>
      )}

      {/* AJ3-05: repetición mensual. «Todas las semanas» guarda null. */}
      <Field data-invalid={Boolean(weeksOfMonthError) || undefined}>
        <FieldLabel>Se repite</FieldLabel>
        <RadioGroup
          aria-label="Se repite"
          value={weeksMode}
          onValueChange={(value) => onWeeksModeChange(value as 'all' | 'some')}
          className="gap-2"
        >
          <label
            htmlFor={`${idPrefix}-weeks-all`}
            className="flex items-center gap-[6px] text-[13px] text-text"
          >
            <RadioGroupItem id={`${idPrefix}-weeks-all`} value="all" />
            Todas las semanas
          </label>
          <label
            htmlFor={`${idPrefix}-weeks-some`}
            className="flex items-center gap-[6px] text-[13px] text-text"
          >
            <RadioGroupItem id={`${idPrefix}-weeks-some`} value="some" />
            Solo algunas semanas del mes
          </label>
        </RadioGroup>
        {weeksMode === 'some' && (
          <>
            <div
              role="group"
              aria-label="Semanas del mes"
              className="flex flex-wrap gap-3"
            >
              {WEEKS_OF_MONTH_OPTIONS.map((option) => {
                const value = String(option.value)
                return (
                  <label
                    key={value}
                    htmlFor={`${idPrefix}-week-${value}`}
                    className="flex items-center gap-[6px] text-[13px] text-text"
                  >
                    <Checkbox
                      id={`${idPrefix}-week-${value}`}
                      checked={weeksOfMonth.includes(value)}
                      onCheckedChange={() =>
                        onWeeksOfMonthChange(toggle(weeksOfMonth, value))
                      }
                    />
                    {option.label}
                  </label>
                )
              })}
            </div>
            <p className="text-[12px] text-text-3">
              Por ejemplo, lunes + 1.ª y 2.ª = los dos primeros lunes de cada
              mes.
            </p>
          </>
        )}
        {weeksOfMonthError && <FieldError>{weeksOfMonthError}</FieldError>}
      </Field>
    </>
  )
}
