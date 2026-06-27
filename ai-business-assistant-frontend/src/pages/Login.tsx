import { useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiFetch, type ApiError } from "@/lib/api"
import { useAuthStore } from "@/store/useAuthStore"

type Mode = "login" | "register"

interface TokenResponse {
  access_token: string
  token_type: string
  user: { id: number; username: string; role: string; created_at: string }
}

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const setSession = useAuthStore((s) => s.setSession)

  const [mode, setMode] = useState<Mode>("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Where to send the user after auth: back to where they were headed, or home.
  const from = (location.state as { from?: string } | null)?.from ?? "/"

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await apiFetch<TokenResponse>(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      })
      setSession(res)
      navigate(from, { replace: true })
    } catch (err) {
      const apiErr = err as ApiError
      setError(apiErr.detail || apiErr.message || "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <CardTitle className="text-lg">
            {mode === "login" ? "Welcome back" : "Create an account"}
          </CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Sign in to your AI Business Assistant"
              : "Set up access to your AI Business Assistant"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="username" className="text-sm font-medium">
                Username
              </label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" disabled={submitting} className="mt-1">
              {submitting
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {mode === "login" ? "No account yet?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login")
                setError(null)
              }}
            >
              {mode === "login" ? "Create one" : "Sign in"}
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
