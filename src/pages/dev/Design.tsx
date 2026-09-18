import * as React from 'react'
import {
  Building2,
  Calendar as CalendarIcon,
  Fingerprint,
  Plus,
  Search,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconButton } from '@/components/IconButton'
import { Fab } from '@/components/Fab'
import { Combobox } from '@/components/Combobox'
import { ToggleRow } from '@/components/ToggleRow'
import { OptionCard } from '@/components/OptionCard'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Stepper } from '@/components/Stepper'
import { WeekdayPicker } from '@/components/WeekdayPicker'
import { TimeInput } from '@/components/TimeInput'
import { DatePicker } from '@/components/DatePicker'
import { MonthPicker } from '@/components/MonthPicker'
import { KpiCard } from '@/components/KpiCard'
import { EmptyState } from '@/components/EmptyState'
import { ProgressBar } from '@/components/ProgressBar'
import { StatusBadge, type StatusBadgeInput } from '@/components/status'

/**
 * `/dev/design` (DS-016, adelanto parcial): vidriera de los componentes de
 * este paquete (DS-003 a DS-007), solo para desarrollo — ver `router.tsx`,
 * que la registra únicamente bajo `import.meta.env.DEV`. P05.5 agrega el
 * resto (DataTable, PersonCell, Alert/Toast/Dialog, Timeline/Tabs/etc.,
 * StarRating, MapPicker/MapView).
 */
function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-border pb-8">
      <h2 className="text-[17px] font-semibold tracking-[-0.25px] text-text">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold text-text-3">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

/** Contenedor de 390 px: así se ven las variantes móviles (encargo P05.2). */
function MobileFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[390px] max-w-full rounded-lg border border-border bg-bg p-4">
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

const STATUS_SHOWCASE: Array<{ domain: string; items: StatusBadgeInput[] }> = [
  {
    domain: 'Turno',
    items: [
      { domain: 'shift', status: 'scheduled' },
      { domain: 'shift', status: 'assigned' },
      { domain: 'shift', status: 'in_progress' },
      { domain: 'shift', status: 'completed' },
      { domain: 'shift', status: 'cancelled' },
      { domain: 'shift', status: 'uncovered' },
      { domain: 'shift', status: 'upcoming' },
    ],
  },
  {
    domain: 'Asignación',
    items: [
      { domain: 'assignment', status: 'expected' },
      { domain: 'assignment', status: 'delay_notified', minutes: 12 },
      { domain: 'assignment', status: 'absence_notified' },
      { domain: 'assignment', status: 'present' },
      { domain: 'assignment', status: 'finished' },
      { domain: 'assignment', status: 'no_record' },
      { domain: 'assignment', status: 'early_leave', minutes: 8 },
    ],
  },
  {
    domain: 'Tarea',
    items: [
      { domain: 'task', status: 'pending' },
      { domain: 'task', status: 'in_progress' },
      { domain: 'task', status: 'done' },
      { domain: 'task', status: 'not_done' },
    ],
  },
  {
    domain: 'Supervisión',
    items: [
      { domain: 'supervision', status: 'assigned' },
      { domain: 'supervision', status: 'in_progress' },
      { domain: 'supervision', status: 'completed' },
      { domain: 'supervision', status: 'not_done' },
      { domain: 'supervision', status: 'cancelled' },
    ],
  },
  {
    domain: 'Empleado',
    items: [
      { domain: 'employee', status: 'active' },
      { domain: 'employee', status: 'on_leave' },
      { domain: 'employee', status: 'terminated' },
    ],
  },
  {
    domain: 'Cliente',
    items: [
      { domain: 'client', status: 'active' },
      { domain: 'client', status: 'suspended' },
      { domain: 'client', status: 'closed' },
    ],
  },
  {
    domain: 'Sede',
    items: [
      { domain: 'site', status: 'active' },
      { domain: 'site', status: 'inactive' },
    ],
  },
  {
    domain: 'Usuario',
    items: [
      { domain: 'user', status: 'activo' },
      { domain: 'user', status: 'desactivado' },
    ],
  },
]

const COMBOBOX_OPTIONS = [
  { value: 'grupo-norte', label: 'Grupo Norte' },
  { value: 'oficinas-delta', label: 'Oficinas Delta' },
  { value: 'clinica-parque', label: 'Clínica del Parque' },
]

const SEGMENTED_OPTIONS = [
  { value: 'today', label: 'Hoy' },
  { value: 'afternoon', label: 'Turno tarde' },
] as const

const MOBILE_SEGMENTED_OPTIONS = [
  { value: 'delay', label: 'Demora' },
  { value: 'absence', label: 'Ausencia', critical: true as const },
] as const

