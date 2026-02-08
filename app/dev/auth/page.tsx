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
    <div className="flex min-h-screen items-center justify-center bg-slate-900">
      <form onSubmit={handleSubmit} className="w-full max-w-sm px-4">
        <div className="rounded-lg bg-white p-8 shadow-xl">
          <h1 className="text-lg font-semibold text-slate-900">
            Access Required
          </h1>
          <div className="mt-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-royal-500 focus:outline-none focus:ring-1 focus:ring-royal-500"
              autoFocus
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {loading ? "..." : "Enter"}
          </button>
        </div>
      </form>
    </div>
  );
}
