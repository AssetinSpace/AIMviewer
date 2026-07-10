import { fetchGuidMap, getIfcModels } from "@/lib/data/ifc";
import IFCWorkspace from "@/components/ifc-workspace";

// SSR na každý request — GUID mapa sa číta z DB (cache na úrovni fetchGuidMap, D-029).
export const dynamic = "force-dynamic";

export default async function IFCPage({
  searchParams,
}: {
  /** `focus` = IFC GUID(y) na zvýraznenie (čiarkou oddelené); `r` = nonce
   *  akcie AI docku — nová hodnota vynúti re-aplikáciu focusu (D-056). */
  searchParams: Promise<{ focus?: string; r?: string }>;
}) {
  const { focus, r } = await searchParams;

  const [models, guidMap] = await Promise.all([
    Promise.resolve(getIfcModels()),
    fetchGuidMap(),
  ]);

  return (
    <div className="mx-auto max-w-[1500px]">
      <header className="mb-4">
        <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          3D Model
        </span>
        <h1 className="mt-2 font-heading text-2xl font-semibold">
          3D model budovy
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {models.map((m) => m.label).join(" + ")} — federované (D-049)
        </p>
      </header>

      <IFCWorkspace models={models} guidMap={guidMap} focus={focus} focusNonce={r} />
    </div>
  );
}
