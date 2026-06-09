import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';

import './styles.css';

const bridgeBaseUrl = new URLSearchParams(window.location.search).get('bridge') || 'http://127.0.0.1:8098';

const state = {
  scene: null,
  camera: null,
  renderer: null,
  effect: null,
  controls: null,
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
};

const app = document.querySelector('#app');
app.innerHTML = `
  <main id="viewer"></main>
  <aside id="hud">
    <header>
      <strong>QwenPaw MMD Companion</strong>
      <span id="status">Starting modern Three.js renderer...</span>
    </header>

    <section class="panel-section">
      <label class="file-drop">
        <input id="packageInput" type="file" accept=".zip" />
        <span>Load PMX Package ZIP</span>
        <small>ZIP can include PMX, textures, and VMD files</small>
      </label>
      <select id="packageModelSelect">
        <option value="">No PMX package loaded</option>
      </select>
      <button id="loadPackageModelBtn">Load Selected PMX</button>
    </section>

    <section class="panel-section">
      <label class="file-drop compact">
        <input id="pmxInput" type="file" accept=".pmx" />
        <span>Load Single PMX</span>
      </label>
      <label class="file-drop compact">
        <input id="vmdInput" type="file" accept=".vmd" />
        <span>Play VMD File</span>
      </label>
      <select id="packageVmdSelect">
        <option value="">No VMD in package</option>
      </select>
      <button id="playPackageVmdBtn">Play Selected VMD</button>
    </section>

    <section class="panel-section">
      <div class="row">
        <button id="gestureGreetBtn">Greet</button>
        <button id="gestureThinkBtn">Think</button>
      </div>
      <button id="resetViewBtn">Reset View</button>
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

function log(message) {
  logEl.textContent += `[${new Date().toLocaleTimeString()}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(message) {
  statusEl.textContent = message;
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

function initScene() {
  const viewer = document.querySelector('#viewer');
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0x080a0f);

  state.camera = new THREE.PerspectiveCamera(38, viewer.clientWidth / viewer.clientHeight, 0.1, 2000);
  state.camera.position.set(0, 9, 34);

  state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setSize(viewer.clientWidth, viewer.clientHeight);
  state.renderer.shadowMap.enabled = true;
  viewer.appendChild(state.renderer.domElement);

  state.effect = new OutlineEffect(state.renderer, {
    defaultThickness: 0.004,
    defaultColor: new THREE.Color(0x000000),
    defaultAlpha: 1,
  });

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.target.set(0, 9, 0);
  state.controls.update();

  state.scene.add(new THREE.AmbientLight(0xffffff, 0.62));

  const key = new THREE.DirectionalLight(0xffffff, 0.5);
  key.position.set(8, 14, 10);
  key.castShadow = true;
  state.scene.add(key);

  const rim = new THREE.DirectionalLight(0x8fd7ff, 0.35);
  rim.position.set(-8, 10, -12);
  state.scene.add(rim);

  state.helper = new MMDAnimationHelper({
    afterglow: 2.0,
    resetPhysicsOnLoop: false,
  });

  window.addEventListener('resize', () => {
    const w = viewer.clientWidth;
    const h = viewer.clientHeight;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h);
  });
}

async function loadModel(path) {
  await loadModelFromUrl(assetUrl(path), path, resourceBase(path));
}

async function loadModelFromUrl(url, label, resourcePath = '') {
  const loader = new MMDLoader();
  if (resourcePath) loader.setResourcePath(resourcePath);
  setupPackageLoading(loader);
  setStatus(`Loading PMX: ${label}`);

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
  state.helper.add(mesh, { physics: true, unitStep: 1 / 120, maxStepNum: 5 });
  frameModel(mesh);
  setStatus(`Loaded PMX: ${label}`);
  log(`Loaded PMX, bones=${mesh.skeleton?.bones?.length || 0}`);
}

function applyModelStyle(mesh) {
  mesh.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
    if (child.isSkinnedMesh) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        if (!mat) continue;
        mat.userData.outlineParameters = {
          thickness: 0.004,
          color: [0, 0, 0],
          alpha: 1,
          visible: true,
        };
      }
    }
  });
}

function frameModel(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (!Number.isFinite(size.length()) || size.length() === 0) return;

  state.controls.target.copy(center);
  const radius = Math.max(size.x, size.y, size.z);
  state.camera.position.set(center.x, center.y + radius * 0.25, center.z + radius * 2.2);
  state.camera.near = Math.max(radius / 1000, 0.01);
  state.camera.far = Math.max(radius * 20, 2000);
  state.camera.updateProjectionMatrix();
  state.controls.update();
}

async function playVmd(path, options = {}) {
  if (!state.mesh) {
    log('VMD ignored: no PMX model loaded.');
    return;
  }

  const loader = new MMDLoader();
  setupPackageLoading(loader);
  setStatus(`Loading VMD: ${path}`);
  const animation = await new Promise((resolve, reject) => {
    loader.loadAnimation(assetUrl(path), state.mesh, resolve, undefined, reject);
  });

  state.helper.remove(state.mesh);
  state.helper.add(state.mesh, {
    animation,
    physics: true,
    unitStep: 1 / 120,
    maxStepNum: 5,
  });

  state.currentMotion = path;
  setStatus(`Playing VMD: ${path}`);
  log(`Playing VMD: ${path}`);
}

