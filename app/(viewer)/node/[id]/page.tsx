import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchNode, type NodeRef } from "@/lib/data/spatial";
import { OBJECT_TYPE_LABEL } from "@/lib/object-type";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

function Breadcrumb({ trail }: { trail: NodeRef[] }) {
  if (trail.length === 0) return null;
  return (
    <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {trail.map((n, i) => (
        <span key={n.id} className="flex items-center gap-1">
          {i > 0 && <span>/</span>}
          <Link href={`/node/${n.id}`} className="hover:text-foreground hover:underline">
            {n.name ?? n.object_ref ?? n.id}
          </Link>
        </span>
      ))}
    </nav>
  );
}

/** Riadok atribútu (label : hodnota). */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-[0.8rem]">{value}</dd>
    </div>
  );
}

export default async function NodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await fetchNode(id);
  if (!detail) notFound();

  const { node, breadcrumb, children } = detail;
  const isAsset = node.object_type === "asset";
  const childLabel = node.object_type === "space" ? "Assety" : "Obsahuje";

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb trail={breadcrumb} />

      <header className="mb-6">
        <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          {OBJECT_TYPE_LABEL[node.object_type]}
        </span>
        <h1 className="mt-2 font-heading text-2xl font-semibold">
          {node.name ?? node.object_ref ?? node.id}
        </h1>
        {node.object_ref && (
          <p className="font-mono text-sm text-muted-foreground">{node.object_ref}</p>
        )}
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Atribúty</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <Field label="IFC typ" value={node.ifc_type} />
            <Field label="PredefinedType" value={node.predefined_type} />
            <Field label="IFC GUID" value={node.ifc_guid} />
            {node.object_type === "floor" && (
              <Field
                label="Elevation"
                value={node.elevation !== null ? `${node.elevation} m` : null}
              />
            )}
          </dl>
        </CardContent>
      </Card>

      {isAsset ? (
        <Card>
          <CardHeader>
            <CardTitle>Detail assetu</CardTitle>
            <CardDescription>
              Zmergované properties, dedičnosť z typu, klasifikácie, dokumenty
              a zodpovednosti pribudnú v ďalšom sprinte (S2 / S3).
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {childLabel}{" "}
              <span className="text-muted-foreground">({children.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {children.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Tento uzol zatiaľ nič neobsahuje.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {children.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/node/${c.id}`}
                      className="flex items-center justify-between gap-2 py-2 text-sm hover:text-foreground"
                    >
                      <span>{c.name ?? c.object_ref ?? c.id}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {c.object_ref}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
