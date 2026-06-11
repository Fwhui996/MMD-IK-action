import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
import { MMDParser } from 'three/addons/libs/mmdparser.module.js';

import './styles.css';

const bridgeBaseUrl = new URLSearchParams(window.location.search).get('bridge') || 'http://127.0.0.1:8098';
const LAST_MODEL_STORAGE_KEY = 'qwenpaw-mmd-last-model/v1';
const OUTLINE_VISIBLE_THRESHOLD = 0.002;

const state = {
  scene: null,
  camera: null,
  renderer: null,
  effect: null,
  controls: null,
  ambientLight: null,
  keyLight: null,
  rimLight: null,
  helper: null,
  mesh: null,
  sceneModel: null,
  mixerClock: new THREE.Clock(),
  currentModel: null,
  currentMotion: null,
  mood: 'neutral',
  objectUrls: [],
  packageFiles: new Map(),
  packagePmxx: [],
  packageVmds: [],
  sceneModels: [],
  physics: true,
  ik: true,
  expressions: [],
  expressionControls: [],
  activeMorphs: new Map(),
  materialMorphs: new Map(),
  pmxMaterialMorphs: new Map(),
  pmxMorphWeights: new Map(),
  materialBaseStates: new Map(),
  sceneMaterialBaseStates: new Map(),
  outlineFrame: 0,
  ammoReady: false,
  isPlaying: false,
  motionFinishHandler: null,
  softEnabled: false,
  pmxCompatFixes: false,
  softBoneIndices: [],
  softRestQuats: [],
  rigidBodyDebug: null,
  cameraMinDistance: 0.5,
  cameraMaxDistance: 80,
  renderSettings: {
    global: {
      outline: 0.004,
      brightness: 1,
      saturation: 1,
      contrast: 1,
      ambient: 0.78,
      key: 1.25,
      rim: 0.45,
      exposure: 1.05,
    },
  },
};

const SOFT_PATTERNS = [
  { pat: '裙', maxAngle: 0.08 },
  { pat: 'スカート', maxAngle: 0.08 },
  { pat: '外套', maxAngle: 0.1 },
  { pat: '披风', maxAngle: 0.1 },
  { pat: 'マント', maxAngle: 0.1 },
  { pat: '领结', maxAngle: 0.08 },
  { pat: '领带', maxAngle: 0.1 },
  { pat: '飘', maxAngle: 0.12 },
  { pat: 'ribbon', maxAngle: 0.12 },
];

const EXPRESSION_PRESETS = {
  neutral: { label: '预设：中性', morphs: {} },
  happy: { label: '预设：开心', morphs: { '笑い': 1, 'にやり': 0.4, '笑': 1 } },
  shy: { label: '预设：害羞', morphs: { '困る': 0.6, '笑い': 0.3, '照れ': 1, '脸红': 1 } },
  embarrassed: { label: '预设：脸红', morphs: { '照れ': 1, '困る': 0.4, '笑い': 0.2, '脸红': 1 } },
  cute: { label: '预设：可爱', morphs: { '笑い': 0.7, 'ウィンク': 1, '笑': 0.7 } },
  wink: { label: '预设：眨眼', morphs: { 'ウィンク': 1, 'まばたき': 0.5 } },
  blink: { label: '预设：闭眼', morphs: { 'まばたき': 1, '閉じ': 1 } },
  sad: { label: '预设：悲伤', morphs: { '困る': 0.8, '涙': 0.5 } },
  angry: { label: '预设：生气', morphs: { '怒り': 0.9, 'にやり': 0.2 } },
  surprised: { label: '预设：惊讶', morphs: { 'びっくり': 1, '驚': 1 } },
  laugh: { label: '预设：大笑', morphs: { '笑い': 1, 'ワ': 1, '笑': 1 } },
};

const app = document.querySelector('#app');
app.innerHTML = `
  <main id="viewer">
    <div id="chatDock">
      <button id="chatDockToggle" type="button">对话</button>
      <div id="chatDockPanel">
        <div id="chatHistoryWrap">
          <div id="chatHistory" aria-live="polite">
            <div id="chatEmpty">QwenPaw 的回复会显示在这里</div>
          </div>
        </div>
        <div id="chatInputRow">
          <input id="chatInput" type="text" placeholder="输入要发给 QwenPaw 的内容" />
          <button id="sendChatBtn" type="button">发送</button>
        </div>
        <div id="chatStatus">准备发送到 QwenPaw</div>
      </div>
    </div>
  </main>
  <aside id="hud">
    <header>
      <strong>QwenPaw MMD 桌宠</strong>
      <span id="status">正在启动 Three.js 渲染器...</span>
      <button id="hudCollapseBtn" type="button">折叠面板</button>
    </header>

    <section class="panel-section">
      <label class="file-drop">
        <input id="packageInput" type="file" accept=".zip" />
        <span>加载模型压缩包 ZIP</span>
        <small>压缩包里可以包含 PMX、贴图和 VMD</small>
      </label>
      <select id="packageModelSelect">
        <option value="">还没有导入 PMX</option>
      </select>
      <button id="loadPackageModelBtn">加载选中的 PMX</button>
      <button id="deleteModelBtn" type="button">删除选中人物模型</button>
    </section>

    <section class="panel-section">
      <label class="file-drop compact">
        <input id="pmxInput" type="file" accept=".zip" />
        <span>加载场景模型</span>
      </label>
      <select id="sceneModelSelect">
        <option value="">还没有导入场景</option>
      </select>
      <button id="loadSceneModelBtn" type="button">加载选中场景</button>
      <button id="deleteSceneModelBtn" type="button">删除选中场景</button>
    </section>

    <section class="panel-section">
      <label class="file-drop compact">
        <input id="vmdInput" type="file" accept=".vmd" />
        <span>导入 VMD 动作</span>
      </label>
      <select id="packageVmdSelect">
        <option value="">还没有导入 VMD</option>
      </select>
      <button id="playPackageVmdBtn">播放选中 VMD</button>
      <button id="deleteVmdBtn" type="button">删除选中 VMD</button>
    </section>

    <section class="panel-section">
      <label class="toggle-row">
        <span>物理效果</span>
        <input id="physicsToggle" type="checkbox" checked />
      </label>
      <label class="toggle-row">
        <span>IK 解算</span>
        <input id="ikToggle" type="checkbox" checked />
      </label>
      <label class="toggle-row">
        <span>软部件保护</span>
        <input id="softToggle" type="checkbox" />
      </label>
      <label class="toggle-row">
        <span>PMX 兼容修复</span>
        <input id="pmxCompatToggle" type="checkbox" />
      </label>
      <button id="resetPhysicsBtn">重置物理</button>
      <label class="control-row">
        <span>表情/材质表情</span>
        <select id="expressionSelect">
          <option value="">加载模型后显示</option>
        </select>
      </label>
      <label class="control-row">
        <span>权重 <b id="expressionWeightLabel">0.00</b></span>
        <input id="expressionWeight" type="range" min="0" max="1" step="0.01" value="0" />
      </label>
    </section>

    <section class="panel-section">
      <button id="resetViewBtn">重置视角</button>
      <button id="renderSettingsToggle" type="button">渲染调节</button>
      <div id="renderSettingsPanel" class="render-settings collapsed">
        <label class="control-row">
          <span>描边 <b id="outlineValue">0.004</b></span>
          <input id="outlineRange" type="range" min="0" max="0.012" step="0.0005" value="0.004" />
        </label>
        <label class="control-row">
          <span>亮度 <b id="brightnessValue">1.00</b></span>
          <input id="brightnessRange" type="range" min="0.2" max="2" step="0.01" value="1" />
        </label>
        <label class="control-row">
          <span>饱和度 <b id="saturationValue">1.00</b></span>
          <input id="saturationRange" type="range" min="0" max="2" step="0.01" value="1" />
        </label>
        <label class="control-row">
          <span>对比度 <b id="contrastValue">1.00</b></span>
          <input id="contrastRange" type="range" min="0.2" max="2" step="0.01" value="1" />
        </label>
        <label class="control-row">
          <span>环境光 <b id="ambientValue">0.78</b></span>
          <input id="ambientRange" type="range" min="0" max="2" step="0.01" value="0.78" />
        </label>
        <label class="control-row">
          <span>主光 <b id="keyValue">1.25</b></span>
          <input id="keyRange" type="range" min="0" max="3" step="0.01" value="1.25" />
        </label>
        <label class="control-row">
          <span>轮廓光 <b id="rimValue">0.45</b></span>
          <input id="rimRange" type="range" min="0" max="2" step="0.01" value="0.45" />
        </label>
        <label class="control-row">
          <span>曝光 <b id="exposureValue">1.05</b></span>
          <input id="exposureRange" type="range" min="0.5" max="2" step="0.01" value="1.05" />
        </label>
        <button id="saveRenderSettingsBtn" type="button">保存渲染方案</button>
      </div>
    </section>

    <button id="logToggleBtn" type="button">显示/隐藏日志</button>
    <pre id="log" class="collapsed"></pre>
  </aside>
`;

const statusEl = document.querySelector('#status');
const logEl = document.querySelector('#log');
const packageInput = document.querySelector('#packageInput');
const pmxInput = document.querySelector('#pmxInput');
const vmdInput = document.querySelector('#vmdInput');
const packageModelSelect = document.querySelector('#packageModelSelect');
const sceneModelSelect = document.querySelector('#sceneModelSelect');
const packageVmdSelect = document.querySelector('#packageVmdSelect');
const deleteModelBtn = document.querySelector('#deleteModelBtn');
const loadSceneModelBtn = document.querySelector('#loadSceneModelBtn');
const deleteSceneModelBtn = document.querySelector('#deleteSceneModelBtn');
const deleteVmdBtn = document.querySelector('#deleteVmdBtn');
const hudCollapseBtn = document.querySelector('#hudCollapseBtn');
const physicsToggle = document.querySelector('#physicsToggle');
const ikToggle = document.querySelector('#ikToggle');
const softToggle = document.querySelector('#softToggle');
const pmxCompatToggle = document.querySelector('#pmxCompatToggle');
const resetPhysicsBtn = document.querySelector('#resetPhysicsBtn');
const expressionSelect = document.querySelector('#expressionSelect');
const expressionWeight = document.querySelector('#expressionWeight');
const expressionWeightLabel = document.querySelector('#expressionWeightLabel');
const chatInput = document.querySelector('#chatInput');
const sendChatBtn = document.querySelector('#sendChatBtn');
const chatDock = document.querySelector('#chatDock');
const chatDockToggle = document.querySelector('#chatDockToggle');
const chatHistory = document.querySelector('#chatHistory');
const chatStatus = document.querySelector('#chatStatus');
const logToggleBtn = document.querySelector('#logToggleBtn');
const renderSettingsToggle = document.querySelector('#renderSettingsToggle');
const renderSettingsPanel = document.querySelector('#renderSettingsPanel');
const saveRenderSettingsBtn = document.querySelector('#saveRenderSettingsBtn');
const renderControls = {
  outline: { input: document.querySelector('#outlineRange'), label: document.querySelector('#outlineValue'), digits: 4 },
  brightness: { input: document.querySelector('#brightnessRange'), label: document.querySelector('#brightnessValue'), digits: 2 },
  saturation: { input: document.querySelector('#saturationRange'), label: document.querySelector('#saturationValue'), digits: 2 },
  contrast: { input: document.querySelector('#contrastRange'), label: document.querySelector('#contrastValue'), digits: 2 },
  ambient: { input: document.querySelector('#ambientRange'), label: document.querySelector('#ambientValue'), digits: 2 },
  key: { input: document.querySelector('#keyRange'), label: document.querySelector('#keyValue'), digits: 2 },
  rim: { input: document.querySelector('#rimRange'), label: document.querySelector('#rimValue'), digits: 2 },
  exposure: { input: document.querySelector('#exposureRange'), label: document.querySelector('#exposureValue'), digits: 2 },
};

