"use client";
import { useState } from "react";
import { Logo } from "./workspace";
export function Login() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <div className="login-card">
        <Logo />
        <h1>Welcome to your workspace.</h1>
        <p>Sign in with your venue team account.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const response = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
              });
              const result = await response.json();
              if (!response.ok) setError(result.error);
              else window.location.href = "/";
            } catch {
              setError("Could not connect. Please try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="form-field">
            Email
            <input
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="form-field">
            Password
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <span className="form-error" role="alert">
              {error}
            </span>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
