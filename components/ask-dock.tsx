"use client";

import dynamic from "next/dynamic";

/**
 * Globálny AI dock (D-056): plávajúci chat pri spodku Viewera — zbalený ako
 * pilulka, rozbalený ako panel. Žije vo (viewer) layoute, takže konverzácia
 * prežíva preklikávanie (navigácia beží pod ním — akcia „zobraz v 3D" otvorí
 * /ifc a chat ostáva).
 *
 * `ssr: false`: stav (otvorené/vlákno) sa číta zo sessionStorage v useState
 * initializeri — bez SSR nehrozí hydration mismatch ani setState-v-efekte.
 */
const AskDockInner = dynamic(() => import("@/components/ask-dock-inner"), {
  ssr: false,
});

export function AskDock() {
  return <AskDockInner />;
}