function log(message) {
  logEl.textContent += `[${new Date().toLocaleTimeString()}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(`[QwenPaw MMD] ${message}`);
}

function setStatus(message) {
  statusEl.textContent = message;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      if (window.Ammo) resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`无法加载 ${src}`));
    document.head.appendChild(script);
  });
}

async function initAmmo() {
  if (state.ammoReady) return true;
  try {
    setStatus('正在初始化 Ammo 物理引擎...');
    await loadScript('/ammo.js');
    if (typeof window.Ammo === 'function' && !window.Ammo.btVector3) {
      window.Ammo = await window.Ammo();
    }
    if (!window.Ammo?.btVector3) throw new Error('Ammo 未正确初始化');
    globalThis.Ammo = window.Ammo;
    state.ammoReady = true;
    log('Ammo 物理引擎已就绪。');
    return true;
  } catch (error) {
    log(`Ammo 初始化失败，稍后会在播放动作时重试：${error.message}`);
    return false;
  }
}

function revokeObjectUrls() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
}

function rememberObjectUrl(url) {
  state.objectUrls.push(url);
  return url;
}

function normalizeZipPath(path) {
  let value = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  value = value.replace(/^qwenpaw-package:\/+/, '');
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep original text when it is not URL-encoded.
    }
  }
  return value;
}

function basename(path) {
  return normalizeZipPath(path).split('/').pop();
}

function cleanModelName(model) {
  const raw = String(model?.name || '');
  const source = raw.includes('/') || raw.includes('\\') ? basename(raw) : (raw || basename(model?.path || ''));
  return source.replace(/\.pmx$/i, '') || basename(model?.path || '') || '模型';
}

function modelIdentity(model) {
  const source = String(basename(model?.path || '') || cleanModelName(model)).replace(/\.pmx$/i, '');
  return source.replace(/_\d+$/g, '').toLowerCase();
}

function dedupeModels(models) {
  const seen = new Set();
  const result = [];
  for (const model of models) {
    const key = modelIdentity(model);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    model.name = cleanModelName(model);
    result.push(model);
  }
  return result;
}

function makeObjectUrl(blob) {
  return rememberObjectUrl(URL.createObjectURL(blob));
}

function fileUrl(file) {
  return makeObjectUrl(file);
}

function virtualUrl(path) {
  return `qwenpaw-package:///${normalizeZipPath(path)}`;
}

function virtualBase(path) {
  const normalized = normalizeZipPath(path);
  const slash = normalized.lastIndexOf('/');
  const base = slash >= 0 ? normalized.slice(0, slash + 1) : '';
  return `qwenpaw-package:///${base}`;
}

function assetUrl(path) {
  if (!path) return path;
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  return `${bridgeBaseUrl}/${path.replace(/^\/+/, '')}`;
}

function resourceBase(path) {
  const url = assetUrl(path);
  return url.slice(0, url.lastIndexOf('/') + 1);
}

function findPackageFile(path) {
  const normalized = normalizeZipPath(path);
  if (state.packageFiles.has(normalized)) return state.packageFiles.get(normalized);

  const bySuffix = [];
  for (const [key, value] of state.packageFiles.entries()) {
    if (key.endsWith('/' + normalized) || key.endsWith(normalized)) {
      bySuffix.push(value);
    }
  }
  if (bySuffix.length > 0) return bySuffix[0];

  const name = basename(normalized).toLowerCase();
  for (const [key, value] of state.packageFiles.entries()) {
    if (basename(key).toLowerCase() === name) return value;
  }
  return null;
}

function setupPackageLoading(loader) {
  loader.manager.setURLModifier((url) => {
    if (/^(blob:|data:)/i.test(url)) return url;
    const clean = normalizeZipPath(url.split(/[?#]/)[0]);
    const file = findPackageFile(clean);
    return file ? file.url : url;
  });
}

const RENDER_SETTINGS_STORAGE_KEY = 'qwenpaw-mmd-render-settings/v2';

function mergeRenderSettings(saved) {
  if (!saved || typeof saved !== 'object') return;
  if (saved.global && typeof saved.global === 'object') {
    Object.assign(state.renderSettings.global, saved.global);
  }
  if (saved.avatar && typeof saved.avatar === 'object') {
    Object.assign(state.renderSettings.global, {
      outline: saved.avatar.outline ?? state.renderSettings.global.outline,
      brightness: saved.avatar.brightness ?? state.renderSettings.global.brightness,
      saturation: saved.avatar.saturation ?? state.renderSettings.global.saturation,
      contrast: saved.avatar.contrast ?? state.renderSettings.global.contrast,
    });
  }
}

function loadSavedRenderSettings() {
  try {
    mergeRenderSettings(JSON.parse(localStorage.getItem(RENDER_SETTINGS_STORAGE_KEY) || 'null'));
  } catch (error) {
    log(`读取渲染方案失败：${error.message}`);
  }
}

function saveRenderSettings() {
  localStorage.setItem(RENDER_SETTINGS_STORAGE_KEY, JSON.stringify(state.renderSettings));
  log('渲染方案已保存。');
}

function applyRenderSettings() {
  const global = state.renderSettings.global;
  if (state.ambientLight) state.ambientLight.intensity = global.ambient;
  if (state.keyLight) state.keyLight.intensity = global.key;
  if (state.rimLight) state.rimLight.intensity = global.rim;
  if (state.renderer) {
    state.renderer.toneMappingExposure = global.exposure;
    state.renderer.domElement.style.filter = `brightness(${global.brightness}) saturate(${global.saturation}) contrast(${global.contrast})`;
  }
  applyObjectRenderSettings(state.mesh, state.renderSettings.global, state.materialBaseStates);
  applyObjectRenderSettings(state.sceneModel, state.renderSettings.global, state.sceneMaterialBaseStates);
  updateOutlineVisibility();
}

function applyObjectRenderSettings(root, settings, baseStates) {
  if (!root) return;
  root.traverse((child) => {
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of materials) {
      if (!mat) continue;
      const base = baseStates.get(mat.uuid);
      restoreRenderBaseColor(mat, base);
      if (mat.userData?.outlineParameters) {
        mat.userData.outlineParameters.thickness = outlineThicknessForMaterial(mat, settings.outline);
        mat.userData.outlineParameters.alpha = outlineAlphaForMaterial(mat, mat.userData.outlineParameters.alpha ?? mat.opacity);
        mat.userData.outlineParameters.visible = shouldShowOutline(mat, settings.outline);
      }
      syncMmdMaterialUniforms(mat);
      mat.needsUpdate = true;
    }
  });
}

function restoreRenderBaseColor(mat, base) {
  if (mat.color && base?.color) mat.color.copy(base.color);
  if (mat.emissive && base?.emissive) mat.emissive.copy(base.emissive);
  if (mat.userData?.renderOriginalMap) mat.map = mat.userData.renderOriginalMap;
}

function applyColorAdjustment(mat, base, settings) {
  if (mat.color && base?.color) {
    mat.color.copy(adjustColor(base.color, settings));
  }
  if (mat.emissive && base?.emissive) {
    mat.emissive.copy(adjustColor(base.emissive, settings));
  }
  if (mat.map?.image) {
    applyTextureAdjustment(mat, settings);
  }
}

function adjustColor(color, settings) {
  const adjusted = color.clone();
  const gray = adjusted.r * 0.2126 + adjusted.g * 0.7152 + adjusted.b * 0.0722;
  adjusted.r = gray + (adjusted.r - gray) * settings.saturation;
  adjusted.g = gray + (adjusted.g - gray) * settings.saturation;
  adjusted.b = gray + (adjusted.b - gray) * settings.saturation;
  adjusted.r = 0.5 + (adjusted.r - 0.5) * settings.contrast;
  adjusted.g = 0.5 + (adjusted.g - 0.5) * settings.contrast;
  adjusted.b = 0.5 + (adjusted.b - 0.5) * settings.contrast;
  adjusted.multiplyScalar(settings.brightness);
  adjusted.r = THREE.MathUtils.clamp(adjusted.r, 0, 1);
  adjusted.g = THREE.MathUtils.clamp(adjusted.g, 0, 1);
  adjusted.b = THREE.MathUtils.clamp(adjusted.b, 0, 1);
  return adjusted;
}

function applyTextureAdjustment(mat, settings) {
  const sourceTexture = mat.userData.renderOriginalMap || mat.map;
  const original = getOriginalTextureCanvas(sourceTexture);
  if (!original) return;
  const canvas = mat.userData.renderAdjustedCanvas || document.createElement('canvas');
  if (canvas.width !== original.width || canvas.height !== original.height) {
    canvas.width = original.width;
    canvas.height = original.height;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(original, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;
    const gray = r * 0.2126 + g * 0.7152 + b * 0.0722;
    r = gray + (r - gray) * settings.saturation;
    g = gray + (g - gray) * settings.saturation;
    b = gray + (b - gray) * settings.saturation;
    r = 0.5 + (r - 0.5) * settings.contrast;
    g = 0.5 + (g - 0.5) * settings.contrast;
    b = 0.5 + (b - 0.5) * settings.contrast;
    r = THREE.MathUtils.clamp(r * settings.brightness, 0, 1);
    g = THREE.MathUtils.clamp(g * settings.brightness, 0, 1);
    b = THREE.MathUtils.clamp(b * settings.brightness, 0, 1);
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
  }
  ctx.putImageData(image, 0, 0);
  if (!mat.userData.renderAdjustedMap) {
    mat.userData.renderOriginalMap = mat.map;
    mat.userData.renderAdjustedCanvas = canvas;
    mat.userData.renderAdjustedMap = new THREE.CanvasTexture(canvas);
    mat.userData.renderAdjustedMap.flipY = mat.map.flipY;
    mat.userData.renderAdjustedMap.wrapS = mat.map.wrapS;
    mat.userData.renderAdjustedMap.wrapT = mat.map.wrapT;
    mat.userData.renderAdjustedMap.colorSpace = mat.map.colorSpace;
    mat.userData.renderAdjustedMap.repeat.copy(mat.map.repeat);
    mat.userData.renderAdjustedMap.offset.copy(mat.map.offset);
    mat.userData.renderAdjustedMap.rotation = mat.map.rotation;
    mat.userData.renderAdjustedMap.center.copy(mat.map.center);
    mat.map = mat.userData.renderAdjustedMap;
  } else {
    mat.userData.renderAdjustedMap.needsUpdate = true;
  }
}

function getOriginalTextureCanvas(texture) {
  const source = texture.userData.renderOriginalCanvas || texture.image;
  if (!source?.width || !source?.height) return null;
  if (texture.userData.renderOriginalCanvas) return texture.userData.renderOriginalCanvas;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth || source.videoWidth || source.width;
    canvas.height = source.naturalHeight || source.videoHeight || source.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    texture.userData.renderOriginalCanvas = canvas;
    return canvas;
  } catch (error) {
    log(`贴图调色失败：${error.message}`);
    return null;
  }
}

function setRenderSetting(name, value) {
  if (!(name in state.renderSettings.global)) return;
  state.renderSettings.global[name] = value;
  const control = renderControls[name];
  if (control?.label) control.label.textContent = value.toFixed(control.digits);
  applyRenderSettings();
}

function addChatBubble(role, text) {
  if (!chatHistory || !text) return;
  const empty = document.querySelector('#chatEmpty');
  if (empty) empty.remove();
  const row = document.createElement('div');
  row.className = `chat-bubble ${role}`;
  row.textContent = text;
  chatHistory.appendChild(row);
  while (chatHistory.children.length > 10) {
    chatHistory.removeChild(chatHistory.firstChild);
  }
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  sendChatBtn.disabled = true;
  chatStatus.textContent = '已发送，等待 QwenPaw 回复...';
  addChatBubble('user', text);
  log(`我：${text}`);
  try {
    const response = await fetch(`${bridgeBaseUrl}/api/qwenpaw/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const reply = data.response?.text || data.response?.message || JSON.stringify(data.response);
    if (reply) {
      addChatBubble('assistant', reply);
      log(`QwenPaw：${reply}`);
      chatStatus.textContent = '已收到 QwenPaw 回复';
    } else {
      chatStatus.textContent = 'QwenPaw 已响应，但没有返回可显示文本';
    }
  } catch (error) {
    addChatBubble('error', `发送失败：${error.message}`);
    chatStatus.textContent = '发送失败';
    log(`发送到 QwenPaw 失败：${error.message}`);
  } finally {
    sendChatBtn.disabled = false;
    chatInput.focus();
  }
}

function syncRenderControls() {
  for (const [name, control] of Object.entries(renderControls)) {
    if (!control.input) continue;
    const value = state.renderSettings.global[name];
    control.input.value = String(value);
    if (control.label) control.label.textContent = value.toFixed(control.digits);
  }
}

function initScene() {
  const viewer = document.querySelector('#viewer');
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0x080a0f);

  state.camera = new THREE.PerspectiveCamera(38, viewer.clientWidth / viewer.clientHeight, 0.05, 500);
  state.camera.position.set(0, 5, 15);

  state.renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: true,
  });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setSize(viewer.clientWidth, viewer.clientHeight);
  state.renderer.shadowMap.enabled = true;
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  viewer.appendChild(state.renderer.domElement);

  state.effect = new OutlineEffect(state.renderer, {
    defaultThickness: 0.004,
    defaultColor: new THREE.Color(0x000000),
    defaultAlpha: 1,
  });

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.target.set(0, 7.5, 0);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.08;
  state.controls.enableZoom = false;
  state.controls.minDistance = state.cameraMinDistance;
  state.controls.maxDistance = state.cameraMaxDistance;
  state.controls.addEventListener('change', clampCameraDistance);
  state.renderer.domElement.addEventListener('wheel', handleSmoothWheelZoom, { passive: false });
  state.controls.update();

  state.ambientLight = new THREE.AmbientLight(0xffffff, state.renderSettings.global.ambient);
  state.scene.add(state.ambientLight);

  state.keyLight = new THREE.DirectionalLight(0xffffff, state.renderSettings.global.key);
  state.keyLight.position.set(8, 14, 10);
  state.keyLight.castShadow = true;
  state.scene.add(state.keyLight);

  state.rimLight = new THREE.DirectionalLight(0x8fd7ff, state.renderSettings.global.rim);
  state.rimLight.position.set(-8, 10, -12);
  state.scene.add(state.rimLight);
  applyRenderSettings();

  state.helper = new MMDAnimationHelper({
    afterglow: 2.0,
    resetPhysicsOnLoop: false,
  });
  state.helper.onBeforePhysics = syncGrantFollowersBeforePhysics;

  window.addEventListener('resize', () => {
    const w = viewer.clientWidth;
    const h = viewer.clientHeight;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h);
  });
}

async function loadModel(path) {
  await loadModelFromUrl(assetUrl(path), cleanModelName({ path }), resourceBase(path), { serverPath: path });
}

async function rememberLastModel(path, name, vmds = state.packageVmds.map((item) => item.path)) {
  const item = { path, name: cleanModelName({ path, name }), vmds: vmds || [] };
  try {
    localStorage.setItem(LAST_MODEL_STORAGE_KEY, JSON.stringify(item));
  } catch {
    // Browser storage can be unavailable in some embedded contexts.
  }
  try {
    const response = await fetch(`${bridgeBaseUrl}/api/runtime/last-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    log(`保存最近模型失败：${error.message}`);
  }
}

async function rememberSceneModel(path, name) {
  try {
    await fetch(`${bridgeBaseUrl}/api/runtime/scene-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name }),
    });
  } catch (error) {
    log(`保存场景模型失败：${error.message}`);
  }
}

async function rememberVmd(path, name) {
  try {
    await fetch(`${bridgeBaseUrl}/api/runtime/vmds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name }),
    });
  } catch (error) {
    log(`保存 VMD 失败：${error.message}`);
  }
}

