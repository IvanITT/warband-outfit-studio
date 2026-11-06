// @ts-check
/**
 * Text-encoding helpers for Warband module files.
 *
 * VERIFIED (2026-11-06, Native/VC/NW installations):
 *  - Every module `.txt` uses CRLF line endings and no BOM.
 *  - `Native/strings.txt` contains two CP1252 bytes (0x96, 0x97) that make a
 *    strict UTF-8 decode fail, while `Viking Conquest/strings.txt` is valid
 *    UTF-8. Therefore encoding must be detected per file, never assumed.
 */

/**
 * @typedef {'utf8' | 'cp1252'} TextEncoding
 */

/**
 * Decode a buffer, preferring strict UTF-8 and falling back to CP1252.
 * @param {Buffer} buffer
 * @returns {{ text: string, encoding: TextEncoding, hadBom: boolean }}
 */
export function decodeText(buffer) {
  let hadBom = false;
  let body = buffer;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    hadBom = true;
    body = buffer.subarray(3);
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf8', hadBom };
  } catch {
    return { text: body.toString('latin1'), encoding: 'cp1252', hadBom };
  }
}

/**
 * Read a text file and return its decoded contents plus metadata.
 * @param {string} filePath
 * @returns {Promise<{ text: string, encoding: TextEncoding, hadBom: boolean, crlf: boolean, lines: string[] }>}
 */
export async function readTextFile(filePath) {
  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(filePath);
  const decoded = decodeText(buffer);
  const crlf = buffer.includes(0x0d);
  return { ...decoded, crlf, lines: splitLines(decoded.text) };
}

/**
 * Split text into lines, tolerating LF, CRLF and a final newline.
 * The returned lines never contain the line terminator.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Serialize lines with the exact CRLF convention used by the Warband module
 * system, including a trailing newline.
 * @param {string[]} lines
 */
export function joinLinesCrlf(lines) {
  return lines.join('\r\n') + '\r\n';
}

/**
 * Convert a Warband display string into a stable identifier the same way the
 * Module System does (`convert_to_identifier`).
 * @param {string} value
 */
export function toIdentifier(value) {
  return value
    .replace(/[\s\t]/g, '_')
    .replace(/['`()\-]/g, '_')
    .replace(/[,|]/g, '')
    .toLowerCase();
}
