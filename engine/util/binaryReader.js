// @ts-check
/**
 * Bounds-checked little-endian reader for Warband binary formats.
 *
 * All read errors raise `FormatError` with the byte offset and the file name so
 * that a corrupt or unknown file can be reported to the user instead of
 * crashing the server.
 */

export class FormatError extends Error {
  /**
   * @param {string} message
   * @param {{ offset?: number, file?: string }} [context]
   */
  constructor(message, context = {}) {
    const where = [];
    if (context.file) where.push(context.file);
    if (typeof context.offset === 'number') where.push(`offset ${context.offset}`);
    super(where.length ? `${message} (${where.join(', ')})` : message);
    this.name = 'FormatError';
    this.offset = context.offset;
    this.file = context.file;
  }
}

const MAX_STRING = 256;
const MAX_COUNT = 50_000_000;

export class BinaryReader {
  /**
   * @param {Buffer} buffer
   * @param {{ file?: string }} [options]
   */
  constructor(buffer, options = {}) {
    this.buffer = buffer;
    this.offset = 0;
    this.file = options.file;
  }

  get length() {
    return this.buffer.length;
  }

  get remaining() {
    return this.buffer.length - this.offset;
  }

  /**
   * @param {number} bytes
   */
  need(bytes) {
    if (this.offset + bytes > this.buffer.length) {
      throw new FormatError(
        `unexpected end of file: need ${bytes} byte(s), ${this.remaining} left`,
        { offset: this.offset, file: this.file },
      );
    }
  }

  /** @param {string} what */
  corrupt(what) {
    throw new FormatError(`invalid ${what}`, { offset: this.offset, file: this.file });
  }

  u8() {
    this.need(1);
    return this.buffer.readUInt8(this.offset++);
  }

  i32() {
    this.need(4);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  u32() {
    this.need(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  f32() {
    this.need(4);
    const value = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return value;
  }

  /** Skip `bytes` without reading them. */
  skip(bytes) {
    if (!Number.isInteger(bytes) || bytes < 0) this.corrupt(`skip length ${bytes}`);
    this.need(bytes);
    this.offset += bytes;
  }

  /**
   * Length-prefixed string used by BRF files (uint32 length + raw bytes).
   * @param {number} [maxLength]
   */
  string(maxLength = MAX_STRING) {
    const length = this.u32();
    if (length >= maxLength) this.corrupt(`string length ${length}`);
    this.need(length);
    const value = this.buffer.toString('latin1', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  /**
   * Optional string as written by OpenBRF's `LoadStringMaybe`: a length in
   * (0, 99) means a string follows; anything else is a default value and the
   * four bytes are rewound.
   * @param {string} fallback
   */
  maybeString(fallback) {
    return this.maybeStringWithPresence(fallback).value;
  }

  /**
   * Like `maybeString`, but also reports whether a string was actually stored.
   * Callers need this when the presence of the string changes the layout of the
   * following fields (see BRF skeleton bones).
   * @param {string} fallback
   * @returns {{ value: string, present: boolean }}
   */
  maybeStringWithPresence(fallback) {
    const start = this.offset;
    const length = this.u32();
    if (length > 0 && length < 99) {
      this.need(length);
      const value = this.buffer.toString('latin1', this.offset, this.offset + length);
      this.offset += length;
      return { value, present: true };
    }
    this.offset = start;
    return { value: fallback, present: false };
  }

  /**
   * Reads a "Point3f" exactly like OpenBRF: the three floats on disk are
   * X, Z, Y and the returned tuple is (X, Y, Z).
   * @returns {[number, number, number]}
   */
  point3() {
    const x = this.f32();
    const z = this.f32();
    const y = this.f32();
    return [x, y, z];
  }

  /** Reads a uint32 element count and validates it against the remaining bytes. */
  count(elementBytes = 1) {
    const count = this.u32();
    if (count > MAX_COUNT) this.corrupt(`element count ${count}`);
    if (elementBytes > 1 && count * elementBytes > this.remaining) {
      this.corrupt(`element count ${count} exceeds remaining bytes`);
    }
    return count;
  }

  /** @param {string} label */
  expectEnd(label = 'file') {
    if (this.offset !== this.buffer.length) {
      throw new FormatError(
        `${label} not fully consumed: ${this.remaining} trailing byte(s)`,
        { offset: this.offset, file: this.file },
      );
    }
  }
}
