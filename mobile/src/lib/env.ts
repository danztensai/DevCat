/** The browser version served by DevCat (`vite --mode web`), not the installed app. */
export const IS_WEB = import.meta.env.MODE === "web";

/** Does this look like a DevCat pairing link (app link, or the browser link from the QR code)? */
export function isPairLink(s: string): boolean {
  const t = s.trim();
  return t.startsWith("devcat://pair") || (/^https?:\/\//.test(t) && /[#&]id=[0-9a-f]{64}/i.test(t) && /[#&]code=/.test(t));
}
