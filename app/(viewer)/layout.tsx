import Link from "next/link";

import { fetchSpatialTree } from "@/lib/data/spatial";
import { SpatialTree } from "@/components/spatial-tree";

// Strom čítame server-side pri každom requeste (seed sa mení v dev).
export const dynamic = "force-dynamic";

export default async function ViewerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = await fetchSpatialTree();

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
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
    </div>
  );
}
