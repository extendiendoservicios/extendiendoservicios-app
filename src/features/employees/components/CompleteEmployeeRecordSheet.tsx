import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { isApiError } from '@/api/errors'
import { EmployeeRecordFields } from '@/features/employees/components/EmployeeRecordFields'
import {
  useAddEmployeeRecordMutation,
  useSuggestedEmployeeNumberQuery,
} from '@/features/employees/queries'
import {
  employeeRecordSchema,
  employeeRecordValuesToInput,
  type EmployeeRecordFormValues,
} from '@/features/employees/schemas'

const EMPTY_VALUES: EmployeeRecordFormValues = {
  dni: '',
  cuil: '',
  employeeNumber: '',
  address: '',
  birthDate: '',
  hireDate: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelationship: '',
  notes: '',
}

/**
 * P26.8 (CR-18): «Completar ficha laboral» desde el menú «…» de ADM-27. Solo
 * el dueño (la RPC `add_employee_record` lo vuelve a verificar). Crea la fila
 * de `employees` y suma el rol `employee`: la persona pasa a figurar en
 * Empleados.
 */
function CompleteEmployeeRecordSheet({
  profileId,
  fullName,
  open,
  onOpenChange,
}: {
  profileId: string
  fullName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const addRecord = useAddEmployeeRecordMutation()
  const suggestedNumberQuery = useSuggestedEmployeeNumberQuery(open)
  const form = useForm<EmployeeRecordFormValues>({
    resolver: zodResolver(employeeRecordSchema),
    defaultValues: EMPTY_VALUES,
  })
  const {
    handleSubmit,
    reset,
    setValue,
    setError,
    formState: { dirtyFields },
  } = form

  // Legajo sugerido mientras la persona no lo haya tocado.
  useEffect(() => {
    if (suggestedNumberQuery.data != null && !dirtyFields.employeeNumber) {
      setValue('employeeNumber', String(suggestedNumberQuery.data))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedNumberQuery.data])

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      reset(EMPTY_VALUES)
      addRecord.reset()
    }
    onOpenChange(nextOpen)
  }

  async function onSubmit(values: EmployeeRecordFormValues) {
    try {
      await addRecord.mutateAsync({
        profileId,
        input: employeeRecordValuesToInput(values),
      })
      toast.success(`Ya figura en Empleados: ${fullName}.`)
      handleOpenChange(false)
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : 'No pudimos completar la ficha laboral.'
      if (isApiError(error) && error.hint === 'DNI_IN_USE') {
        setError('dni', { message }, { shouldFocus: true })
      } else if (isApiError(error) && error.hint === 'EMPLOYEE_NUMBER_IN_USE') {
        setError('employeeNumber', { message }, { shouldFocus: true })
      }
      toast.error(message)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Completar ficha laboral</SheetTitle>
          <SheetDescription>
            {fullName} va a figurar en Empleados, en las asignaciones y en las
            horas. Cargá los datos reales: el DNI y el legajo no se inventan.
          </SheetDescription>
        </SheetHeader>
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-1 flex-col gap-5 overflow-y-auto px-6"
        >
          <EmployeeRecordFields
            form={form}
            idPrefix="complete-record"
            numberHint="Sugerido según el último cargado; podés cambiarlo."
          />
        </form>
        <SheetFooter className="flex-row justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            loading={addRecord.isPending}
            onClick={(event) => void handleSubmit(onSubmit)(event)}
          >
            Completar ficha
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export { CompleteEmployeeRecordSheet }
