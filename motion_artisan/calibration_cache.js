/**
 * Calibration Cache — 模型校准 localStorage 缓存层
 *
 * 第一次加载模型时自动测量 → 存缓存 → 后续加载同一模型直接复用。
 * 缓存 key: mmd_calibration_cache，按 model_id 索引。
 *
 * @module CalibrationCache
 */
(function() {
  'use strict';

  var CACHE_KEY = 'mmd_calibration_cache';

  function _readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return (typeof parsed === 'object' && parsed !== null) ? parsed : {};
    } catch (e) {
      console.warn('[CalibrationCache] read failed:', e.message);
      return {};
    }
  }

  function _writeCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn('[CalibrationCache] write failed:', e.message);
    }
  }

  /** 按 model_id 获取缓存的校准 profile */
  function get(modelId) {
    var cache = _readCache();
    return cache[modelId] || null;
  }

  /** 按 model_id 存入校准 profile */
  function set(modelId, profile) {
    var cache = _readCache();
    cache[modelId] = profile;
    _writeCache(cache);
  }

  /** 检查 model_id 是否已有缓存 */
  function has(modelId) {
    return !!get(modelId);
  }

  /** 清除全部缓存 */
  function clear() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  /** 清除指定 model_id 的缓存 */
  function remove(modelId) {
    var cache = _readCache();
    delete cache[modelId];
    _writeCache(cache);
  }

  /** 列出所有缓存的 model_id */
  function listKeys() {
    return Object.keys(_readCache());
  }

  window.CalibrationCache = {
    get: get,
    set: set,
    has: has,
    clear: clear,
    remove: remove,
    listKeys: listKeys,
  };
})();