async function playVmdFromUrl(url, label) {
  if (!state.mesh) {
    log('VMD ignored: no PMX model loaded.');
    return;
  }
  const loader = new MMDLoader();
  setupPackageLoading(loader);
  setStatus(`Loading VMD: ${label}`);
  const animation = await new Promise((resolve, reject) => {
    loader.loadAnimation(url, state.mesh, resolve, undefined, reject);
  });
  state.helper.remove(state.mesh);
  state.helper.add(state.mesh, {
    animation,
    physics: true,
    unitStep: 1 / 120,
    maxStepNum: 5,
  });
  state.currentMotion = label;
  setStatus(`Playing VMD: ${label}`);
  log(`Playing VMD: ${label}`);
}

function setExpression(name, weight = 1) {
  if (!state.mesh?.morphTargetDictionary || !state.mesh?.morphTargetInfluences) return;
  const index = state.mesh.morphTargetDictionary[name];
  if (index === undefined) {
    log(`Expression not found: ${name}`);
    return;
  }
  state.mesh.morphTargetInfluences[index] = weight;
}

function performGesture(payload) {
  const intent = payload.intent || 'idle';
  state.mood = payload.emotion || state.mood;
  log(`Gesture intent received: ${intent}`);
  // Placeholder for the procedural gesture layer. Keep this adapter stable while
  // motion generation evolves.
  if (intent === 'greet_user') {
    setExpression('笑い', Math.min(1, payload.intensity || 0.6));
  }
}

async function loadPackage(file) {
  setStatus(`Uploading ZIP: ${file.name}`);
  log(`Uploading package: ${file.name}`);
  revokeObjectUrls();
  state.packageFiles.clear();
  state.packagePmxx = [];
  state.packageVmds = [];

  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${bridgeBaseUrl}/api/models/upload`, {
    method: 'POST',
    body: formData,
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || 'upload failed');
  }

  const pmx = { path: data.path, url: assetUrl(data.path), serverPath: data.path };
  state.packagePmxx = [pmx];
  state.packageVmds = (data.vmds || []).map((path) => ({
    path,
    url: assetUrl(path),
    serverPath: path,
  }));
  updatePackageSelects();
  log(`Imported package: ${data.name}, PMX=1, VMD=${state.packageVmds.length}`);
  setStatus('Package imported. Loading PMX...');

  packageModelSelect.value = pmx.path;
  await loadSelectedPackageModel();
}

function updatePackageSelects() {
  packageModelSelect.innerHTML = state.packagePmxx.length
    ? ''
    : '<option value="">No PMX found in package</option>';
  for (const pmx of state.packagePmxx) {
    const option = document.createElement('option');
    option.value = pmx.path;
    option.textContent = pmx.path;
    packageModelSelect.appendChild(option);
  }

  packageVmdSelect.innerHTML = state.packageVmds.length
    ? ''
    : '<option value="">No VMD found in package</option>';
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
      else log(`Unsupported dropped file: ${file.name}`);
    } catch (error) {
      log(`Drop load failed: ${error.message}`);
    }
  });

  packageInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await loadPackage(file);
    } catch (error) {
      setStatus('ZIP load failed.');
      log(`ZIP load failed: ${error.message}`);
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
      log(`PMX load failed: ${error.message}`);
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
      log(`VMD playback failed: ${error.message}`);
    }
  });

  document.querySelector('#loadPackageModelBtn').addEventListener('click', () => {
    loadSelectedPackageModel().catch((error) => log(`PMX load failed: ${error.message}`));
  });
  document.querySelector('#playPackageVmdBtn').addEventListener('click', () => {
    playSelectedPackageVmd().catch((error) => log(`VMD playback failed: ${error.message}`));
  });
  document.querySelector('#gestureGreetBtn').addEventListener('click', () => {
    performGesture({ intent: 'greet_user', emotion: 'happy', intensity: 0.7 });
  });
  document.querySelector('#gestureThinkBtn').addEventListener('click', () => {
    performGesture({ intent: 'thinking', emotion: 'neutral', intensity: 0.5 });
  });
  document.querySelector('#resetViewBtn').addEventListener('click', () => {
    if (state.mesh) frameModel(state.mesh);
  });
}

async function handleCommand(command) {
  const payload = command.payload || {};
  try {
    if (command.type === 'load_model') await loadModel(payload.path);
    else if (command.type === 'play_vmd') await playVmd(payload.path, payload);
    else if (command.type === 'set_expression') setExpression(payload.name, payload.weight);
    else if (command.type === 'set_mood') state.mood = payload.mood || 'neutral';
    else if (command.type === 'perform_gesture') performGesture(payload);
    else log(`Unknown command: ${command.type}`);
  } catch (error) {
    log(`${command.type} failed: ${error.message}`);
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
    log(`Bridge poll failed: ${error.message}`);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = state.mixerClock.getDelta();
  if (state.helper) state.helper.update(delta);
  if (state.effect) state.effect.render(state.scene, state.camera);
}

initScene();
bindUI();
animate();
setInterval(pollCommands, 250);
setStatus('Modern Three.js renderer ready.');
log(`Three.js ${THREE.REVISION}`);
