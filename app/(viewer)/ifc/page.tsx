import { fetchGuidMap, getIfcModels, getIfcUrl } from "@/lib/data/ifc";
import IFCWorkspace from "@/components/ifc-workspace";

// SSR na každý request — GUID mapa sa číta z DB (cache na úrovni fetchGuidMap, D-029).
export const dynamic = "force-dynamic";

export default async function IFCPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const { focus } = await searchParams;

  const [ifcUrl, guidMap] = await Promise.all([
    Promise.resolve(getIfcUrl()),
    fetchGuidMap(),
  ]);
  const models = getIfcModels();

  return (
    <div className="mx-auto max-w-[1500px]">
      <header className="mb-4">
        <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          3D Model
        </span>
        <h1 className="mt-2 font-heading text-2xl font-semibold">
          ASR — 3D model budovy
        </h1>
      </header>

      <IFCWorkspace ifcUrl={ifcUrl} models={models} guidMap={guidMap} focus={focus} />
    </div>
  );
}
