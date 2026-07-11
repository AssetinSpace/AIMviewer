import { fetchSpatialTree } from "@/lib/data/spatial";
import { fetchSidebarNav } from "@/lib/data/nav";
import { SpatialTree } from "@/components/spatial-tree";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarShell } from "@/components/sidebar-shell";
import { AskDock } from "@/components/ask-dock";

// ISR: viewer je verejný read-only (žiadne auth/cookies), tak render cachujeme
// a každých 60 s revalidujeme. Warm navigácia je takmer okamžitá a Next routy
// prefetchne. V `next dev` sa cache neuplatní → počas vývoja vždy čerstvé.
export const revalidate = 60;

export default async function ViewerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [tree, nav] = await Promise.all([fetchSpatialTree(), fetchSidebarNav()]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <SidebarShell>
        <SpatialTree tree={tree} />
        <SidebarNav nav={nav} />
      </SidebarShell>

      {/* Stránky s koreňom `.full-bleed` (3D viewer) dostanú celú plochu bez
          paddingu a bez scrollu — obsah si výšku manažuje sám. */}
      <main className="flex-1 overflow-y-auto p-6 lg:p-8 [&:has(.full-bleed)]:overflow-hidden [&:has(.full-bleed)]:p-0">
        {children}
      </main>

      {/* Globálny AI chat pri spodku — konverzácia prežíva preklikávanie (D-056). */}
      <AskDock />
    </div>
  );
}