async function restoreLastModel() {
  try {
    const response = await fetch(`${bridgeBaseUrl}/api/runtime/last-model`);
    const data = await response.json();
    let scenePath = '';
    try {
      const sceneResponse = await fetch(`${bridgeBaseUrl}/api/runtime/scene-model`);
      if (sceneResponse.ok) {
        const sceneData = await sceneResponse.json();
        scenePath = sceneData.scene_model?.path || '';
      }
    } catch {
      scenePath = '';
    }
    let localLast = null;
    try {
      localLast = JSON.parse(localStorage.getItem(LAST_MODEL_STORAGE_KEY) || 'null');
    } catch {
      localLast = null;
    }
    let models = data.models?.length ? data.models : (data.last_model ? [data.last_model] : []);
    if (localLast?.path && !models.some((model) => model.path === localLast.path)) {
      models.unshift(localLast);
    }
    models = models.filter((model) => model?.path && model.path !== scenePath);
    if (models.length < 2) {
      try {
        const modelResponse = await fetch(`${bridgeBaseUrl}/api/models`);
        const importedModels = await modelResponse.json();
        const existing = new Set(models.map((model) => modelIdentity(model)));
        for (const model of importedModels || []) {
          if (model.path === scenePath) continue;
          const key = modelIdentity(model);
          if (!existing.has(key)) {
            existing.add(key);
            models.push({ path: model.path, name: model.name, vmds: [] });
          }
        }
      } catch (error) {
        log(`读取模型历史失败：${error.message}`);
      }
    }
    models = dedupeModels(models);
    if (models.length) {
      state.packagePmxx = models.map((model) => ({
        path: model.path,
        url: assetUrl(model.path),
        serverPath: model.path,
        name: model.name,
        vmds: model.vmds || [],
      }));
      updatePackageSelects();
    }
    const preferred = models.find((model) => model.path === data.last_model?.path)
      || models.find((model) => model.path === localLast?.path);
    const ordered = preferred ? [preferred, ...models.filter((model) => model.path !== preferred.path)] : models;
    for (const model of ordered) {
      if (!model?.path) continue;
      try {
        state.packageVmds = (model.vmds || []).map((path) => ({ path, url: assetUrl(path), serverPath: path }));
        updatePackageSelects();
        packageModelSelect.value = model.path;
        log(`自动恢复最近模型：${model.name || model.path}`);
        await loadModel(model.path);
        return;
      } catch (error) {
        log(`恢复模型失败，尝试下一个：${model.name || model.path}，${error.message}`);
      }
    }
  } catch (error) {
    log(`自动恢复最近模型失败：${error.message}`);
  }
}

async function restoreSceneModel() {
  try {
    const response = await fetch(`${bridgeBaseUrl}/api/runtime/scene-model`);
    const data = await response.json();
    state.sceneModels = (data.scene_models || []).map((model) => ({
      path: model.path,
      url: assetUrl(model.path),
      serverPath: model.path,
      name: cleanModelName(model),
    }));
    updatePackageSelects();
    const sceneModel = data.scene_model;
    if (!sceneModel?.path) return;
    if (!state.sceneModels.some((model) => model.path === sceneModel.path)) {
      state.sceneModels.unshift({
        path: sceneModel.path,
        url: assetUrl(sceneModel.path),
        serverPath: sceneModel.path,
        name: cleanModelName(sceneModel),
      });
      updatePackageSelects();
    }
    sceneModelSelect.value = sceneModel.path;
    log(`自动恢复场景模型：${sceneModel.name || sceneModel.path}`);
    await loadSceneModelFromUrl(assetUrl(sceneModel.path), sceneModel.name || sceneModel.path, resourceBase(sceneModel.path));
  } catch (error) {
    log(`自动恢复场景模型失败：${error.message}`);
  }
}

async function restoreVmdHistory() {
  try {
    const response = await fetch(`${bridgeBaseUrl}/api/runtime/vmds`);
    const data = await response.json();
    state.packageVmds = (data.vmds || []).map((vmd) => ({
      path: vmd.path,
      url: assetUrl(vmd.path),
      serverPath: vmd.path,
      name: vmd.name || basename(vmd.path),
    }));
    updatePackageSelects();
  } catch (error) {
    log(`读取 VMD 历史失败：${error.message}`);
  }
}

async function loadModelFromUrl(url, label, resourcePath = '', options = {}) {
  if (state.physics) await initAmmo();
  const loader = new MMDLoader();
  if (resourcePath) loader.setResourcePath(resourcePath);
  setupPackageLoading(loader);
  setStatus(`正在加载 PMX：${label}`);

  if (state.mesh) {
    state.helper.remove(state.mesh);
    state.scene.remove(state.mesh);
    state.mesh = null;
  }

  const mesh = await loader.loadAsync(url);
  applyModelStyle(mesh);
  state.mesh = mesh;
  state.currentModel = label;
  state.scene.add(mesh);
  captureRestPose(mesh);
  await loadPmxMaterialMorphs(url, loader);
  addMeshToHelper(mesh);
  buildSoftBoneList(mesh);
  frameModel(mesh);
  refreshExpressionList();
  updateOutlineVisibility();
  setStatus(`PMX 已加载：${label}`);
  const mmd = mesh.geometry?.userData?.MMD || {};
  log(`PMX 加载完成，骨骼=${mesh.skeleton?.bones?.length || 0}，刚体=${mmd.rigidBodies?.length || 0}，约束=${mmd.constraints?.length || 0}`);
  if (state.physics && (mmd.rigidBodies?.length || 0) === 0) {
    log('这个 PMX 没检测到刚体数据，所以不会有头发/裙摆等 MMD 物理。');
  }
  if (options.serverPath) await rememberLastModel(options.serverPath, label);
}

