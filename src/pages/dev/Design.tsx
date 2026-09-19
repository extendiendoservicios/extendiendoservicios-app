import * as React from 'react'
import { toast } from 'sonner'
import {
  Building2,
  Calendar as CalendarIcon,
  Fingerprint,
  Info,
  LogOut,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  TriangleAlert,
  User,
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { ActionBar } from '@/app/shells/ActionBar'
import { StagingBanner } from '@/components/StagingBanner'
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
import { Avatar } from '@/components/Avatar'
import { PersonCell } from '@/components/PersonCell'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Timeline, type TimelineItem } from '@/components/Timeline'
import { TaskList, type TaskListTask } from '@/components/TaskList'
import {
  DataTable,
  type DataTableColumnDef,
  type DataTablePagination,
} from '@/components/DataTable'
import {
  StatusBadge,
  getTableRowVariant,
  type AssignmentStatus,
  type StatusBadgeInput,
} from '@/components/status'

/**
 * `/dev/design` (DS-016): vidriera de todos los componentes de
 * `07_Design_System.md` sección 2 con sus variantes, solo para desarrollo —
 * ver `router.tsx`, que la registra únicamente bajo `import.meta.env.DEV`
 * (no queda en el build de producción, verificado con `pnpm build` + `grep`
 * sobre `dist/`).
 *
 * Quedan afuera a propósito, con sus propias fases (`08_Fases_y_Backlog.md`
 * F5 alcance): `StarRating` (F15, MOB-SUP-001), `MapPicker`/`MapView` (F8,
 * SITE-004/SITE-005), `Calendar` mensual y `WeekGrid` (F11,
 * `src/features/planning`, por el ajuste de `11_Desglose_de_Tareas.md`
 * sección 5). `AdminShell`/`MobileShell` completos no se embeben acá (son
 * layouts de ruta, no piezas del vocabulario visual): se recorren enteros
 * desde `/dev/rol` (DS-015).
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

/**
 * Ejemplo de DataTable (DS-008): "Servicios de hoy" de ADM-02/ADM-10, con
 * estados mezclados — mismos nombres y horarios que D01/D06 del mockup.
 */
interface TodayAssignmentRow {
  id: string
  employeeName: string
  employeeFile: string
  clientName: string
  siteName: string
  schedule: string
  checkIn: string | null
  status: AssignmentStatus
  minutes?: number
}

const TODAY_ASSIGNMENTS: TodayAssignmentRow[] = [
  {
    id: 'maria-gomez',
    employeeName: 'María Gómez',
    employeeFile: 'Legajo 024',
    clientName: 'Grupo Norte',
    siteName: 'San Isidro',
    schedule: '08:00 – 12:00',
    checkIn: '07:58',
    status: 'present',
  },
  {
    id: 'juan-perez',
    employeeName: 'Juan Pérez',
    employeeFile: 'Legajo 011',
    clientName: 'Clínica del Parque',
    siteName: 'Martínez',
    schedule: '08:00 – 13:00',
    checkIn: '08:02',
    status: 'present',
  },
  {
    id: 'lucia-torres',
    employeeName: 'Lucía Torres',
    employeeFile: 'Legajo 007',
    clientName: 'Grupo Norte',
    siteName: 'Martínez',
    schedule: '07:00 – 11:00',
    checkIn: '06:57',
    status: 'early_leave',
    minutes: 18,
  },
  {
    id: 'carlos-medina',
    employeeName: 'Carlos Medina',
    employeeFile: 'Legajo 019',
    clientName: 'Logística Central',
    siteName: 'Munro',
    schedule: '08:00 – 12:00',
    checkIn: null,
    status: 'no_record',
  },
  {
    id: 'valeria-paz',
    employeeName: 'Valeria Paz',
    employeeFile: 'Legajo 015',
    clientName: 'Clínica del Parque',
    siteName: 'Martínez',
    schedule: '06:00 – 10:00',
    checkIn: '05:58',
    status: 'finished',
  },
]

