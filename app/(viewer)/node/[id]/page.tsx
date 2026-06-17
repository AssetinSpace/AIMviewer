import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchNode, type NodeRef } from "@/lib/data/spatial";
import { fetchAsset } from "@/lib/data/asset";
import { OBJECT_TYPE_LABEL } from "@/lib/object-type";
import { PropertySets } from "@/components/property-sets";
import { ClassificationList } from "@/components/classification-list";
import {
  Card,
  CardContent,
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

/** Detail assetu (S2): atribúty s dedeným PredefinedType + linkom na type,
 *  property sety s provenance a union klasifikácií. */
async function AssetDetailView({ id }: { id: string }) {
  const asset = await fetchAsset(id);
  if (!asset) notFound();

  const predef = asset.predefinedType.value && (
    <span className="flex flex-wrap items-center gap-2">
      <span>{asset.predefinedType.value}</span>
      {asset.predefinedType.inherited && (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-secondary-foreground">
          zdedené z typu
        </span>
      )}
    </span>
  );

  return (
    <>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Atribúty</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <Field label="IFC typ" value={asset.ifc_type} />
            <Field label="PredefinedType" value={predef} />
            <Field label="ObjectType" value={asset.userDefinedType} />
            <Field label="IFC GUID" value={asset.ifc_guid} />
            <Field
              label="Typ"
              value={
                asset.type ? (
                  <Link
                    href={`/type/${asset.type.id}`}
                    className="text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {asset.type.name ?? asset.type.object_ref ?? asset.type.id}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">bez typu</span>
                )
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Properties</CardTitle>
        </CardHeader>
        <CardContent>
          <PropertySets groups={asset.propertySets} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Klasifikácie{" "}
            <span className="text-muted-foreground">
              ({asset.classifications.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ClassificationList facets={asset.classifications} />
        </CardContent>
      </Card>
    </>
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

      {isAsset ? (
        <AssetDetailView id={id} />
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
