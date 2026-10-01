// Arcade Rally - browser build. Assets: Blender (GLB, Draco), audio: SourceArt/Audio (ElevenLabs pipeline).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const fmt = (s) => { const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };

const IS_TOUCH = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
if (IS_TOUCH) document.body.classList.add('touch');

// ------------------------------------------------------------------ tuning (SI units)
const TUNE = {
  engineAccel: 12.5, brakeAccel: 22, maxSpeed: 185 / 3.6, maxReverse: 40 / 3.6,
  boostMax: 240 / 3.6, boostAccel: 11, coast: 0.25, maxYaw: 2.0, driftYaw: 1.45, gravity: 9.81 * 1.7,
  // per surface: 0 tarmac, 1 gravel, 2 mud
  grip: [7.5, 3.9, 2.6], driftGrip: 1.25, topSpeed: [1.0, 0.95, 0.86], extraDrag: [0, 0.03, 0.2], yawMul: [1, 1.1, 1.18],
  boostCharge: 28, boostDrain: 38, laps: 3, wheelRadius: 0.34, barrier: 11.9,
};
const SURF_NAME = ['TARMAC', 'GRAVEL', 'MUD'];

// ------------------------------------------------------------------ renderer / scene
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb4d8f5, 220, 1100);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 3000);
scene.add(new THREE.HemisphereLight(0xd6ecff, 0x6b8a45, 0.85));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
const SUN_DIR = new V3(-0.55, 0.75, 0.38).normalize();

{ // Sega-blue gradient sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2f86ee) }, bottom: { value: new THREE.Color(0xcfeaff) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 2.2 + 0.05, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0); }',
  }));
  sky.renderOrder = -1;
  scene.add(sky);
  scene.userData.sky = sky;
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  $('rotate').classList.toggle('hidden', !(IS_TOUCH && h > w));
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ audio
class GameAudio {
  constructor() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.32; this.musicGain.connect(this.master);
    this.buf = {};
    this.loops = {};
  }
  async load(name) {
    const res = await fetch(`assets/audio/${name}.wav`);
    this.buf[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
  }
  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }
  play(name, vol = 1, rate = 1) {
    const b = this.buf[name]; if (!b) return 0;
    const src = this.ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g).connect(this.master); src.start();
    return b.duration / rate;
  }
  say(name) {   // announcer: duck the music underneath
    const d = this.play(name, 1.0);
    const t = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(0.12, t, 0.05);
    this.musicGain.gain.setTargetAtTime(0.32, t + d, 0.3);
  }
  loop(name, vol, toMusic = false) {
    if (this.loops[name]) return this.loops[name];
    const b = this.buf[name]; if (!b) return null;
    const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g).connect(toMusic ? this.musicGain : this.master); src.start();
    return (this.loops[name] = { src, gain: g });
  }
  stopLoops() { for (const k in this.loops) { try { this.loops[k].src.stop(); } catch { /* already stopped */ } } this.loops = {}; }
}
const audio = new GameAudio();
const SOUNDS = ['VO_Title', 'VO_Three', 'VO_Two', 'VO_One', 'VO_Go', 'VO_Checkpoint', 'VO_FinalLap', 'VO_Finish', 'VO_NewRecord',
  'SFX_EngineLoop', 'SFX_SkidLoop', 'SFX_Boost', 'SFX_Crash', 'SFX_Checkpoint', 'MUS_RaceLoop'];

// ------------------------------------------------------------------ input
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Enter') onConfirm();
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// touch: each pointer maps to the button under the finger, so sliding between buttons works
const touchPointers = new Map();
function buttonAt(x, y) { const el = document.elementFromPoint(x, y); return el && el.closest ? el.closest('.tbtn') : null; }
function refreshTouchButtons() {
  const active = new Set(touchPointers.values());
  document.querySelectorAll('.tbtn').forEach((b) => b.classList.toggle('on', active.has(b.dataset.act)));
}
document.querySelectorAll('.tbtn').forEach((btn) => {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (btn.hasPointerCapture && btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
    touchPointers.set(e.pointerId, btn.dataset.act);
    refreshTouchButtons();
    if (navigator.vibrate) navigator.vibrate(8);
  });
});
addEventListener('pointermove', (e) => {
  if (!touchPointers.has(e.pointerId)) return;
  const b = buttonAt(e.clientX, e.clientY);
  if (b) { touchPointers.set(e.pointerId, b.dataset.act); refreshTouchButtons(); }
});
const releasePointer = (e) => { if (touchPointers.delete(e.pointerId)) refreshTouchButtons(); };
addEventListener('pointerup', releasePointer);
addEventListener('pointercancel', releasePointer);

