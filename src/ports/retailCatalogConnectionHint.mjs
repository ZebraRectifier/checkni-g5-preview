// Prepare only the existing anonymous connection. No HTTP request, catalogue
// data, address, key, retry or change to the bounded fetch deadline is involved.
export function hintRetailCatalogConnection(document, endpoint) {
  if (!document?.head || typeof document.createElement !== 'function'
      || typeof document.querySelector !== 'function' || typeof document.head.append !== 'function') return false;
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const origin = url.origin;
  if (document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return false;
  const link = document.createElement('link');
  link.rel = 'preconnect'; link.href = origin; link.crossOrigin = 'anonymous';
  document.head.append(link);
  return true;
}
