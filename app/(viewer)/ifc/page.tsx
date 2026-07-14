import { fetchUnderlayDrawings } from "@/lib/data/drawing";
import { fetchGuidMap, getIfcModels } from "@/lib/data/ifc";
import IFCWorkspace from "@/components/ifc-workspace";

// SSR na každý request — GUID mapa sa číta z DB (cache na úrovni fetchGuidMap, D-029).
export const dynamic = "force-dynamic";

export default async function IFCPage({
  searchParams,
}: {
  /** `focus` = IFC GUID(y) na zvýraznenie (čiarkou oddelené); `ops` = viewer
   *  operácie AI docku (ofarbenie/skrytie/izolácia, D-066); `r` = nonce
   *  akcie AI docku — nová hodnota vynúti re-aplikáciu focusu/ops (D-056). */
  searchParams: Promise<{ focus?: string; ops?: string; r?: string }>;
}) {
  const { focus, ops, r } = await searchParams;

  const [models, guidMap, underlays] = await Promise.all([
    Promise.resolve(getIfcModels()),
    fetchGuidMap(),
    // Georeferencované PDF podklady (D-072) — viewer ich dostane po MODELS_LOADED.
    fetchUnderlayDrawings(),
  ]);

  // Full-bleed: viewer zaberá celú plochu main-u (layout zruší padding aj
  // scroll cez :has(.full-bleed)); navigácia a strom ostávajú v ľavom sidebari.
  return (
    <div className="full-bleed h-full">
      <IFCWorkspace models={models} guidMap={guidMap} focus={focus} focusNonce={r} ops={ops} underlays={underlays} />
    </div>
  );
}
