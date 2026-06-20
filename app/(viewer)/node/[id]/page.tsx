import Link from "next/link";
import { Eye } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { fetchDrawing } from "@/lib/data/drawing";
import { fetchNode, type NodeDetail, type NodeRef } from "@/lib/data/spatial";
import { fetchAsset } from "@/lib/data/asset";
import {
  fetchNodeSections,
  fetchFloorDrawingsCached,
  type NodeSectionsData,
} from "@/lib/data/relations";
import {
  fetchObjectMeta,
  fetchPerson,
  fetchOrganization,
  fetchDocument,
} from "@/lib/data/object";
import { OBJECT_TYPE_LABEL } from "@/lib/object-type";
import { formatDate } from "@/lib/utils";
import { PropertySets } from "@/components/property-sets";
import { ClassificationList } from "@/components/classification-list";
import { DocumentList } from "@/components/document-list";
import { DrawingList } from "@/components/drawing-list";
import { DrawingElements } from "@/components/drawing-elements";
import { ResponsibilityList } from "@/components/responsibility-list";
import { ResponsibilityOfList } from "@/components/responsibility-of-list";
import { GuidHistory } from "@/components/guid-history";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ISR — render uzla sa cachuje a po 60 s revaliduje (viewer je verejný read-only).
export const revalidate = 60;

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

/** Hlavička karty: typový badge + názov + object_ref. */
function NodeHeader({
  type,
  name,
  objectRef,
}: {
  type: keyof typeof OBJECT_TYPE_LABEL;
  name: string | null;
  objectRef: string | null;
}) {
  return (
    <header className="mb-6">
      <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
        {OBJECT_TYPE_LABEL[type]}
      </span>
      <h1 className="mt-2 font-heading text-2xl font-semibold">{name ?? objectRef ?? "—"}</h1>
      {objectRef && (
        <p className="font-mono text-sm text-muted-foreground">{objectRef}</p>
      )}
    </header>
  );
}

/**
 * Generické sekcie uzla (S3, D-029): dokumenty, zodpovednosti, história GUID.
 * Presentational — dáta dostane zvonku, aby ich volajúci mohol načítať paralelne
 * s ostatným obsahom karty.
 */
