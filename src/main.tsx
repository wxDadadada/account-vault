import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ThemeProvider } from './context/theme-provider'
import './styles/index.css'
import { VaultApp } from './vault/App'
import { VaultProvider } from './vault/state/store'

const root = createRootRoute({ component: VaultApp })
const routes = (['/', '/subjects', '/history', '/settings'] as const).map(
  (path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null })
)
const router = createRouter({ routeTree: root.addChildren(routes) })
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme='light' storageKey='keyfolio-theme'>
      <VaultProvider>
        <RouterProvider router={router} />
      </VaultProvider>
    </ThemeProvider>
  </StrictMode>
)
