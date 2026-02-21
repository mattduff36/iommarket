"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DevAuthPage() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/dev-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // Password correct → cookie set → go to site
        router.push("/");
        router.refresh();
      } else {
        // Wrong password → redirect to holding page
        router.push("/");
      }
    } catch {
      // Error → redirect to holding page
      router.push("/");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <form onSubmit={handleSubmit} className="w-full max-w-sm px-4">
        <div className="rounded-lg bg-surface p-8 shadow-high border border-border">
          <h1 className="text-lg font-semibold text-text-primary">
            Access Required
          </h1>
          <div className="mt-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full rounded-sm border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-neon-blue-500 focus:outline-none focus:shadow-glow-blue"
              autoFocus
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full rounded-sm bg-neon-red-500 px-4 py-2 text-sm font-bold uppercase italic text-white hover:bg-neon-red-400 disabled:opacity-50 transition-colors shadow-glow-red"
          >
            {loading ? "..." : "Enter"}
          </button>
        </div>
      </form>
    </div>
  );
}
