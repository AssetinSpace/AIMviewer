import type { SpatialType } from "@/lib/data/spatial";

/** Slovenské labely priestorových typov (zobrazenie vo Viewerі). */
export const OBJECT_TYPE_LABEL: Record<SpatialType, string> = {
  site: "Areál",
  building: "Budova",
  floor: "Podlažie",
  space: "Miestnosť",
  asset: "Asset",
};