let padPrev = {};
function readInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  const t = new Set(touchPointers.values());
  let throttle = 0, steer = 0, drift = false, boost = false, reset = false;
  if (k('KeyW', 'ArrowUp') || t.has('gas')) throttle += 1;
  if (k('KeyS', 'ArrowDown') || t.has('brake')) throttle -= 1;
  if (k('KeyD', 'ArrowRight') || t.has('right')) steer += 1;
  if (k('KeyA', 'ArrowLeft') || t.has('left')) steer -= 1;
  drift = k('Space') || t.has('drift');
  boost = k('ShiftLeft', 'ShiftRight') || t.has('boost');
  reset = k('KeyR');
  const pad = navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p) : null;
  if (pad) {
    const b = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
    throttle += b(7) - b(6);
    const ax = pad.axes[0] || 0;
    steer += Math.abs(ax) > 0.12 ? ax : 0;
    steer += b(15) - b(14);
    drift = drift || b(1) > 0.5 || b(5) > 0.5;
    boost = boost || b(0) > 0.5;
    reset = reset || b(3) > 0.5;
    const start = b(9) > 0.5;
    if (start && !padPrev.start) onConfirm();
    padPrev = { start };
  }
  return { throttle: clamp(throttle, -1, 1), steer: clamp(steer, -1, 1), drift, boost, reset };
}

