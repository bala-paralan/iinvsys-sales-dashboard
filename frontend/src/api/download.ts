/**
 * Authenticated file download.
 *
 * A plain `<a href>` cannot carry the Authorization header, so every protected
 * download has to be fetched and handed to the browser as a blob. The legacy
 * app sidestepped this by building the workbook client-side with SheetJS —
 * which is why its export contained whatever the browser happened to have
 * loaded rather than what the caller was entitled to see.
 */
import { ApiError, getToken } from './client';

export async function downloadFile(path: string, fallbackName = 'download'): Promise<void> {
  const token = getToken();

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the API running?');
  }

  if (!res.ok) {
    /* An error response is JSON even though the happy path is binary. */
    let message = `Download failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && typeof body.message === 'string') message = body.message;
    } catch { /* keep the status-based message */ }
    throw new ApiError(res.status, message);
  }

  /* Prefer the server's filename — it carries the report date. */
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match ? match[1] : fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Revoke on the next tick — revoking synchronously races the click in
     Safari and silently produces an empty file. */
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