async function loadSceneModelFromUrl(url, label, resourcePath = '', options = {}) {
  const loader = new MMDLoader();
  if (resourcePath) loader.setResourcePath(resourcePath);
  setupPackageLoading(loader);
  setStatus(`正在加载场景模型：${label}`);

  if (state.sceneModel) {
    state.scene.remove(state.sceneModel);
    state.sceneModel.traverse((child) => {
      if (child.geometry) child.geometry.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) mat?.dispose?.();
    });
    state.sceneModel = null;
  }

  const sceneModel = await loader.loadAsync(url);
  if (options?.serverPath) sceneModel.userData.serverPath = options.serverPath;
  applySceneModelStyle(sceneModel);
  state.sceneModel = sceneModel;
  state.scene.add(sceneModel);
  applyRenderSettings();
  setStatus(`场景模型已加载：${label}`);
  const mmd = sceneModel.geometry?.userData?.MMD || {};
  log(`场景模型加载完成：${label}，材质=${Array.isArray(sceneModel.material) ? sceneModel.material.length : 1}，刚体=${mmd.rigidBodies?.length || 0}。`);
}

function applySceneModelStyle(mesh) {
  state.sceneMaterialBaseStates.clear();
  mesh.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = false;
      child.receiveShadow = true;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of materials) {
      if (!mat) continue;
      mat.opacity = THREE.MathUtils.clamp(Number.isFinite(mat.opacity) ? mat.opacity : 1, 0, 1);
      mat.transparent = mat.opacity < 0.99;
      mat.depthWrite = mat.opacity >= 0.99;
      mat.needsUpdate = true;
      state.sceneMaterialBaseStates.set(mat.uuid, captureMaterialState(mat));
    }
  });
}

async function loadPmxMaterialMorphs(url, loader) {
  state.pmxMaterialMorphs.clear();
  state.pmxMorphWeights.clear();
  try {
    const resolved = loader.manager.resolveURL(url);
    const response = await fetch(resolved);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const parser = new MMDParser.Parser();
    const data = parser.parsePmx(buffer, true);
    const morphs = data.morphs || [];
    const morphByIndex = new Map(morphs.map((morph, index) => [index, morph]));
    const materials = Array.isArray(state.mesh?.material) ? state.mesh.material : [state.mesh?.material];
    for (const morph of morphs) {
      if (![0, 8].includes(morph.type) || !morph.elements?.length) continue;
      const ops = [];
      if (morph.type === 8) {
        addPmxMaterialOps(ops, morph.elements, materials, 1);
      } else {
        for (const element of morph.elements) {
          const child = morphByIndex.get(element.index);
          if (child?.type === 8) addPmxMaterialOps(ops, child.elements, materials, element.ratio ?? 1);
        }
      }
      if (ops.length) state.pmxMaterialMorphs.set(morph.name, { name: morph.name, ops });
    }
    recomputePmxMaterialMorphs();
    log(`PMX 材质表情：${state.pmxMaterialMorphs.size} 个。`);
  } catch (error) {
    log(`PMX 材质表情解析失败：${error.message}`);
  }
}

function addPmxMaterialOps(ops, elements, materials, ratio = 1) {
  for (const element of elements || []) {
    const targetMaterials = element.index === -1 ? materials : [materials[element.index]];
    for (const mat of targetMaterials) {
      if (!mat) continue;
      ops.push({
        materialIndex: element.index,
        material: mat,
        ratio,
        opType: element.type,
        diffuse: element.diffuse || [0, 0, 0, 0],
        specular: element.specular || [0, 0, 0],
        shininess: element.shininess,
        ambient: element.ambient || [0, 0, 0],
        edgeColor: element.edgeColor || [0, 0, 0, 0],
        edgeSize: element.edgeSize,
        textureColor: element.textureColor || [0, 0, 0, 0],
        sphereTextureColor: element.sphereTextureColor || [0, 0, 0, 0],
        toonColor: element.toonColor || [0, 0, 0, 0],
      });
    }
  }
}

function captureRestPose(mesh) {
  state.restPoseQuat = [];
  state.restPosePos = [];
  for (const bone of mesh.skeleton?.bones || []) {
    state.restPoseQuat.push(bone.quaternion.clone());
    state.restPosePos.push(bone.position.clone());
  }
}

function buildSoftBoneList(mesh) {
  state.softBoneIndices = [];
  state.softRestQuats = [];
  const bones = mesh.skeleton?.bones || [];
  const bridgeNames = new Set(['右袖親', '後腰', '领结', '领带', '後外套']);
  for (let i = 0; i < bones.length; i++) {
    const name = bones[i].name || '';
    if (bridgeNames.has(name)) continue;
    if (!SOFT_PATTERNS.some((rule) => name.toLowerCase().includes(rule.pat.toLowerCase()))) continue;
    const rest = state.restPoseQuat?.[i];
    if (!rest) continue;
    const parent = bones[i].parent;
    if (parent) {
      const parentIndex = bones.indexOf(parent);
      const parentRest = state.restPoseQuat?.[parentIndex] || new THREE.Quaternion();
      state.softRestQuats.push(rest.clone().premultiply(parentRest.clone().invert()));
    } else {
      state.softRestQuats.push(rest.clone());
    }
    state.softBoneIndices.push(i);
  }
  log(`软部件保护骨骼：${state.softBoneIndices.length} 个。`);
}

function addMeshToHelper(mesh, animation = null) {
  const params = {
    physics: state.physics,
    ik: state.ik,
    unitStep: 1 / 240,
    maxStepNum: 2,
    warmup: 0,
    animationWarmup: false,
    gravity: new THREE.Vector3(0, -35, 0),
  };
  if (animation) params.animation = animation;
  try {
    state.helper.add(mesh, params);
  } catch (error) {
    if (params.physics) {
      log(`物理初始化失败，已用无物理模式加载：${error.message}`);
      state.physics = false;
      physicsToggle.checked = false;
      params.physics = false;
      params.warmup = 0;
      state.helper.add(mesh, params);
    } else {
      throw error;
    }
  }
  syncHelperFlags();
  logPhysicsStatus(mesh);
}

function getCurrentPhysics(mesh = state.mesh) {
  return mesh && state.helper?.objects?.get(mesh)?.physics || null;
}

function logPhysicsStatus(mesh = state.mesh) {
  const mmd = mesh?.geometry?.userData?.MMD || {};
  const physics = getCurrentPhysics(mesh);
  if (!physics) {
    log(`MMD物理未创建：PMX刚体=${mmd.rigidBodies?.length || 0}，约束=${mmd.constraints?.length || 0}`);
    return;
  }
  log(`MMD物理已创建：PMX刚体=${mmd.rigidBodies?.length || 0}，约束=${mmd.constraints?.length || 0}，Ammo刚体=${physics.bodies?.length || 0}，Ammo约束=${physics.constraints?.length || 0}`);
}

function syncHelperFlags() {
  if (!state.helper?.enabled) return;
  state.helper.enabled.physics = state.physics;
  state.helper.enabled.ik = state.ik;
}

function setPhysics(enabled) {
  state.physics = enabled;
  rebuildCurrentHelper();
  log(`物理效果：${enabled ? '开' : '关'}`);
}

function resetPhysics() {
  if (!state.mesh || !state.helper?.objects) return;
  const objects = state.helper.objects.get(state.mesh);
  if (objects?.physics) {
    objects.physics.reset();
    log('物理已重置。');
  }
}

function syncGrantFollowersBeforePhysics(mesh) {
  const bones = mesh?.skeleton?.bones || [];
  const bonesData = mesh?.geometry?.userData?.MMD?.bones || [];
  if (!bones.length || !bonesData.length) return;

  for (let i = 0; i < bonesData.length; i++) {
    const data = bonesData[i];
    const grant = data?.grant;
    if (!grant || grant.isLocal || !grant.affectRotation || grant.affectPosition) continue;
    if (Math.abs((grant.ratio ?? 0) - 1) > 1e-4) continue;

    const bone = bones[i];
    const parent = bones[grant.parentIndex];
    if (!bone || !parent) continue;

    const name = bone.name || data.name || '';
    if (!/D$|EX$|足D|ひざD|足首D/.test(name)) continue;

    bone.quaternion.copy(parent.quaternion);
  }

  mesh.updateMatrixWorld(true);
}

function stopCurrentAnimation() {
  const objects = state.mesh && state.helper?.objects?.get(state.mesh);
  const mixer = objects?.mixer;
  if (!mixer) return;
  mixer.stopAllAction();
  for (const action of mixer._actions || []) {
    action.stop();
  }
}

function restoreRestPose() {
  if (!state.mesh || !state.restPoseQuat?.length) return;
  const bones = state.mesh.skeleton?.bones || [];
  for (let i = 0; i < bones.length; i++) {
    if (state.restPoseQuat[i]) bones[i].quaternion.copy(state.restPoseQuat[i]);
    if (state.restPosePos[i]) bones[i].position.copy(state.restPosePos[i]);
  }
  state.mesh.updateMatrixWorld(true);
}

function resetModelToRest({ readdHelper = true } = {}) {
  if (!state.mesh) return;
  state.isPlaying = false;
  stopCurrentAnimation();
  hideRigidBodies();
  if (state.helper?.objects?.has(state.mesh)) {
    state.helper.remove(state.mesh);
  }
  restoreRestPose();
  if (readdHelper) {
    addMeshToHelper(state.mesh);
    resetPhysics();
  }
}

function detachCurrentHelperForMotion() {
  if (!state.mesh) return;
  stopCurrentAnimation();
  hideRigidBodies();
  if (state.helper?.objects?.has(state.mesh)) {
    state.helper.remove(state.mesh);
  }
}

function makeRigidBodyDebugObject(params, material) {
  if (params.shapeType === 0) {
    return new THREE.Mesh(new THREE.SphereGeometry(params.width, 12, 8), material);
  }
  if (params.shapeType === 1) {
    return new THREE.Mesh(new THREE.BoxGeometry(params.width * 2, params.height * 2, params.depth * 2), material);
  }
  if (params.shapeType === 2) {
    const group = new THREE.Group();
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(params.width, params.width, params.height, 12), material);
    const top = new THREE.Mesh(new THREE.SphereGeometry(params.width, 12, 8), material);
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(params.width, 12, 8), material);
    top.position.y = params.height / 2;
    bottom.position.y = -params.height / 2;
    group.add(cylinder, top, bottom);
    return group;
  }
  return new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), material);
}

function updateRigidBodyDebug() {
  const debug = state.rigidBodyDebug;
  if (!debug) return;
  if (debug.helper) {
    debug.helper.updateMatrixWorld(true);
    return;
  }
  for (const item of debug.entries) {
    item.body.getMotionState().getWorldTransform(debug.transform);
    const origin = debug.transform.getOrigin();
    const rotation = debug.transform.getRotation();
    item.object.position.set(origin.x(), origin.y(), origin.z());
    item.object.quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w());
  }
}

