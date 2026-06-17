import Link from "next/link";

import { fetchSpatialTree } from "@/lib/data/spatial";
import { fetchSidebarNav } from "@/lib/data/nav";
import { SpatialTree } from "@/components/spatial-tree";
import { SidebarNav } from "@/components/sidebar-nav";

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
      <aside className="flex w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="border-b px-4 py-3">
          <Link href="/" className="font-heading text-sm font-semibold">
            AIM Viewer
          </Link>
          <p className="text-xs text-muted-foreground">Priestorová hierarchia</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          <SpatialTree tree={tree} />
          <SidebarNav nav={nav} />
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
    </div>
  );
}
