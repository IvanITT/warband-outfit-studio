// @ts-check
/**
 * Installation profile store.
 *
 * Profiles live in `config/profiles.json` (machine-local, git-ignored). Each
 * profile points at a Warband installation root. The active profile drives the
 * engine; switching profiles reloads modules and clears parsed caches.
 *
 * Bootstrap rule: when no profiles exist, the engine probes `WARBAND_DIR`,
 * `config/app.json` and well-known paths, then stores the first valid
 * installation as a profile.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { describeInstallation } from './detect.js';
import { readJson, writeJsonAtomic, ensureDir } from '../util/fsx.js';
import { slugify } from '../util/slug.js';

export const PROFILES_SCHEMA_VERSION = 1;

/**
 * @typedef {Object} InstallationProfile
 * @property {string} id
 * @property {string} label
 * @property {string} path
 * @property {string} createdAt
 * @property {string} lastValidatedAt
 * @property {boolean} valid
 * @property {string|null} version
 * @property {number} moduleCount
 */

/**
 * @typedef {Object} ProfilesDocument
 * @property {number} schemaVersion
 * @property {string|null} activeId
 * @property {InstallationProfile[]} profiles
 */

export class ProfileStore {
  /** @param {{ rootDir: string }} options */
  constructor(options) {
    this.configDir = path.join(options.rootDir, 'config');
    this.file = path.join(this.configDir, 'profiles.json');
    /** @type {ProfilesDocument} */
    this.doc = { schemaVersion: PROFILES_SCHEMA_VERSION, activeId: null, profiles: [] };
  }

  async init() {
    await ensureDir(this.configDir);
    try {
      const loaded = await readJson(this.file);
      if (loaded?.schemaVersion === PROFILES_SCHEMA_VERSION && Array.isArray(loaded.profiles)) {
        this.doc = loaded;
      }
    } catch {
      /* no profiles yet */
    }
    return this;
  }

  async save() {
    await writeJsonAtomic(this.file, this.doc);
  }

  /** @returns {InstallationProfile[]} */
  list() {
    return this.doc.profiles.slice();
  }

  /** @returns {InstallationProfile|null} */
  active() {
    if (!this.doc.activeId) return null;
    return this.doc.profiles.find((profile) => profile.id === this.doc.activeId) ?? null;
  }

  /**
   * @param {string} rootPath
   * @param {string} label
   * @returns {Promise<{profile: InstallationProfile, created: boolean}>}
   */
  async add(rootPath, label) {
    const normalized = path.resolve(rootPath);
    const existing = this.doc.profiles.find((profile) => path.resolve(profile.path).toLowerCase() === normalized.toLowerCase());
    if (existing) return { profile: existing, created: false };

    const installation = await describeInstallation(normalized);
    if (!installation) {
      const error = new Error(`'${normalized}' is not a Mount & Blade: Warband installation.`);
      // @ts-expect-error machine-readable
      error.code = 'INVALID_INSTALLATION';
      throw error;
    }

    const base = slugify(label || path.basename(normalized), 'warband');
    const hash = createHash('sha1').update(normalized.toLowerCase()).digest('hex').slice(0, 6);
    /** @type {InstallationProfile} */
    const profile = {
      id: `${base}-${hash}`.slice(0, 64),
      label: (label || path.basename(normalized)).trim(),
      path: normalized,
      createdAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      valid: true,
      version: installation.version,
      moduleCount: installation.moduleCount,
    };

    this.doc.profiles.push(profile);
    if (!this.doc.activeId) this.doc.activeId = profile.id;
    await this.save();
    return { profile, created: true };
  }

  /** @param {string} id */
  async activate(id) {
    const profile = this.doc.profiles.find((candidate) => candidate.id === id);
    if (!profile) {
      const error = new Error(`Profile '${id}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'PROFILE_NOT_FOUND';
      throw error;
    }
    const installation = await describeInstallation(profile.path);
    if (!installation) {
      profile.valid = false;
      await this.save();
      const error = new Error(`Profile '${profile.label}' no longer points to a valid installation.`);
      // @ts-expect-error machine-readable
      error.code = 'INVALID_INSTALLATION';
      throw error;
    }
    profile.valid = true;
    profile.version = installation.version;
    profile.moduleCount = installation.moduleCount;
    profile.lastValidatedAt = new Date().toISOString();
    this.doc.activeId = id;
    await this.save();
    return profile;
  }

  /**
   * @param {string} id
   * @param {string} confirm Must equal the profile id.
   */
  async remove(id, confirm) {
    if (confirm !== id) {
      const error = new Error('Confirmation required: pass the profile id as confirm.');
      // @ts-expect-error machine-readable
      error.code = 'CONFIRMATION_REQUIRED';
      throw error;
    }
    const index = this.doc.profiles.findIndex((profile) => profile.id === id);
    if (index < 0) {
      const error = new Error(`Profile '${id}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'PROFILE_NOT_FOUND';
      throw error;
    }
    const [removed] = this.doc.profiles.splice(index, 1);
    if (this.doc.activeId === id) {
      this.doc.activeId = this.doc.profiles[0]?.id ?? null;
    }
    await this.save();
    return { removed, activeId: this.doc.activeId };
  }

  async validateAll() {
    for (const profile of this.doc.profiles) {
      const installation = await describeInstallation(profile.path);
      profile.valid = Boolean(installation);
      profile.version = installation?.version ?? null;
      profile.moduleCount = installation?.moduleCount ?? 0;
      profile.lastValidatedAt = new Date().toISOString();
    }
    await this.save();
    return this.list();
  }
}
