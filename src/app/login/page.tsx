"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const res = await login({ email, password });
      setAuth({ accessToken: res.accessToken, refreshToken: res.refreshToken, user: res.user });
      router.replace(res.user.role === "doctor" ? "/doctor" : "/patient");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Doctor Queue</h1>
          <p className="mt-1 text-sm text-zinc-600">Sign in to continue.</p>
        </div>

        <Card>
          <form className="flex flex-col gap-3" onSubmit={onSubmit}>
            <label className="text-sm font-medium text-zinc-800">
              Email
              <div className="mt-1">
                <Input
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </label>

            <label className="text-sm font-medium text-zinc-800">
              Password
              <div className="mt-1">
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </label>

            {error ? (
              <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            ) : null}

            <Button type="submit" disabled={isLoading || !email || !password} className="mt-2">
              {isLoading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-xs text-zinc-500">
          Clinics often have poor connectivity — this app is designed to work well on slow networks.
        </p>
      </div>
    </div>
  );
}

