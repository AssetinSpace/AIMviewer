"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="sk">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center font-sans">
        <h1 className="text-lg font-semibold">Nastala neočakávaná chyba</h1>
        <p className="text-sm text-muted-foreground">
          Skúste stránku obnoviť. Ak problém pretrváva, kontaktujte správcu.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Skúsiť znova
        </button>
      </body>
    </html>
  );
}