// ------------------------------------------------------------------ track (analytic surface = same profile as the Blender mesh)
let S = [], N = 0, TRACK = null, PROFILE = null;
function setupTrack(data) {
  TRACK = data;
  // Blender (x, y, z) -> three.js (x, z, -y)
  S = data.samples.map((s) => ({
    p: new V3(s.p[0], s.p[2], -s.p[1]),
    f: new V3(s.f[0], 0, -s.f[1]).normalize(),
    r: new V3(s.r[0], 0, -s.r[1]).normalize(),
    bank: s.bank, surf: s.surf ?? 1,
  }));
  N = S.length;
  PROFILE = data.cross_section;
}
function profile(d) {
  const c = PROFILE.cols, z = PROFILE.dz, n = c.length;
  let h;
  if (d <= c[0]) h = z[0] - (c[0] - d) * 0.15;
  else if (d >= c[n - 1]) h = z[n - 1] - (d - c[n - 1]) * 0.15;
  else {
    let k = 0; while (d > c[k + 1]) k++;
    h = lerp(z[k], z[k + 1], (d - c[k]) / (c[k + 1] - c[k]));
  }
  const a = Math.abs(d);
  if (a <= 7) h += PROFILE.crown * (1 - a / 7);
  return h;
}
function nearest(x, z, hint, win) {
  let best = hint, bd = Infinity;
  for (let k = -win; k <= win; k++) {
    const i = (hint + k + N) % N; const p = S[i].p;
    const dx = p.x - x, dz = p.z - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
const G = { h: 0, i: 0, t: 0, d: 0, surf: 1, rx: 0, rz: 1, fx: 1, fz: 0 };
function ground(x, z, hint, out = G) {
  const i = nearest(x, z, hint, 14);
  let a = i, b = (i + 1) % N;
  let pa = S[a].p, pb = S[b].p;
  let t = ((x - pa.x) * (pb.x - pa.x) + (z - pa.z) * (pb.z - pa.z)) / ((pb.x - pa.x) ** 2 + (pb.z - pa.z) ** 2);
  if (t < 0) {
    a = (i - 1 + N) % N; b = i; pa = S[a].p; pb = S[b].p;
    t = ((x - pa.x) * (pb.x - pa.x) + (z - pa.z) * (pb.z - pa.z)) / ((pb.x - pa.x) ** 2 + (pb.z - pa.z) ** 2);
  }
  t = clamp(t, 0, 1);
  const A = S[a], B = S[b];
  const cx = lerp(pa.x, pb.x, t), cy = lerp(pa.y, pb.y, t), cz = lerp(pa.z, pb.z, t);
  let rx = lerp(A.r.x, B.r.x, t), rz = lerp(A.r.z, B.r.z, t); const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
  const d = (x - cx) * rx + (z - cz) * rz;
  const surf = (t < 0.5 ? A : B).surf;
  out.h = cy + profile(d) + d * Math.tan(lerp(A.bank, B.bank, t)) - (surf === 2 && Math.abs(d) < 7 ? PROFILE.mud_drop : 0);
  out.i = a; out.t = t; out.d = d; out.surf = surf; out.rx = rx; out.rz = rz;
  out.fx = rz; out.fz = -rx;   // forward = up x right
  return out;
}
const fwdDist = (a, b) => (b - a + N) % N;
const yawOf = (f) => Math.atan2(-f.z, f.x);   // car forward = (cos yaw, 0, -sin yaw)

// ------------------------------------------------------------------ effects: dust/mud particles + skid marks
function spriteTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
class Particles {
  constructor(max = IS_TOUCH ? 260 : 520) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.rgb = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 2.2, map: spriteTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(p, v, color, life) {
    const k = this.i; this.i = (this.i + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], k * 3); this.vel.set([v.x, v.y, v.z], k * 3);
    this.rgb.set([color.r, color.g, color.b], k * 3); this.life[k] = this.maxLife[k] = life;
  }
  update(dt) {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) { this.col[k * 4 + 3] = 0; continue; }
      this.life[k] -= dt;
      const j = k * 3;
      this.vel[j + 1] -= 3.5 * dt; this.vel[j] *= 1 - 1.5 * dt; this.vel[j + 2] *= 1 - 1.5 * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const a = Math.max(0, this.life[k] / this.maxLife[k]);
      this.col.set([this.rgb[j], this.rgb[j + 1], this.rgb[j + 2], a * 0.65], k * 4);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
class Skids {
  constructor(max = 1400) {
    this.max = max; this.n = 0; this.last = [null, null];
    this.pos = new Float32Array(max * 12); this.col = new Float32Array(max * 16);
    const idx = new Uint32Array(max * 6);
    for (let q = 0; q < max; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  add(w, p, rx, rz, color, alpha) {
    const hw = 0.13;
    const l = [p.x - rx * hw, p.y, p.z - rz * hw], r = [p.x + rx * hw, p.y, p.z + rz * hw];
    const last = this.last[w];
    if (last) {
      const q = this.n % this.max; this.n++;
      this.pos.set([...last.l, ...last.r, ...l, ...r], q * 12);
      const c = [color.r, color.g, color.b];
      this.col.set([...c, last.a, ...c, last.a, ...c, alpha, ...c, alpha], q * 16);
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.mesh.geometry.attributes.color.needsUpdate = true;
    }
    this.last[w] = { l, r, a: alpha };
  }
  lift(w) { this.last[w] = null; }
  clear() { this.pos.fill(0); this.col.fill(0); this.n = 0; this.last = [null, null]; this.mesh.geometry.attributes.position.needsUpdate = true; }
}
const SURF_FX = [
  { dust: new THREE.Color(0.55, 0.55, 0.55), skid: new THREE.Color(0.04, 0.04, 0.04), skidA: 0.55 },
  { dust: new THREE.Color(0.78, 0.64, 0.46), skid: new THREE.Color(0.30, 0.22, 0.13), skidA: 0.6 },
  { dust: new THREE.Color(0.30, 0.20, 0.11), skid: new THREE.Color(0.10, 0.065, 0.035), skidA: 0.75 },
];

// ------------------------------------------------------------------ world objects
const carRoot = new THREE.Group();     // ground-following: position + yaw
const carBody = new THREE.Group();     // pitch / roll / suspension bob
carRoot.add(carBody);
const wheels = [];                     // { steer: Group, spin: Group, base: V3 }
let particles, skids;
const gates = [];

async function loadAll(onProgress) {
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  const glbs = ['world', 'car', 'wheel', 'gate_start', 'gate_checkpoint', 'boostpad'];
  const total = glbs.length + SOUNDS.length + 1; let done = 0;
  const tick = () => onProgress(++done / total);
  const [track, ...models] = await Promise.all([
    fetch('assets/track.json').then((r) => r.json()).then((j) => { tick(); return j; }),
    ...glbs.map((g) => loader.loadAsync(`assets/${g}.glb`).then((m) => { tick(); return m; })),
    ...SOUNDS.map((s) => audio.load(s).then(tick).catch(() => tick())),
  ]);
  setupTrack(track);
  const [world, car, wheel, gateStart, gateCp, pad] = models;

  world.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.receiveShadow = true;
    o.castShadow = /Scenery|Barriers/.test(o.name) || /Scenery|Barriers/.test(o.parent?.name || '');
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) { if (/Puddle/.test(m.name)) { m.roughness = 0.05; m.envMapIntensity = 1.6; } }
  });
  scene.add(world.scene);

  car.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  carBody.add(car.scene);
  for (const [x, z] of [[1.25, -0.8], [1.25, 0.8], [-1.25, -0.8], [-1.25, 0.8]]) {
    const steer = new THREE.Group(); const spin = new THREE.Group();
    const w = wheel.scene.clone(); w.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    spin.add(w); steer.add(spin); steer.position.set(x, TUNE.wheelRadius, z);
    carRoot.add(steer); wheels.push({ steer, spin, base: new V3(x, TUNE.wheelRadius, z) });
  }
  scene.add(carRoot);

  // gates + boost pads from the track data (same placement rules as the Unreal setup script)
  track.checkpoints.forEach((idx, k) => {
    const g = (k === 0 ? gateStart : gateCp).scene.clone();
    g.position.copy(S[idx].p); g.rotation.y = yawOf(S[idx].f);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g); gates.push(idx);
  });
  window.__boostPads = track.boost_pads.map((want) => {
    let best = want, bv = Infinity;
    for (let i = want - 12; i <= want + 12; i++) {
      const s = S[(i + N) % N]; const v = Math.abs(s.bank) + Math.abs(i - want) * 0.0005;
      if (v < bv) { bv = v; best = (i + N) % N; }
    }
    const p = pad.scene.clone(); p.position.copy(S[best].p); p.position.y += 0.06; p.rotation.y = yawOf(S[best].f);
    p.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.material = o.material.clone(); if (/Boost/.test(o.material.name)) { o.material.emissive = new THREE.Color(0x00d9ff); o.material.emissiveIntensity = 1.4; } } });
    scene.add(p);
    return best;
  });
  particles = new Particles();
  skids = new Skids();
}

