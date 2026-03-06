/**
 * Module-level store for files that need WebR processing (e.g. .dta, .rdata).
 * Used to pass File objects from the dashboard to the session view across
 * Next.js client-side navigation (JS runtime stays alive).
 */
const pending = new Map<string, File[]>();

export function setPendingUploads(sessionId: string, files: File[]) {
  if (files.length > 0) pending.set(sessionId, files);
}

export function takePendingUploads(sessionId: string): File[] {
  const files = pending.get(sessionId) || [];
  pending.delete(sessionId);
  return files;
}
