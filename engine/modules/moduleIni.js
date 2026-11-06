// @ts-check
/**
 * `module.ini` parser.
 *
 * VERIFIED: Warband reads a flat `key = value` INI (no sections) where `#`
 * starts a comment, keys are case-sensitive and the same key may appear many
 * times (`load_resource`). Unknown keys are ignored by the engine, so the
 * parser preserves them instead of rejecting the file.
 */

import { readTextFile } from '../util/textFile.js';

/**
 * @typedef {Object} ModuleIniEntry
 * @property {string} key
 * @property {string} value
 * @property {string} raw
 * @property {number} line
 * @property {string} comment
 */

/**
 * @typedef {Object} ModuleIni
 * @property {string} file
 * @property {string} encoding
 * @property {ModuleIniEntry[]} entries
 * @property {Map<string,string>} values
 * @property {string[]} duplicates
 * @property {string[]} commonResources
 * @property {string[]} moduleResources
 * @property {{singlePlayer:boolean,multiplayer:boolean}} capabilities
 * @property {{module:string|null,compatible:string|null,savegame:string|null,operationSet:string|null}} versions
 * @property {string|null} moduleName
 * @property {string[]} unknownKeys
 */

/** Keys that the 1.170/1.171 engine is known to consume (see docs). */
export const KNOWN_KEYS = new Set([
  'module_name', 'compatible_with_warband', 'compatible_multiplayer_version_no',
  'supports_directx_7', 'reduce_texture_loader_memory_usage', 'use_case_insensitive_mesh_searches',
  'use_texture_degration_cache', 'num_hints', 'auto_create_note_indices',
  'map_min_x', 'map_max_x', 'map_min_y', 'map_max_y', 'map_sea_direction', 'map_sea_wave_rotation',
  'map_sea_speed_x', 'map_sea_speed_y', 'map_river_direction', 'map_river_speed_x', 'map_river_speed_y',
  'air_friction_arrow', 'air_friction_bullet', 'map_tree_types', 'map_snow_tree_types',
  'map_steppe_tree_types', 'map_desert_tree_types', 'map_max_distance', 'has_tutorial',
  'time_multiplier', 'seeing_range', 'track_spotting_multiplier', 'player_wounded_treshold',
  'hero_wounded_treshold', 'skill_prisoner_management_bonus', 'skill_leadership_bonus',
  'base_companion_limit', 'player_xp_multiplier', 'hero_xp_multiplier', 'regulars_xp_multiplier',
  'display_wp_firearms', 'damage_interrupt_attack_threshold', 'damage_interrupt_attack_threshold_mp',
  'extra_penetration_factor_soak', 'extra_penetration_factor_reduction',
  'armor_soak_factor_against_cut', 'armor_soak_factor_against_pierce', 'armor_soak_factor_against_blunt',
  'armor_reduction_factor_against_cut', 'armor_reduction_factor_against_pierce',
  'armor_reduction_factor_against_blunt', 'horse_charge_damage_multiplier',
  'couched_lance_damage_multiplier', 'fall_damage_multiplier', 'shield_penetration_offset',
  'shield_penetration_factor', 'missile_damage_speed_power', 'melee_damage_speed_power',
  'multiplayer_walk_enabled', 'mission_object_prune_time', 'disable_food_slot',
  'scan_module_textures', 'scan_module_sounds', 'load_resource', 'load_mod_resource',
  'load_module_resource', 'limit_hair_colors', 'show_faction_color', 'show_quest_notes',
  'dont_load_regular_troop_inventories', 'disable_moveable_flag_optimization',
  'show_party_ids_instead_of_names', 'crush_through_treshold', 'can_crouch', 'can_objects_make_sound',
  'disable_zoom', 'use_advanced_formation', 'use_crossbow_as_firearm', 'can_reload_while_moving',
  'can_run_faster_with_skills', 'use_phased_reload', 'horses_try_running_away',
  'horses_rear_with_attack', 'lance_pike_effect_speed', 'no_friendly_fire_for_bots',
  'can_adjust_camera_distance', 'sync_ragdoll_effects', 'has_forced_particles',
  'can_use_scene_props_in_single_player', 'disable_attack_while_jumping', 'disable_high_hdr',
  'has_accessories_for_female', 'restrict_attacks_more_in_multiplayer', 'module_version',
  'compatible_module_version', 'compatible_savegame_module_version', 'works_with_version_min',
  'works_with_version_max', 'operation_set_version', 'has_single_player', 'has_multiplayer',
  'use_scene_unloading', 'map_min_elevation', 'auto_compute_party_radius',
  'disable_disband_on_terrain_type', 'use_strict_pathfinding_for_ships',
  'disable_force_leaving_conversations', 'shorter_pistol_aiming', 'apply_all_ammo_damage_modifiers',
  'maximum_number_of_notification_messages', 'ai_decide_direction_according_to_damage',
  'skill_points_per_level', 'attribute_points_per_level', 'weapon_points_per_level',
  'level_boundary_multiplier', 'attribute_required_per_skill_level', 'far_plane_distance',
  'battle_size_min', 'battle_size_max', 'blood_multiplier',
  'consider_weapon_length_for_weapon_quality', 'meek_modifier_speed_bonus',
  'timid_modifier_speed_bonus', 'give_performance_warnings', 'show_troop_upgrades_button',
  'show_multiplayer_gold',
]);