// ------------------------------------------------------------------ car simulation
const car = {
  pos: new V3(), vel: new V3(), y: 0, vy: 0, yaw: 0, yawRate: 0, air: false, idx: 0, lastH: 0,
  boost: 35, padBoost: 0, boosting: false, drifting: false, surf: 1, steer: 0, spin: 0,
  pitch: 0, roll: 0, bob: 0, bobV: 0, lastCrash: -10, enabled: false, lat: 0,
};
function placeCar(idx) {
  const s = S[idx];
  car.idx = idx; car.pos.set(s.p.x, 0, s.p.z); car.vel.set(0, 0, 0); car.yaw = yawOf(s.f); car.yawRate = 0;
  car.y = ground(car.pos.x, car.pos.z, idx).h; car.lastH = car.y; car.vy = 0; car.air = false;
  car.pitch = car.roll = car.bob = car.bobV = 0;
  skids && skids.lift(0); skids && skids.lift(1);
}

const tmpF = new V3(), tmpR = new V3(), tmpP = new V3();
function stepCar(dt, input) {
  const f = tmpF.set(Math.cos(car.yaw), 0, -Math.sin(car.yaw));
  const r = tmpR.set(Math.sin(car.yaw), 0, Math.cos(car.yaw));
  const g = ground(car.pos.x, car.pos.z, car.idx);
  car.idx = g.i; car.surf = g.surf; car.lat = g.d;
  const s = car.surf;
  let vf = car.vel.dot(f), vr = car.vel.dot(r);
  const speed = Math.hypot(vf, vr);
  const drive = car.enabled;

  // boost
  car.padBoost = Math.max(0, car.padBoost - dt);
  const wasBoosting = car.boosting;
  car.boosting = drive && (car.padBoost > 0 || (input.boost && car.boost > 0));
  if (car.boosting && car.padBoost <= 0) car.boost = Math.max(0, car.boost - TUNE.boostDrain * dt);
  if (car.boosting && !wasBoosting && car.padBoost <= 0) audio.play('SFX_Boost', 0.8);

  // drifting: handbrake or a big slip angle while steering
  const slip = Math.atan2(Math.abs(vr), Math.max(Math.abs(vf), 1));
  car.drifting = !car.air && drive && vf > 9 && (input.drift || slip > 0.21) && Math.abs(input.steer) > 0.2;
  if (car.drifting) car.boost = Math.min(100, car.boost + TUNE.boostCharge * dt * (s === 2 ? 1.25 : 1));

  if (!car.air) {
    const top = (car.boosting ? TUNE.boostMax : TUNE.maxSpeed) * TUNE.topSpeed[s];
    let a = 0;
    if (drive) {
      if (input.throttle > 0) {
        const head = clamp(1 - vf / top, 0, 1);
        a = input.throttle * TUNE.engineAccel * (0.35 + 0.65 * head) * (vf < top ? 1 : 0);
      } else if (input.throttle < 0) {
        a = vf > 1.5 ? input.throttle * TUNE.brakeAccel : (vf > -TUNE.maxReverse ? input.throttle * TUNE.engineAccel * 0.5 : 0);
      }
      if (car.boosting) a += TUNE.boostAccel * (vf < top ? 1 : 0);
    }
    if (input.throttle === 0 || !drive) a -= vf * TUNE.coast * (drive ? 1 : 4);
    if (input.drift && drive) a -= vf * 0.3;
    a -= vf * TUNE.extraDrag[s] * (1 + Math.abs(vr) * 0.05);
    vf += a * dt;
    const grip = (car.drifting || (input.drift && drive) ? TUNE.driftGrip : TUNE.grip[s]);
    vr *= 1 - Math.min(grip * dt, 0.9);
  }
  car.vel.copy(f).multiplyScalar(vf).addScaledVector(r, vr);

  // steering: drive the yaw rate (positive steer = right = yaw decreases)
  car.steer = damp(car.steer, input.steer, 10, dt);
  let target = 0;
  if (drive) {
    const sf = clamp(Math.abs(vf) / 7, 0, 1) * (1 - 0.3 * clamp(Math.abs(vf) / TUNE.maxSpeed, 0, 1));
    target = -car.steer * TUNE.maxYaw * sf * Math.sign(vf) * (car.drifting ? TUNE.driftYaw : 1) * TUNE.yawMul[s];
  }
  car.yawRate = damp(car.yawRate, target, car.air ? 1.5 : 7, dt);
  car.yaw += car.yawRate * dt;
  car.pos.addScaledVector(car.vel, dt);

  // barriers (track-relative) + gate pillars
  const g2 = ground(car.pos.x, car.pos.z, car.idx);
  const limit = TUNE.barrier;
  const nearGate = gates.some((gi) => Math.min(fwdDist(g2.i, gi), fwdDist(gi, g2.i)) <= 1);
  let hitSide = 0, wallAt = 0;
  if (Math.abs(g2.d) > limit) { hitSide = Math.sign(g2.d); wallAt = limit; }
  else if (nearGate && Math.abs(g2.d) > 8.1 && Math.abs(g2.d) < 9.9) { hitSide = Math.abs(g2.d) < 9 ? Math.sign(g2.d) : -Math.sign(g2.d); wallAt = Math.abs(g2.d) < 9 ? 8.1 : 9.9; }
  if (hitSide) {
    const push = Math.abs(g2.d) - wallAt;
    const sgn = Math.sign(g2.d);
    car.pos.x -= g2.rx * push * sgn; car.pos.z -= g2.rz * push * sgn;
    const vIn = (car.vel.x * g2.rx + car.vel.z * g2.rz) * hitSide;
    if (vIn > 0) {
      car.vel.x -= g2.rx * hitSide * vIn * 1.35; car.vel.z -= g2.rz * hitSide * vIn * 1.35;   // bounce off
      if (vIn > 4 && performance.now() / 1000 - car.lastCrash > 0.5) {
        car.vel.multiplyScalar(clamp(1 - vIn * 0.012, 0.75, 0.97));                          // impact costs speed once
        car.lastCrash = performance.now() / 1000; audio.play('SFX_Crash', clamp(vIn / 15, 0.35, 1));
        shake = Math.min(1, vIn / 18);
      }
    }
    car.vel.multiplyScalar(1 - 0.8 * dt);   // scraping friction (per second, not per step)
    // arcade wall assist: the barrier steers the car back along the track
    let diff = wrapAngle(Math.atan2(-g2.fz, g2.fx) - car.yaw);
    if (Math.abs(diff) > Math.PI / 2) diff = wrapAngle(diff + Math.PI);
    car.yaw += diff * Math.min(1, 3 * dt);
  }

  // vertical: glue to the road, or fly when the road drops away faster than gravity
  const g3 = ground(car.pos.x, car.pos.z, car.idx);
  const h = g3.h;
  const groundVel = (h - car.lastH) / dt; car.lastH = h;
  if (car.air) {
    car.vy -= TUNE.gravity * dt; car.y += car.vy * dt;
    if (car.y <= h) {
      const impact = groundVel - car.vy; car.air = false; car.y = h; car.vy = groundVel;
      car.bobV -= Math.min(impact, 12) * 0.12;
      if (impact > 6) audio.play('SFX_Crash', 0.3, 1.3);
    }
  } else {
    const ballistic = car.y + (car.vy - TUNE.gravity * dt) * dt;
    if (ballistic > h + 0.02 && car.vy - groundVel > 0.6 && speed > 12) { car.air = true; car.vy -= TUNE.gravity * dt; car.y = ballistic; }
    else { car.y = h; car.vy = groundVel; }
  }
  return { vf, vr, speed };
}

