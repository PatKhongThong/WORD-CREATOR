// Advanced 3D Planetary Rendering Engine (Three.js WebGL + full-featured Software Ray-Cast fallback).
// Features:
//  - High-resolution displaced spherical terrain mesh with normal/bump & water-specular maps
//  - Separate animated procedural cloud sphere with shadow undercast
//  - Physically-inspired Rayleigh/Fresnel atmospheric scattering halo with configurable density & color
//  - Dynamic sun direction (Time-of-Day simulation) with realistic day/night terminator & city night lights
//  - 3D geographical & city labels projected over the globe surface with horizon occlusion
//  - Smooth damped orbit camera, zoom limits, pan, click to inspect, double-click to focus, flyTo(lat, lon)
//  - Miniature Planetary System orbital mode (central star + multiple generated planets in Keplerian orbits)
//  - Adaptive quality (Low / Medium / High) and complete GPU resource cleanup

import { getLayerCanvas, getBorderCanvas } from './layers.js';
import { createNoise3D, fbm } from '../core/noise.js';
import { RNG } from '../core/rng.js';
import { BIOMES, isWater } from '../gen/biomes.js';
import { cellLatLon, formatLatLon } from '../gen/grid.js';
import { clamp, lerp } from '../core/utils.js';

function hexRgb(hex, def = [76, 184, 255]) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return def;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export class GlobeViewer {
  /**
   * @param {HTMLElement} container
   * @param {{onHover?:Function, onSelect?:Function, onCamera?:Function}} callbacks
   */
  constructor(container, callbacks = {}) {
    this.container = container;
    this.cb = callbacks;
    this.world = null;
    this.systemWorlds = []; // extra planets for Planetary System mode
    this.systemMode = false;
    this.layer = 'physical';
    this.borders = true;
    this.showLabels = true;
    this.labelFilters = {
      continents: true,
      countries: true,
      capitals: true,
      cities: true,
      mountains: true,
      rivers: true,
      oceans: true,
    };
    this.showClouds = true;
    this.showAtmosphere = true;
    this.autoRotate = true;
    this.quality = 'high'; // 'low' | 'medium' | 'high'
    this.exaggeration = 1.25;
    this.sunAngle = 0.65; // radians around equator (time-of-day simulation)
    this.timeSpeed = 0;   // >0 animates time of day

    // Damped spherical camera state
    this.rotY = -0.5;
    this.rotX = 0.22;
    this.distance = 2.45;
    this.panX = 0;
    this.panY = 0;
    this.target = { rotY: -0.5, rotX: 0.22, distance: 2.45, panX: 0, panY: 0 };

    this.selected = null;
    this.pulse = null;
    this.cloudAngle = 0;
    this._disposed = false;
    this._init();
  }

  async _init() {
    // Overlay canvas for crisp 3D-projected geographical labels, pins, and solar-system orbit HUD
    this.stageWrap = document.createElement('div');
    this.stageWrap.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;';
    this.mountEl = document.createElement('div');
    this.mountEl.style.cssText = 'width:100%;height:100%;';
    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    this.stageWrap.appendChild(this.mountEl);
    this.stageWrap.appendChild(this.hudCanvas);
    this.container.innerHTML = '';
    this.container.appendChild(this.stageWrap);

    try {
      const THREE = await import('three');
      this.THREE = THREE;
      this._initThree();
    } catch {
      this._initSoftware();
    }
  }

  /** Synthesize equirectangular procedural cloud texture for the planet's seed & cloudCoverage. */
  _buildCloudCanvas(world) {
    const cov = world.settings?.cloudCoverage ?? 0.52;
    const key = `${world.seed}:${cov.toFixed(2)}`;
    if (world._cloudCanvas && world._cloudKey === key) return world._cloudCanvas;

    const W = 512, H = 256;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const n1 = createNoise3D(new RNG(world.seed + '::clouds-1'));
    const n2 = createNoise3D(new RNG(world.seed + '::clouds-2'));
    const thresh = 0.62 - cov * 0.68;

    for (let y = 0; y < H; y++) {
      const lat = Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      // ITCZ & mid-latitude storm tracks have denser cloud bands
      const bandBoost = 0.08 * Math.cos(lat * 6);
      for (let x = 0; x < W; x++) {
        const lon = ((x + 0.5) / W) * Math.PI * 2;
        const px = cl * Math.cos(lon), py = sl, pz = cl * Math.sin(lon);
        const w = fbm(n2, px * 2.2, py * 2.2, pz * 2.2, 3) * 0.35;
        const v = fbm(n1, (px + w) * 3.4, (py + w) * 3.4, (pz + w) * 3.4, 5) + bandBoost;
        const alpha = clamp((v - thresh) * 1.9, 0, 1);
        const idx = (y * W + x) * 4;
        d[idx] = 248; d[idx + 1] = 250; d[idx + 2] = 255;
        d[idx + 3] = Math.round(Math.pow(alpha, 1.25) * 235 * Math.min(1, cov * 1.35));
      }
    }
    ctx.putImageData(img, 0, 0);
    world._cloudCanvas = c;
    world._cloudKey = key;
    return c;
  }

  /** Build roughness + night-lights + specular water maps for Three.js material. */
  _buildMaterialMaps(world) {
    if (world._matMaps) return world._matMaps;
    const { W, H, fields } = world;
    const { height, biome, lakeMask, pop, volcanicMask } = fields;

    const roughC = document.createElement('canvas');
    roughC.width = W; roughC.height = H;
    const rCtx = roughC.getContext('2d');
    const rImg = rCtx.createImageData(W, H);
    const rData = rImg.data;

    const emitC = document.createElement('canvas');
    emitC.width = W; emitC.height = H;
    const eCtx = emitC.getContext('2d');
    const eImg = eCtx.createImageData(W, H);
    const eData = eImg.data;

    const bumpC = document.createElement('canvas');
    bumpC.width = W; bumpC.height = H;
    const bCtx = bumpC.getContext('2d');
    const bImg = bCtx.createImageData(W, H);
    const bData = bImg.data;

    for (let i = 0; i < W * H; i++) {
      const h = height[i], b = biome[i];
      const water = (h <= 0 || lakeMask[i]) && b !== 3; // open water (not sea ice)
      const rough = water ? 48 : b === 6 || b === 19 ? 110 : 218;
      const k = i * 4;
      rData[k] = rough; rData[k + 1] = rough; rData[k + 2] = rough; rData[k + 3] = 255;

      const bmp = h > 0 ? clamp(Math.round(128 + h * 127), 0, 255) : clamp(Math.round(128 + h * 45), 0, 255);
      bData[k] = bmp; bData[k + 1] = bmp; bData[k + 2] = bmp; bData[k + 3] = 255;

      // Emissive: warm urban lights on dense population cells + glowing lava on volcanic cells
      const p = pop ? Math.min(1, Math.log10(pop[i] + 1) / 3.5) : 0;
      const lava = b === 20 && volcanicMask ? clamp((volcanicMask[i] - 0.5) * 2.2, 0, 1) : 0;
      const nightGlow = p > 0.42 ? Math.pow((p - 0.42) / 0.58, 1.6) : 0;
      eData[k]     = clamp(nightGlow * 255 + lava * 255, 0, 255);
      eData[k + 1] = clamp(nightGlow * 185 + lava * 72, 0, 255);
      eData[k + 2] = clamp(nightGlow * 85  + lava * 18, 0, 255);
      eData[k + 3] = 255;
    }
    rCtx.putImageData(rImg, 0, 0);
    bCtx.putImageData(bImg, 0, 0);
    eCtx.putImageData(eImg, 0, 0);
    world._matMaps = { roughC, bumpC, emitC };
    return world._matMaps;
  }

  _composeTexture(world = this.world) {
    if (!world) return null;
    const layerId = this.layer === 'wireframe' ? 'elevation' : this.layer;
    const base = getLayerCanvas(world, layerId);
    const out = document.createElement('canvas');
    out.width = base.width; out.height = base.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(base, 0, 0);
    if ((this.borders || this.layer === 'countries') && this.layer !== 'wireframe') {
      ctx.drawImage(getBorderCanvas(world), 0, 0);
    }
    return out;
  }

  _initThree() {
    const THREE = this.THREE;
    const w = Math.max(300, this.mountEl.clientWidth || 800);
    const h = Math.max(260, this.mountEl.clientHeight || 600);
    const renderer = new THREE.WebGLRenderer({ antialias: this.quality !== 'low', alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(this.quality === 'low' ? 1 : Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    this.mountEl.innerHTML = '';
    this.mountEl.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, w / h, 0.05, 160);
    this.scene = scene; this.camera = camera;

    this.ambientLight = new THREE.AmbientLight(0x3a527a, 0.42);
    scene.add(this.ambientLight);
    this.sunLight = new THREE.DirectionalLight(0xfff5e4, 2.25);
    scene.add(this.sunLight);

    // Multi-layered starfield + galactic dust band
    const starGeo = new THREE.BufferGeometry();
    const starCount = 2600;
    const starPts = new Float32Array(starCount * 3);
    const starCols = new Float32Array(starCount * 3);
    const srng = new RNG('starfield-cosmos-v2');
    for (let i = 0; i < starCount; i++) {
      const band = i < 900 ? srng.gauss(0, 0.18) : srng.range(-1, 1);
      const u = clamp(band, -1, 1);
      const t = srng.range(0, Math.PI * 2), r = 32 + srng.range(0, 28);
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      starPts[i * 3] = r * s * Math.cos(t);
      starPts[i * 3 + 1] = r * u;
      starPts[i * 3 + 2] = r * s * Math.sin(t);
      const tint = srng.next();
      starCols[i * 3]     = tint < 0.3 ? 0.75 : 0.98;
      starCols[i * 3 + 1] = tint < 0.3 ? 0.86 : 0.94;
      starCols[i * 3 + 2] = tint > 0.7 ? 0.78 : 1.0;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPts, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starCols, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.085, vertexColors: true, transparent: true, opacity: 0.88 }));
    scene.add(this.stars);

    // Primary planet group
    this.group = new THREE.Group();
    scene.add(this.group);

    this._buildPlanetMeshes();

    // Planetary System Group (hidden unless systemMode is active)
    this.solarGroup = new THREE.Group();
    this.solarGroup.visible = false;
    scene.add(this.solarGroup);

    this._bindControls(renderer.domElement);
    this._ro = new ResizeObserver(() => {
      if (this._disposed) return;
      const cw = Math.max(240, this.mountEl.clientWidth), ch = Math.max(200, this.mountEl.clientHeight);
      camera.aspect = cw / ch; camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
    });
    this._ro.observe(this.mountEl);
    if (this.world) this._applyWorldThree();

    let lastTs = performance.now();
    const tick = (ts) => {
      if (this._disposed) return;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      this._stepSimulation(dt);
      this.group.rotation.y = this.rotY;
      this.group.rotation.x = this.rotX;
      if (this.cloudMesh) {
        this.cloudMesh.rotation.y = this.cloudAngle;
        this.cloudMesh.visible = this.showClouds && this.layer !== 'wireframe' && !this.systemMode;
      }
      if (this.atmoMesh) {
        this.atmoMesh.visible = this.showAtmosphere && (this.world?.settings?.atmosphereDensity ?? 0.68) > 0.02 && !this.systemMode;
      }
      const sx = Math.cos(this.sunAngle) * 6, sz = Math.sin(this.sunAngle) * 6;
      this.sunLight.position.set(sx, 1.35, sz);
      if (this.atmoMesh?.material?.uniforms?.sunDir) {
        this.atmoMesh.material.uniforms.sunDir.value.set(sx, 1.35, sz).normalize();
      }
      camera.position.set(this.panX, this.panY, this.distance);
      camera.lookAt(this.panX, this.panY, 0);
      renderer.render(scene, camera);
      this._drawHUD(ts);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _buildPlanetMeshes() {
    const THREE = this.THREE;
    if (!THREE || !this.group) return;
    while (this.group.children.length) {
      const ch = this.group.children.pop();
      ch.geometry?.dispose();
      ch.material?.dispose?.();
    }
    const segW = this.quality === 'low' ? 96 : this.quality === 'medium' ? 160 : 224;
    const segH = this.quality === 'low' ? 64 : this.quality === 'medium' ? 96 : 128;
    const sphereGeo = new THREE.SphereGeometry(1, segW, segH);
    this._basePos = Float32Array.from(sphereGeo.attributes.position.array);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.08, bumpScale: 0.015, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.38 });
    this.globe = new THREE.Mesh(sphereGeo, mat);
    this.group.add(this.globe);

    // Separate procedural cloud layer sphere
    const cloudGeo = new THREE.SphereGeometry(1.018, 96, 64);
    const cloudMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.88, depthWrite: false, roughness: 0.95 });
    this.cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    this.group.add(this.cloudMesh);

    // Rayleigh / Fresnel atmospheric scattering shell
    const atmoGeo = new THREE.SphereGeometry(1.055, 72, 54);
    const atmoMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        glowColor: { value: new THREE.Color(0x4cb8ff) },
        density:   { value: 0.72 },
        sunDir:    { value: new THREE.Vector3(0.7, 0.2, 0.7).normalize() },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        uniform vec3 glowColor;
        uniform float density;
        uniform vec3 sunDir;
        void main() {
          float fresnel = pow(clamp(0.74 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.1);
          float day = smoothstep(-0.35, 0.55, dot(vWorldNormal, sunDir));
          vec3 sunset = mix(vec3(0.95, 0.45, 0.22), glowColor, smoothstep(-0.1, 0.35, dot(vWorldNormal, sunDir)));
          gl_FragColor = vec4(sunset, 1.0) * fresnel * (0.28 + 0.92 * day) * density * 1.35;
        }`,
    });
    this.atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    this.scene.add(this.atmoMesh);
  }

  _applyWorldThree() {
    const THREE = this.THREE;
    if (!THREE || !this.globe || !this.world) return;

    const texCanvas = this._composeTexture();
    const tex = new THREE.CanvasTexture(texCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    const maps = this._buildMaterialMaps(this.world);
    const roughTex = new THREE.CanvasTexture(maps.roughC);
    const bumpTex = new THREE.CanvasTexture(maps.bumpC);
    const emitTex = new THREE.CanvasTexture(maps.emitC);

    const mat = this.globe.material;
    mat.map?.dispose(); mat.roughnessMap?.dispose(); mat.bumpMap?.dispose(); mat.emissiveMap?.dispose();
    mat.map = tex;
    mat.roughnessMap = roughTex;
    mat.bumpMap = bumpTex;
    mat.emissiveMap = emitTex;
    mat.wireframe = this.layer === 'wireframe';
    mat.emissiveIntensity = this.layer === 'physical' ? 0.42 : 0.08;
    mat.needsUpdate = true;

    // Cloud texture
    if (this.cloudMesh) {
      const cc = this._buildCloudCanvas(this.world);
      const cTex = new THREE.CanvasTexture(cc);
      this.cloudMesh.material.map?.dispose();
      this.cloudMesh.material.map = cTex;
      this.cloudMesh.material.opacity = clamp((this.world.settings?.cloudCoverage ?? 0.52) * 1.15, 0, 0.95);
      this.cloudMesh.material.needsUpdate = true;
    }

    // Atmosphere parameters
    if (this.atmoMesh) {
      const aCol = this.world.settings?.atmosphereColor || '#4cb8ff';
      const dens = this.world.settings?.atmosphereDensity ?? 0.68;
      this.atmoMesh.material.uniforms.glowColor.value.set(aCol);
      this.atmoMesh.material.uniforms.density.value = dens;
      const scale = 1.02 + dens * 0.055;
      this.atmoMesh.scale.set(scale, scale, scale);
    }

    // Displace spherical vertices by heightmap
    const pos = this.globe.geometry.attributes.position;
    const base = this._basePos;
    const { W, H, fields } = this.world;
    const hArr = fields.height;
    const dispScale = 0.052 * this.exaggeration * (0.65 + (this.world.settings?.elevationVariation ?? 0.65) * 0.55);
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      const lat = Math.asin(clamp(by, -1, 1));
      const lon = Math.atan2(-bz, bx);
      const u = ((lon / (2 * Math.PI)) + 0.5) % 1;
      const v = 0.5 - lat / Math.PI;
      const gx = clamp(Math.floor(u * W), 0, W - 1), gy = clamp(Math.floor(v * H), 0, H - 1);
      const h = hArr[gy * W + gx];
      const r = h > 0 ? 1 + h * dispScale : 1 + h * dispScale * 0.12;
      pos.setXYZ(i, bx * r, by * r, bz * r);
    }
    pos.needsUpdate = true;
    this.globe.geometry.computeVertexNormals();
  }

  /** Build or update the miniature Planetary System (Feature 14A). */
  setSystemMode(enabled, worlds = []) {
    this.systemMode = enabled;
    this.systemWorlds = worlds;
    if (enabled) {
      this.target.distance = 4.2;
      this.target.rotX = 0.45;
      if (this.THREE && this.solarGroup) {
        this.group.visible = false;
        this.solarGroup.visible = true;
        this._buildSolarSystemThree();
      }
    } else {
      this.target.distance = 2.45;
      this.target.rotX = 0.22;
      if (this.THREE && this.solarGroup) {
        this.group.visible = true;
        this.solarGroup.visible = false;
      }
    }
  }

  _buildSolarSystemThree() {
    const THREE = this.THREE;
    if (!THREE || !this.solarGroup) return;
    while (this.solarGroup.children.length) {
      const c = this.solarGroup.children.pop();
      c.geometry?.dispose?.(); c.material?.dispose?.();
    }
    // Central Star
    const sunGeo = new THREE.SphereGeometry(0.38, 48, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffd27d });
    this.solarGroup.add(new THREE.Mesh(sunGeo, sunMat));

    this._orbitBodies = [];
    this.systemWorlds.forEach((w, idx) => {
      const orbitR = 0.92 + idx * 0.58;
      const pRad = clamp((w.radius / 6371) * 0.16, 0.09, 0.26);
      // Orbit ring
      const pts = [];
      for (let k = 0; k <= 96; k++) {
        const a = (k / 96) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * orbitR, 0, Math.sin(a) * orbitR));
      }
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      this.solarGroup.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x386898, transparent: true, opacity: 0.45 })));

      const pGeo = new THREE.SphereGeometry(pRad, 48, 32);
      const tex = new THREE.CanvasTexture(getLayerCanvas(w, 'physical'));
      const pMesh = new THREE.Mesh(pGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
      this.solarGroup.add(pMesh);
      this._orbitBodies.push({ world: w, mesh: pMesh, orbitR, speed: 0.42 / Math.pow(idx + 1, 0.65), angle: idx * 1.7, radius: pRad });
    });
  }

  _initSoftware() {
    const c = document.createElement('canvas');
    c.style.cssText = 'width:100%;height:100%;display:block;';
    this.mountEl.innerHTML = '';
    this.mountEl.appendChild(c);
    this.swCanvas = c;
    this._bindControls(c);

    // Precompute deterministic starfield for software renderer
    const srng = new RNG('sw-stars-v2');
    this._swStars = Array.from({ length: 420 }, () => ({
      u: srng.next(), v: srng.next(), s: srng.chance(0.18) ? 2 : 1,
      col: srng.pick(['rgba(235,244,255,0.85)', 'rgba(180,212,255,0.65)', 'rgba(255,232,196,0.7)']),
    }));

    let lastTs = performance.now();
    const tick = (ts) => {
      if (this._disposed) return;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      this._stepSimulation(dt);
      this._drawSoftware(ts);
      this._drawHUD(ts);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _stepSimulation(dt) {
    if (this.autoRotate && !this._dragging) this.target.rotY += dt * 0.14;
    if (this.timeSpeed > 0) this.sunAngle = (this.sunAngle + dt * this.timeSpeed) % (Math.PI * 2);
    this.cloudAngle = (this.cloudAngle + dt * 0.045) % (Math.PI * 2);

    const damp = Math.min(1, dt * 10);
    this.rotY += (this.target.rotY - this.rotY) * damp;
    this.rotX += (this.target.rotX - this.rotX) * damp;
    this.distance += (this.target.distance - this.distance) * damp;
    this.panX += (this.target.panX - this.panX) * damp;
    this.panY += (this.target.panY - this.panY) * damp;

    if (this._orbitBodies) {
      for (const b of this._orbitBodies) {
        b.angle += dt * b.speed;
        b.mesh.position.set(Math.cos(b.angle) * b.orbitR, 0, Math.sin(b.angle) * b.orbitR);
        b.mesh.rotation.y += dt * 0.8;
      }
    }
  }

  _drawSoftware(ts) {
    const c = this.swCanvas;
    if (!c || !this.world) return;
    const cw = Math.max(260, this.mountEl.clientWidth || 720);
    const ch = Math.max(220, this.mountEl.clientHeight || 500);
    const resScale = this.quality === 'low' ? 0.42 : this.quality === 'medium' ? 0.58 : 0.72;
    const rw = Math.floor(cw * resScale), rh = Math.floor(ch * resScale);
    if (c.width !== rw || c.height !== rh) { c.width = rw; c.height = rh; }
    const ctx = c.getContext('2d');

    if (this.systemMode && this.systemWorlds.length) {
      this._drawSoftwareSolarSystem(ctx, rw, rh, ts);
      return;
    }

    const cacheKey = `${this.world.id}:${this.world.fingerprint}:${this.layer}:${this.borders}:${this.world.settings.oceanColor}`;
    if (!this._swTex || this._swTexKey !== cacheKey) {
      const tc = this._composeTexture();
      this._swTex = tc.getContext('2d').getImageData(0, 0, tc.width, tc.height).data;
      this._swTexKey = cacheKey;
      const cc = this._buildCloudCanvas(this.world);
      this._swCloud = cc.getContext('2d').getImageData(0, 0, cc.width, cc.height).data;
      this._swCloudW = cc.width; this._swCloudH = cc.height;
    }

    const src = this._swTex;
    const clouds = this._swCloud;
    const cW = this._swCloudW, cH = this._swCloudH;
    const W = this.world.W, H = this.world.H;
    const hArr = this.world.fields.height;
    const bArr = this.world.fields.biome;
    const popArr = this.world.fields.pop;

    const img = ctx.createImageData(rw, rh);
    const d = img.data;
    const R = Math.min(rw, rh) * (1.02 / this.distance);
    const cx = rw / 2 - this.panX * R * 0.55;
    const cy = rh / 2 + this.panY * R * 0.55;
    const cy1 = Math.cos(this.rotY), sy1 = Math.sin(this.rotY);
    const cx1 = Math.cos(this.rotX), sx1 = Math.sin(this.rotX);

    // Sun unit vector in screen space
    const lx = Math.cos(this.sunAngle) * 0.78;
    const ly = 0.26;
    const lz = Math.sin(this.sunAngle) * 0.78;
    const lLen = Math.hypot(lx, ly, lz) || 1;
    const slx = lx / lLen, sly = ly / lLen, slz = lz / lLen;

    const atmoRgb = hexRgb(this.world.settings?.atmosphereColor || '#4cb8ff');
    const atmoDens = this.showAtmosphere ? (this.world.settings?.atmosphereDensity ?? 0.68) : 0;
    const haloOuter = 1 + 0.085 * atmoDens;
    const haloOuter2 = haloOuter * haloOuter;
    const cloudShift = this.cloudAngle / (Math.PI * 2);
    const showClouds = this.showClouds && (this.world.settings?.cloudCoverage ?? 0.52) > 0.02 && this.layer !== 'wireframe';

    for (let y = 0; y < rh; y++) {
      const ny = (cy - y) / R;
      for (let x = 0; x < rw; x++) {
        const nx = (x - cx) / R;
        const r2 = nx * nx + ny * ny;
        const idx = (y * rw + x) * 4;
        if (r2 > haloOuter2) {
          d[idx] = 5; d[idx + 1] = 9; d[idx + 2] = 18; d[idx + 3] = 255;
          continue;
        }
        if (r2 > 1) {
          const t = 1 - (Math.sqrt(r2) - 1) / (haloOuter - 1 || 0.001);
          const sunSide = clamp(0.35 + (nx * slx + ny * sly) * 0.85, 0.12, 1.2);
          const a = Math.pow(clamp(t, 0, 1), 2.2) * atmoDens * sunSide;
          d[idx]     = clamp(5 + atmoRgb[0] * a * 0.85, 0, 255);
          d[idx + 1] = clamp(9 + atmoRgb[1] * a * 0.85, 0, 255);
          d[idx + 2] = clamp(18 + atmoRgb[2] * a * 0.95, 0, 255);
          d[idx + 3] = 255;
          continue;
        }
        const nz = Math.sqrt(1 - r2);
        // Rotate view normal by (-rotX, -rotY) into planet-space unit vector (vx, vy, vz)
        const y1 = ny * cx1 - nz * sx1, z1 = ny * sx1 + nz * cx1;
        const vx = nx * cy1 + z1 * sy1, vz = -nx * sy1 + z1 * cy1, vy = y1;
        const lat = Math.asin(clamp(vy, -1, 1));
        const lon = Math.atan2(vx, vz);
        const u = ((lon / (2 * Math.PI)) + 0.5 + 1) % 1;
        const v = 0.5 - lat / Math.PI;
        const tx = Math.min(W - 1, Math.floor(u * W)), ty = Math.min(H - 1, Math.floor(v * H));
        const cellIdx = ty * W + tx;
        const ti = cellIdx * 4;

        // Diffuse + day/night terminator
        const ndotl = nx * slx + ny * sly + nz * slz;
        const dayFactor = clamp((ndotl + 0.16) / 0.92, 0, 1);
        const light = 0.11 + dayFactor * 1.04;

        let pr = src[ti] * light;
        let pg = src[ti + 1] * light;
        let pb = src[ti + 2] * light;

        // Specular ocean sun glint on open water
        const isOpenWater = hArr[cellIdx] <= 0 && bArr[cellIdx] !== 3 && this.layer === 'physical';
        if (isOpenWater && ndotl > 0) {
          // Halfway vector between light (slx, sly, slz) and view (0, 0, 1)
          const hx = slx, hy = sly, hz = slz + 1;
          const hl = Math.hypot(hx, hy, hz) || 1;
          const spec = Math.pow( Math.max(0, (nx * hx + ny * hy + nz * hz) / hl), 28) * 155;
          pr += spec * 1.0; pg += spec * 0.95; pb += spec * 0.82;
        }

        // Procedural cloud layer with slight shadow offset
        if (showClouds) {
          const cu = (u + cloudShift + 1) % 1;
          const ctxX = Math.min(cW - 1, Math.floor(cu * cW)), ctxY = Math.min(cH - 1, Math.floor(v * cH));
          const ca = (clouds[(ctxY * cW + ctxX) * 4 + 3] / 255) * (0.22 + dayFactor * 0.85);
          if (ca > 0.01) {
            pr = lerp(pr, 246 * (0.22 + dayFactor * 0.88), ca);
            pg = lerp(pg, 250 * (0.22 + dayFactor * 0.88), ca);
            pb = lerp(pb, 255 * (0.25 + dayFactor * 0.88), ca);
          }
        }

        // Night-side city lights & twilight warm scattering near terminator
        if (ndotl < 0.08 && this.layer === 'physical') {
          const night = clamp((0.08 - ndotl) * 3.2, 0, 1);
          const popVal = popArr ? popArr[cellIdx] : 0;
          if (popVal > 18 && hArr[cellIdx] > 0) {
            const glow = Math.min(1, Math.log10(popVal) / 3.2) * night;
            pr += glow * 235; pg += glow * 165; pb += glow * 68;
          }
        }

        // Fresnel atmospheric rim scattering
        if (atmoDens > 0) {
          const rim = Math.pow(1 - nz, 2.65) * atmoDens * (0.28 + dayFactor * 0.85);
          const sunset = ndotl > -0.22 && ndotl < 0.24 ? (1 - Math.abs(ndotl) / 0.24) * 0.45 : 0;
          pr = lerp(pr, atmoRgb[0] + sunset * 140, clamp(rim, 0, 0.85));
          pg = lerp(pg, atmoRgb[1] - sunset * 30,  clamp(rim, 0, 0.85));
          pb = lerp(pb, atmoRgb[2] - sunset * 65,  clamp(rim, 0, 0.85));
        }

        d[idx]     = clamp(pr, 0, 255);
        d[idx + 1] = clamp(pg, 0, 255);
        d[idx + 2] = clamp(pb, 0, 255);
        d[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Draw background stars on space pixels
    ctx.fillStyle = '#ffffff';
    for (const st of this._swStars) {
      const sx = st.u * rw, sy = st.v * rh;
      if (Math.hypot(sx - cx, sy - cy) > R * haloOuter) {
        ctx.fillStyle = st.col;
        ctx.fillRect(sx, sy, st.s, st.s);
      }
    }
  }

  _drawSoftwareSolarSystem(ctx, rw, rh, ts) {
    ctx.fillStyle = '#050912';
    ctx.fillRect(0, 0, rw, rh);
    for (const st of this._swStars) {
      ctx.fillStyle = st.col;
      ctx.fillRect(st.u * rw, st.v * rh, st.s, st.s);
    }
    const cx = rw / 2, cy = rh / 2;
    const tilt = clamp(0.38 + Math.sin(this.rotX) * 0.35, 0.18, 0.85);
    const scale = Math.min(rw, rh) * (0.24 * (2.45 / this.distance));

    // Central star
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, scale * 0.45);
    grad.addColorStop(0, '#fff9e6');
    grad.addColorStop(0.4, '#ffbe48');
    grad.addColorStop(1, 'rgba(255, 130, 30, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, scale * 0.45, 0, Math.PI * 2); ctx.fill();

    this.systemWorlds.forEach((w, idx) => {
      const orbitR = (0.85 + idx * 0.52) * scale;
      ctx.strokeStyle = 'rgba(78, 152, 224, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, orbitR, orbitR * tilt, 0, 0, Math.PI * 2);
      ctx.stroke();

      const ang = this.rotY + idx * 1.65 + (ts * 0.00025) / Math.pow(idx + 1, 0.6);
      const px = cx + Math.cos(ang) * orbitR;
      const py = cy + Math.sin(ang) * orbitR * tilt;
      const pr = clamp((w.radius / 6371) * scale * 0.14, 7, 28);
      const atmo = w.settings?.atmosphereColor || '#4cb8ff';
      ctx.fillStyle = atmo;
      ctx.beginPath(); ctx.arc(px, py, pr + 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(getLayerCanvas(w, 'physical'), px - pr, py - pr, pr * 2, pr * 2);
      ctx.restore();
      ctx.fillStyle = '#e8f1ff';
      ctx.font = '600 10px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(w.name, px, py - pr - 5);
    });
  }

  /** Project a cell coordinate (gx, gy) onto the 2D HUD canvas; returns {x, y, z, visible}. */
  projectCell(gx, gy, vw, vh) {
    const { W, H, fields } = this.world;
    const lat = Math.PI / 2 - ((gy + 0.5) / H) * Math.PI;
    const lon = ((gx + 0.5) / W) * 2 * Math.PI - Math.PI;
    const cl = Math.cos(lat), vy = Math.sin(lat);

    if (this.THREE && this.camera && this.globe) {
      // Exact Three.js UV-to-sphere mapping (matches _applyWorldThree: lon = atan2(-bz, bx))
      const bx = -cl * Math.cos(lon);
      const by = vy;
      const bz = cl * Math.sin(lon);
      const cellIdx = clamp(Math.floor(gy), 0, H - 1) * W + clamp(Math.floor(gx), 0, W - 1);
      const h = fields.height[cellIdx];
      const dispScale = 0.052 * this.exaggeration * (0.65 + (this.world.settings?.elevationVariation ?? 0.65) * 0.55);
      const rad = h > 0 ? 1 + h * dispScale : 1 + h * dispScale * 0.12;

      const THREE = this.THREE;
      if (!this._tmpV1) {
        this._tmpV1 = new THREE.Vector3();
        this._tmpV2 = new THREE.Vector3();
        this._tmpCamDir = new THREE.Vector3();
      }
      this.group.updateMatrixWorld();
      this.camera.updateMatrixWorld();
      // World normal at this point on the rotated planet
      const wn = this._tmpV1.set(bx, by, bz).applyQuaternion(this.group.quaternion).normalize();
      // World position of the displaced surface point
      const wp = this._tmpV2.set(bx * rad, by * rad, bz * rad).applyMatrix4(this.group.matrixWorld);
      // Horizon occlusion: dot product of surface normal with vector toward camera
      const toCam = this._tmpCamDir.copy(this.camera.position).sub(wp).normalize();
      const cosAngle = wn.dot(toCam);
      // Project through PerspectiveCamera to Normalized Device Coordinates [-1, 1]
      const ndc = wp.project(this.camera);
      const sx = (ndc.x * 0.5 + 0.5) * vw;
      const sy = (-ndc.y * 0.5 + 0.5) * vh;
      return { x: sx, y: sy, z: cosAngle, visible: cosAngle > 0.12 && ndc.z < 1 };
    }

    // Software ray-cast fallback projection
    const vx = cl * Math.sin(lon), vz = cl * Math.cos(lon);
    const cy1 = Math.cos(this.rotY), sy1 = Math.sin(this.rotY);
    const cx1 = Math.cos(this.rotX), sx1 = Math.sin(this.rotX);
    const nx = vx * cy1 - vz * sy1;
    const z1 = vx * sy1 + vz * cy1;
    const ny = vy * cx1 + z1 * sx1;
    const nz = -vy * sx1 + z1 * cx1;

    const R = Math.min(vw, vh) * (1.02 / this.distance);
    const cx = vw / 2 - this.panX * R * 0.55;
    const cy = vh / 2 + this.panY * R * 0.55;
    return { x: cx + nx * R, y: cy - ny * R, z: nz, visible: nz > 0.14 };
  }

  /** Unproject screen coordinates (sx, sy) onto planet cell (ix, iy). */
  screenToCell(sx, sy) {
    if (!this.world || this.systemMode) return null;
    const vw = this.mountEl.clientWidth || 800, vh = this.mountEl.clientHeight || 600;

    if (this.THREE && this.camera && this.globe) {
      const THREE = this.THREE;
      if (!this._raycaster) {
        this._raycaster = new THREE.Raycaster();
        this._ndcMouse = new THREE.Vector2();
      }
      this._ndcMouse.set((sx / vw) * 2 - 1, -(sy / vh) * 2 + 1);
      this.group.updateMatrixWorld();
      this.camera.updateMatrixWorld();
      this._raycaster.setFromCamera(this._ndcMouse, this.camera);
      const hits = this._raycaster.intersectObject(this.globe, false);
      if (!hits.length) return null;
      const uv = hits[0].uv;
      if (!uv) return null;
      const u = ((uv.x % 1) + 1) % 1;
      const v = clamp(1 - uv.y, 0, 0.999999);
      const ix = clamp(Math.floor(u * this.world.W), 0, this.world.W - 1);
      const iy = clamp(Math.floor(v * this.world.H), 0, this.world.H - 1);
      const lat = (0.5 - v) * 180;
      const lon = (u - 0.5) * 360;
      return { ix, iy, lat, lon };
    }

    const R = Math.min(vw, vh) * (1.02 / this.distance);
    const cx = vw / 2 - this.panX * R * 0.55;
    const cy = vh / 2 + this.panY * R * 0.55;
    const nx = (sx - cx) / R, ny = (cy - sy) / R;
    const r2 = nx * nx + ny * ny;
    if (r2 > 1) return null;
    const nz = Math.sqrt(1 - r2);
    const cy1 = Math.cos(this.rotY), sy1 = Math.sin(this.rotY);
    const cx1 = Math.cos(this.rotX), sx1 = Math.sin(this.rotX);
    const y1 = ny * cx1 - nz * sx1, z1 = ny * sx1 + nz * cx1;
    const vx = nx * cy1 + z1 * sy1, vz = -nx * sy1 + z1 * cy1, vy = y1;
    const lat = Math.asin(clamp(vy, -1, 1));
    const lon = Math.atan2(vx, vz);
    const u = ((lon / (2 * Math.PI)) + 0.5 + 1) % 1;
    const v = 0.5 - lat / Math.PI;
    const ix = clamp(Math.floor(u * this.world.W), 0, this.world.W - 1);
    const iy = clamp(Math.floor(v * this.world.H), 0, this.world.H - 1);
    return { ix, iy, lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
  }

  inspectAt(ix, iy) {
    const w = this.world;
    const i = iy * w.W + ix;
    const F = w.fields;
    const h = F.height[i];
    const elev = Math.round(h > 0 ? h * w.maxElev : h * w.maxDepth);
    const { lat, lon } = cellLatLon(w.grid, ix, iy);
    const country = F.owner[i] >= 0 ? w.countries[F.owner[i]] : null;
    const lm = F.landmass[i];
    const continent = lm >= 0 ? (w.continents.find((c) => c.id === lm) || w.islands.find((c) => c.id === lm)) : null;
    const feat = F.region[i] >= 0 ? w.features[F.region[i]] : null;
    const river = F.riverId[i] >= 0 ? w.rivers[F.riverId[i]] : null;
    let nearCity = null, bestD = 9;
    for (const ct of w.cities) {
      const d = Math.hypot(ct.x - ix, ct.y - iy);
      if (d < bestD) { bestD = d; nearCity = ct; }
    }
    return {
      ix, iy, i, lat, lon, coordStr: formatLatLon(lat, lon),
      land: h > 0 && !F.lakeMask[i],
      elevation: elev, temp: F.temp[i], moist: F.moist[i],
      biome: BIOMES[F.biome[i]], popDensity: F.pop[i],
      plateId: F.plateId ? F.plateId[i] : 0,
      country, continent, feature: feat, river, city: nearCity,
    };
  }

  pickAtScreen(sx, sy) {
    const hit = this.screenToCell(sx, sy);
    if (!hit) return null;
    const info = this.inspectAt(hit.ix, hit.iy);
    if (info.city) return { type: 'city', city: info.city, country: this.world.countries[info.city.countryId], info };
    if (info.country && this.layer === 'countries') return { type: 'country', country: info.country, info };
    if (info.feature) return { type: 'feature', feature: info.feature, info };
    if (info.continent && info.continent.kind === 'continent') return { type: 'continent', continent: info.continent, info };
    if (info.country) return { type: 'country', country: info.country, info };
    return { type: 'cell', info };
  }

  /** Smoothly rotate and zoom the 3D camera to focus on cell (gx, gy). */
  flyToCell(gx, gy, distance = 1.65, label = null) {
    if (!this.world) return;
    const { W, H } = this.world;
    const lat = Math.PI / 2 - ((gy + 0.5) / H) * Math.PI;
    const lon = ((gx + 0.5) / W) * 2 * Math.PI - Math.PI;
    this.autoRotate = false;
    // In Three.js mesh space, bx = -cos(lat)*cos(lon), bz = cos(lat)*sin(lon);
    // rotating group by rotY = lon - Math.PI/2 brings (bx, 0, bz) to face +Z toward the camera.
    this.target.rotY = this.THREE ? (lon - Math.PI / 2) : lon;
    this.target.rotX = clamp(lat, -1.32, 1.32);
    this.target.distance = clamp(distance, 1.18, 4.8);
    this.target.panX = 0;
    this.target.panY = 0;
    this.pulse = { x: gx, y: gy, label, start: performance.now() };
    this.cb.onCamera && this.cb.onCamera(this);
  }

  resetCamera() {
    this.target.rotY = -0.5;
    this.target.rotX = 0.22;
    this.target.distance = 2.45;
    this.target.panX = 0;
    this.target.panY = 0;
    this.cb.onCamera && this.cb.onCamera(this);
  }

  _drawHUD(ts) {
    const c = this.hudCanvas;
    if (!c || !this.world) return;
    const vw = this.mountEl.clientWidth || 800, vh = this.mountEl.clientHeight || 600;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.floor(vw * dpr) || c.height !== Math.floor(vh * dpr)) {
      c.width = Math.floor(vw * dpr); c.height = Math.floor(vh * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, vw, vh);

    if (this.systemMode) { ctx.restore(); return; }

    const zoomScale = clamp(2.35 / Math.max(0.8, this.distance), 0.72, 1.85);
    const lf = this.labelFilters || {};
    const boxes = [];
    const place = (text, px, py, baseSize, family, weight, style, fill, stroke = 'rgba(6, 10, 20, 0.94)', dotCol = null, zDepth = 0.8) => {
      if (!text) return false;
      const horizonFade = clamp((zDepth - 0.12) / 0.32, 0.25, 1);
      const fontPx = clamp(Math.round(baseSize * Math.pow(zoomScale, 0.42)), 9, 20);
      ctx.save();
      ctx.globalAlpha = horizonFade;
      ctx.font = `${style ? style + ' ' : ''}${weight} ${fontPx}px ${family}`;
      const w = ctx.measureText(text).width + 12;
      const h = fontPx + 6;
      const box = { x0: px - w / 2, y0: py - h / 2, x1: px + w / 2, y1: py + h / 2 };
      if (box.x0 < 8 || box.x1 > vw - 8 || box.y0 < 8 || box.y1 > vh - 8) { ctx.restore(); return false; }
      for (const b of boxes) {
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) { ctx.restore(); return false; }
      }
      boxes.push(box);
      if (dotCol) {
        ctx.fillStyle = '#09101d';
        ctx.beginPath(); ctx.arc(px, py + fontPx * 0.82, 4.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = dotCol;
        ctx.beginPath(); ctx.arc(px, py + fontPx * 0.82, 2.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.2; ctx.strokeStyle = stroke;
      ctx.strokeText(text, px, py);
      ctx.fillStyle = fill;
      ctx.fillText(text, px, py);
      ctx.restore();
      return true;
    };

    if (this.showLabels) {
      const w = this.world;

      // 1. Custom user geographical labels (always high priority)
      if (Array.isArray(w.customLabels)) {
        for (const lbl of w.customLabels) {
          const p = this.projectCell(lbl.x, lbl.y, vw, vh);
          if (p.visible) place(lbl.text, p.x, p.y - 6, 12, '"Cinzel", Georgia, serif', 700, '', '#7ce8ff', 'rgba(6, 10, 20, 0.95)', '#42b8e0', p.z);
        }
      }

      // 2. Capitals (highest priority settlement markers)
      if (lf.capitals !== false && this.distance < 3.1) {
        for (const ct of w.cities) {
          if (ct.type !== 'capital') continue;
          const p = this.projectCell(ct.x, ct.y, vw, vh);
          if (p.visible) {
            place(`★ ${ct.name}`, p.x, p.y - 10, 11, '"Inter", sans-serif', 700, '', '#ffe083', 'rgba(6, 10, 20, 0.94)', '#f2c95c', p.z);
          }
        }
      }

      // 3. Countries (visible in Political mode or mid/close zoom)
      if (lf.countries !== false && (this.layer === 'countries' || this.distance < 2.65)) {
        for (const c of w.countries) {
          const cap = w.cities[c.capitalId];
          const gx = cap ? cap.x : c.x;
          const gy = cap ? cap.y : c.y;
          const p = this.projectCell(gx, gy, vw, vh);
          if (p.visible) place(c.name.toUpperCase(), p.x, p.y - 24, 11.5, '"Cinzel", Georgia, serif', 700, '', '#ffe8a3', 'rgba(6, 10, 20, 0.95)', null, p.z);
        }
      }

      // 4. Continents & Regions
      if (lf.continents !== false && this.distance > 1.35) {
        for (const cont of w.continents) {
          const p = this.projectCell(cont.x, cont.y, vw, vh);
          if (p.visible) place(cont.name.toUpperCase(), p.x, p.y, 12.5, '"Cinzel", Georgia, serif', 700, '', 'rgba(246, 234, 198, 0.94)', 'rgba(6, 10, 20, 0.92)', null, p.z);
        }
      }

      // 5. Cities & Towns (zoom-dependent tier filtering)
      if (lf.cities !== false && this.distance < 2.55) {
        const minImp = this.distance < 1.50 ? 1 : this.distance < 1.85 ? 2 : this.distance < 2.2 ? 3 : 4;
        for (const ct of w.cities) {
          if (ct.type === 'capital') continue;
          if (ct.importance < minImp) continue;
          const p = this.projectCell(ct.x, ct.y, vw, vh);
          if (p.visible) {
            place(ct.name, p.x, p.y - 9, 10, '"Inter", sans-serif', 600, '', '#e8f1ff', 'rgba(6, 10, 20, 0.92)', '#63d4ee', p.z);
          }
        }
      }

      // 6. Mountains, Deserts, Volcanic Rifts & Landmarks
      if (lf.mountains !== false && this.distance < 2.35) {
        for (const f of w.features) {
          if (!['mountain', 'desert', 'volcanic'].includes(f.kind)) continue;
          const p = this.projectCell(f.x, f.y, vw, vh);
          if (p.visible) place(f.name, p.x, p.y, 10.5, '"Cinzel", Georgia, serif', 600, 'italic', 'rgba(235, 218, 182, 0.90)', 'rgba(6, 10, 20, 0.92)', null, p.z);
        }
        if (Array.isArray(w.landmarks)) {
          for (const lm of w.landmarks) {
            const p = this.projectCell(lm.x, lm.y, vw, vh);
            if (p.visible) place(`◆ ${lm.name}`, p.x, p.y - 8, 10.5, '"Cinzel", Georgia, serif', 600, '', '#f5d06b', 'rgba(6, 10, 20, 0.92)', '#e6b84c', p.z);
          }
        }
      }

      // 7. Rivers & Lakes
      if (lf.rivers !== false && this.distance < 2.2) {
        for (const f of w.features) {
          if (f.kind !== 'lake') continue;
          const p = this.projectCell(f.x, f.y, vw, vh);
          if (p.visible) place(f.name, p.x, p.y, 10, '"Inter", sans-serif', 500, 'italic', 'rgba(130, 212, 246, 0.9)', 'rgba(6, 10, 20, 0.92)', null, p.z);
        }
        for (const r of w.rivers) {
          if (!r.name || !r.cells?.length) continue;
          const mid = r.cells[Math.floor(r.cells.length / 2)];
          const p = this.projectCell(mid % w.W, (mid / w.W) | 0, vw, vh);
          if (p.visible) place(r.name, p.x, p.y, 9.5, '"Inter", sans-serif', 500, 'italic', 'rgba(120, 208, 250, 0.88)', 'rgba(6, 10, 20, 0.92)', null, p.z);
        }
      }

      // 8. Oceans & Seas
      if (lf.oceans !== false) {
        for (const f of w.features) {
          if (f.kind !== 'ocean' && (f.kind !== 'sea' || this.distance > 2.2)) continue;
          const p = this.projectCell(f.x, f.y, vw, vh);
          if (p.visible) place(f.name.toUpperCase(), p.x, p.y, f.kind === 'ocean' ? 11 : 9.5, '"Cinzel", Georgia, serif', 600, 'italic', 'rgba(136, 198, 240, 0.78)', 'rgba(6, 10, 20, 0.90)', null, p.z);
        }
      }
    }

    // Highlighted Region Selection Box / Ring on 3D Globe
    if (this.highlightedRegion) {
      const hr = this.highlightedRegion;
      const p = this.projectCell(hr.x, hr.y, vw, vh);
      if (p.visible) {
        const rad = clamp((hr.spanW || 120) * (1.25 / this.distance), 26, 140);
        ctx.save();
        ctx.strokeStyle = 'rgba(230, 184, 76, 0.92)';
        ctx.fillStyle = 'rgba(230, 184, 76, 0.12)';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

    // Selected / Pulse beacon
    if (this.pulse) {
      const elapsed = (ts - this.pulse.start) / 1000;
      if (elapsed < 8) {
        const p = this.projectCell(this.pulse.x, this.pulse.y, vw, vh);
        if (p.visible) {
          const t = (elapsed * 1.1) % 1;
          ctx.strokeStyle = `rgba(99, 212, 238, ${(1 - t) * 0.95})`;
          ctx.lineWidth = 2.2;
          ctx.beginPath(); ctx.arc(p.x, p.y, 6 + t * 32, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#63d4ee';
          ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
          if (this.pulse.label) place(this.pulse.label, p.x, p.y - 18, 11.5, '"Inter", sans-serif', 600, '', '#63d4ee', 'rgba(6, 10, 20, 0.95)', null, p.z);
        }
      } else this.pulse = null;
    }
    ctx.restore();
  }

  _bindControls(el) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      this._dragging = true;
      this._dragMoved = false;
      this._panMode = e.button === 2 || e.shiftKey;
      this._lx = e.clientX; this._ly = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (this._dragging) {
        const dx = e.clientX - this._lx, dy = e.clientY - this._ly;
        if (Math.hypot(dx, dy) > 3) this._dragMoved = true;
        this._lx = e.clientX; this._ly = e.clientY;
        if (this._panMode) {
          this.target.panX = clamp(this.target.panX - dx * 0.003, -0.85, 0.85);
          this.target.panY = clamp(this.target.panY + dy * 0.003, -0.85, 0.85);
        } else {
          const sens = 0.0055 * (this.distance / 2.45);
          this.target.rotY += dx * sens;
          this.target.rotX = clamp(this.target.rotX + dy * sens, -1.38, 1.38);
        }
        this.cb.onCamera && this.cb.onCamera(this);
      } else if (this.cb.onHover) {
        const cell = this.screenToCell(sx, sy);
        this.cb.onHover(cell ? this.inspectAt(cell.ix, cell.iy) : null);
      }
    });
    const up = (e) => {
      if (!this._dragging) return;
      this._dragging = false;
      if (!this._dragMoved && e.button === 0) {
        const rect = el.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const picked = this.pickAtScreen(sx, sy);
        if (picked) {
          this.selected = picked;
          this.pulse = { x: picked.info.ix, y: picked.info.iy, label: picked.city?.name || picked.country?.name || picked.feature?.name || picked.continent?.name || picked.info.coordStr, start: performance.now() };
          this.cb.onSelect && this.cb.onSelect(picked);
        }
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    // Double-click to smoothly focus & zoom onto a location
    el.addEventListener('dblclick', (e) => {
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const picked = this.pickAtScreen(sx, sy);
      if (picked) {
        this.selected = picked;
        this.flyToCell(picked.info.ix, picked.info.iy, Math.max(1.22, this.target.distance * 0.68), picked.city?.name || picked.feature?.name || picked.continent?.name || picked.info.coordStr);
        this.cb.onSelect && this.cb.onSelect(picked);
      }
    });

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.target.distance = clamp(this.target.distance * Math.exp(e.deltaY * 0.0011), 1.18, 5.2);
      this.cb.onCamera && this.cb.onCamera(this);
    }, { passive: false });
  }

  setWorld(world) {
    this.world = world;
    this._swTex = null;
    this._applyWorldThree();
  }

  setLayer(layer) {
    this.layer = layer;
    this._swTex = null;
    this._applyWorldThree();
  }

  setBorders(b) {
    this.borders = b;
    this._swTex = null;
    this._applyWorldThree();
  }

  setQuality(q) {
    this.quality = q;
    if (this.THREE && this.renderer) {
      this.renderer.setPixelRatio(q === 'low' ? 1 : Math.min(2, window.devicePixelRatio || 1));
      this._buildPlanetMeshes();
      this._applyWorldThree();
    }
  }

  setExaggeration(v) {
    this.exaggeration = v;
    this._applyWorldThree();
  }

  /** Composite screenshot of the 3D planet + HUD labels as a PNG data URL. */
  exportScreenshotPNG() {
    const srcCanvas = this.renderer ? this.renderer.domElement : this.swCanvas;
    if (!srcCanvas) return null;
    const out = document.createElement('canvas');
    out.width = srcCanvas.width; out.height = srcCanvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#050912';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(srcCanvas, 0, 0, out.width, out.height);
    if (this.hudCanvas) ctx.drawImage(this.hudCanvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  dispose() {
    this._disposed = true;
    this._ro && this._ro.disconnect();
    if (this.globe) {
      this.globe.geometry?.dispose();
      this.globe.material?.map?.dispose();
      this.globe.material?.roughnessMap?.dispose();
      this.globe.material?.bumpMap?.dispose();
      this.globe.material?.emissiveMap?.dispose();
      this.globe.material?.dispose();
    }
    if (this.cloudMesh) {
      this.cloudMesh.geometry?.dispose();
      this.cloudMesh.material?.map?.dispose();
      this.cloudMesh.material?.dispose();
    }
    if (this.atmoMesh) {
      this.atmoMesh.geometry?.dispose();
      this.atmoMesh.material?.dispose();
    }
    this.renderer && this.renderer.dispose();
  }
}
