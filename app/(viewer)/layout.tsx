import { fetchSpatialTree } from "@/lib/data/spatial";
import { fetchSidebarNav } from "@/lib/data/nav";
import { SpatialTree } from "@/components/spatial-tree";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarShell } from "@/components/sidebar-shell";
import { AskPanel } from "@/components/ask-panel";

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

      <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>

      <AskPanel />
    </div>
  );
}
