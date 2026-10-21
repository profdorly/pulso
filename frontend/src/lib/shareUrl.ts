/**
 * Characters a query value cannot carry as they are:
 *
 *   - controls, space and DEL (`\u0000-\u0020`, `\u007f`): not valid in a URL at all;
 *   - `" < > \` ^ { | } [ ] \`: not allowed raw in a URL, and some parsers rewrite them;
 *   - `#`: would start the fragment and cut the text short;
 *   - `%`: would read as the start of an escape;
 *   - `& = ;`: would split the value into other parameters (`;` on older servers);
 *   - `+`: a form decoder reads it as a space.
 *
 * Everything else, accents and emoji included, stays raw: the browser encodes it as UTF-8 when it
 * navigates, exactly as `encodeURIComponent` would. A full edition carries about fifty of these
 * links, and escaping each accent three times over was a few kB of the page.
 */
// eslint-disable-next-line no-control-regex -- matching the control characters is the point.
const UNSAFE_IN_QUERY = /[\u0000-\u0020"#%&+;<=>[\\\]^`{|}\u007f]/g;

/**
 * A wa.me link that opens WhatsApp with `text` ready to send.
 *
 * WhatsApp receives the same text, character for character, as with `encodeURIComponent`:
 * `new URL(whatsappShareUrl(text)).searchParams.get("text") === text`. A lone surrogate (which
 * `encodeURIComponent` would throw on) becomes U+FFFD first.
 */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${text.toWellFormed().replace(UNSAFE_IN_QUERY, encodeURIComponent)}`;
}
