import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
import { MMDParser } from 'three/addons/libs/mmdparser.module.js';

import './styles.css';

const bridgeBaseUrl = new URLSearchParams(window.location.search).get('bridge') || 'http://127.0.0.1:8098';

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
  mixerClock: new THREE.Clock(),
  currentModel: null,
  currentMotion: null,
  mood: 'neutral',
  objectUrls: [],
  packageFiles: new Map(),
  packagePmxx: [],
  packageVmds: [],
  physics: true,
  ik: true,
  expressions: [],
  expressionControls: [],
  activeMorphs: new Map(),
  materialMorphs: new Map(),
  pmxMaterialMorphs: new Map(),
  pmxMorphWeights: new Map(),
  materialBaseStates: new Map(),
  outlineFrame: 0,
  ammoReady: false,
  isPlaying: false,
  softEnabled: true,
  softBoneIndices: [],
  softRestQuats: [],
  rigidBodyDebug: null,
  cameraMinDistance: 0.5,
  cameraMaxDistance: 80,
  renderSettings: {
    outline: 0.004,
    ambient: 0.78,
    key: 1.25,
    rim: 0.45,
    exposure: 1.05,
    saturation: 1.16,
    contrast: 1.06,
  },
};

const SOFT_PATTERNS = [
  { pat: '裙', maxAngle: 0.08 },
  { pat: 'スカート', maxAngle: 0.08 },
  { pat: '袖', maxAngle: 0.06 },
  { pat: '腕', maxAngle: 0.06 },
  { pat: '髪', maxAngle: 0.35 },
  { pat: 'hair', maxAngle: 0.35 },
  { pat: 'hair', maxAngle: 0.35 },
  { pat: '外套', maxAngle: 0.1 },
  { pat: '披风', maxAngle: 0.1 },
  { pat: 'マント', maxAngle: 0.1 },
  { pat: '领结', maxAngle: 0.08 },
  { pat: '领带', maxAngle: 0.1 },
  { pat: '腕', maxAngle: 0.14 },
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
  <main id="viewer"></main>
  <aside id="hud">
    <header>
      <strong>QwenPaw MMD 桌宠</strong>
      <span id="status">正在启动 Three.js 渲染器...</span>
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
    </section>

    <section class="panel-section">
      <label class="file-drop compact">
        <input id="pmxInput" type="file" accept=".pmx" />
        <span>单独加载 PMX</span>
      </label>
      <label class="file-drop compact">
        <input id="vmdInput" type="file" accept=".vmd" />
        <span>播放 VMD 动作</span>
      </label>
      <select id="packageVmdSelect">
        <option value="">压缩包里没有 VMD</option>
      </select>
      <button id="playPackageVmdBtn">播放选中的 VMD</button>
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
        <input id="softToggle" type="checkbox" checked />
      </label>
      <button id="resetPhysicsBtn">重置物理</button>
      <button id="rigidBodyDebugBtn" type="button">显示刚体</button>
      <button id="physicsInspectBtn" type="button">物理诊断</button>
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
        <label class="control-row">
          <span>饱和度 <b id="saturationValue">1.16</b></span>
          <input id="saturationRange" type="range" min="0.5" max="2" step="0.01" value="1.16" />
        </label>
        <label class="control-row">
          <span>对比度 <b id="contrastValue">1.06</b></span>
          <input id="contrastRange" type="range" min="0.5" max="1.8" step="0.01" value="1.06" />
        </label>
      </div>
    </section>

    <pre id="log"></pre>
  </aside>
`;

const statusEl = document.querySelector('#status');
const logEl = document.querySelector('#log');
const packageInput = document.querySelector('#packageInput');
const pmxInput = document.querySelector('#pmxInput');
const vmdInput = document.querySelector('#vmdInput');
const packageModelSelect = document.querySelector('#packageModelSelect');
const packageVmdSelect = document.querySelector('#packageVmdSelect');
const physicsToggle = document.querySelector('#physicsToggle');
const ikToggle = document.querySelector('#ikToggle');
const softToggle = document.querySelector('#softToggle');
const resetPhysicsBtn = document.querySelector('#resetPhysicsBtn');
const rigidBodyDebugBtn = document.querySelector('#rigidBodyDebugBtn');
const physicsInspectBtn = document.querySelector('#physicsInspectBtn');
const expressionSelect = document.querySelector('#expressionSelect');
const expressionWeight = document.querySelector('#expressionWeight');
const expressionWeightLabel = document.querySelector('#expressionWeightLabel');
const renderSettingsToggle = document.querySelector('#renderSettingsToggle');
const renderSettingsPanel = document.querySelector('#renderSettingsPanel');
const renderControls = {
  outline: { input: document.querySelector('#outlineRange'), label: document.querySelector('#outlineValue'), digits: 4 },
  ambient: { input: document.querySelector('#ambientRange'), label: document.querySelector('#ambientValue'), digits: 2 },
  key: { input: document.querySelector('#keyRange'), label: document.querySelector('#keyValue'), digits: 2 },
  rim: { input: document.querySelector('#rimRange'), label: document.querySelector('#rimValue'), digits: 2 },
  exposure: { input: document.querySelector('#exposureRange'), label: document.querySelector('#exposureValue'), digits: 2 },
  saturation: { input: document.querySelector('#saturationRange'), label: document.querySelector('#saturationValue'), digits: 2 },
  contrast: { input: document.querySelector('#contrastRange'), label: document.querySelector('#contrastValue'), digits: 2 },
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
    state.physics = false;
    physicsToggle.checked = false;
    log(`Ammo 初始化失败，物理效果已关闭：${error.message}`);
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

function modelIdentity(model) {
  const source = String(model?.name || basename(model?.path || '') || '').replace(/\.pmx$/i, '');
  return source.replace(/_\d+$/g, '').toLowerCase();
}

function dedupeModels(models) {
  const seen = new Set();
  const result = [];
  for (const model of models) {
    const key = modelIdentity(model);
    if (!key || seen.has(key)) continue;
    seen.add(key);
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

function applyRenderSettings() {
  const settings = state.renderSettings;
  if (state.ambientLight) state.ambientLight.intensity = settings.ambient;
  if (state.keyLight) state.keyLight.intensity = settings.key;
  if (state.rimLight) state.rimLight.intensity = settings.rim;
  if (state.renderer) {
    state.renderer.toneMappingExposure = settings.exposure;
    state.renderer.domElement.style.filter = `saturate(${settings.saturation}) contrast(${settings.contrast})`;
  }
  if (state.mesh) {
    state.mesh.traverse((child) => {
      if (!child.isSkinnedMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        if (!mat?.userData?.outlineParameters) continue;
        mat.userData.outlineParameters.thickness = settings.outline;
      }
    });
    updateOutlineVisibility();
  }
}

function setRenderSetting(name, value) {
  if (!(name in state.renderSettings)) return;
  state.renderSettings[name] = value;
  const control = renderControls[name];
  if (control?.label) control.label.textContent = value.toFixed(control.digits);
  applyRenderSettings();
}

function initScene() {
  const viewer = document.querySelector('#viewer');
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0x080a0f);

  state.camera = new THREE.PerspectiveCamera(38, viewer.clientWidth / viewer.clientHeight, 0.1, 2000);
  state.camera.position.set(0, 5, 15);

  state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
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

  state.ambientLight = new THREE.AmbientLight(0xffffff, state.renderSettings.ambient);
  state.scene.add(state.ambientLight);

  state.keyLight = new THREE.DirectionalLight(0xffffff, state.renderSettings.key);
  state.keyLight.position.set(8, 14, 10);
  state.keyLight.castShadow = true;
  state.scene.add(state.keyLight);

  state.rimLight = new THREE.DirectionalLight(0x8fd7ff, state.renderSettings.rim);
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
  await loadModelFromUrl(assetUrl(path), path, resourceBase(path), { serverPath: path });
}

async function rememberLastModel(path, name, vmds = state.packageVmds.map((item) => item.path)) {
  try {
    await fetch(`${bridgeBaseUrl}/api/runtime/last-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name, vmds }),
    });
  } catch (error) {
    log(`保存最近模型失败：${error.message}`);
  }
}