function NodeSectionsCards({
  data,
  ifcGuid,
  nodeId,
}: {
  data: NodeSectionsData;
  ifcGuid: string | null;
  /** `objects.id` uzla — pre `?focus=` odkaz do prehliadačky výkresov (D-042 D). */
  nodeId: string;
}) {
  const { documents, drawings, responsibilities, guidHistory } = data;

  return (
    <>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            Dokumenty{" "}
            <span className="text-muted-foreground">({documents.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentList documents={documents} />
        </CardContent>
      </Card>

      {drawings.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>
              Zobrazený vo výkrese{" "}
              <span className="text-muted-foreground">({drawings.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DrawingList drawings={drawings} elementId={nodeId} />
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            Zodpovednosti{" "}
            <span className="text-muted-foreground">({responsibilities.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsibilityList items={responsibilities} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>História IFC GUID</CardTitle>
        </CardHeader>
        <CardContent>
          <GuidHistory currentGuid={ifcGuid} history={guidHistory} />
        </CardContent>
      </Card>
    </>
  );
}

/** Async wrapper — načíta sekcie sám (priestorové uzly, kde nie je čo paralelizovať). */
async function NodeSections({ id, ifcGuid }: { id: string; ifcGuid: string | null }) {
  const data = await fetchNodeSections(id);
  return <NodeSectionsCards data={data} ifcGuid={ifcGuid} nodeId={id} />;
}

/**
 * „Prvky vo výkrese" (E4, D-041) — pre priestorový uzol (podlažie/budova): výkresy
 * pripojené na uzol a prvky auto-detegované v každom z nich. Skryje sa, ak žiadny
 * výkres uzla nemá detegované prvky.
 */
async function FloorDrawingsSection({ id }: { id: string }) {
  const drawings = await fetchFloorDrawingsCached(id);
  if (drawings.length === 0) return null;
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>
          Prvky vo výkrese{" "}
          <span className="text-muted-foreground">({drawings.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DrawingElements drawings={drawings} />
      </CardContent>
    </Card>
  );
}

/** Detail assetu (S2 jadro + S3 sekcie): atribúty, properties, klasifikácie,
 *  dokumenty, zodpovednosti, GUID história. */
async function AssetDetailView({ id }: { id: string }) {
  // Asset karta aj jej S3 sekcie závisia len od `id` → načítaj ich paralelne.
  const [asset, sections] = await Promise.all([
    fetchAsset(id),
    fetchNodeSections(id),
  ]);
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

      <Card className="mb-6">
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

      <NodeSectionsCards data={sections} ifcGuid={asset.ifc_guid} nodeId={id} />
    </>
  );
}

/** Priestorový uzol (S1) + generické S3 sekcie. */
function SpatialView({ detail }: { detail: NodeDetail }) {
  const { node, breadcrumb, children } = detail;
  const isAsset = node.object_type === "asset";
  const childLabel = node.object_type === "space" ? "Assety" : "Obsahuje";

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb trail={breadcrumb} />
      <NodeHeader type={node.object_type} name={node.name} objectRef={node.object_ref} />

      {isAsset ? (
        <AssetDetailView id={node.id} />
      ) : (
        <>
          <Card className="mb-6">
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

          <FloorDrawingsSection id={node.id} />

          <NodeSections id={node.id} ifcGuid={node.ifc_guid} />
        </>
      )}
    </div>
  );
}

/** Detail osoby (S3): kontakt, členstvá vo firmách, za čo zodpovedá. */
async function PersonView({ id }: { id: string }) {
  const person = await fetchPerson(id);
  if (!person) notFound();

  const fullName =
    [person.givenName, person.familyName].filter(Boolean).join(" ") || null;

  return (
    <div className="mx-auto max-w-3xl">
      <NodeHeader type="person" name={person.name} objectRef={person.object_ref} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Kontakt</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <Field label="Meno" value={fullName} />
            <Field
              label="E-mail"
              value={
                person.email ? (
                  <a
                    href={`mailto:${person.email}`}
                    className="text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {person.email}
                  </a>
                ) : null
              }
            />
            <Field label="Telefón" value={person.phone} />
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            Členstvo{" "}
            <span className="text-muted-foreground">({person.memberships.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {person.memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Bez členstva v organizácii.
            </p>
          ) : (
            <ul className="space-y-2">
              {person.memberships.map((m) => (
                <li
                  key={m.orgId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                >
                  <Link
                    href={`/node/${m.orgId}`}
                    className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {m.orgName ?? m.orgRef ?? m.orgId}
                  </Link>
                  {m.role && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] font-medium text-secondary-foreground">
                      {m.role}
                    </span>
                  )}
                  {formatDate(m.validFrom) && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      od {formatDate(m.validFrom)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Zodpovedá za{" "}
            <span className="text-muted-foreground">
              ({person.responsibilities.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsibilityOfList items={person.responsibilities} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Detail organizácie (S3): zachytený kontakt, členovia, za čo zodpovedá. */
async function OrganizationView({ id }: { id: string }) {
  const org = await fetchOrganization(id);
  if (!org) notFound();

  const contactEntries = org.contact
    ? Object.entries(org.contact).filter(([k]) => !k.startsWith("__"))
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <NodeHeader type="organization" name={org.name} objectRef={org.object_ref} />

      {contactEntries.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>
              Kontakt{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (zachytené, _contact)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              {contactEntries.map(([k, v]) => (
                <Field
                  key={k}
                  label={k}
                  value={typeof v === "object" ? JSON.stringify(v) : String(v)}
                />
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            Členovia{" "}
            <span className="text-muted-foreground">({org.members.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {org.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žiadni evidovaní členovia.</p>
          ) : (
            <ul className="space-y-2">
              {org.members.map((m) => (
                <li
                  key={m.personId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                >
                  <Link
                    href={`/node/${m.personId}`}
                    className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {m.personName ?? m.personRef ?? m.personId}
                  </Link>
                  {m.role && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] font-medium text-secondary-foreground">
                      {m.role}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Zodpovedá za{" "}
            <span className="text-muted-foreground">
              ({org.responsibilities.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsibilityOfList items={org.responsibilities} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Detail dokumentu (S3, D-014): metadáta + na ktoré objekty je pripojený. */
async function DocumentView({ id }: { id: string }) {
  // Dokument + (ak je výkres) jeho klikateľné regióny — pre vstup do prehliadačky.
  const [doc, drawing] = await Promise.all([fetchDocument(id), fetchDrawing(id)]);
  if (!doc) notFound();

  const hasViewer = drawing !== null && drawing.links.length > 0;

  return (
    <div className="mx-auto max-w-3xl">
      <NodeHeader type="document" name={doc.name} objectRef={doc.object_ref} />

      {hasViewer && (
        <Link
          href={`/drawing/${id}`}
          className="mb-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Eye className="size-4" />
          Otvoriť interaktívnu prehliadačku
          <span className="opacity-80">({drawing!.links.length} prvkov)</span>
        </Link>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Metadáta</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <Field label="Identifikácia" value={doc.identification} />
            <Field label="Popis" value={doc.description} />
            <Field label="Účel" value={doc.purpose} />
            <Field label="Revízia" value={doc.revision} />
            <Field label="Status" value={doc.status} />
            <Field label="Vlastník" value={doc.documentOwner} />
            <Field
              label="Platnosť"
              value={
                formatDate(doc.validFrom)
                  ? `${formatDate(doc.validFrom)}${
                      formatDate(doc.validUntil) ? ` – ${formatDate(doc.validUntil)}` : ""
                    }`
                  : null
              }
            />
            <Field
              label="Umiestnenie"
              value={
                doc.location ? (
                  <a
                    href={doc.location}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {doc.location}
                  </a>
                ) : null
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Pripojené k{" "}
            <span className="text-muted-foreground">({doc.attachedTo.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {doc.attachedTo.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Dokument nie je pripojený na žiadny objekt.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {doc.attachedTo.map((a) => (
                <li key={a.object.id}>
                  <Link
                    href={`/node/${a.object.id}`}
                    className="flex items-center justify-between gap-2 py-2 text-sm hover:text-foreground"
                  >
                    <span>
                      {a.object.name ?? a.object.object_ref ?? a.object.id}
                      {a.role && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({a.role})
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {a.object.object_ref}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Generický object route (D-029): priestorové uzly cez `fetchNode` (S1), inak
 * dispatch podľa `object_type`. `asset_type` patrí na `/type/[id]`.
 */
export default async function NodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Spatial uzly (site…asset) — bežná cesta, breadcrumb + strom.
  const spatial = await fetchNode(id);
  if (spatial) return <SpatialView detail={spatial} />;

  // Nie je priestorový — rozhodni podľa typu objektu.
  const meta = await fetchObjectMeta(id);
  if (!meta) notFound();

  switch (meta.object_type) {
    case "asset_type":
      redirect(`/type/${id}`);
    case "person":
      return <PersonView id={id} />;
    case "organization":
      return <OrganizationView id={id} />;
    case "document":
      return <DocumentView id={id} />;
    default:
      notFound();
  }
}