function showRigidBodies() {
  const physics = getCurrentPhysics();
  if (!physics?.bodies?.length) {
    log('没有可显示的刚体：MMD物理尚未创建。');
    return;
  }
  hideRigidBodies();
  if (typeof physics.createHelper === 'function') {
    const helper = physics.createHelper();
    helper.name = 'MMDRigidBodyDebug';
    state.scene.add(helper);
    state.rigidBodyDebug = { group: helper, helper, entries: [] };
    rigidBodyDebugBtn.textContent = '隐藏刚体';
    log(`已显示刚体：${physics.bodies.length} 个（官方颜色：红=type0骨骼驱动，绿=type1物理，蓝=type2骨骼+物理）。`);
    return;
  }
  const group = new THREE.Group();
  group.name = 'MMDRigidBodyDebug';
  const entries = [];
  for (const body of physics.bodies) {
    const params = body.params;
    const color = params.type === 0 ? 0x00ff66 : params.type === 1 ? 0xffdd33 : 0xff3355;
    const material = new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.48,
      depthTest: false,
    });
    const object = makeRigidBodyDebugObject(params, material);
    group.add(object);
    entries.push({ object, body: body.body });
  }
  state.scene.add(group);
  state.rigidBodyDebug = {
    group,
    entries,
    transform: new Ammo.btTransform(),
  };
  updateRigidBodyDebug();
  rigidBodyDebugBtn.textContent = '隐藏刚体';
  log(`已显示刚体：${entries.length} 个（自定义颜色：绿=type0骨骼驱动，黄=type1物理，红=type2骨骼+物理）。`);
}

function hideRigidBodies() {
  const debug = state.rigidBodyDebug;
  if (!debug) return;
  state.scene?.remove(debug.group);
  debug.group.traverse((object) => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
  Ammo.destroy(debug.transform);
  state.rigidBodyDebug = null;
  if (rigidBodyDebugBtn) rigidBodyDebugBtn.textContent = '显示刚体';
}

function toggleRigidBodies() {
  if (state.rigidBodyDebug) hideRigidBodies();
  else showRigidBodies();
}

function getRigidBodyWorldPosition(bodyWrapper) {
  const transform = new Ammo.btTransform();
  bodyWrapper.body.getMotionState().getWorldTransform(transform);
  const origin = transform.getOrigin();
  const position = new THREE.Vector3(origin.x(), origin.y(), origin.z());
  Ammo.destroy(transform);
  return position;
}

function isInterestingPhysicsName(name) {
  return /足|脚|腿|ひざ|膝|足首|つま先|toe|knee|leg|ankle|foot|裙|スカート|skirt|袖|髪|hair|腕/.test(name || '');
}

function inspectPhysics() {
  const mesh = state.mesh;
  const physics = getCurrentPhysics();
  if (!mesh || !physics?.bodies?.length) {
    log('物理诊断：没有可诊断的模型或 Ammo 刚体。');
    return;
  }

  mesh.updateMatrixWorld(true);
  const bones = mesh.skeleton?.bones || [];
  const rows = physics.bodies.map((body, index) => {
    const params = body.params || {};
    const bone = params.boneIndex >= 0 ? bones[params.boneIndex] : null;
    const bodyPos = getRigidBodyWorldPosition(body);
    const bonePos = new THREE.Vector3();
    if (bone) bone.getWorldPosition(bonePos);
    return {
      index,
      name: params.name || '(无名)',
      type: params.type,
      shapeType: params.shapeType,
      boneIndex: params.boneIndex,
      boneName: bone?.name || '(无骨骼)',
      groupIndex: params.groupIndex,
      groupTarget: params.groupTarget,
      distance: bone ? bodyPos.distanceTo(bonePos) : null,
      bodyPos,
      bonePos,
    };
  });

  const interesting = rows.filter((row) => (
    isInterestingPhysicsName(row.name)
    || isInterestingPhysicsName(row.boneName)
    || (row.distance !== null && row.distance > 2.5)
  ));

  log(`物理诊断：刚体=${rows.length}，绑定骨骼=${rows.filter((row) => row.boneIndex >= 0).length}，重点项=${interesting.length}`);
  for (const row of interesting.slice(0, 80)) {
    const distance = row.distance === null ? '-' : row.distance.toFixed(3);
    log(`刚体#${row.index} ${row.name} type=${row.type} shape=${row.shapeType} bone#${row.boneIndex} ${row.boneName} 距骨=${distance} group=${row.groupIndex}/${row.groupTarget}`);
  }
  if (interesting.length > 80) log(`物理诊断：只显示前 80 项，剩余 ${interesting.length - 80} 项未展开。`);
  console.table(rows);
}

window.__QPMMD = {
  THREE,
  state,
  loadModel,
  loadModelFromUrl,
  getCurrentPhysics,
  inspectPhysics,
  resetPhysics,
  showRigidBodies,
  hideRigidBodies,
};

function setIK(enabled) {
  state.ik = enabled;
  syncHelperFlags();
  log(`IK 解算：${enabled ? '开' : '关'}`);
}

function setSoftProtection(enabled) {
  state.softEnabled = enabled;
  log(`软部件保护：${enabled ? '开' : '关'}`);
}

function setPmxCompatFixes(enabled) {
  state.pmxCompatFixes = enabled;
  if (state.mesh) {
    applyModelStyle(state.mesh);
    applyRenderSettings();
  }
  log(`PMX 兼容修复：${enabled ? '开' : '关'}`);
}

function rebuildCurrentHelper() {
  if (!state.mesh || !state.helper) {
    syncHelperFlags();
    return;
  }
  try {
    state.helper.remove(state.mesh);
  } catch {
    // The helper may not own the mesh yet.
  }
  addMeshToHelper(state.mesh);
}

function applyModelStyle(mesh) {
  state.materialBaseStates.clear();
  const compatFixed = [];
  mesh.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
    if (child.isSkinnedMesh) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        if (!mat) continue;
        mat.opacity = THREE.MathUtils.clamp(Number.isFinite(mat.opacity) ? mat.opacity : 1, 0, 1);
        mat.visible = mat.opacity > 0.01;
        mat.transparent = mat.opacity < 0.99;
        mat.depthWrite = mat.opacity >= 0.99;
        applyPmxMaterialCompatibility(mat);
        if (mat.userData.qwenpawHairOutlineFix) compatFixed.push(mat.name || 'material');
        mat.userData.outlineParameters = {
          thickness: outlineThicknessForMaterial(mat, state.renderSettings.global.outline),
          color: [0, 0, 0],
          alpha: outlineAlphaForMaterial(mat, mat.opacity),
          visible: shouldShowOutline(mat),
        };
        syncMmdMaterialUniforms(mat);
        state.materialBaseStates.set(mat.uuid, captureMaterialState(mat));
      }
    }
  });
}

function captureMaterialState(mat) {
  return {
    visible: mat.visible !== false,
    opacity: Number.isFinite(mat.opacity) ? mat.opacity : 1,
    transparent: mat.transparent === true,
    depthWrite: mat.depthWrite !== false,
    color: mat.color?.clone?.() || null,
    emissive: mat.emissive?.clone?.() || null,
    specular: mat.specular?.clone?.() || null,
    shininess: Number.isFinite(mat.shininess) ? mat.shininess : null,
    outline: mat.userData?.outlineParameters ? { ...mat.userData.outlineParameters } : null,
  };
}

function isMaterialHidden(mat) {
  if (!mat) return true;
  if (mat.visible === false) return true;
  const opacity = Number.isFinite(mat.opacity) ? mat.opacity : 1;
  return opacity <= 0.01;
}

function shouldShowOutline(mat, outline = state.renderSettings.global.outline) {
  return outline >= OUTLINE_VISIBLE_THRESHOLD
    && !isMaterialHidden(mat);
}

function outlineThicknessForMaterial(mat, outline) {
  if (outline < OUTLINE_VISIBLE_THRESHOLD) return 0;
  if (mat?.userData?.qwenpawHairOutlineFix) {
    return outline * 0.35;
  }
  return outline;
}

function outlineAlphaForMaterial(mat, alpha) {
  if (mat?.userData?.qwenpawHairOutlineFix) {
    return Math.min(alpha ?? 1, 0.5);
  }
  return alpha;
}

function updateOutlineVisibility() {
  if (!state.mesh) return;
  state.mesh.traverse((child) => {
    if (!child.isSkinnedMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of materials) {
      if (!mat?.userData?.outlineParameters) continue;
      mat.userData.outlineParameters.visible = shouldShowOutline(mat);
      mat.userData.outlineParameters.thickness = outlineThicknessForMaterial(mat, state.renderSettings.global.outline);
      mat.userData.outlineParameters.alpha = outlineAlphaForMaterial(mat, mat.userData.outlineParameters.alpha ?? mat.opacity);
    }
  });
}

function clampCameraDistance() {
  if (!state.camera || !state.controls) return;
  const offset = state.camera.position.clone().sub(state.controls.target);
  const distance = offset.length();
  if (!Number.isFinite(distance) || distance === 0) return;
  const clamped = THREE.MathUtils.clamp(distance, state.cameraMinDistance, state.cameraMaxDistance);
  if (Math.abs(clamped - distance) < 1e-5) return;
  offset.setLength(clamped);
  state.camera.position.copy(state.controls.target).add(offset);
  state.camera.updateMatrixWorld();
}

function handleSmoothWheelZoom(event) {
  if (!state.camera || !state.controls) return;
  event.preventDefault();
  const offset = state.camera.position.clone().sub(state.controls.target);
  const distance = offset.length();
  if (!Number.isFinite(distance) || distance === 0) return;

  const direction = Math.sign(event.deltaY);
  const wheelUnits = Math.min(Math.abs(event.deltaY), 120) / 120;
  const factor = Math.exp(direction * wheelUnits * 0.08);
  const nextDistance = THREE.MathUtils.clamp(
    distance * factor,
    state.cameraMinDistance,
    state.cameraMaxDistance,
  );

  offset.setLength(nextDistance);
  state.camera.position.copy(state.controls.target).add(offset);
  state.camera.updateProjectionMatrix();
  state.controls.update();
}

function frameModel(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (!Number.isFinite(size.length()) || size.length() === 0) return;

  const radius = Math.max(size.x, size.y, size.z);
  const target = center.clone();
  target.y -= radius * 0.16;
  state.cameraMinDistance = Math.max(radius * 0.35, 0.25);
  state.cameraMaxDistance = Math.max(radius * 8, 20);
  state.controls.minDistance = state.cameraMinDistance;
  state.controls.maxDistance = state.cameraMaxDistance;
  state.controls.target.copy(target);
  state.camera.position.set(center.x, center.y + radius * 0.05, center.z + radius * 1.05);
  state.camera.near = Math.max(radius / 80, 0.03);
  state.camera.far = Math.max(radius * 12, 80);
  state.camera.updateProjectionMatrix();
  state.controls.update();
  clampCameraDistance();
}

async function playVmd(path, options = {}) {
  if (!state.mesh) {
    log('没有加载 PMX，无法播放 VMD。');
    return;
  }

  resetModelToRest({ readdHelper: false });
  const loader = new MMDLoader();
  setupPackageLoading(loader);
  setStatus(`正在加载 VMD：${path}`);
  const animation = await new Promise((resolve, reject) => {
    loader.loadAnimation(assetUrl(path), state.mesh, resolve, undefined, reject);
  });

  addMeshToHelper(state.mesh, animation);
  configureOneShotAnimation();

  state.currentMotion = path;
  state.isPlaying = true;
  setStatus(`正在播放 VMD：${path}`);
  log(`正在播放 VMD：${path}`);
}

