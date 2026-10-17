/** The hosted browser version (`vite --mode hosted`, GitHub Pages): reaches the computer through
 *  its relay from any network. */
export const IS_HOSTED = import.meta.env.MODE === "hosted";
/** A browser version (served by DevCat on the computer, or hosted), not the installed app. */
export const IS_WEB = import.meta.env.MODE === "web" || IS_HOSTED;

/** Does this look like a DevCat pairing link (app link, or the browser link from the QR code)? */
export function isPairLink(s: string): boolean {
  const t = s.trim();
  return t.startsWith("devcat://pair") || (/^https?:\/\//.test(t) && /[#&]id=[0-9a-f]{64}/i.test(t) && /[#&]code=/.test(t));
}
