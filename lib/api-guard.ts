/**
 * Ochrana verejných API routes (D-068): per-IP sliding-window rate limit
 * + cross-origin guard. Čisté funkcie s injektovateľnými hodinami — testovateľné
 * bez Next runtime.
 *
 * In-memory limiter je per serverless inštancia (na Verceli sa inštancie
 * škálujú a recyklujú) — nie je to presný distribuovaný limit, ale reálne
 * zastaví lacné zneužitie (skript búšiaci do jednej inštancie). Presný
 * globálny limit by vyžadoval KV/Upstash — vedomý trade-off, viď D-068.
 */

interface RateLimiterOptions {
  /** Dĺžka okna v ms. */
  windowMs: number;
  /** Max požiadaviek na kľúč v okne. */
  max: number;
  /** Zdroj času — injektovateľný pre testy (default Date.now). */
  now?: () => number;
}

export interface RateCheck {
  allowed: boolean;
  /** Sekundy do uvoľnenia okna — hodnota pre Retry-After hlavičku (0 ak allowed). */
  retryAfterSeconds: number;
}

/**
 * Sliding-window limiter: drží timestampy požiadaviek per kľúč a pri každej
 * kontrole odreže tie mimo okna. Pamäť sa upratuje lazy — kľúč zmizne, keď
 * jeho okno vyprší (prune pri kontrole), takže Map nerastie donekonečna.
 */
export function createRateLimiter({ windowMs, max, now = Date.now }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();
  let checksSincePrune = 0;

  function check(key: string): RateCheck {
    const t = now();
    const cutoff = t - windowMs;

    // Lazy prune celej mapy každú 64. kontrolu, aby kľúče jednorazových
    // návštevníkov nezostávali v pamäti navždy.
    if (++checksSincePrune >= 64) {
      checksSincePrune = 0;
      for (const [k, arr] of hits) {
        const alive = arr.filter((ts) => ts > cutoff);
        if (alive.length === 0) hits.delete(k);
        else hits.set(k, alive);
      }
    }

    const recent = (hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= max) {
      hits.set(key, recent);
      const oldest = recent[0];
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)),
      };
    }
    recent.push(t);
    hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return { check };
}

/**
 * Cross-origin guard pre browser POST-y: ak požiadavka NESIE Origin hlavičku
 * a jej host sa nezhoduje s hostom požiadavky, je to cudzia stránka strieľajúca
 * na naše API z prehliadača používateľa — blokni. Požiadavky bez Origin
 * (curl, server-side skripty, eval runner) prechádzajú — limiter ich stále
 * kryje; toto je CSRF-ová vrstva, nie autentifikácia.
 */
export function isCrossOriginBlocked(
  originHeader: string | null,
  requestHost: string | null
): boolean {
  if (!originHeader || !requestHost) return false;
  try {
    return new URL(originHeader).host !== requestHost;
  } catch {
    // Nevalidný Origin — prehliadač ho takto nikdy nepošle; blokni.
    return true;
  }
}

/**
 * Klientská IP z hlavičiek, ktoré na Verceli nastavuje platforma (proxy ich
 * prepisuje, klient ich nespoofne). Mimo takejto infraštruktúry je to len
 * best-effort kľúč pre limiter — horšie ako nič to nie je.
 */
export function clientIpKey(headers: Headers): string {
  return (
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
