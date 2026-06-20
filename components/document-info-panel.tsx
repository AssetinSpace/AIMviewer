"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

/**
 * Bočný panel s informáciami o **dokumente** (D-042 D+): predvolený obsah pravého
 * panela prehliadačky — mirror detail-stránky dokumentu (metadáta + „Pripojené k").
 * Po kliknutí na kód vo výkrese sa panel prepne na detail prvku (`ElementInfoPanel`).
 */
export interface DocAttachment {
  object: {
    id: string;
    object_type: string;
    object_ref: string | null;
    name: string | null;
  };
  role: string | null;
}

export interface DocumentPanelData {
  identification: string | null;
  description: string | null;
  location: string | null;
  purpose: string | null;
  revision: string | null;
  status: string | null;
  documentOwner: string | null;
  validFrom: string | null;
  validUntil: string | null;
  attachedTo: DocAttachment[];
}

function fmtDate(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("sk-SK");
}

export function DocumentInfoPanel({ document }: { document: DocumentPanelData }) {
  const validity = (() => {
    const from = fmtDate(document.validFrom);
    if (!from) return null;
    const until = fmtDate(document.validUntil);
    return until ? `${from} – ${until}` : from;
  })();

  return (
    <div className="sticky top-4 space-y-4 rounded-md ring-1 ring-border bg-background p-4">
      <div>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Metadáta
        </h2>
        <dl className="divide-y divide-border text-sm">
          <Row label="Identifikácia" value={document.identification} />
          <Row label="Popis" value={document.description} />
          <Row label="Účel" value={document.purpose} />
          <Row label="Revízia" value={document.revision} />
          <Row label="Status" value={document.status} />
          <Row label="Vlastník" value={document.documentOwner} />
          <Row label="Platnosť" value={validity} />
        </dl>
        {document.location && (
          <a
            href={document.location}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <FileText className="size-3.5" /> Pôvodné PDF
          </a>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Pripojené k ({document.attachedTo.length})
        </h3>
        {document.attachedTo.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Dokument nie je pripojený na žiadny objekt.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md ring-1 ring-border">
            {document.attachedTo.map((a) => (
              <li key={a.object.id}>
                <Link
                  href={`/${a.object.object_type === "asset_type" ? "type" : "node"}/${a.object.id}`}
                  className="flex items-start justify-between gap-2 px-2.5 py-2 text-sm hover:bg-secondary/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate">
                      {a.object.name ?? a.object.object_ref ?? a.object.id}
                    </span>
                    {a.role && (
                      <span className="text-xs text-muted-foreground">{a.role}</span>
                    )}
                  </span>
                  {a.object.object_ref && (
                    <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">
                      {a.object.object_ref}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
