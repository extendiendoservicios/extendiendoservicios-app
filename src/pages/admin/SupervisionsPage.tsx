import { useSearchParams } from 'react-router'
import {
  SupervisionsAdminScreen,
  type SupervisionsAdminTab,
} from '@/features/supervisions/components/SupervisionsAdminScreen'

/**
 * `/admin/supervisiones` (ADM-13 "Supervisiones · listado", SUP-010, `05`
 * línea 57): pestaña por `?pestana=calificaciones` o `?pestana=jornadas` (`05` sección 5, OD-05), igual
 * criterio que `EmployeeDetailPage` para `?pestana=`.
 */
export default function SupervisionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const pestana = searchParams.get('pestana')
  const tab: SupervisionsAdminTab =
    pestana === 'calificaciones' || pestana === 'jornadas'
      ? pestana
      : 'supervisiones'

  function handleTabChange(next: SupervisionsAdminTab) {
    const params = new URLSearchParams(searchParams)
    if (next === 'supervisiones') {
      params.delete('pestana')
    } else {
      params.set('pestana', next)
    }
    setSearchParams(params, { replace: true })
  }

  return <SupervisionsAdminScreen tab={tab} onTabChange={handleTabChange} />
}
