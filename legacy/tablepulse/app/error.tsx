"use client";
import { ShieldCheck } from "lucide-react";
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  return (
    <div className="login-page">
      <div className="login-card">
        <ShieldCheck size={30} color="#6e9156" />
        <h1>We couldn’t load this workspace.</h1>
        <p>
          Please retry, or ask your venue administrator to check the connection.
        </p>
        <button className="button primary" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
