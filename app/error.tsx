"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md rounded-2xl border border-danger-line bg-surface p-8 text-center shadow-raised">
        <CircleAlert className="mx-auto size-10 text-danger" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">
          This screen could not load
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {error.message || "Please try again. Your data was not changed."}
        </p>
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
