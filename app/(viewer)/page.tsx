import { redirect } from "next/navigation";

// Vstupným rozhraním je IFC workspace (D-077 viewer-first) — koreň naň
// presmeruje, aby sa apka neotvárala na starom empty state hierarchie.
export default function ViewerHome() {
  redirect("/ifc");
}
