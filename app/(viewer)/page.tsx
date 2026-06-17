import { MousePointerClick } from "lucide-react";

export default function ViewerHome() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center">
        <MousePointerClick className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="font-heading text-lg font-semibold">
          Vyber uzol v hierarchii
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Prejdi stromom vľavo od areálu cez budovu, podlažia a miestnosti až po
          konkrétny asset.
        </p>
      </div>
    </div>
  );
}