/** Keys where repetition is part of the format, not an error. */
const REPEATABLE_KEYS = new Set(['load_resource', 'load_mod_resource', 'load_module_resource']);

/**
 * @param {string} filePath
 * @returns {Promise<ModuleIni>}
 */
export async function parseModuleIniFile(filePath) {
  const { lines, encoding } = await readTextFile(filePath);
  /** @type {ModuleIniEntry[]} */
  const entries = [];
  /** @type {Map<string,string>} */
  const values = new Map();
  /** @type {Map<string,number>} */
  const seen = new Map();
  /** @type {string[]} */
  const duplicates = [];
  /** @type {string[]} */
  const commonResources = [];
  /** @type {string[]} */
  const moduleResources = [];
  /** @type {string[]} */
  const unknownKeys = [];

  lines.forEach((rawLine, index) => {
    const hash = rawLine.indexOf('#');
    const data = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).trim();
    const comment = hash >= 0 ? rawLine.slice(hash + 1).trim() : '';
    if (!data) return;

    const equals = data.indexOf('=');
    if (equals <= 0) return;
    const key = data.slice(0, equals).trim();
    const value = data.slice(equals + 1).trim();
    if (!key) return;

    entries.push({ key, value, raw: rawLine, line: index + 1, comment });
    if (seen.has(key) && !REPEATABLE_KEYS.has(key)) duplicates.push(key);
    if (!seen.has(key)) seen.set(key, index + 1);
    values.set(key, value);

    if (key === 'load_resource') commonResources.push(value);
    if (key === 'load_mod_resource' || key === 'load_module_resource') moduleResources.push(value);
    if (!KNOWN_KEYS.has(key)) unknownKeys.push(key);
  });

  return {
    file: filePath,
    encoding,
    entries,
    values,
    duplicates: [...new Set(duplicates)],
    commonResources,
    moduleResources,
    capabilities: {
      singlePlayer: values.get('has_single_player') !== '0',
      multiplayer: values.get('has_multiplayer') !== '0',
    },
    versions: {
      module: values.get('module_version') ?? null,
      compatible: values.get('compatible_module_version') ?? null,
      savegame: values.get('compatible_savegame_module_version') ?? null,
      operationSet: values.get('operation_set_version') ?? null,
    },
    moduleName: values.get('module_name') ?? null,
    unknownKeys: [...new Set(unknownKeys)],
  };
}
