import type { NodeSummary } from "@/lib/data/object";
import type { CaptureSummary } from "@/lib/data/capture-placement";

/**
 * AIM karta v natívnom paneli ifclite — render schéma posielaná cez
 * aim-bridge do embednutého viewera (AIM_PANEL_DATA). Viewer ju vykresľuje
 * genericky (apps/viewer/src/aim/AimCard.tsx vo forku), takže nové polia /
 * sekcie sa pridávajú len tu (host deploy), bez redeployu viewera.
 *
 * Všetky `href` sú host-relatívne cesty (/node/{id}, /type/{id},
 * /drawing/{id}); viewer ich neinterpretuje, len ich pošle späť cez
 * AIM_NAVIGATE a parent appka naviguje.
 */
export interface AimPanelData {
  version: 1;
  /** Echo GUID-u vybraného elementu — viewer ním zahadzuje stale odpovede. */
  guid: string;
  title: string;
  subtitle?: string;
  badges?: { label: string; tone?: "default" | "accent" }[];
  sections?: {
    label: string;
    rows: { label: string; value: string; href?: string; mono?: boolean }[];
  }[];
  documents?: { name: string; href: string; badge?: string }[];
  actions?: { label: string; href: string; primary?: boolean }[];
}

const TYPE_LABEL: Record<string, string> = {
  asset: "Asset",
  asset_type: "Typ assetu",
};

/**
 * NodeSummary (GET /api/element/[id]) → render schéma AIM karty. `captures`
 * (voliteľné, D-073) pridá akciu „Reality Capture (N)" ktorá otvorí galériu
 * priestoru priamo v 3D (`/ifc?captures=<spaceId>` — soft-nav → overlay).
 */
export function nodeSummaryToAimPanel(
  summary: NodeSummary,
  guid: string,
  captures?: CaptureSummary | null
): AimPanelData {
  const ifcRows: NonNullable<AimPanelData["sections"]>[number]["rows"] = [];
  if (summary.ifcType) ifcRows.push({ label: "IFC typ", value: summary.ifcType, mono: true });
  if (summary.predefinedType)
    ifcRows.push({ label: "PredefinedType", value: summary.predefinedType, mono: true });
  if (summary.userDefinedType)
    ifcRows.push({ label: "ObjectType", value: summary.userDefinedType, mono: true });
  if (summary.type) {
    ifcRows.push({
      label: "Typ",
      value: summary.type.name ?? summary.type.object_ref ?? summary.type.id,
      href: `/type/${summary.type.id}`,
    });
  }

  const overviewRows: NonNullable<AimPanelData["sections"]>[number]["rows"] = [
    { label: "Klasifikácie", value: String(summary.counts.classifications) },
  ];
  if (summary.objectType === "asset_type") {
    overviewRows.push({ label: "Výskyty", value: String(summary.counts.occurrences) });
  }

  const sections: AimPanelData["sections"] = [];
  if (ifcRows.length > 0) sections.push({ label: "IFC", rows: ifcRows });
  sections.push({ label: "Prehľad", rows: overviewRows });

  return {
    version: 1,
    guid,
    title: summary.name ?? guid,
    subtitle: summary.objectRef ?? undefined,
    badges: [{ label: TYPE_LABEL[summary.objectType] ?? "Prvok", tone: "accent" }],
    sections,
    // Parita so starým ElementInfoPanel: všetky dokumenty vedú na /drawing/{id}.
    documents: summary.documents.map((d) => ({
      name: d.name ?? d.objectRef ?? d.id,
      href: `/drawing/${d.id}`,
      badge: d.isDrawing ? "výkres" : undefined,
    })),
    actions: [
      { label: "Otvoriť celý detail", href: `/${summary.route}/${summary.id}`, primary: true },
      // Reality Capture (D-073) — otvorí galériu priestoru ako overlay nad 3D.
      ...(captures && captures.count > 0 && captures.spaceId
        ? [
            {
              label: `Reality Capture (${captures.count})`,
              href: `/ifc?captures=${captures.spaceId}`,
            },
          ]
        : []),
    ],
  };
}