async function playVmdFromUrl(url, label) {
  if (!state.mesh) {
    log('没有加载 PMX，无法播放 VMD。');
    return;
  }
  resetModelToRest({ readdHelper: false });
  const loader = new MMDLoader();
  setupPackageLoading(loader);
  setStatus(`正在加载 VMD：${label}`);
  const animation = await new Promise((resolve, reject) => {
    loader.loadAnimation(url, state.mesh, resolve, undefined, reject);
  });
  addMeshToHelper(state.mesh, animation);
  configureOneShotAnimation();
  state.currentMotion = label;
  state.isPlaying = true;
  setStatus(`正在播放 VMD：${label}`);
  log(`正在播放 VMD：${label}`);
}

function configureOneShotAnimation() {
  const objects = state.helper?.objects?.get(state.mesh);
  const mixer = objects?.mixer;
  if (!mixer) return;
  if (state.motionFinishHandler) {
    mixer.removeEventListener('finished', state.motionFinishHandler);
    state.motionFinishHandler = null;
  }
  for (const action of mixer._actions || []) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
  }
  state.motionFinishHandler = () => {
    resetModelToRest({ readdHelper: true });
    log('VMD 播放结束。');
    state.motionFinishHandler = null;
  };
  mixer.addEventListener('finished', state.motionFinishHandler);
}

function resetExpressions() {
  for (const control of state.activeMorphs.values()) {
    if (control.kind === 'vertex' && control.mesh.morphTargetInfluences) {
      control.mesh.morphTargetInfluences[control.index] = 0;
    } else if (control.kind === 'material') {
      applyMaterialMorph(control, 0);
    } else if (control.kind === 'pmxMaterial') {
      applyPmxMaterialMorph(control, 0);
    }
  }
  state.activeMorphs.clear();
  state.pmxMorphWeights.clear();
  recomputePmxMaterialMorphs();
  updateOutlineVisibility();
}

function findExpressionControl(name) {
  if (!name) return null;
  if (name.startsWith('control:')) {
    const index = Number(name.slice('control:'.length));
    return Number.isInteger(index) ? state.expressionControls[index] || null : null;
  }
  if (name.startsWith('pmxMaterial:')) {
    const morphName = name.slice('pmxMaterial:'.length);
    return state.expressionControls.find((item) => item.kind === 'pmxMaterial' && item.morphName === morphName) || null;
  }
  if (name.startsWith('vertex:')) {
    const morphName = name.slice('vertex:'.length);
    return state.expressionControls.find((item) => item.kind === 'vertex' && item.morphName === morphName) || null;
  }
  if (name.startsWith('material:')) {
    const uuid = name.slice('material:'.length);
    return state.expressionControls.find((item) => item.kind === 'material' && item.material?.uuid === uuid) || null;
  }
  const lower = name.toLowerCase();
  const exact = state.expressionControls.find((item) => item.name?.toLowerCase() === lower || item.morphName?.toLowerCase() === lower);
  if (exact) return exact;
  return state.expressionControls.find((item) => {
    const target = `${item.name} ${item.morphName || ''} ${item.label || ''}`.toLowerCase();
    return target.includes(lower) || lower.includes(target);
  }) || null;
}

function applyMaterialMorph(control, weight) {
  const mat = control.material;
  if (!mat) return;
  const targetOpacity = control.targetOpacity ?? (control.baseOpacity < 0.5 ? 1 : 0);
  mat.opacity = control.baseOpacity + (targetOpacity - control.baseOpacity) * weight;
  mat.transparent = mat.opacity < 0.99;
  mat.depthWrite = mat.opacity >= 0.99;
  mat.visible = mat.opacity > 0.01;
  mat.needsUpdate = true;
  if (!mat.userData.outlineParameters) mat.userData.outlineParameters = {};
  mat.userData.outlineParameters.alpha = outlineAlphaForMaterial(mat, mat.opacity);
  mat.userData.outlineParameters.visible = shouldShowOutline(mat);
  mat.userData.outlineParameters.thickness = outlineThicknessForMaterial(mat, mat.userData.outlineParameters.thickness ?? state.renderSettings.global.outline);
}

function applyPmxMaterialMorph(control, weight) {
  if (!control.morph?.name) return;
  state.pmxMorphWeights.set(control.morph.name, weight);
  recomputePmxMaterialMorphs();
  if (weight > 0) logPmxMaterialMorphResult(control.morph.name, control.morph.ops, weight);
}

function restoreBaseMaterialState(mat) {
  const base = state.materialBaseStates.get(mat.uuid);
  if (!base) return;
  mat.visible = base.visible;
  mat.opacity = base.opacity;
  mat.transparent = base.transparent;
  mat.depthWrite = base.depthWrite;
  if (base.color && mat.color) mat.color.copy(base.color);
  if (base.emissive && mat.emissive) mat.emissive.copy(base.emissive);
  if (base.specular && mat.specular) mat.specular.copy(base.specular);
  if (base.shininess !== null && mat.shininess !== undefined) mat.shininess = base.shininess;
  if (base.outline) mat.userData.outlineParameters = { ...base.outline };
}

function applyColorOp(baseColor, currentColor, values, opType, weight) {
  if (!baseColor || !currentColor || !values) return;
  if (opType === 0) {
    currentColor.r *= 1 + ((values[0] ?? 1) - 1) * weight;
    currentColor.g *= 1 + ((values[1] ?? 1) - 1) * weight;
    currentColor.b *= 1 + ((values[2] ?? 1) - 1) * weight;
  } else {
    currentColor.r += (values[0] ?? 0) * weight;
    currentColor.g += (values[1] ?? 0) * weight;
    currentColor.b += (values[2] ?? 0) * weight;
  }
  currentColor.r = THREE.MathUtils.clamp(currentColor.r, 0, 1);
  currentColor.g = THREE.MathUtils.clamp(currentColor.g, 0, 1);
  currentColor.b = THREE.MathUtils.clamp(currentColor.b, 0, 1);
}

function applyScalarOp(baseValue, currentValue, value, opType, weight) {
  if (!Number.isFinite(value)) return currentValue;
  if (opType === 0) return currentValue * (1 + (value - 1) * weight);
  return currentValue + value * weight;
}

function recomputePmxMaterialMorphs() {
  const touched = new Set();
  for (const morph of state.pmxMaterialMorphs.values()) {
    for (const op of morph.ops) touched.add(op.material);
  }
  for (const mat of touched) restoreBaseMaterialState(mat);

  for (const [name, rawWeight] of state.pmxMorphWeights.entries()) {
    const weight = THREE.MathUtils.clamp(rawWeight, 0, 1);
    if (weight <= 0) continue;
    const morph = state.pmxMaterialMorphs.get(name);
    if (!morph) continue;
    for (const op of morph.ops) {
      applyPmxMaterialOp(op, weight * (op.ratio ?? 1));
    }
  }
  for (const mat of touched) {
    mat.opacity = THREE.MathUtils.clamp(mat.opacity, 0, 1);
    mat.visible = mat.opacity > 0.01;
    mat.transparent = mat.opacity < 0.99;
    mat.depthWrite = mat.opacity >= 0.99;
    if (!mat.userData.outlineParameters) mat.userData.outlineParameters = {};
    mat.userData.outlineParameters.alpha = outlineAlphaForMaterial(mat, Math.min(mat.userData.outlineParameters.alpha ?? mat.opacity, mat.opacity));
    mat.userData.outlineParameters.visible = shouldShowOutline(mat) && mat.visible && (mat.userData.outlineParameters.alpha ?? 1) > 0.01;
    mat.userData.outlineParameters.thickness = outlineThicknessForMaterial(mat, mat.userData.outlineParameters.thickness ?? state.renderSettings.global.outline);
    syncMmdMaterialUniforms(mat);
  }
  applyObjectRenderSettings(state.mesh, state.renderSettings.global, state.materialBaseStates);
}

function applyPmxMaterialOp(op, weight) {
    const mat = op.material;
    if (!mat) return;
    const base = state.materialBaseStates.get(mat.uuid);
    applyColorOp(base?.color, mat.color, op.diffuse, op.opType, weight);
    applyColorOp(base?.emissive, mat.emissive, op.ambient, op.opType, weight);
    applyColorOp(base?.specular, mat.specular, op.specular, op.opType, weight);
    mat.opacity = applyScalarOp(base?.opacity ?? mat.opacity, mat.opacity, op.diffuse?.[3], op.opType, weight);
    if (mat.shininess !== undefined) mat.shininess = applyScalarOp(base?.shininess ?? mat.shininess, mat.shininess, op.shininess, op.opType, weight);
    if (!mat.userData.outlineParameters) mat.userData.outlineParameters = {};
    const baseOutline = base?.outline || {};
    const nextAlpha = applyScalarOp(baseOutline.alpha ?? mat.opacity, mat.userData.outlineParameters.alpha ?? mat.opacity, op.edgeColor?.[3], op.opType, weight);
    const nextThickness = applyScalarOp(baseOutline.thickness ?? 0.004, mat.userData.outlineParameters.thickness ?? 0.004, op.edgeSize, op.opType, weight);
    mat.userData.outlineParameters.alpha = outlineAlphaForMaterial(mat, nextAlpha);
    mat.userData.outlineParameters.thickness = outlineThicknessForMaterial(mat, nextThickness);
}

function syncMmdMaterialUniforms(mat) {
  if (!mat) return;
  mat.needsUpdate = true;
  const uniforms = mat.uniforms;
  if (!uniforms) return;
  if (uniforms.opacity) uniforms.opacity.value = mat.opacity;
  if (uniforms.diffuse && mat.color) uniforms.diffuse.value.copy(mat.color);
  if (uniforms.emissive && mat.emissive) uniforms.emissive.value.copy(mat.emissive);
  if (uniforms.specular && mat.specular) uniforms.specular.value.copy(mat.specular);
  if (uniforms.shininess && mat.shininess !== undefined) uniforms.shininess.value = Math.max(mat.shininess, 1e-4);
  if (uniforms.reflectivity && mat.reflectivity !== undefined) uniforms.reflectivity.value = mat.reflectivity;
}

function logPmxMaterialMorphResult(name, ops, weight) {
  const rows = [];
  const seen = new Set();
  for (const op of ops || []) {
    const mat = op.material;
    if (!mat || seen.has(mat.uuid)) continue;
    seen.add(mat.uuid);
    rows.push(`${op.materialIndex}:${mat.name || 'material'}=${(mat.opacity ?? 1).toFixed(2)}${mat.visible === false ? '/hidden' : ''}`);
  }
  log(`PMX材质表情 ${name} ${weight.toFixed(2)} -> ${rows.join(', ')}`);
}

