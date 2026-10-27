/** Hashes PINs before persistence so cloud copies never contain the raw PIN. */
export async function hashPin(pin: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return `sha256:${Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  // HTTPS and modern browsers support SubtleCrypto; this fallback is only for local dev.
  let hash = 2166136261;
  for (let i = 0; i < pin.length; i++) hash = Math.imul(hash ^ pin.charCodeAt(i), 16777619);
  return `legacy:${(hash >>> 0).toString(16)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!stored.startsWith('sha256:') && !stored.startsWith('legacy:')) return stored === pin;
  return (await hashPin(pin)) === stored;
}
