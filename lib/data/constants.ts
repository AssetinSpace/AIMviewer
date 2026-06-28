/**
 * Zdieľané konštanty dátovej vrstvy — importuj namiesto lokálnych definícií.
 */

/** `source` hrán z auto-linkingu výkresov (E4, D-041). */
export const PDF_LINK_SOURCE = "pdf_link (E4)";

/** Spoločné ISR nastavenie pre cachované čítania (D-029 perf). */
export const AIM_CACHE = { revalidate: 60, tags: ["aim"] } as const;