async function restoreLastModel() {
  try {
    const response = await fetch(`${bridgeBaseUrl}/api/runtime/last-model`);
    const data = await response.json();
    let models = data.models?.length ? data.models : (data.last_model ? [data.last_model] : []);
    if (models.length < 2) {
      try {
        const modelResponse = await fetch(`${bridgeBaseUrl}/api/models`);
        const importedModels = await modelResponse.json();
        const existing = new Set(models.map((model) => modelIdentity(model)));
        for (const model of importedModels || []) {
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
    const last = data.last_model || models[0];
    if (!last?.path) return;
    state.packageVmds = (last.vmds || []).map((path) => ({ path, url: assetUrl(path), serverPath: path }));
    updatePackageSelects();
    packageModelSelect.value = last.path;
    log(`自动恢复最近模型：${last.name || last.path}`);
    await loadModel(last.path);
  } catch (error) {
    log(`自动恢复最近模型失败：${error.message}`);
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
  if (options.serverPath) rememberLastModel(options.serverPath, label);
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
        mat.userData.outlineParameters = {
          thickness: state.renderSettings.outline,
          color: [0, 0, 0],
          alpha: mat.opacity,
          visible: !isMaterialHidden(mat),
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

function updateOutlineVisibility() {
  if (!state.mesh) return;
  state.mesh.traverse((child) => {
    if (!child.isSkinnedMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of materials) {
      if (!mat?.userData?.outlineParameters) continue;
      mat.userData.outlineParameters.visible = !isMaterialHidden(mat);
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
  state.camera.near = Math.max(radius / 10000, 0.001);
  state.camera.far = Math.max(radius * 30, 2000);
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
  for (const action of mixer._actions || []) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
  }
  mixer.addEventListener('finished', () => {
    resetModelToRest({ readdHelper: true });
    log('VMD 播放结束。');
  });
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
  mat.userData.outlineParameters.alpha = mat.opacity;
  mat.userData.outlineParameters.visible = mat.opacity > 0.01;
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
    mat.userData.outlineParameters.alpha = Math.min(mat.userData.outlineParameters.alpha ?? mat.opacity, mat.opacity);
    mat.userData.outlineParameters.visible = mat.visible && (mat.userData.outlineParameters.alpha ?? 1) > 0.01;
    syncMmdMaterialUniforms(mat);
  }
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
    mat.userData.outlineParameters.alpha = applyScalarOp(baseOutline.alpha ?? mat.opacity, mat.userData.outlineParameters.alpha ?? mat.opacity, op.edgeColor?.[3], op.opType, weight);
    mat.userData.outlineParameters.thickness = applyScalarOp(baseOutline.thickness ?? 0.004, mat.userData.outlineParameters.thickness ?? 0.004, op.edgeSize, op.opType, weight);
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
  }));
  updatePackageSelects();
  log(`模型包已导入：${data.name}，PMX=1，VMD=${state.packageVmds.length}`);
  setStatus('模型包已导入，正在加载 PMX...');

  packageModelSelect.value = pmx.path;
  await rememberLastModel(pmx.path, data.name, state.packageVmds.map((item) => item.path));
  await loadSelectedPackageModel();
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

  packageVmdSelect.innerHTML = state.packageVmds.length
    ? ''
    : '<option value="">压缩包里没有 VMD</option>';
  for (const vmd of state.packageVmds) {
    const option = document.createElement('option');
    option.value = vmd.path;
    option.textContent = vmd.path;
    packageVmdSelect.appendChild(option);
  }
}

async function loadSelectedPackageModel() {
  const path = packageModelSelect.value;
  if (!path) return;
  const file = state.packagePmxx.find((item) => item.path === path) || state.packageFiles.get(path);
  if (!file) return;
  if (file.serverPath) {
    state.packageVmds = (file.vmds || []).map((vmdPath) => ({ path: vmdPath, url: assetUrl(vmdPath), serverPath: vmdPath }));
    updatePackageSelects();
    packageModelSelect.value = file.serverPath;
    await loadModel(file.serverPath);
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
  } else {
    await playVmdFromUrl(virtualUrl(file.path), path);
  }
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
        const path = `__local_vmd__/${file.name}`;
        state.packageFiles.set(path, { path, url: fileUrl(file), blob: file });
        await playVmdFromUrl(virtualUrl(path), file.name);
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
      revokeObjectUrls();
      state.packageFiles.clear();
      const path = `__local__/${file.name}`;
      state.packageFiles.set(path, { path, url: fileUrl(file), blob: file });
      await loadModelFromUrl(virtualUrl(path), file.name, virtualBase(path));
    } catch (error) {
      log(`PMX 加载失败：${error.message}`);
    }
  });

  vmdInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const path = `__local_vmd__/${file.name}`;
      state.packageFiles.set(path, { path, url: fileUrl(file), blob: file });
      await playVmdFromUrl(virtualUrl(path), file.name);
    } catch (error) {
      log(`VMD 播放失败：${error.message}`);
    }
  });

  document.querySelector('#loadPackageModelBtn').addEventListener('click', () => {
    loadSelectedPackageModel().catch((error) => log(`PMX 加载失败：${error.message}`));
  });
  document.querySelector('#playPackageVmdBtn').addEventListener('click', () => {
    playSelectedPackageVmd().catch((error) => log(`VMD 播放失败：${error.message}`));
  });
  physicsToggle.addEventListener('change', () => setPhysics(physicsToggle.checked));
  ikToggle.addEventListener('change', () => setIK(ikToggle.checked));
  softToggle.addEventListener('change', () => setSoftProtection(softToggle.checked));
  resetPhysicsBtn.addEventListener('click', resetPhysics);
  rigidBodyDebugBtn.addEventListener('click', toggleRigidBodies);
  physicsInspectBtn.addEventListener('click', inspectPhysics);
  expressionSelect.addEventListener('change', applySelectedExpression);
  expressionWeight.addEventListener('input', applySelectedExpression);
  renderSettingsToggle.addEventListener('click', () => {
    renderSettingsPanel.classList.toggle('collapsed');
  });
  for (const [name, control] of Object.entries(renderControls)) {
    if (!control.input) continue;
    control.input.value = String(state.renderSettings[name]);
    if (control.label) control.label.textContent = state.renderSettings[name].toFixed(control.digits);
    control.input.addEventListener('input', () => setRenderSetting(name, Number(control.input.value)));
  }
  document.querySelector('#resetViewBtn').addEventListener('click', () => {
    if (state.mesh) frameModel(state.mesh);
  });
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

initScene();
bindUI();
animate();
setInterval(pollCommands, 250);
initAmmo().then(() => restoreLastModel()).finally(() => {
  setStatus(state.mesh ? '最近模型已恢复。' : 'Three.js 渲染器已就绪。');
});
log(`Three.js ${THREE.REVISION}`);

