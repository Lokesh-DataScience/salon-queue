// frontend/src/lib/qrCode.ts
// What a salon's wall QR contains: https://<site>/q/<code>. The in-app scanner only takes the
// <code> out of it and opens OUR OWN salon page (/c/s/<code>). It never follows the scanned link,
// so a random QR can't send the customer to another website. Any host is accepted so a poster
// printed for the live site also works in a test build.
const CODE = /^[a-zA-Z0-9]{8,32}$/;

export function salonCodeFromQr(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const m = /^\/q\/([^/]+)\/?$/.exec(url.pathname);
  return m && CODE.test(m[1]) ? m[1].toLowerCase() : null;
}
