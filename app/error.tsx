"use client";

export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-lg font-semibold">Nastala neočakávaná chyba</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Skúste stránku obnoviť. Ak problém pretrváva, kontaktujte správcu.
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
