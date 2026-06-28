"use client";

export default function ViewerError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-lg font-semibold">Nepodarilo sa načítať dáta</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Skúste stránku obnoviť. Ak problém pretrváva, skontrolujte pripojenie
        k databáze.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Skúsiť znova
      </button>
    </div>
  );
}
