import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** ISO timestamp → `YYYY-MM-DD` (deň stačí pre platnosti vo Viewerі). */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  return value.slice(0, 10)
}