// ------------------------------------------------------------------ race state
const race = {
  state: 'loading', clock: 0, countdown: 0, lastSecond: 4, time: 0, lapStart: 0, lap: 1, next: 0, armed: false,
  cpThisLap: 0, lapTimes: [], best: 0, lastCheckpointIdx: 0, paused: false,
};
let shake = 0;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

function callout(text) {
  const el = $('hud-callout'); el.textContent = text; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function show(id) { for (const s of ['screen-loading', 'screen-start', 'screen-pause', 'screen-results']) $(s).classList.toggle('hidden', s !== id); }

async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  } catch { /* not allowed (e.g. iPhone Safari) - the canvas already fills the viewport */ }
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch { /* desktop */ }
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen(); else enterFullscreen();
}

function startRace() {
  audio.resume();
  enterFullscreen();
  audio.stopLoops();
  skids.clear();
  placeCar(TRACK.start_index);
  camInit = false;
  Object.assign(race, { state: 'intro', clock: 0, countdown: 0, lastSecond: 4, time: 0, lapStart: 0, lap: 1, next: 0, armed: false,
    cpThisLap: 0, lapTimes: [], lastCheckpointIdx: TRACK.start_index, paused: false });
  race.best = parseFloat(store.get('arcadeRally.bestLap')) || 0;
  car.boost = 35; car.enabled = false;
  show(null);
  $('hud').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !IS_TOUCH);
  audio.loop('MUS_RaceLoop', 1, true);
  audio.loop('SFX_EngineLoop', 0.45);
  audio.loop('SFX_SkidLoop', 0);
  audio.say('VO_Title');
  callout('ARCADE RALLY');
}
function onConfirm() {
  if (race.state === 'start' || race.state === 'finished') startRace();
  else if (race.paused) togglePause();
}
function togglePause() {
  if (!['intro', 'countdown', 'race'].includes(race.state)) return;
  race.paused = !race.paused;
  show(race.paused ? 'screen-pause' : null);
  if (race.paused) audio.ctx.suspend(); else audio.resume();
}
$('btn-start').addEventListener('click', startRace);
$('btn-again').addEventListener('click', startRace);
$('btn-resume').addEventListener('click', togglePause);
$('btn-restart').addEventListener('click', () => { race.paused = false; audio.resume(); startRace(); });
$('btn-pause').addEventListener('click', togglePause);
$('btn-fullscreen').addEventListener('click', toggleFullscreen);