function DesignPage() {
  const [segmentedValue, setSegmentedValue] =
    React.useState<(typeof SEGMENTED_OPTIONS)[number]['value']>('today')
  const [mobileSegmentedValue, setMobileSegmentedValue] =
    React.useState<(typeof MOBILE_SEGMENTED_OPTIONS)[number]['value']>('delay')
  const [stepperValue, setStepperValue] = React.useState(5)
  const [weekdays, setWeekdays] = React.useState<number[]>([1, 3, 5])
  const [comboboxValue, setComboboxValue] = React.useState<string>()
  const [optionValue, setOptionValue] = React.useState('propio')
  const [date, setDate] = React.useState<Date>()
  const [month, setMonth] = React.useState<Date>()

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 bg-bg p-6 text-text">
      <header>
        <h1 className="text-[20px] font-bold text-text">
          /dev/design — Acciones, entradas, selectores, tarjetas y estados
        </h1>
        <p className="mt-1 text-[13px] text-text-3">
          Componentes de DS-003 a DS-007 (P05.2). Solo en desarrollo: esta
          página no se registra en el router de producción.
        </p>
      </header>

      <Section title="Button">
        <Row label="Variantes (tamaño md)">
          <Button variant="primary">Primario</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="dark">Oscuro</Button>
          <Button variant="destructive">Destructivo</Button>
          <Button variant="link">Enlace</Button>
        </Row>
        <Row label="Tamaños">
          <Button size="sm">Chico</Button>
          <Button size="md">Mediano</Button>
        </Row>
        <Row label="Con ícono a la izquierda">
          <Button icon={Plus}>Nuevo turno</Button>
        </Row>
        <Row label="Estados">
          <Button>Normal</Button>
          <Button disabled>Deshabilitado</Button>
          <Button loading>Guardando</Button>
        </Row>
        <Row label="Móvil (390 px, ancho completo)">
          <MobileFrame>
            <Button size="mobile" icon={Fingerprint}>
              Registrar ingreso
            </Button>
            <Button size="mobile" variant="ghost">
              Cancelar
            </Button>
          </MobileFrame>
        </Row>
      </Section>

      <Section title="IconButton y FAB">
        <Row label="IconButton">
          <IconButton icon={Search} aria-label="Buscar" />
          <IconButton icon={Users} aria-label="Ver equipo" disabled />
        </Row>
        <Row label='FAB "Fichar" (46 px, elevado -14 px)'>
          <div className="flex h-[66px] w-[120px] items-center justify-center border-t border-border bg-surface">
            <Fab />
          </div>
        </Row>
      </Section>

      <Section title="Input, Textarea, Select, Combobox">
        <Row label="Input">
          <Input
            placeholder="Buscar empleado, cliente o sede…"
            icon={Search}
            className="w-72"
          />
        </Row>
        <Row label="Input con error">
          <Input
            defaultValue="12345678"
            error="El CUIT tiene que tener 11 dígitos."
            className="w-72"
          />
        </Row>
        <Row label="Input deshabilitado">
          <Input disabled placeholder="No editable" className="w-72" />
        </Row>
        <Row label="Textarea">
          <Textarea placeholder="Observaciones del turno…" className="w-96" />
        </Row>
        <Row label="Select">
          <Select defaultValue="norte">
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Elegí una sede" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="norte">Grupo Norte — San Isidro</SelectItem>
              <SelectItem value="delta">Oficinas Delta</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="Combobox con búsqueda">
          <Combobox
            options={COMBOBOX_OPTIONS}
            value={comboboxValue}
            onValueChange={setComboboxValue}
            placeholder="Elegí un cliente"
            aria-label="Cliente"
            className="w-72"
          />
        </Row>
        <Row label="Móvil (390 px)">
          <MobileFrame>
            <Input mobile placeholder="Buscar…" icon={Search} />
            <Textarea mobile placeholder="Observación del servicio…" />
          </MobileFrame>
        </Row>
      </Section>

      <Section title="Switch, Checkbox, RadioGroup">
        <Row label="Switch">
          <Switch defaultChecked aria-label="Activo" />
          <Switch aria-label="Inactivo" />
          <Switch disabled aria-label="Deshabilitado" />
        </Row>
        <Row label="Fila de toggle">
          <div className="w-96">
            <ToggleRow
              title="Notificar por WhatsApp"
              description="Además de la notificación de la app."
              defaultChecked
            />
            <ToggleRow
              title="Fotos solo para incidencias"
              description="No se piden fotos en cada tarea."
            />
          </div>
        </Row>
        <Row label="Checkbox">
          <div className="flex items-center gap-2">
            <Checkbox id="chk-demo" defaultChecked />
            <Label htmlFor="chk-demo">Obligatoria</Label>
          </div>
        </Row>
        <Row label="RadioGroup">
          <RadioGroup defaultValue="a" className="flex flex-row gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem id="radio-a" value="a" />
              <Label htmlFor="radio-a">Mañana</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="radio-b" value="b" />
              <Label htmlFor="radio-b">Tarde</Label>
            </div>
          </RadioGroup>
        </Row>
        <Row label="OptionCard (dentro de un RadioGroup)">
          <RadioGroup
            value={optionValue}
            onValueChange={setOptionValue}
            className="w-96 gap-2"
          >
            <OptionCard
              value="cliente"
              title="Plantilla del cliente"
              description="Se aplica a todas sus sedes."
            />
            <OptionCard
              value="propio"
              title="Plantilla propia de esta sede"
              description="Reemplaza a la del cliente."
            />
          </RadioGroup>
        </Row>
      </Section>

      <Section title="SegmentedControl, Stepper, WeekdayPicker, TimeInput">
        <Row label="SegmentedControl (escritorio)">
          <SegmentedControl
            options={SEGMENTED_OPTIONS}
            value={segmentedValue}
            onValueChange={setSegmentedValue}
            aria-label="Franja"
          />
        </Row>
        <Row label="SegmentedControl móvil (opción crítica en rojo)">
          <MobileFrame>
            <SegmentedControl
              options={MOBILE_SEGMENTED_OPTIONS}
              value={mobileSegmentedValue}
              onValueChange={setMobileSegmentedValue}
              mobile
              aria-label="Tipo de aviso"
            />
          </MobileFrame>
        </Row>
        <Row label="Stepper (límites 0 y 60)">
          <Stepper
            aria-label="Minutos de demora"
            value={stepperValue}
            onValueChange={setStepperValue}
            min={0}
            max={60}
          />
        </Row>
        <Row label="WeekdayPicker (0 = domingo)">
          <WeekdayPicker value={weekdays} onValueChange={setWeekdays} />
        </Row>
        <Row label="TimeInput">
          <TimeInput defaultValue="08:00" />
        </Row>
      </Section>

      <Section title="DatePicker y MonthPicker">
        <Row label="DatePicker (español, semana desde el lunes)">
          <div className="w-64">
            <DatePicker
              value={date}
              onValueChange={setDate}
              aria-label="Fecha"
            />
          </div>
        </Row>
        <Row label="MonthPicker">
          <div className="w-64">
            <MonthPicker
              value={month}
              onValueChange={setMonth}
              aria-label="Mes"
            />
          </div>
        </Row>
      </Section>

      <Section title="Card">
        <Row label="Default">
          <Card className="w-80">
            <CardHeader>
              <CardTitle>Grupo Norte</CardTitle>
              <IconButton icon={Building2} aria-label="Editar cliente" />
            </CardHeader>
            <CardContent>San Isidro · Av. Centenario 1450</CardContent>
          </Card>
        </Row>
        <Row label="Flush (para embeber una tabla)">
          <Card variant="flush" className="w-80">
            <CardHeader>
              <CardTitle>Servicios de hoy</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="px-4 py-3 text-[12px] text-text-3">
                (acá va una DataTable a ancho completo, P05.3)
              </p>
            </CardContent>
          </Card>
        </Row>
        <Row label="Hero (móvil)">
          <MobileFrame>
            <Card variant="hero">
              <CardContent className="flex flex-col gap-1 pt-4">
                <p className="text-[10.5px] font-semibold tracking-[0.7px] text-text-3 uppercase">
                  Próximo servicio
                </p>
                <p className="text-[16px] font-bold text-text">Grupo Norte</p>
              </CardContent>
            </Card>
          </MobileFrame>
        </Row>
      </Section>

      <Section title="KpiCard, EmptyState, ProgressBar">
        <Row label="KpiCard">
          <KpiCard
            label="Turnos hoy"
            value={24}
            detail="8 clientes · 14 sedes"
            variant="accent"
          />
          <KpiCard
            label="Presentes"
            value={19}
            detail="en servicio ahora"
            variant="ok"
          />
          <KpiCard
            label="Sin fichar"
            value={1}
            detail="supera la tolerancia"
            variant="crit"
          />
          <KpiCard
            label="Ausencias"
            value={1}
            detail="reemplazo pendiente"
            variant="warn"
          />
        </Row>
        <Row label="EmptyState">
          <div className="w-80 rounded-lg border border-border">
            <EmptyState
              icon={CalendarIcon}
              title="Sin turnos hoy"
              description="No hay servicios programados para esta fecha."
            />
          </div>
        </Row>
        <Row label="ProgressBar">
          <div className="flex w-64 flex-col gap-3">
            <ProgressBar value={80} label="Tareas completadas" />
            <ProgressBar value={45} variant="warn" label="Tareas completadas" />
            <ProgressBar value={100} variant="ok" label="Tareas completadas" />
          </div>
        </Row>
      </Section>

      <Section title="StatusBadge">
        <div className="flex flex-col gap-4">
          {STATUS_SHOWCASE.map(({ domain, items }) => (
            <Row key={domain} label={domain}>
              {items.map((item) => (
                <StatusBadge key={`${item.domain}-${item.status}`} {...item} />
              ))}
            </Row>
          ))}
        </div>
      </Section>
    </div>
  )
}

export default DesignPage
