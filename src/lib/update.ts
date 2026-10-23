// Aviso de nova versão do launcher (GitHub Releases do próprio projeto).

export const REPO = "RiqueBitt/-Commandproject";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

function parts(v: string) {
  return v.replace(/^v/i, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
}

export function isNewer(latest: string, current: string) {
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function checkAppUpdate(current: string): Promise<{ version: string; url: string; notes: string } | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { tag_name?: string; html_url?: string; body?: string; draft?: boolean };
    if (!j.tag_name || j.draft || !isNewer(j.tag_name, current)) return null;
    return { version: j.tag_name.replace(/^v/i, ""), url: j.html_url ?? RELEASES_URL, notes: (j.body ?? "").slice(0, 1500) };
  } catch {
    return null;
  }
}
