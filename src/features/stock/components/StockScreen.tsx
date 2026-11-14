import { useSearchParams } from 'react-router'
import { useAuth } from '@/features/auth/AuthProvider'
import { StockPermissionNotice } from './StockActionButton'
import { canManageStock } from '@/features/stock/permissions'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  resolveStockTab,
  visibleStockTabs,
  STOCK_TABS,
} from '@/features/stock/tabs'

/**
 * Sección «Insumos» (`/admin/insumos`, IS-33): las pestañas que ya tienen
 * pantalla, elegidas con `?pestana=` en la URL (Stock es la de entrada).
 */
function StockScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const auth = useAuth()
  // OF-14: un administrador sin `manage_stock` ve todo pero no puede cargar.
  const showCapabilityNotice =
    auth.roles.includes('admin') && !canManageStock(auth)
  const tabs = visibleStockTabs(STOCK_TABS)
  const activeTab = resolveStockTab(searchParams.get('pestana'))

  function handleTabChange(value: string) {
    const next = new URLSearchParams(searchParams)
    if (value === 'stock') {
      next.delete('pestana')
    } else {
      next.set('pestana', value)
    }
    // El filtro que llega desde el Resumen solo vale para Stock.
    next.delete('filtro')
    setSearchParams(next, { replace: true })
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      {showCapabilityNotice && <StockPermissionNotice />}
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => {
        const Content = tab.component
        return (
          <TabsContent key={tab.value} value={tab.value} className="pt-3">
            {Content && <Content />}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

export { StockScreen }