function passGate(gi) {
  if (race.state !== 'race' || gi !== race.next) return;
  const idx = TRACK.checkpoints[gi];
  race.lastCheckpointIdx = idx;
  race.next = (gi + 1) % TRACK.checkpoints.length;
  if (gi !== 0) {
    race.cpThisLap++;
    audio.play('SFX_Checkpoint', 0.8); audio.say('VO_Checkpoint');
    callout(`CHECKPOINT  ${fmt(race.time - race.lapStart)}`);
    return;
  }
  if (!race.armed) { race.armed = true; return; }   // grid is behind the line
  const lapTime = race.time - race.lapStart;
  race.lapTimes.push(lapTime); race.lapStart = race.time; race.cpThisLap = 0;
  const record = !race.best || lapTime < race.best;
  if (record) { race.best = lapTime; store.set('arcadeRally.bestLap', String(lapTime)); }
  audio.play('SFX_Checkpoint', 0.8);
  if (race.lap >= TUNE.laps) { finishRace(); return; }
  race.lap++;
  if (race.lap === TUNE.laps) { audio.say('VO_FinalLap'); callout(record && race.lapTimes.length > 1 ? 'FINAL LAP!  NEW RECORD!' : 'FINAL LAP!'); }
  else if (record && race.lapTimes.length > 1) { audio.say('VO_NewRecord'); callout(`NEW LAP RECORD  ${fmt(lapTime)}`); }
  else callout(`LAP ${race.lap}  -  ${fmt(lapTime)}`);
}
function finishRace() {
  race.state = 'finished'; car.enabled = false;
  audio.say('VO_Finish'); callout(`FINISH!  ${fmt(race.time)}`);
  const best = Math.min(...race.lapTimes);
  $('results-laps').innerHTML = race.lapTimes.map((t, i) => `<div class="${t === best ? 'best' : ''}">LAP ${i + 1} &nbsp; ${fmt(t)}${t === best ? ' &nbsp;BEST' : ''}</div>`).join('');
  $('results-total').textContent = `TOTAL  ${fmt(race.time)}`;
  const bestTotal = parseFloat(store.get('arcadeRally.bestTotal')) || 0;
  if (!bestTotal || race.time < bestTotal) store.set('arcadeRally.bestTotal', String(race.time));
  setTimeout(() => { if (race.state === 'finished') { show('screen-results'); $('touch').classList.add('hidden'); } }, 2200);
}

// ------------------------------------------------------------------ HUD
const hud = {};
for (const id of ['hud-lap', 'hud-time', 'hud-laptime', 'hud-best', 'hud-best-row', 'hud-cp', 'hud-speed', 'hud-boost-fill', 'hud-boost-label', 'hud-drift', 'hud-countdown', 'hud-surface']) hud[id] = $(id);
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; hud[id].textContent = v; } }
function updateHud(speedKmh) {
  setText('hud-lap', `LAP ${Math.min(race.lap, TUNE.laps)}/${TUNE.laps}`);
  setText('hud-time', fmt(race.time));
  setText('hud-laptime', fmt(Math.max(0, race.time - race.lapStart)));
  if (race.best) { hud['hud-best-row'].classList.remove('hidden'); setText('hud-best', fmt(race.best)); }
  setText('hud-cp', `${race.cpThisLap}/${TRACK.checkpoints.length - 1}`);
  setText('hud-speed', String(Math.round(speedKmh)));
  hud['hud-boost-fill'].style.width = `${car.boost.toFixed(1)}%`;
  hud['hud-boost-fill'].classList.toggle('active', car.boosting);
  hud['hud-boost-label'].classList.toggle('active', car.boosting);
  hud['hud-drift'].classList.toggle('hidden', !car.drifting);
  setText('hud-surface', race.state === 'race' ? SURF_NAME[car.surf] : '');
  document.querySelector('.boost-btn').classList.toggle('ready', car.boost > 30);
  let cd = '';
  if (race.state === 'countdown') cd = String(clamp(Math.ceil(race.countdown), 1, 3));
  else if (race.state === 'race' && race.time < 0.8) cd = 'GO!';
  setText('hud-countdown', cd);
  hud['hud-countdown'].classList.toggle('go', cd === 'GO!');
}

