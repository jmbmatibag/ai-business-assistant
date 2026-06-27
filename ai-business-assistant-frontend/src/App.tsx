import { lazy } from "react"
import { Route, Routes } from "react-router-dom"

import { AppLayout } from "@/components/layout/AppLayout"

// Lazy-load pages so heavy, route-specific deps (e.g. Recharts on the dashboard)
// are split out of the initial bundle and fetched on demand.
const Chat = lazy(() => import("@/pages/Chat").then((m) => ({ default: m.Chat })))
const Dashboard = lazy(() =>
  import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard }))
)
const Settings = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.Settings }))
)

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/assistant" element={<Chat />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}

export default App