function setSingleExpression(name, weight = 1) {
  const control = findExpressionControl(name);
  if (!control) {
    log(`没有找到表情/材质：${name}`);
    return false;
  }
  log(`解析控制：kind=${control.kind}，name=${control.name || ''}，morph=${control.morphName || ''}${control.material?.name ? `，material=${control.material.name}` : ''}`);
  if (control.kind === 'vertex' && state.pmxMaterialMorphs.has(control.morphName || control.name)) {
    const morphName = control.morphName || control.name;
    const morph = state.pmxMaterialMorphs.get(morphName);
    applyPmxMaterialMorph({ morph }, weight);
    state.activeMorphs.set(`pmxMaterial:${morphName}`, { name: morphName, morphName, kind: 'pmxMaterial', morph });
    updateOutlineVisibility();
    return true;
  }
  if (control.kind === 'vertex') {
    control.mesh.morphTargetInfluences[control.index] = weight;
  } else if (control.kind === 'material') {
    applyMaterialMorph(control, weight);
  } else if (control.kind === 'pmxMaterial') {
    applyPmxMaterialMorph(control, weight);
  }
  state.activeMorphs.set(control.name, control);
  updateOutlineVisibility();
  return true;
}

function setExpression(name, weight = 1) {
  if (EXPRESSION_PRESETS[name]) {
    resetExpressions();
    for (const [morphName, value] of Object.entries(EXPRESSION_PRESETS[name].morphs)) {
      setSingleExpression(morphName, value * weight);
    }
    log(`应用${EXPRESSION_PRESETS[name].label}，强度=${weight.toFixed(2)}`);
    return;
  }
  setSingleExpression(name, weight);
}

function collectMaterialMorphControls(controls) {
  for (const morph of state.pmxMaterialMorphs.values()) {
    controls.set(`pmxMaterial:${morph.name}`, {
      name: morph.name,
      morphName: morph.name,
      label: `材质表情：${morph.name}`,
      kind: 'pmxMaterial',
      morph,
    });
  }

  const allMaterials = [];
  state.mesh?.traverse((child) => {
    if (!child.isSkinnedMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material?.name) continue;
      allMaterials.push({ mesh: child, material, name: material.name, baseOpacity: Number.isFinite(material.opacity) ? material.opacity : 1 });
    }
  });

  const materialAliases = [
    { morphName: '照れ', aliases: ['照れ', '脸红', '頬染', 'blush', '红晕', '赤面'], targetOpacity: 0.85 },
    { morphName: '脸红', aliases: ['照れ', '脸红', '頬染', 'blush', '红晕', '赤面'], targetOpacity: 0.85 },
    { morphName: '？', aliases: ['？', '?', 'question', '疑问'], targetOpacity: 1 },
    { morphName: '涙', aliases: ['涙', '泪', '眼泪', 'tear'], targetOpacity: 1 },
  ];

  for (const spec of materialAliases) {
    for (const item of allMaterials) {
      const matName = item.name.toLowerCase();
      if (!spec.aliases.some((alias) => matName.includes(alias.toLowerCase().trim()))) continue;
      const key = `material:${spec.morphName}:${item.material.uuid}`;
      if (controls.has(key)) continue;
      controls.set(key, {
        name: spec.morphName,
        morphName: spec.morphName,
        label: `材质表情：${spec.morphName} / ${item.name}`,
        kind: 'material',
        mesh: item.mesh,
        material: item.material,
        baseOpacity: item.baseOpacity,
        targetOpacity: spec.targetOpacity,
      });
    }
  }

  for (const item of allMaterials) {
    if (item.baseOpacity >= 0.99 && item.material.visible !== false) continue;
    const name = `材质：${item.name}`;
    controls.set(`material:${item.material.uuid}`, {
      name,
      morphName: name,
      label: name,
      kind: 'material',
      mesh: item.mesh,
      material: item.material,
      baseOpacity: item.baseOpacity,
      targetOpacity: item.baseOpacity < 0.5 ? 1 : 0,
    });
  }
}

function refreshExpressionList() {
  const controls = new Map();
  collectMaterialMorphControls(controls);
  const pmxMaterialNames = new Set(Array.from(state.pmxMaterialMorphs.keys()));
  state.mesh?.traverse((child) => {
    if (child.isSkinnedMesh && child.morphTargetDictionary && child.morphTargetInfluences) {
      for (const [name, index] of Object.entries(child.morphTargetDictionary)) {
        if (pmxMaterialNames.has(name)) continue;
        if (!controls.has(`vertex:${name}`)) {
          controls.set(`vertex:${name}`, { name, morphName: name, label: `表情：${name}`, kind: 'vertex', mesh: child, index });
        }
      }
    }
  });
  state.expressionControls = Array.from(controls.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
  state.expressions = state.expressionControls.map((item) => item.name);
  expressionSelect.innerHTML = '<option value="">不使用表情</option>';
  for (const [key, preset] of Object.entries(EXPRESSION_PRESETS)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.label;
    expressionSelect.appendChild(option);
  }
  for (const [index, item] of state.expressionControls.entries()) {
    const option = document.createElement('option');
    option.value = `control:${index}`;
    option.dataset.kind = item.kind;
    option.dataset.morphName = item.morphName || item.name || '';
    option.textContent = item.label;
    expressionSelect.appendChild(option);
  }
  const pmxNames = state.expressionControls.filter((item) => item.kind === 'pmxMaterial').map((item) => item.morphName);
  log(`检测到表情/材质控制：${state.expressionControls.length} 个，PMX材质表情：${pmxNames.length} 个。${pmxNames.includes('翼ON') ? '已找到翼ON。' : ''}`);
  expressionWeight.value = '0';
  expressionWeightLabel.textContent = '0.00';
}
function expressionControlValue(item) {
  if (item.kind === 'pmxMaterial') return `pmxMaterial:${item.morphName}`;
  if (item.kind === 'vertex') return `vertex:${item.morphName}`;
  if (item.kind === 'material') return `material:${item.material?.uuid || item.morphName}`;
  return item.name;
}

function applySelectedExpression() {
  const name = expressionSelect.value;
  const weight = Number(expressionWeight.value || 0);
  const option = expressionSelect.selectedOptions?.[0];
  expressionWeightLabel.textContent = weight.toFixed(2);
  if (!name) {
    resetExpressions();
    return;
  }
  log(`选择控制：value=${name}，文本=${option?.textContent || ''}，kind=${option?.dataset.kind || ''}，morph=${option?.dataset.morphName || ''}，权重=${weight.toFixed(2)}`);
  setExpression(name, weight);
}

function performGesture(payload) {
  const intent = payload.intent || 'idle';
  state.mood = payload.emotion || state.mood;
  log(`收到动作意图：${intent}`);
  // Placeholder for the procedural gesture layer. Keep this adapter stable while
  // motion generation evolves.
  if (intent === 'greet_user') {
    setExpression('happy', Math.min(1, payload.intensity || 0.6));
  }
}

async function loadPackage(file) {
  setStatus(`正在导入 ZIP：${file.name}`);
  log(`正在导入模型包：${file.name}`);
  revokeObjectUrls();
  state.packageFiles.clear();
  state.packageVmds = [];

  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${bridgeBaseUrl}/api/models/upload`, {
    method: 'POST',
    body: formData,
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || '导入失败');
  }

  const pmx = { path: data.path, url: assetUrl(data.path), serverPath: data.path, name: data.name, vmds: data.vmds || [] };
  state.packagePmxx = dedupeModels([pmx, ...state.packagePmxx]);
  state.packageVmds = (data.vmds || []).map((path) => ({
    path,
    url: assetUrl(path),
    serverPath: path,
    name: basename(path).replace(/\.vmd$/i, ''),
  }));
  updatePackageSelects();
  log(`模型包已导入：${data.name}，PMX=1，VMD=${state.packageVmds.length}`);
  setStatus('模型包已导入，正在加载 PMX...');

  packageModelSelect.value = pmx.path;
  await rememberLastModel(pmx.path, data.name, state.packageVmds.map((item) => item.path));
  await loadSelectedPackageModel();
}

async function loadScenePackage(file) {
  setStatus(`正在导入场景 ZIP：${file.name}`);
  log(`正在导入场景模型包：${file.name}`);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('remember', '0');
  const response = await fetch(`${bridgeBaseUrl}/api/models/upload`, {
    method: 'POST',
    body: formData,
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || '场景导入失败');
  }
  await loadSceneModelFromUrl(assetUrl(data.path), data.name || data.path, resourceBase(data.path), { serverPath: data.path });
  await rememberSceneModel(data.path, data.name || data.path);
  state.sceneModels = dedupeModels([{ path: data.path, url: assetUrl(data.path), serverPath: data.path, name: data.name }, ...state.sceneModels]);
  updatePackageSelects();
  sceneModelSelect.value = data.path;
}

async function importVmdFile(file) {
  setStatus(`正在导入 VMD：${file.name}`);
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${bridgeBaseUrl}/api/vmds/upload`, {
    method: 'POST',
    body: formData,
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || 'VMD 导入失败');
  const vmd = {
    path: data.vmd.path,
    url: assetUrl(data.vmd.path),
    serverPath: data.vmd.path,
    name: data.vmd.name || basename(data.vmd.path),
  };
  state.packageVmds = [vmd, ...state.packageVmds.filter((item) => item.path !== vmd.path)];
  updatePackageSelects();
  packageVmdSelect.value = vmd.path;
  setStatus('VMD 已导入。');
  log(`VMD 已导入：${vmd.name}`);
}

function updatePackageSelects() {
  packageModelSelect.innerHTML = state.packagePmxx.length
    ? ''
    : '<option value="">压缩包里没有 PMX</option>';
  for (const pmx of state.packagePmxx) {
    const option = document.createElement('option');
    option.value = pmx.path;
    option.textContent = pmx.name || pmx.path;
    packageModelSelect.appendChild(option);
  }

  sceneModelSelect.innerHTML = state.sceneModels.length
    ? ''
    : '<option value="">还没有导入场景</option>';
  for (const sceneModel of state.sceneModels) {
    const option = document.createElement('option');
    option.value = sceneModel.path;
    option.textContent = sceneModel.name || sceneModel.path;
    sceneModelSelect.appendChild(option);
  }

  packageVmdSelect.innerHTML = state.packageVmds.length
    ? ''
    : '<option value="">还没有导入 VMD</option>';
  for (const vmd of state.packageVmds) {
    const option = document.createElement('option');
    option.value = vmd.path;
    option.textContent = vmd.name || basename(vmd.path);
    packageVmdSelect.appendChild(option);
  }
}

function removeMissingModel(path) {
  const before = state.packagePmxx.length;
  state.packagePmxx = state.packagePmxx.filter((item) => item.path !== path && item.serverPath !== path);
  if (state.packagePmxx.length !== before) {
    updatePackageSelects();
  }
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_MODEL_STORAGE_KEY) || 'null');
    if (saved?.path === path) localStorage.removeItem(LAST_MODEL_STORAGE_KEY);
  } catch {
    // Ignore malformed local storage.
  }
}