// ------------------------------------------------------------------ main loop
const FIXED = 1 / 120;
let acc = 0, last = performance.now();
let camYaw = 0, camPos = new V3(), camInit = false, resetHeld = false;
const camTarget = new V3(), lookAt = new V3();
let lastFx = { vf: 0, vr: 0, speed: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (race.state === 'loading' || race.state === 'start') return;   // start screen renders its own orbit
  if (race.paused) { renderer.render(scene, camera); return; }

  const input = readInput();
  if (input.reset && !resetHeld && race.state === 'race') placeCar(race.lastCheckpointIdx);
  resetHeld = input.reset;

  // race flow
  race.clock += dt;
  if (race.state === 'intro' && race.clock > 2.2) { race.state = 'countdown'; race.countdown = 3.999; race.lastSecond = 4; }
  if (race.state === 'countdown') {
    race.countdown -= dt;
    const sec = Math.ceil(race.countdown);
    if (sec !== race.lastSecond && sec >= 1) { race.lastSecond = sec; audio.say(sec === 3 ? 'VO_Three' : sec === 2 ? 'VO_Two' : 'VO_One'); }
    if (race.countdown <= 0) { race.state = 'race'; race.time = race.lapStart = 0; car.enabled = true; audio.say('VO_Go'); }
  }
  if (race.state === 'race') race.time += dt;

  // fixed-step physics
  if (race.state !== 'start') {
    acc += dt;
    while (acc >= FIXED) {
      const prevIdx = car.idx;
      lastFx = stepCar(FIXED, input);
      const moved = fwdDist(prevIdx, car.idx);
      if (moved > 0 && moved < 60) {
        TRACK.checkpoints.forEach((gi, k) => { const d = fwdDist(prevIdx, gi); if (d > 0 && d <= moved) passGate(k); });
        window.__boostPads.forEach((pi) => { const d = fwdDist(prevIdx, pi); if (d > 0 && d <= moved && Math.abs(car.lat) < 3.4) { car.padBoost = 1.6; audio.play('SFX_Boost', 0.9); } });
      }
      acc -= FIXED;
    }
  }

  // ---- visuals: car pose ----
  const f = tmpF.set(Math.cos(car.yaw), 0, -Math.sin(car.yaw));
  const r = tmpR.set(Math.sin(car.yaw), 0, Math.cos(car.yaw));
  const hF = ground(car.pos.x + f.x * 1.4, car.pos.z + f.z * 1.4, car.idx, {}).h;
  const hB = ground(car.pos.x - f.x * 1.4, car.pos.z - f.z * 1.4, car.idx, {}).h;
  const hR = ground(car.pos.x + r.x * 0.8, car.pos.z + r.z * 0.8, car.idx, {}).h;
  const hL = ground(car.pos.x - r.x * 0.8, car.pos.z - r.z * 0.8, car.idx, {}).h;
  const latAcc = car.yawRate * lastFx.vf;
  if (!car.air) {
    car.pitch = damp(car.pitch, Math.atan2(hF - hB, 2.8), 12, dt);
    car.roll = damp(car.roll, -Math.atan2(hR - hL, 1.6) + clamp(latAcc * 0.006, -0.07, 0.07), 8, dt);
  } else {
    car.pitch = damp(car.pitch, -0.08, 1.5, dt);
  }
  car.bobV += (-car.bob * 120 - car.bobV * 9) * dt; car.bob += car.bobV * dt;
  carRoot.position.set(car.pos.x, car.y, car.pos.z);
  carRoot.rotation.set(0, car.yaw, 0);
  carBody.position.y = car.bob;
  carBody.rotation.set(car.roll, 0, car.pitch);
  car.spin -= (lastFx.vf / TUNE.wheelRadius) * dt;
  wheels.forEach((w, i) => {
    w.steer.rotation.y = i < 2 ? -car.steer * 0.45 : 0;
    w.spin.rotation.z = car.spin;
    w.steer.position.y = TUNE.wheelRadius + (car.air ? -0.08 : 0);
  });

  // ---- effects: dust, mud, skid marks, sounds ----
  const fx = SURF_FX[car.surf];
  const slide = Math.abs(lastFx.vr);
  const grounded = !car.air && race.state !== 'start';
  for (let w = 0; w < 2; w++) {
    const side = w === 0 ? -0.8 : 0.8;
    tmpP.set(car.pos.x - f.x * 1.25 + r.x * side, 0, car.pos.z - f.z * 1.25 + r.z * side);
    tmpP.y = ground(tmpP.x, tmpP.z, car.idx, {}).h + 0.03;
    const marking = grounded && (slide > 2.2 || (car.drifting) || (car.surf > 0 && lastFx.speed > 6));
    if (marking) skids.add(w, tmpP, r.x, r.z, fx.skid, car.surf > 0 ? fx.skidA * clamp(lastFx.speed / 20 + slide / 8, 0.3, 1) : fx.skidA * clamp(slide / 6, 0, 1));
    else skids.lift(w);
    const emitRate = grounded ? (car.surf === 0 ? (slide > 3 ? 40 : 0) : clamp(lastFx.speed * 1.4 + slide * 6, 0, 90)) : 0;
    let n = emitRate * dt + Math.random();
    while (n-- >= 1) {
      const kick = new V3(-f.x * lastFx.speed * 0.25 + (Math.random() - 0.5) * 3, 1 + Math.random() * (car.surf === 2 ? 3.5 : 2), -f.z * lastFx.speed * 0.25 + (Math.random() - 0.5) * 3);
      particles.emit(new V3(tmpP.x, tmpP.y + 0.2, tmpP.z), kick, fx.dust, car.surf === 2 ? 0.7 : 1.2);
    }
  }
  particles.update(dt);
  if (audio.loops.SFX_EngineLoop) {
    const kmh = lastFx.speed * 3.6, span = 185 / 5, gear = Math.min(Math.floor(kmh / span), 4), inGear = clamp((kmh - gear * span) / span, 0, 1.2);
    const rev = car.enabled ? 0 : Math.max(0, input.throttle) * 0.6;
    audio.loops.SFX_EngineLoop.src.playbackRate.value = clamp(0.65 + 0.75 * inGear + 0.06 * gear + rev + (car.boosting ? 0.12 : 0), 0.4, 2);
    audio.loops.SFX_EngineLoop.gain.gain.value = 0.4 + 0.3 * Math.abs(input.throttle);
  }
  if (audio.loops.SFX_SkidLoop) audio.loops.SFX_SkidLoop.gain.gain.value = grounded ? clamp((slide - 2) / 8, 0, 0.8) + (car.drifting ? 0.25 : 0) : 0;

  // ---- camera: Sega-style chase, lags behind the heading so drifts look wide ----
  const speedRatio = lastFx.speed / TUNE.maxSpeed;
  if (!camInit) camYaw = car.yaw;
  camYaw += wrapAngle(car.yaw - camYaw) * (1 - Math.exp(-4.5 * dt));
  const cf = new V3(Math.cos(camYaw), 0, -Math.sin(camYaw));
  const dist = 7.0 + speedRatio * 1.6;
  camTarget.set(car.pos.x - cf.x * dist, car.y + 2.5 + speedRatio * 0.4, car.pos.z - cf.z * dist);
  const camGround = ground(camTarget.x, camTarget.z, car.idx, {}).h + 1.2;
  camTarget.y = Math.max(camTarget.y, camGround);
  if (!camInit) { camPos.copy(camTarget); camInit = true; }
  camPos.lerp(camTarget, 1 - Math.exp(-10 * dt));
  shake = Math.max(0, shake - dt * 2.5);
  camera.position.copy(camPos).add(new V3((Math.random() - 0.5) * shake * 0.4, (Math.random() - 0.5) * shake * 0.4, 0));
  lookAt.set(car.pos.x + cf.x * 4, car.y + 1.1, car.pos.z + cf.z * 4);
  camera.lookAt(lookAt);
  const fov = 68 + 12 * clamp(speedRatio, 0, 1.3) + (car.boosting ? 8 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 4, dt); camera.updateProjectionMatrix(); }

  sun.position.copy(carRoot.position).addScaledVector(SUN_DIR, 120);
  sun.target.position.copy(carRoot.position);
  scene.userData.sky.position.copy(camera.position);

  if (race.state !== 'start') updateHud(lastFx.speed * 3.6);
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
(async () => {
  try {
    await loadAll((p) => { $('load-fill').style.width = `${Math.round(p * 100)}%`; });
  } catch (err) {
    $('load-text').textContent = `Could not load the game: ${err.message}`;
    throw err;
  }
  placeCar(TRACK.start_index);
  race.state = 'start';
  const best = parseFloat(store.get('arcadeRally.bestLap'));
  if (best) $('best-ever').textContent = `YOUR BEST LAP  ${fmt(best)}`;
  show('screen-start');
  // attract mode: slow orbit around the car behind the start screen
  const orbit = (t) => {
    if (race.state !== 'start') return;
    const a = t / 4000;
    camera.position.set(car.pos.x + Math.cos(a) * 9, car.y + 3.2, car.pos.z + Math.sin(a) * 9);
    camera.lookAt(car.pos.x, car.y + 0.8, car.pos.z);
    carRoot.position.set(car.pos.x, car.y, car.pos.z); carRoot.rotation.set(0, car.yaw, 0);
    sun.position.copy(carRoot.position).addScaledVector(SUN_DIR, 120); sun.target.position.copy(carRoot.position);
    scene.userData.sky.position.copy(camera.position);
    renderer.render(scene, camera);
    requestAnimationFrame(orbit);
  };
  requestAnimationFrame(orbit);
  requestAnimationFrame(frame);
  window.__rally = { race, car, TUNE, samples: () => S };   // handy for debugging / automated tests
})();
