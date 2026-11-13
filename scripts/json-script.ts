// json-script — serialize a value for inline embedding in an HTML <script>.
// Why: a raw "</script" or "<!--" inside the data would end or corrupt the
// script block, and U+2028/U+2029 break older JS parsers. Escaping every "<"
// and both separators keeps the block inert; JSON.parse / evaluation restore
// the exact value. Shared by the HTML generators (mind-meld viewer, explorer).
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replaceAll(LINE_SEP, '\\u2028').replaceAll(PARA_SEP, '\\u2029');
}