const TODAY_ASSIGNMENTS_COLUMNS: DataTableColumnDef<TodayAssignmentRow>[] = [
  {
    id: 'employee',
    accessorKey: 'employeeName',
    header: 'Empleado',
    cell: ({ row }) => (
      <PersonCell
        id={row.original.id}
        name={row.original.employeeName}
        subtitle={row.original.employeeFile}
        size="compact"
      />
    ),
    meta: { card: 'title' },
  },
  {
    id: 'clientSite',
    accessorKey: 'clientName',
    header: 'Cliente / sede',
    cell: ({ row }) => (
      <div>
        <p className="font-semibold text-text">{row.original.clientName}</p>
        <p className="text-[11px] text-text-3">{row.original.siteName}</p>
      </div>
    ),
    meta: { card: 'meta', cardLabel: 'Cliente / sede' },
  },
  {
    id: 'schedule',
    accessorKey: 'schedule',
    header: 'Horario',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.schedule}</span>
    ),
    meta: { card: 'meta', cardLabel: 'Horario' },
  },
  {
    id: 'checkIn',
    accessorKey: 'checkIn',
    header: 'Ingreso real',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.checkIn ?? '—'}</span>
    ),
    meta: { card: 'meta', cardLabel: 'Ingreso real' },
  },
  {
    id: 'status',
    header: 'Estado',
    cell: ({ row }) => (
      <StatusBadge
        domain="assignment"
        status={row.original.status}
        minutes={row.original.minutes}
      />
    ),
    meta: { card: 'trailing', align: 'end' },
  },
]

/** Timeline de ejemplo (DS-011): historial del turno de Carlos Medina (D01). */
const ASSIGNMENT_TIMELINE: TimelineItem[] = [
  {
    id: 'assigned',
    title: 'Turno asignado',
    description: 'Miér 12 ago · 18:00',
    variant: 'ok',
  },
  {
    id: 'no-record',
    title: 'Sin registro de ingreso',
    description: 'Detectado a las 08:42, 42 min después del inicio',
    variant: 'crit',
  },
  {
    id: 'admin-check-in',
    title: 'Ingreso registrado por la administración',
    description: '09:10',
    variant: 'on',
  },
  {
    id: 'close',
    title: 'Cierre del turno',
    description: 'Pendiente',
  },
]

/** Tareas de ejemplo (DS-012): checklist de M10 (Grupo Norte – San Isidro). */
const INITIAL_TASKS: TaskListTask[] = [
  {
    id: 'sanitarios',
    title: 'Limpiar sanitarios',
    status: 'done',
    completedAt: '2026-08-13T08:24:00-03:00',
  },
  {
    id: 'papel',
    title: 'Reponer papel',
    status: 'done',
    completedAt: '2026-08-13T08:41:00-03:00',
  },
  {
    id: 'residuos',
    title: 'Retirar residuos',
    status: 'done',
    completedAt: '2026-08-13T09:15:00-03:00',
  },
  {
    id: 'oficinas',
    title: 'Aspirar oficinas',
    status: 'done',
    completedAt: '2026-08-13T09:52:00-03:00',
  },
  { id: 'recepcion', title: 'Limpiar recepción', status: 'pending' },
  {
    id: 'cocina',
    title: 'Revisar cocina',
    status: 'pending',
    isRequired: false,
  },
]

