import { useReducer, type KeyboardEvent } from 'react'
import { Delete } from 'lucide-react'
import { cn } from 'cn'
import {
  CALC_INITIAL_STATE,
  calcActionForKey,
  calcReduce,
  type CalcAction,
} from '../calculator'

interface KeyDef {
  label: string
  ariaLabel?: string
  action: CalcAction
  tone?: 'operator' | 'equals' | 'clear'
}

const KEYS: KeyDef[] = [
  {
    label: 'C',
    ariaLabel: 'Borrar todo',
    action: { type: 'clear' },
    tone: 'clear',
  },
  {
    label: '←',
    ariaLabel: 'Borrar el último dígito',
    action: { type: 'backspace' },
    tone: 'clear',
  },
  {
    label: '%',
    ariaLabel: 'Porcentaje',
    action: { type: 'percent' },
    tone: 'operator',
  },
  {
    label: '÷',
    ariaLabel: 'Dividir',
    action: { type: 'operator', operator: '÷' },
    tone: 'operator',
  },
  { label: '7', action: { type: 'digit', digit: '7' } },
  { label: '8', action: { type: 'digit', digit: '8' } },
  { label: '9', action: { type: 'digit', digit: '9' } },
  {
    label: '×',
    ariaLabel: 'Multiplicar',
    action: { type: 'operator', operator: '×' },
    tone: 'operator',
  },
  { label: '4', action: { type: 'digit', digit: '4' } },
  { label: '5', action: { type: 'digit', digit: '5' } },
  { label: '6', action: { type: 'digit', digit: '6' } },
  {
    label: '−',
    ariaLabel: 'Restar',
    action: { type: 'operator', operator: '-' },
    tone: 'operator',
  },
  { label: '1', action: { type: 'digit', digit: '1' } },
  { label: '2', action: { type: 'digit', digit: '2' } },
  { label: '3', action: { type: 'digit', digit: '3' } },
  {
    label: '+',
    ariaLabel: 'Sumar',
    action: { type: 'operator', operator: '+' },
    tone: 'operator',
  },
  { label: '0', action: { type: 'digit', digit: '0' } },
  { label: ',', ariaLabel: 'Coma decimal', action: { type: 'decimal' } },
  {
    label: '=',
    ariaLabel: 'Igual',
    action: { type: 'equals' },
    tone: 'equals',
  },
]

/**
 * Calculadora simple (AG-18): pantalla, dígitos, coma decimal, + − × ÷, %, C,
 * ← y =. También se maneja con el teclado cuando tiene el foco. No guarda
 * nada. La lógica vive en `calculator.ts`.
 */
function AgendaCalculator() {
  const [state, dispatch] = useReducer(calcReduce, CALC_INITIAL_STATE)

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return
    }
    const action = calcActionForKey(event.key)
    if (action) {
      // Enter o espacio sobre un botón ya lo activa el propio botón.
      if (event.target instanceof HTMLButtonElement && event.key === 'Enter') {
        return
      }
      event.preventDefault()
      dispatch(action)
    }
  }

  return (
    <section
      aria-label="Calculadora"
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2.5"
    >
      <h2 className="text-[14px] font-semibold text-text">Calculadora</h2>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- el teclado de la calculadora (AG-18) se maneja con el foco en este grupo */}
      <div
        role="group"
        aria-label="Teclado de la calculadora"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- tiene que poder recibir el foco para leer el teclado
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex flex-col gap-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring"
      >
        <output
          aria-live="polite"
          aria-label="Resultado"
          className={cn(
            'block h-9 truncate rounded-md border border-border bg-bg px-2.5 text-right text-[16px] leading-[34px] font-semibold tabular-nums',
            state.error ? 'text-danger' : 'text-text',
          )}
        >
          {state.display}
        </output>
        <div className="grid grid-cols-4 gap-1">
          {KEYS.map((key) => (
            <button
              key={key.label}
              type="button"
              aria-label={key.ariaLabel}
              onClick={() => dispatch(key.action)}
              className={cn(
                'flex h-8 items-center justify-center rounded-md border border-border-strong text-[13px] font-semibold outline-none hover:bg-bg focus-visible:ring-3 focus-visible:ring-ring max-md:h-9',
                key.tone === 'operator' && 'bg-bg text-primary-800',
                key.tone === 'equals' &&
                  'border-transparent bg-primary text-white hover:bg-primary-700',
                key.tone === 'clear' && 'text-danger',
                key.tone === 'equals' && 'col-span-2',
              )}
            >
              {key.label === '←' ? (
                <Delete aria-hidden="true" className="size-3.5" />
              ) : (
                key.label
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

export { AgendaCalculator }
