import { LinkButton } from "@/ui/button";

export default function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-accent">404</p>
        <h1 className="mt-2 text-2xl font-semibold">
          We could not find that page
        </h1>
        <p className="mt-2 text-ink-muted">
          The link may have expired or the page may have moved.
        </p>
        <LinkButton href="/" className="mt-6">
          Return to Return Anchor
        </LinkButton>
      </div>
    </main>
  );
}
