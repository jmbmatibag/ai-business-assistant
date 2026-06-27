import { Navigate, Outlet, useLocation } from "react-router-dom"

import { useAuthStore } from "@/store/useAuthStore"

/**
 * Gate for authenticated areas. Unauthenticated users are redirected to
 * /login, remembering where they were headed so login can return them there.
 */
export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
