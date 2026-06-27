import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface AuthUser {
  id: number
  username: string
  role: string
  created_at: string
}

interface TokenResponse {
  access_token: string
  token_type: string
  user: AuthUser
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  isAuthenticated: boolean
  /** Persist a successful auth response (login or register). */
  setSession: (res: TokenResponse) => void
  /** Clear all auth state. */
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      setSession: (res) =>
        set({
          token: res.access_token,
          user: res.user,
          isAuthenticated: true,
        }),

      logout: () =>
        set({
          token: null,
          user: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: "aiba-auth",
      // Only persist the durable bits; isAuthenticated is derived on load.
      partialize: (state) => ({ token: state.token, user: state.user }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = Boolean(state.token)
        }
      },
    }
  )
)