async function loadSelectedPackageModel() {
  const path = packageModelSelect.value;
  if (!path) return;
  const file = state.packagePmxx.find((item) => item.path === path) || state.packageFiles.get(path);
  if (!file) {
    log(`模型记录已失效：${path}`);
    removeMissingModel(path);
    setStatus('模型记录已失效，请重新导入 ZIP。');
    return;
  }
  if (file.serverPath) {
    state.packageVmds = (file.vmds || []).map((vmdPath) => ({ path: vmdPath, url: assetUrl(vmdPath), serverPath: vmdPath }));
    updatePackageSelects();
    packageModelSelect.value = file.serverPath;
    try {
      await loadModel(file.serverPath);
    } catch (error) {
      removeMissingModel(file.serverPath);
      setStatus('模型文件不存在，请重新导入 ZIP。');
      throw error;
    }
  } else {
    await loadModelFromUrl(virtualUrl(file.path), path, virtualBase(file.path));
  }
}

async function playSelectedPackageVmd() {
  const path = packageVmdSelect.value;
  if (!path) return;
  const file = state.packageVmds.find((item) => item.path === path) || state.packageFiles.get(path);
  if (!file) return;
  if (file.serverPath) {
    await playVmd(file.serverPath);
    await rememberVmd(file.serverPath, file.name || basename(file.serverPath));
  } else {
    await playVmdFromUrl(virtualUrl(file.path), path);
  }
}

async function loadSelectedSceneModel() {
  const path = sceneModelSelect.value;
  if (!path) return;
  const file = state.sceneModels.find((item) => item.path === path);
  if (!file) return;
  await loadSceneModelFromUrl(assetUrl(file.serverPath || file.path), file.name || file.path, resourceBase(file.serverPath || file.path), { serverPath: file.serverPath || file.path });
  await rememberSceneModel(file.serverPath || file.path, file.name || file.path);
}

async function deleteRuntimeResource(kind, path) {
  if (!path) return;
  const endpoint = kind === 'model'
    ? '/api/runtime/last-model'
    : kind === 'scene'
      ? '/api/runtime/scene-model'
      : '/api/runtime/vmds';
  await fetch(`${bridgeBaseUrl}${endpoint}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

function isHairLikeMaterial(mat) {
  const name = `${mat?.name || ''} ${mat?.userData?.Name || ''}`.toLowerCase();
  return /髪|hair|头发|頭髮|发|髮/.test(name);
}

function applyPmxMaterialCompatibility(mat) {
  if (!state.pmxCompatFixes || !mat) return;
  const hairLike = isHairLikeMaterial(mat);
  const riskyTransparent = mat.transparent || (Number.isFinite(mat.opacity) && mat.opacity < 0.99);
  if (hairLike) {
    mat.userData.qwenpawOriginalEnvMap ??= mat.envMap || null;
    mat.userData.qwenpawOriginalMatcap ??= mat.matcap || null;
    mat.userData.qwenpawOriginalCombine ??= mat.combine;
    mat.userData.qwenpawOriginalMatcapCombine ??= mat.matcapCombine;
    mat.userData.qwenpawOriginalReflectivity ??= mat.reflectivity;
    mat.envMap = null;
    mat.matcap = null;
    mat.matcapCombine = THREE.MultiplyOperation;
    mat.reflectivity = 0;
    if (mat.specular) mat.specular.multiplyScalar(0.25);
    if (mat.shininess !== undefined) mat.shininess = Math.min(mat.shininess || 0, 12);
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 1;
    mat.polygonOffsetUnits = 1;
    mat.depthWrite = true;
    mat.transparent = false;
    mat.userData.qwenpawHairOutlineFix = true;
  } else if (riskyTransparent) {
    mat.depthWrite = false;
  }
}

async function deleteSelectedModel() {
  const path = packageModelSelect.value;
  if (!path) return;
  await deleteRuntimeResource('model', path);
  removeMissingModel(path);
  setStatus('人物模型记录已删除。');
}

async function deleteSelectedSceneModel() {
  const path = sceneModelSelect.value;
  if (!path) return;
  await deleteRuntimeResource('scene', path);
  state.sceneModels = state.sceneModels.filter((item) => item.path !== path && item.serverPath !== path);
  if (state.sceneModel?.userData?.serverPath === path) {
    state.scene.remove(state.sceneModel);
    state.sceneModel = null;
  }
  updatePackageSelects();
  setStatus('场景模型记录已删除。');
}

async function deleteSelectedVmd() {
  const path = packageVmdSelect.value;
  if (!path) return;
  await deleteRuntimeResource('vmd', path);
  state.packageVmds = state.packageVmds.filter((item) => item.path !== path && item.serverPath !== path);
  updatePackageSelects();
  setStatus('VMD 记录已删除。');
}

function bindUI() {
  window.addEventListener('dragover', (event) => {
    event.preventDefault();
  });
  window.addEventListener('drop', async (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.zip')) await loadPackage(file);
      else if (lower.endsWith('.pmx')) {
        revokeObjectUrls();
        state.packageFiles.clear();
        const path = `__local__/${file.name}`;
        state.packageFiles.set(path, { path, url: fileUrl(file), blob: file });
        await loadModelFromUrl(virtualUrl(path), file.name, virtualBase(path));
      }
      else if (lower.endsWith('.vmd')) {
        await importVmdFile(file);
      }
      else log(`不支持这个文件：${file.name}`);
    } catch (error) {
      log(`拖放加载失败：${error.message}`);
    }
  });

  packageInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await loadPackage(file);
    } catch (error) {
      setStatus('ZIP 加载失败。');
      log(`ZIP 加载失败：${error.message}`);
    }
  });

  pmxInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await loadScenePackage(file);
    } catch (error) {
      setStatus('场景模型加载失败。');
      log(`场景模型加载失败：${error.message}`);
    } finally {
      pmxInput.value = '';
    }
  });

  vmdInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await importVmdFile(file);
    } catch (error) {
      log(`VMD 导入失败：${error.message}`);
    } finally {
      vmdInput.value = '';
    }
  });

  document.querySelector('#loadPackageModelBtn').addEventListener('click', () => {
    loadSelectedPackageModel().catch((error) => log(`PMX 加载失败：${error.message}`));
  });
  deleteModelBtn.addEventListener('click', () => {
    deleteSelectedModel().catch((error) => log(`删除人物模型失败：${error.message}`));
  });
  loadSceneModelBtn.addEventListener('click', () => {
    loadSelectedSceneModel().catch((error) => log(`场景加载失败：${error.message}`));
  });
  deleteSceneModelBtn.addEventListener('click', () => {
    deleteSelectedSceneModel().catch((error) => log(`删除场景失败：${error.message}`));
  });
  document.querySelector('#playPackageVmdBtn').addEventListener('click', () => {
    playSelectedPackageVmd().catch((error) => log(`VMD 播放失败：${error.message}`));
  });
  deleteVmdBtn.addEventListener('click', () => {
    deleteSelectedVmd().catch((error) => log(`删除 VMD 失败：${error.message}`));
  });
  hudCollapseBtn.addEventListener('click', () => {
    app.classList.toggle('hud-collapsed');
    hudCollapseBtn.textContent = app.classList.contains('hud-collapsed') ? '展开面板' : '折叠面板';
  });
  physicsToggle.addEventListener('change', () => setPhysics(physicsToggle.checked));
  ikToggle.addEventListener('change', () => setIK(ikToggle.checked));
  softToggle.addEventListener('change', () => setSoftProtection(softToggle.checked));
  pmxCompatToggle.addEventListener('change', () => setPmxCompatFixes(pmxCompatToggle.checked));
  resetPhysicsBtn.addEventListener('click', resetPhysics);
  expressionSelect.addEventListener('change', applySelectedExpression);
  expressionWeight.addEventListener('input', applySelectedExpression);
  chatDockToggle.addEventListener('click', () => {
    chatDock.classList.toggle('collapsed');
  });
  sendChatBtn.addEventListener('click', () => {
    sendChatMessage().catch((error) => log(`发送失败：${error.message}`));
  });
  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage().catch((error) => log(`发送失败：${error.message}`));
    }
  });
  chatHistory.addEventListener('wheel', (event) => {
    event.stopPropagation();
  }, { passive: true });
  chatHistory.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  chatHistory.addEventListener('touchmove', (event) => {
    event.stopPropagation();
  }, { passive: true });
  logToggleBtn.addEventListener('click', () => {
    logEl.classList.toggle('collapsed');
  });
  renderSettingsToggle.addEventListener('click', () => {
    renderSettingsPanel.classList.toggle('collapsed');
  });
  for (const [name, control] of Object.entries(renderControls)) {
    if (!control.input) continue;
    control.input.addEventListener('input', () => setRenderSetting(name, Number(control.input.value)));
  }
  saveRenderSettingsBtn.addEventListener('click', saveRenderSettings);
  document.querySelector('#resetViewBtn').addEventListener('click', () => {
    if (state.mesh) frameModel(state.mesh);
  });
  syncRenderControls();
  applyRenderSettings();
}

async function handleCommand(command) {
  const payload = command.payload || {};
  try {
    if (command.type === 'load_model') await loadModel(payload.path);
    else if (command.type === 'play_vmd') await playVmd(payload.path, payload);
    else if (command.type === 'set_expression') setExpression(payload.name, payload.weight);
    else if (command.type === 'set_mood') state.mood = payload.mood || 'neutral';
    else if (command.type === 'perform_gesture') performGesture(payload);
    else log(`未知指令：${command.type}`);
  } catch (error) {
    log(`${command.type} 执行失败：${error.message}`);
  }
}

async function pollCommands() {
  try {
    const response = await fetch(`${bridgeBaseUrl}/api/avatar/commands`);
    const data = await response.json();
    for (const command of data.commands || []) {
      await handleCommand(command);
    }
  } catch (error) {
    log(`连接桥接服务失败：${error.message}`);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(state.mixerClock.getDelta(), 1 / 60);
  if (state.helper) state.helper.update(delta);
  updateRigidBodyDebug();
  applySoftConstraints(delta);
  if (state.controls) state.controls.update();
  state.outlineFrame = (state.outlineFrame + 1) % 6;
  if (state.outlineFrame === 0) updateOutlineVisibility();
  if (state.effect) state.effect.render(state.scene, state.camera);
}

function applySoftConstraints(delta) {
  if (!state.softEnabled || state.isPlaying || !state.mesh || !state.softBoneIndices.length) return;
  const bones = state.mesh.skeleton?.bones || [];
  if (delta <= 0 || delta > 0.5) delta = 0.016;
  const idleGravity = 0.0003 * delta * 60;
  for (let j = 0; j < state.softBoneIndices.length; j++) {
    const bone = bones[state.softBoneIndices[j]];
    if (!bone?.parent) continue;
    const target = state.softRestQuats[j].clone();
    if (idleGravity > 0) {
      target.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -idleGravity));
    }
    bone.quaternion.copy(target);
  }
}

loadSavedRenderSettings();
initScene();
bindUI();
animate();
setInterval(pollCommands, 250);
initAmmo().then(() => restoreLastModel()).then(() => restoreSceneModel()).then(() => restoreVmdHistory()).finally(() => {
  setStatus(state.mesh ? '最近模型已恢复。' : 'Three.js 渲染器已就绪。');
});
log(`Three.js ${THREE.REVISION}`);