/** Seis colores fijos del avatar (DS-009), un id que hashea a cada uno. */
const AVATAR_SHOWCASE = [
  { id: 'emp-4', name: 'Ana López' },
  { id: 'emp-5', name: 'Bruno Díaz' },
  { id: 'emp-0', name: 'Carla Núñez' },
  { id: 'emp-1', name: 'Diego Ríos' },
  { id: 'emp-2', name: 'Elena Paz' },
  { id: 'emp-3', name: 'Franco Vega' },
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
  const [tasks, setTasks] = React.useState<TaskListTask[]>(INITIAL_TASKS)
  const [tablePagination, setTablePagination] =
    React.useState<DataTablePagination>({ pageIndex: 0, pageSize: 5 })
  const [cancelDialogOpen, setCancelDialogOpen] = React.useState(false)

  function handleTaskComplete(id: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? { ...task, status: 'done', completedAt: new Date() }
          : task,
      ),
    )
  }

  function handleTaskNotDone(id: string, reason: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? { ...task, status: 'not_done', notDoneReason: reason }
          : task,
      ),
    )
  }

  function handleTaskUndo(id: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? {
              ...task,
              status: 'pending',
              notDoneReason: undefined,
              completedAt: undefined,
            }
          : task,
      ),
    )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 bg-bg p-6 text-text">
      <header>
        <h1 className="text-[20px] font-bold text-text">
          /dev/design — Design system de Extendiendo Servicios
        </h1>
        <p className="mt-1 text-[13px] text-text-3">
          Todos los componentes de <code>07_Design_System.md</code> sección 2,
          salvo <code>StarRating</code> (F15), <code>MapPicker</code>/
          <code>MapView</code> (F8) y <code>Calendar</code>/
          <code>WeekGrid</code> (F11) — ver la nota al pie. Solo en desarrollo:
          esta página no se registra en el router de producción.
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

      <Section title="IconButton, FAB y DropdownMenu">
        <Row label="IconButton">
          <IconButton icon={Search} aria-label="Buscar" />
          <IconButton icon={Users} aria-label="Ver equipo" disabled />
        </Row>
        <Row label='FAB "Fichar" (46 px, elevado -14 px)'>
          <div className="flex h-[66px] w-[120px] items-center justify-center border-t border-border bg-surface">
            <Fab />
          </div>
        </Row>
        <Row label='DropdownMenu — "más acciones" de una fila'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon={MoreHorizontal} aria-label="Más acciones" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Ver ficha</DropdownMenuItem>
              <DropdownMenuItem>Editar</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                Dar de baja
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>
        <Row label="DropdownMenu — usuario de la sidebar (AdminShell)">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-full p-1 outline-none focus-visible:ring-3 focus-visible:ring-ring">
              <Avatar id="dropdown-user" name="Andrea Ríos" />
              <span className="sr-only">Menú de usuario</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Andrea Ríos</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User /> Mi perfil
              </DropdownMenuItem>
              <DropdownMenuItem>
                <LogOut /> Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <Textarea
            placeholder="Observaciones del turno…"
            className="w-full max-w-96"
          />
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

      <Section title="Field / FormField">
        <p className="text-[11.5px] text-text-3">
          Reemplazo de <code>form</code> (react-hook-form + zod, `07` sección
          2.2): etiqueta 11 px/650/<code>--text-2</code>, ayuda 11 px/
          <code>--text-3</code>. Las grillas <code>row2</code>/<code>row3</code>{' '}
          del mockup son un <code>className</code> de Tailwind (
          <code>grid grid-cols-2</code>/<code>grid-cols-3</code>), no un
          subcomponente propio.
        </p>
        <Row label="Campo con ayuda">
          <Field className="w-72">
            <FieldLabel htmlFor="field-demo-nombre">Nombre completo</FieldLabel>
            <Input id="field-demo-nombre" placeholder="María Gómez" />
            <FieldDescription>Como figura en el documento.</FieldDescription>
          </Field>
        </Row>
        <Row label="Campo con error (FieldError, sin el error propio de Input)">
          <Field data-invalid="true" className="w-72">
            <FieldLabel htmlFor="field-demo-cuit">CUIT</FieldLabel>
            <Input id="field-demo-cuit" defaultValue="12345678" aria-invalid />
            <FieldError>El CUIT tiene que tener 11 dígitos.</FieldError>
          </Field>
        </Row>
        <Row label="row2 — dos columnas">
          <FieldGroup className="grid w-full max-w-xl grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="field-demo-row2-nombre">Nombre</FieldLabel>
              <Input id="field-demo-row2-nombre" placeholder="María" />
            </Field>
            <Field>
              <FieldLabel htmlFor="field-demo-row2-apellido">
                Apellido
              </FieldLabel>
              <Input id="field-demo-row2-apellido" placeholder="Gómez" />
            </Field>
          </FieldGroup>
        </Row>
        <Row label="row3 — tres columnas">
          <FieldGroup className="grid w-full max-w-xl grid-cols-3 gap-3">
            <Field>
              <FieldLabel htmlFor="field-demo-row3-desde">Desde</FieldLabel>
              <Input id="field-demo-row3-desde" defaultValue="08:00" />
            </Field>
            <Field>
              <FieldLabel htmlFor="field-demo-row3-hasta">Hasta</FieldLabel>
              <Input id="field-demo-row3-hasta" defaultValue="12:00" />
            </Field>
            <Field>
              <FieldLabel htmlFor="field-demo-row3-tolerancia">
                Tolerancia (min)
              </FieldLabel>
              <Input id="field-demo-row3-tolerancia" defaultValue="10" />
            </Field>
          </FieldGroup>
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
        <Row label="Flush (para embeber una tabla — ver DataTable más abajo)">
          <Card variant="flush" className="w-full max-w-2xl">
            <CardHeader>
              <CardTitle>Servicios de hoy</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={TODAY_ASSIGNMENTS_COLUMNS}
                data={TODAY_ASSIGNMENTS.slice(0, 3)}
                caption="Servicios de hoy (resumen)"
                compact
                rowVariant={(row) =>
                  getTableRowVariant({ assignmentStatuses: [row.status] })
                }
              />
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
        <Row label="KpiCard (KPIs de ADM-02, 05_Pantallas_y_Navegacion sección 2.1)">
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
            label="Próximos (2 h)"
            value={4}
            detail="inician en las próximas 2 h"
          />
          <KpiCard
            label="Sin registro"
            value={1}
            detail="pasada la hora de inicio"
            variant="crit"
          />
          <KpiCard
            label="Avisos de ausencia y demora"
            value={2}
            detail="hoy"
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

      <Section title="DataTable (DS-008)">
        <p className="text-[11.5px] text-text-3">
          Ordenamiento por columna (clic en un encabezado), paginación por rango
          controlada desde afuera y filas <code>crit</code>/<code>warn</code>{' '}
          según el estado de la asignación (`07` sección 3). Por debajo de 1024
          px esta misma tabla se ve como una lista de tarjetas (
          <code>RowCard</code>) — achicá la ventana para verlo, sin scroll
          horizontal.
        </p>
        <Row label="Asignaciones de hoy (ADM-02/ADM-10), paginada de a 5">
          <div className="w-full max-w-3xl">
            <DataTable
              columns={TODAY_ASSIGNMENTS_COLUMNS}
              data={TODAY_ASSIGNMENTS.slice(
                tablePagination.pageIndex * tablePagination.pageSize,
                tablePagination.pageIndex * tablePagination.pageSize +
                  tablePagination.pageSize,
              )}
              caption="Asignaciones de hoy"
              rowVariant={(row) =>
                getTableRowVariant({ assignmentStatuses: [row.status] })
              }
              pagination={tablePagination}
              onPaginationChange={setTablePagination}
              pageCount={Math.ceil(
                TODAY_ASSIGNMENTS.length / tablePagination.pageSize,
              )}
              rowCount={TODAY_ASSIGNMENTS.length}
            />
          </div>
        </Row>
        <Row label="Estado de carga (Skeleton)">
          <div className="w-full max-w-3xl">
            <DataTable
              columns={TODAY_ASSIGNMENTS_COLUMNS}
              data={[]}
              caption="Cargando asignaciones"
              isLoading
            />
          </div>
        </Row>
        <Row label="Estado vacío (EmptyState)">
          <div className="w-full max-w-3xl">
            <DataTable
              columns={TODAY_ASSIGNMENTS_COLUMNS}
              data={[]}
              caption="Sin asignaciones"
              emptyState={{
                icon: CalendarIcon,
                title: 'No hay servicios hoy',
                description: 'No hay asignaciones programadas para esta fecha.',
              }}
            />
          </div>
        </Row>
      </Section>

      <Section title="Avatar y PersonCell (DS-009)">
        <Row label="Los seis colores fijos (hash determinístico del id)">
          {AVATAR_SHOWCASE.map((person) => (
            <Avatar key={person.id} id={person.id} name={person.name} />
          ))}
        </Row>
        <Row label="Con foto (si falla la carga, cae a las iniciales)">
          <Avatar
            id="con-foto"
            name="Rocío Aguirre"
            src="/no-existe-esta-imagen.jpg"
          />
        </Row>
        <Row label="PersonCell (nombre 600 + subtítulo 11 px)">
          <PersonCell
            id="maria-gomez"
            name="María Gómez"
            subtitle="Legajo 024"
          />
          <PersonCell
            id="carlos-medina"
            name="Carlos Medina"
            subtitle="Logística Central"
          />
        </Row>
      </Section>

      <Section title="Alert, Toast, Dialog de confirmación (DS-010)">
        <Row label="Alert — variantes crit, warn e info">
          <div className="flex w-full max-w-md flex-col gap-2">
            <Alert variant="crit">
              <TriangleAlert aria-hidden="true" />
              <div>
                <AlertTitle>Carlos Medina no registró ingreso</AlertTitle>
                <AlertDescription>
                  Logística Central – Munro · turno 08:00 · Hace 42 minutos
                </AlertDescription>
              </div>
            </Alert>
            <Alert variant="warn">
              <TriangleAlert aria-hidden="true" />
              <div>
                <AlertTitle>Salida anticipada detectada</AlertTitle>
                <AlertDescription>
                  Lucía Torres · registró 10:42, salida prevista 11:00
                </AlertDescription>
              </div>
            </Alert>
            <Alert variant="info">
              <Info aria-hidden="true" />
              <div>
                <AlertTitle>Recordatorio</AlertTitle>
                <AlertDescription>
                  El turno de Diego Fabbri empieza a las 10:00.
                </AlertDescription>
              </div>
            </Alert>
          </div>
        </Row>
        <Row label="Toast (sonner, fijo en modo claro)">
          <Button
            variant="ghost"
            onClick={() =>
              toast.success('Asignación registrada', {
                description: 'María Gómez · Grupo Norte, San Isidro',
              })
            }
          >
            Mostrar éxito
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              toast.error('No se pudo guardar', {
                description: 'Revisá tu conexión e intentá de nuevo.',
              })
            }
          >
            Mostrar error
          </Button>
        </Row>
        <Row label="Dialog de confirmación con motivo obligatorio">
          <Button
            variant="destructive"
            onClick={() => setCancelDialogOpen(true)}
          >
            Cancelar turno
          </Button>
          <ConfirmDialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            title='Cancelar el turno de "Grupo Norte — San Isidro"'
            description="Esta acción no se puede deshacer."
            reasonPlaceholder="Contá por qué se cancela el turno…"
            confirmLabel="Cancelar turno"
            variant="destructive"
            onConfirm={(reason) =>
              toast.success('Turno cancelado', { description: reason })
            }
          />
        </Row>
      </Section>

      <Section title="Timeline, Tabs, Breadcrumb, Tooltip, Skeleton (DS-011)">
        <Row label="Timeline (puntos on, ok y crit)">
          <div className="w-full max-w-sm">
            <Timeline items={ASSIGNMENT_TIMELINE} />
          </div>
        </Row>
        <Row label="Tabs (subrayado teal de 2 px)">
          <Tabs defaultValue="datos" className="w-full max-w-md">
            <TabsList>
              <TabsTrigger value="datos">Datos</TabsTrigger>
              <TabsTrigger value="asistencia">Asistencia</TabsTrigger>
              <TabsTrigger value="calificaciones">Calificaciones</TabsTrigger>
            </TabsList>
            <TabsContent value="datos" className="pt-3 text-[12px] text-text-2">
              Nombre, legajo, roles, contacto de emergencia.
            </TabsContent>
            <TabsContent
              value="asistencia"
              className="pt-3 text-[12px] text-text-2"
            >
              Historial de registros de asistencia (ADM-12).
            </TabsContent>
            <TabsContent
              value="calificaciones"
              className="pt-3 text-[12px] text-text-2"
            >
              Calificaciones recibidas en supervisiones.
            </TabsContent>
          </Tabs>
        </Row>
        <Row label="Breadcrumb">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Clientes y sedes</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Grupo Norte</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>San Isidro</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </Row>
        <Row label="Tooltip (fondo --dark, 11 px)">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton icon={Phone} aria-label="Llamar" />
              </TooltipTrigger>
              <TooltipContent>Llamar al 11 5541-2280</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Row>
        <Row label="Skeleton">
          <div className="flex w-64 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </Row>
      </Section>

      <Section title="TaskList y TaskItem (DS-012)">
        <Row label="Interactiva (Grupo Norte — San Isidro, checklist de M10)">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface px-[14px]">
            <TaskList
              tasks={tasks}
              onComplete={handleTaskComplete}
              onMarkNotDone={handleTaskNotDone}
              onUndo={handleTaskUndo}
            />
          </div>
        </Row>
        <Row label="Solo lectura (supervisor o antes de iniciar el turno)">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface px-[14px]">
            <TaskList tasks={tasks} readOnly />
          </div>
        </Row>
      </Section>

      <Section title="Drawer / Sheet (DS-013/014, 452 px a la derecha)">
        <p className="text-[11.5px] text-text-3">
          Cabecera, cuerpo con scroll y pie con botones a ancho completo (`07`
          sección 2.4). En móvil ({'<'} 768 px) ocupa toda la pantalla — es el
          mismo componente que usa <code>AdminShell</code> para el menú
          &quot;Más&quot; (<code>side=&quot;bottom&quot;</code>, ver
          `/dev/rol`).
        </p>
        <Row label='Drawer de detalle (side="right", 452 px)'>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost">Abrir detalle del turno</Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="data-[side=right]:sm:max-w-[452px]"
            >
              <SheetHeader>
                <SheetTitle>Grupo Norte — San Isidro</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-3 overflow-y-auto px-6 text-[12px] text-text-2">
                <p>Turno de 08:00 a 12:00, jue 13 ago.</p>
                <p>
                  Cuerpo con scroll propio: el contenido largo de un drawer real
                  (asignaciones, tareas, historial) se desplaza acá adentro sin
                  mover la cabecera ni el pie.
                </p>
              </div>
              <SheetFooter className="flex-row">
                <Button variant="ghost" className="flex-1">
                  Cancelar
                </Button>
                <Button variant="primary" className="flex-1">
                  Guardar
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </Row>
      </Section>

      <Section title="ActionBar (DS-014, móvil)">
        <p className="text-[11.5px] text-text-3">
          Franja de botones apilados al pie de una subpágina móvil (M16
          &quot;Volver al servicio&quot; / &quot;Registrar salida&quot;). Hijo
          directo de <code>&lt;main&gt;</code>, se pega a la ventana con
          <code>sticky</code> — acá, al contenedor de 390 px de este ejemplo.
        </p>
        <Row label="Botones apilados con nota debajo">
          <MobileFrame>
            <div className="flex h-40 flex-col">
              <p className="text-[12px] text-text-2">
                Contenido de la subpágina…
              </p>
              <ActionBar note="Se guardarán la hora y la ubicación de salida.">
                <Button size="mobile" variant="primary" icon={Fingerprint}>
                  Registrar salida
                </Button>
                <Button size="mobile" variant="ghost">
                  Volver al servicio
                </Button>
              </ActionBar>
            </div>
          </MobileFrame>
        </Row>
      </Section>

      <Section title="StagingBanner (INFRA-022)">
        <p className="text-[11.5px] text-text-3">
          Franja <code>role=&quot;status&quot;</code> montada una sola vez en{' '}
          <code>RootLayout</code>, visible en los tres shells y en la portada
          solo con <code>VITE_APP_ENV=staging</code> (nunca en{' '}
          <code>production</code> ni en <code>local</code>) — el{' '}
          <code>&lt;StagingBanner /&gt;</code> de acá abajo no se ve en este
          entorno de desarrollo, así que se muestra además una réplica estática
          con el mismo marcado, solo para esta vidriera.
        </p>
        <Row label="Componente real (se ve solo con VITE_APP_ENV=staging)">
          <div className="w-full max-w-md rounded-lg border border-border">
            <StagingBanner />
            <div className="p-3 text-[11.5px] text-text-3">
              (vacío acá: este entorno no es staging)
            </div>
          </div>
        </Row>
        <Row label="Réplica estática (mismo marcado, para verlo sin cambiar de entorno)">
          <div
            role="status"
            className="flex w-full max-w-md items-center justify-center gap-[7px] rounded-lg bg-warning-bg px-4 py-[6px] text-center text-[11px] font-semibold text-warning-800"
          >
            <TriangleAlert
              aria-hidden="true"
              className="size-[13px] shrink-0"
            />
            Entorno de prueba: los datos de esta versión no son reales.
          </div>
        </Row>
      </Section>
    </div>
  )
}

export default DesignPage
