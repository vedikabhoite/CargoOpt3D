/**
 * renderer.js — FCOS 3D Visualization Engine
 *
 * Uses Three.js r128 to render packed cartons inside a wireframe
 * container. Supports orbit controls, multiple camera presets,
 * wireframe toggle, explode view, hover tooltips, and
 * carton highlight on selection.
 *
 * Coordinate mapping:
 *   Packer  → Three.js
 *   X (length, front→back) → X
 *   Y (height, bottom→top) → Y
 *   Z (width,  left→right) → Z
 *
 * Distances in mm scaled down by SCALE = 0.001 (mm → m)
 */

'use strict';

(function () {

const SCALE = 0.001; // mm to Three.js units

function _disposeMesh(mesh) {
  if (!mesh) return;
  if (mesh.geometry) mesh.geometry.dispose();
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) { if (m && m.map) m.map.dispose(); if (m) m.dispose(); }
}


/* ─────────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────────── */
let scene, camera, renderer, animationId;
let packedMeshes  = []; // { mesh, edges, data }
let containerMesh = null;
let container     = null;

// Interaction state
let isExploded    = false;
let showWireframe = true;
let showLabels    = true;
let mousePos      = { x: 0, y: 0 };
let hoveredMesh   = null;
let selectedMesh  = null;

// Door state
let doorL = null, doorR = null;
let doorOpen = false;
let doorAnimId = null;
let doorCurrentAngle = 0;
let doorTargetAngle  = 0;
let doorContainerGroup = null;

// Loading animation state
let loadAnim = {
  active:    false,
  paused:    false,
  items:     [],       // display items sorted in load order
  snapshot:  [],       // copy kept for replay after completion
  index:     0,        // next carton to start animating
  speed:     1.0,      // multiplier (0.5 = slow, 2 = fast)
  inFlight:  [],       // { mesh, edges, targetPos, startPos, t, duration }
  timerId:   null,     // setTimeout for next carton spawn
};

// Orbit control state
let orbitState = {
  theta: Math.PI / 4,
  phi: Math.PI / 3,
  radius: 8,
  target: { x: 0, y: 0, z: 0 },
  isDragging: false,
  lastMouse: { x: 0, y: 0 },
  isPanning: false,
};

const raycaster  = new THREE.Raycaster();
const mouseTHREE = new THREE.Vector2();

/* ─────────────────────────────────────────────────────────────
   INIT / DESTROY
───────────────────────────────────────────────────────────── */
function init(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  // Remove placeholder
  const placeholder = document.getElementById('viewport-placeholder');
  if (placeholder) placeholder.style.display = 'none';

  // Destroy previous instance
  destroy();

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xEBF4FF);

  // Subtle grid
  const gridHelper = new THREE.GridHelper(20, 40, 0xC0D5EE, 0xD8E9F7);
  gridHelper.position.y = -0.01;
  scene.add(gridHelper);

  // Camera
  const w = el.clientWidth, h = el.clientHeight;
  camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 200);
  updateCameraFromOrbit();

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0x8899BB, 0.3);
  fillLight.position.set(-5, 2, -5);
  scene.add(fillLight);

  // Events
  renderer.domElement.addEventListener('mousedown', onMouseDown);
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('mouseup',   onMouseUp);
  renderer.domElement.addEventListener('wheel',     onWheel, { passive: false });
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('resize', onResize);

  animate();
}

function destroy() {
  if (animationId) cancelAnimationFrame(animationId);
  if (renderer) {
    renderer.domElement.removeEventListener('mousedown', onMouseDown);
    renderer.domElement.removeEventListener('mousemove', onMouseMove);
    renderer.domElement.removeEventListener('mouseup',   onMouseUp);
    renderer.domElement.removeEventListener('wheel',     onWheel);
    renderer.domElement.remove();
    renderer.dispose();
  }
  packedMeshes = [];
  containerMesh = null;
  scene = null;
  camera = null;
  renderer = null;
  window.removeEventListener('resize', onResize);
}

/* ─────────────────────────────────────────────────────────────
   RENDER PACKED RESULT
───────────────────────────────────────────────────────────── */
function renderPacked(result, containerSpec) {
  if (!scene) return;

  container = containerSpec;

  // Clear previous cartons and any in-flight animation
  _stopLoadAnim();
  _removeLabels();
  _labelsBuilt = false;
  for (const obj of packedMeshes) {
    scene.remove(obj.mesh);
    scene.remove(obj.edges);
    obj.mesh.geometry.dispose();
    obj.edges.geometry.dispose();
  }
  packedMeshes = [];
  hoveredMesh  = null;
  selectedMesh = null;

  // Draw container wireframe
  drawContainer(containerSpec);

  // Build display items (flip X: packer X=0=back wall → renderer X=0=door)
  const CL = containerSpec.length;
  const displayItems = result.packed.map(item =>
    Object.assign({}, item, {
      x: CL - item.x - item.l,
      cartonNumber: item.cartonNumber,
      layerNumber:  item.layerNumber,
    })
  );

  // Sort into loading order: lowest display-X first = back wall first in display space
  // (display-X=0 is door, display-X=CL is back wall; back wall = highest display-X)
  // We load back-to-front so sort descending display-X, then Z asc, then Y asc
  const ordered = [...displayItems].sort((a, b) =>
    b.x !== a.x ? b.x - a.x :
    a.z !== b.z ? a.z - b.z :
    a.y - b.y
  );

  // Reset camera and open door, then start animation
  frameCameraToContainer(containerSpec);
  if (!doorOpen) {
    setTimeout(() => toggleDoor(), 300);
  }
  setTimeout(() => _startLoadAnim(ordered), doorOpen ? 100 : 900);
}

/* ─────────────────────────────────────────────────────────────
   LOADING ANIMATION ENGINE
───────────────────────────────────────────────────────────── */
function _stopLoadAnim() {
  if (loadAnim.timerId) { clearTimeout(loadAnim.timerId); loadAnim.timerId = null; }
  for (const f of loadAnim.inFlight) {
    scene.remove(f.mesh);
    scene.remove(f.edges);
    if (f.mesh.geometry) f.mesh.geometry.dispose();
    if (f.edges.geometry) f.edges.geometry.dispose();
    if (f.labelSprite) scene.remove(f.labelSprite);
  }
  loadAnim.active   = false;
  loadAnim.paused   = false;
  loadAnim.items    = [];
  loadAnim.index    = 0;
  loadAnim.inFlight = [];
  _updateAnimUI();
}

function _startLoadAnim(orderedItems) {
  loadAnim.active   = true;
  loadAnim.paused   = false;
  loadAnim.items    = orderedItems;
  loadAnim.snapshot = orderedItems.slice(); // keep for replay
  loadAnim.index    = 0;
  loadAnim.inFlight = [];
  _updateAnimUI();
  _scheduleNextCarton();
}

function _scheduleNextCarton() {
  if (!loadAnim.active || loadAnim.paused) return;
  if (loadAnim.index >= loadAnim.items.length) return; // all spawned

  // Stagger between cartons: 280ms / speed (so at speed=2 it's 140ms apart)
  const delay = 280 / loadAnim.speed;
  loadAnim.timerId = setTimeout(() => {
    if (!loadAnim.active || loadAnim.paused) return;
    _spawnCarton(loadAnim.items[loadAnim.index]);
    loadAnim.index++;
    _scheduleNextCarton();
  }, delay);
}

function _spawnCarton(item) {
  const sl = item.l * SCALE;
  const sh = item.h * SCALE;
  const sw = item.w * SCALE;

  const geo = new THREE.BoxGeometry(sl, sh, sw);

  // ── Face materials with stamped number + SKU + arrows ──
  const mats = (item.cartonNumber != null)
    ? _makeCartonFaceMaterials(item.cartonNumber, item.sku, item.color)
    : Array(6).fill(null).map(() => new THREE.MeshPhongMaterial({
        color: new THREE.Color(item.color || '#3B82F6'),
        shininess: 40, transparent: true, opacity: 0,
      }));

  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  mesh.userData      = { item };

  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 });
  const edges   = new THREE.LineSegments(edgeGeo, edgeMat);

  // Target position (final resting place)
  const tx = item.x * SCALE + sl / 2;
  const ty = item.y * SCALE + sh / 2;
  const tz = item.z * SCALE + sw / 2;

  // Start position: outside the door (x < 0) at same height and Z
  const sx = -sl * 2 - 0.3;
  const sy = ty;
  const sz = tz;

  mesh.position.set(sx, sy, sz);
  edges.position.copy(mesh.position);

  scene.add(mesh);
  scene.add(edges);

  const duration = (420 / loadAnim.speed) / 1000;

  loadAnim.inFlight.push({
    mesh, edges,
    labelSprite: null, // no floating sprite — label is on the face
    startPos:  new THREE.Vector3(sx, sy, sz),
    targetPos: new THREE.Vector3(tx, ty, tz),
    t: 0,
    duration,
    item,
    done: false,
  });
}

// Called every frame from animate()
function _tickLoadAnim(dt) {
  if (!loadAnim.active || loadAnim.paused) return;

  let allDone = true;

  for (const f of loadAnim.inFlight) {
    if (f.done) continue;
    allDone = false;

    f.t = Math.min(f.t + dt / f.duration, 1.0);
    const t = f.t;

    // Easing: ease-out cubic with a tiny bounce at the end
    let ease;
    if (t < 0.85) {
      const u = t / 0.85;
      ease = 1 - Math.pow(1 - u, 3); // ease-out cubic
    } else {
      // small bounce in final 15%
      const u = (t - 0.85) / 0.15;
      ease = 1 + 0.06 * Math.sin(u * Math.PI); // overshoot & settle
    }
    ease = Math.min(ease, 1.0);

    const x = f.startPos.x + (f.targetPos.x - f.startPos.x) * ease;
    const y = f.startPos.y + (f.targetPos.y - f.startPos.y) * ease;
    const z = f.startPos.z + (f.targetPos.z - f.startPos.z) * ease;

    f.mesh.position.set(x, y, z);
    f.edges.position.set(x, y, z);

    // Fade in opacity — mesh may have array of face materials
    const opacity = Math.min(t * 6, 0.85);
    const mats = Array.isArray(f.mesh.material) ? f.mesh.material : [f.mesh.material];
    for (const m of mats) m.opacity = opacity;
    f.edges.material.opacity = Math.min(t * 6, 0.4);

    if (t >= 1.0) {
      f.done = true;
      f.mesh.position.copy(f.targetPos);
      f.edges.position.copy(f.targetPos);
      for (const m of mats) m.opacity = 0.92; // faces fully opaque
      f.edges.material.opacity = 0.4;
      packedMeshes.push({
        mesh:    f.mesh,
        edges:   f.edges,
        data:    f.item,
        basePos: f.targetPos.clone(),
      });
    }
  }

  // Remove completed flights
  loadAnim.inFlight = loadAnim.inFlight.filter(f => !f.done);

  // Check if fully complete
  if (loadAnim.index >= loadAnim.items.length && loadAnim.inFlight.length === 0) {
    loadAnim.active = false;
    _updateAnimUI();
    // Labels were already attached per-carton during animation — no rebuild needed
    _labelsBuilt = true;
  }
}

function _updateAnimUI() {
  const btn = document.getElementById('btn-anim-playpause');
  const bar = document.getElementById('anim-progress-bar');
  const lbl = document.getElementById('anim-progress-lbl');
  if (!btn) return;

  if (!loadAnim.active && loadAnim.index === 0) {
    btn.textContent = '▶ Play';
    btn.classList.remove('active');
  } else if (loadAnim.paused) {
    btn.textContent = '▶ Resume';
    btn.classList.add('active');
  } else if (loadAnim.active) {
    btn.textContent = '⏸ Pause';
    btn.classList.add('active');
  } else {
    btn.textContent = '↺ Replay';
    btn.classList.remove('active');
  }

  if (bar && loadAnim.items.length > 0) {
    const pct = Math.round((loadAnim.index / loadAnim.items.length) * 100);
    bar.style.width = pct + '%';
    if (lbl) lbl.textContent = `${loadAnim.index} / ${loadAnim.items.length}`;
  }
}

function playPauseAnim() {
  // If animation finished, replay from scratch
  if (!loadAnim.active && loadAnim.snapshot.length > 0) {
    // Remove all current carton meshes
    for (const obj of packedMeshes) {
      scene.remove(obj.mesh);
      scene.remove(obj.edges);
      obj.mesh.geometry.dispose();
      obj.edges.geometry.dispose();
    }
    packedMeshes = [];
    _removeLabels();
    _labelsBuilt = false;
    hoveredMesh  = null;
    selectedMesh = null;
    _startLoadAnim(loadAnim.snapshot.slice());
    return;
  }
  if (!loadAnim.active) return;
  loadAnim.paused = !loadAnim.paused;
  if (!loadAnim.paused) _scheduleNextCarton(); // resume spawning
  _updateAnimUI();
}

function skipAnim() {
  // Instantly place all remaining cartons
  _stopLoadAnim();
  // Draw all items immediately
  if (!container) return;
  // Re-read from last result — we stored ordered items before _stop cleared them
  // So we need to draw directly from whatever was in loadAnim.items
  // But _stop clears items. So we keep a snapshot.
}

function setAnimSpeed(s) {
  loadAnim.speed = s;
  // Update speed button UI
  document.querySelectorAll('.anim-speed-btn').forEach(b => {
    b.classList.toggle('active', parseFloat(b.dataset.speed) === s);
  });
}

/* ─────────────────────────────────────────────────────────────
   CONTAINER WIREFRAME
───────────────────────────────────────────────────────────── */
function drawContainer(spec) {
  // Remove old container group if any
  if (doorContainerGroup) {
    scene.remove(doorContainerGroup);
  }
  if (containerMesh) {
    scene.remove(containerMesh);
    containerMesh = null;
  }

  doorContainerGroup = new THREE.Group();
  scene.add(doorContainerGroup);

  const L = spec.length * SCALE;
  const H = spec.height * SCALE;
  const W = spec.width  * SCALE;

  // Semi-transparent shell (BackSide so it's visible from inside)
  const geo = new THREE.BoxGeometry(L, H, W);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x1C2333, transparent: true, opacity: 0.06, side: THREE.BackSide,
  });
  containerMesh = new THREE.Mesh(geo, mat);
  containerMesh.position.set(L / 2, H / 2, W / 2);
  doorContainerGroup.add(containerMesh);

  // Edge lines (walls)
  const wallMat = new THREE.LineBasicMaterial({ color: 0x2563EB, transparent: true, opacity: 0.55 });
  // Draw walls manually so we can skip the door-end face
  const wallPts = [
    // bottom rect (closed end at x=L, open/door at x=0)
    [L,0,0],[L,0,W],  [L,0,W],[L,H,W],  [L,H,W],[L,H,0],  [L,H,0],[L,0,0],
    // top/floor long edges
    [L,0,0],[0,0,0],  [L,0,W],[0,0,W],  [L,H,W],[0,H,W],  [L,H,0],[0,H,0],
    // back rect (closed end) — already drawn above, just the verticals
  ];
  const wallVerts = [];
  wallPts.forEach(([x,y,z]) => wallVerts.push(x, y, z));
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallVerts, 3));
  doorContainerGroup.add(new THREE.LineSegments(wallGeo, wallMat));

  // Floor
  const floorGeo = new THREE.PlaneGeometry(L, W);
  const floorMat = new THREE.MeshBasicMaterial({ color: 0xCBD5E1, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const floor    = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(L / 2, 0.001, W / 2);
  doorContainerGroup.add(floor);

  // ── DOORS — two panels hinged at z=0 and z=W, opening outward
  doorOpen = false;
  doorCurrentAngle = 0;
  doorTargetAngle  = 0;
  doorL = null; doorR = null;

  const dHalfW = W / 2;  // each door panel covers half the container width
  const dT     = 0.018;  // door thickness

  const doorPaintMat = new THREE.MeshLambertMaterial({ color: 0x2563EB });
  const doorEdgeMat  = new THREE.LineBasicMaterial({ color: 0x93C5FD, transparent: true, opacity: 0.9 });

  // LEFT door — hinge at z=0, panel extends to z=+dHalfW inside container
  // Pivot rotates around Y at z=0; closed: rotation.y=0, open: rotation.y = -π/2
  const pivotL = new THREE.Group();
  pivotL.position.set(0, 0, 0);
  doorContainerGroup.add(pivotL);

  const dGeoL  = new THREE.BoxGeometry(dT, H - 0.02, dHalfW - 0.01);
  const meshL  = new THREE.Mesh(dGeoL, doorPaintMat);
  meshL.position.set(0, H / 2, dHalfW / 2);
  pivotL.add(meshL);

  const edgesL = new THREE.LineSegments(new THREE.EdgesGeometry(dGeoL), doorEdgeMat);
  edgesL.position.copy(meshL.position);
  pivotL.add(edgesL);
  doorL = pivotL;

  // RIGHT door — hinge at z=W, panel extends to z=-dHalfW inside container
  // Pivot rotates around Y at z=W; closed: rotation.y=0, open: rotation.y = +π/2
  const pivotR = new THREE.Group();
  pivotR.position.set(0, 0, W);
  doorContainerGroup.add(pivotR);

  const dGeoR  = new THREE.BoxGeometry(dT, H - 0.02, dHalfW - 0.01);
  const meshR  = new THREE.Mesh(dGeoR, doorPaintMat.clone());
  meshR.position.set(0, H / 2, -dHalfW / 2);
  pivotR.add(meshR);

  const edgesR = new THREE.LineSegments(new THREE.EdgesGeometry(dGeoR), doorEdgeMat.clone());
  edgesR.position.copy(meshR.position);
  pivotR.add(edgesR);
  doorR = pivotR;

  _startDoorAnim();
}

/* ── Door animation loop ── */
function _startDoorAnim() {
  if (doorAnimId) { cancelAnimationFrame(doorAnimId); doorAnimId = null; }
  function step() {
    if (!doorL || !doorR) return;
    const diff = doorTargetAngle - doorCurrentAngle;
    if (Math.abs(diff) < 0.001) {
      doorCurrentAngle = doorTargetAngle;
      doorL.rotation.y = -doorCurrentAngle;  // left: hinge at z=0, opens outward (neg Z)
      doorR.rotation.y =  doorCurrentAngle;  // right: hinge at z=W, opens outward (pos Z)
      doorAnimId = null;
      return;
    }
    doorCurrentAngle += diff * 0.12;
    doorL.rotation.y = -doorCurrentAngle;
    doorR.rotation.y =  doorCurrentAngle;
    doorAnimId = requestAnimationFrame(step);
  }
  doorAnimId = requestAnimationFrame(step);
}

function toggleDoor() {
  doorOpen = !doorOpen;
  doorTargetAngle = doorOpen ? Math.PI / 2 : 0;
  _startDoorAnim();
  const btn = document.getElementById('btn-door');
  if (btn) {
    btn.textContent = doorOpen ? '🚪 Close Door' : '🚪 Open Door';
    btn.classList.toggle('active', doorOpen);
  }
}

/* ── Show empty container (before optimization) ── */
function showEmptyContainer(spec) {
  if (!scene) return;
  container = spec;
  // Clear cartons
  for (const obj of packedMeshes) {
    scene.remove(obj.mesh);
    scene.remove(obj.edges);
    obj.mesh.geometry.dispose();
    obj.edges.geometry.dispose();
  }
  packedMeshes = [];
  hoveredMesh = null; selectedMesh = null;
  drawContainer(spec);
  frameCameraToContainer(spec);
  // Hide placeholder
  const ph = document.getElementById('vp-placeholder');
  if (ph) ph.style.display = 'none';
}

/* ─────────────────────────────────────────────────────────────
   CARTON MESH
───────────────────────────────────────────────────────────── */
function drawCarton(item) {
  const sl = item.l * SCALE;
  const sh = item.h * SCALE;
  const sw = item.w * SCALE;

  const geo = new THREE.BoxGeometry(sl, sh, sw);

  // Parse color
  const color = new THREE.Color(item.color || '#3B82F6');
  const mat   = new THREE.MeshPhongMaterial({
    color,
    shininess: 40,
    transparent: true,
    opacity: 0.85,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(
    item.x * SCALE + sl / 2,
    item.y * SCALE + sh / 2,
    item.z * SCALE + sw / 2
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { item };
  scene.add(mesh);

  // Wireframe edges
  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 });
  const edges   = new THREE.LineSegments(edgeGeo, edgeMat);
  edges.position.copy(mesh.position);
  scene.add(edges);

  packedMeshes.push({ mesh, edges, data: item, basePos: mesh.position.clone() });
}

/* ─────────────────────────────────────────────────────────────
   ANIMATION LOOP
───────────────────────────────────────────────────────────── */
let _lastTime = 0;
function animate(now) {
  animationId = requestAnimationFrame(animate);
  if (!renderer || !scene || !camera) return;

  const dt = Math.min((now - _lastTime) / 1000, 0.1); // seconds, capped at 100ms
  _lastTime = now;

  _tickLoadAnim(dt);
  updateRaycaster();
  renderer.render(scene, camera);
}

/* ─────────────────────────────────────────────────────────────
   RAYCASTER / HOVER
───────────────────────────────────────────────────────────── */
function updateRaycaster() {
  if (!renderer) return;
  raycaster.setFromCamera(mouseTHREE, camera);
  const meshes = packedMeshes.map(o => o.mesh);
  const hits   = raycaster.intersectObjects(meshes);

  const tooltip = document.getElementById('carton-tooltip');

  if (hits.length) {
    const hit     = hits[0].object;
    const entry   = packedMeshes.find(o => o.mesh === hit);
    if (entry && entry !== hoveredMesh) {
      if (hoveredMesh && hoveredMesh !== selectedMesh) resetMeshAppearance(hoveredMesh);
      hoveredMesh = entry;
      applyHoverAppearance(entry);
    }

    if (tooltip && entry) {
      const d = entry.data;
      const cNum  = d.cartonNumber ? `#${d.cartonNumber}` : d.instanceId;
      const layer = d.layerNumber  || (Math.floor(d.y/500)+1);
      tooltip.style.display = 'block';
      tooltip.style.left = (mousePos.x + 12) + 'px';
      tooltip.style.top  = (mousePos.y - 10) + 'px';
      tooltip.innerHTML = `
        <div class="tt-header">
          <span class="tt-carton-num">${cNum}</span>
          <span class="tt-sku">${d.sku}</span>
        </div>
        <div class="tt-layer-badge">Layer ${layer}</div>
        <div class="tt-row"><span>Pos</span><span>${Math.round(d.x)}, ${Math.round(d.y)}, ${Math.round(d.z)}</span></div>
        <div class="tt-row"><span>Size</span><span>${Math.round(d.l)} × ${Math.round(d.h)} × ${Math.round(d.w)}</span></div>
        <div class="tt-row"><span>Weight</span><span>${d.weight} kg</span></div>
        <div class="tt-row"><span>Rotated</span><span>${d.rotated ? 'Yes' : 'No'}</span></div>
      `;
    }
    document.body.style.cursor = 'pointer';
  } else {
    if (hoveredMesh && hoveredMesh !== selectedMesh) {
      resetMeshAppearance(hoveredMesh);
    }
    hoveredMesh = null;
    if (tooltip) tooltip.style.display = 'none';
    document.body.style.cursor = 'default';
  }
}

function applyHoverAppearance(entry) {
  if (selectedMesh && entry !== selectedMesh) return;
  _setMeshEmissive(entry.mesh, 0x334466, 0.3);
  _setMeshOpacity(entry.mesh, selectedMesh ? 1.0 : (showWireframe ? 0.95 : 1.0));
  entry.edges.material.color.setHex(0xffffff);
  entry.edges.material.opacity = 0.8;
}

function resetMeshAppearance(entry) {
  if (!entry) return;
  if (selectedMesh && entry !== selectedMesh) {
    _setMeshOpacity(entry.mesh, 0.12);
    _setMeshEmissive(entry.mesh, 0x000000, 0);
    entry.edges.material.opacity = 0.05;
    return;
  }
  if (!selectedMesh) {
    _setMeshEmissive(entry.mesh, 0x000000, 0);
    _setMeshOpacity(entry.mesh, showWireframe ? 0.92 : 0.96);
    entry.edges.material.color.setHex(0x000000);
    entry.edges.material.opacity = showWireframe ? 0.4 : 0.0;
  }
}

/* ─────────────────────────────────────────────────────────────
   CAMERA / ORBIT CONTROLS (manual implementation for r128)
───────────────────────────────────────────────────────────── */
function updateCameraFromOrbit() {
  if (!camera) return;
  const { theta, phi, radius, target } = orbitState;
  const x = target.x + radius * Math.sin(phi) * Math.sin(theta);
  const y = target.y + radius * Math.cos(phi);
  const z = target.z + radius * Math.sin(phi) * Math.cos(theta);
  camera.position.set(x, y, z);
  camera.lookAt(target.x, target.y, target.z);
}

function frameCameraToContainer(spec) {
  const cx = spec.length * SCALE / 2;
  const cy = spec.height * SCALE / 2;
  const cz = spec.width  * SCALE / 2;
  orbitState.target = { x: cx, y: cy, z: cz };
  orbitState.radius = Math.max(spec.length, spec.width, spec.height) * SCALE * 1.6;
  // Camera positioned at front-left corner: theta = -PI*0.6 puts viewer
  // to the left of the door end, looking in so door appears on the left
  // and the loaded back wall is visible on the right — matching real freight view.
  orbitState.theta  = -Math.PI * 0.6;
  orbitState.phi    = Math.PI / 3;
  updateCameraFromOrbit();
}

function setCameraView(view) {
  if (!container) return;
  const cx = container.length * SCALE / 2;
  const cy = container.height * SCALE / 2;
  const cz = container.width  * SCALE / 2;
  const r  = orbitState.radius;

  switch (view) {
    case 'top':
      orbitState.phi   = 0.05;
      orbitState.theta = 0;
      break;
    case 'front':
      orbitState.phi   = Math.PI / 2;
      orbitState.theta = 0;
      break;
    case 'side':
      orbitState.phi   = Math.PI / 2;
      orbitState.theta = Math.PI / 2;
      break;
    case 'iso':
      orbitState.phi   = Math.PI / 3;
      orbitState.theta = Math.PI / 4;
      break;
    case 'reset':
      frameCameraToContainer(container);
      return;
  }
  updateCameraFromOrbit();
}

/* ─────────────────────────────────────────────────────────────
   MOUSE EVENTS
───────────────────────────────────────────────────────────── */
function onMouseDown(e) {
  if (e.button === 0) {
    orbitState.isDragging = true;
    orbitState.isPanning  = false;
  } else if (e.button === 2) {
    orbitState.isPanning  = true;
    orbitState.isDragging = false;
  }
  orbitState.lastMouse = { x: e.clientX, y: e.clientY };
}

function onMouseMove(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mousePos.x = e.clientX - rect.left;
  mousePos.y = e.clientY - rect.top;
  mouseTHREE.x =  (mousePos.x / rect.width)  * 2 - 1;
  mouseTHREE.y = -(mousePos.y / rect.height) * 2 + 1;

  const dx = e.clientX - orbitState.lastMouse.x;
  const dy = e.clientY - orbitState.lastMouse.y;

  if (orbitState.isDragging) {
    orbitState.theta -= dx * 0.008;
    orbitState.phi   -= dy * 0.008;
    orbitState.phi    = Math.max(0.05, Math.min(Math.PI - 0.05, orbitState.phi));
    updateCameraFromOrbit();
  } else if (orbitState.isPanning) {
    const panSpeed = orbitState.radius * 0.001;
    const right = new THREE.Vector3();
    const up    = new THREE.Vector3();
    camera.getWorldDirection(up);
    right.crossVectors(camera.up, up).normalize();
    up.crossVectors(right, up).normalize();
    orbitState.target.x += (right.x * dx + up.x * dy) * panSpeed;
    orbitState.target.y += (right.y * dx + up.y * dy) * panSpeed;
    orbitState.target.z += (right.z * dx + up.z * dy) * panSpeed;
    updateCameraFromOrbit();
  }

  orbitState.lastMouse = { x: e.clientX, y: e.clientY };
}

function onMouseUp(e) {
  if (!orbitState.isDragging && !orbitState.isPanning) {
    // Click = select
    raycaster.setFromCamera(mouseTHREE, camera);
    const meshes = packedMeshes.map(o => o.mesh);
    const hits   = raycaster.intersectObjects(meshes);
    if (hits.length) {
      const entry = packedMeshes.find(o => o.mesh === hits[0].object);
      if (entry) selectCarton(entry.data.instanceId);
    } else {
      clearSelection();
      // Also clear the manifest highlight and location panel in app
      document.querySelectorAll('#manifest-body tr').forEach(r => r.classList.remove('active-row'));
      document.querySelectorAll('.seq-step').forEach(s => s.classList.remove('highlight'));
      if (window.clearCartonLocationInfo) window.clearCartonLocationInfo();
    }
  }
  orbitState.isDragging = false;
  orbitState.isPanning  = false;
}

function onWheel(e) {
  e.preventDefault();
  orbitState.radius *= 1 + e.deltaY * 0.001;
  orbitState.radius = Math.max(0.5, Math.min(50, orbitState.radius));
  updateCameraFromOrbit();
}

function onResize() {
  if (!renderer || !camera) return;
  const el = renderer.domElement.parentElement;
  if (!el) return;
  const w = el.clientWidth, h = el.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

/* ─────────────────────────────────────────────────────────────
   CARTON FACE TEXTURES
   Stamps number + SKU + "this side up" arrows directly onto
   each face of the box — no floating sprites at all.
───────────────────────────────────────────────────────────── */

// No sprite list needed — markings are baked into the mesh geometry
const labelSprites = []; // kept as empty stub so selectCarton/clearSelection don't break

function _makeCartonFaceMaterials(num, sku, baseColor) {
  // Create 6 face materials for BoxGeometry face order:
  // +X (right), -X (left), +Y (top), -Y (bottom), +Z (front), -Z (back)
  // We stamp the label on +X, -X, +Z, -Z (the four "sides")
  // Top (+Y) gets the "this side up" arrow symbol
  // Bottom (-Y) gets a plain color face

  const mats = [];
  for (let i = 0; i < 6; i++) {
    let canvas;
    if (i === 2) {
      // +Y = top face → "this side up" arrows
      canvas = _drawTopFace(baseColor);
    } else if (i === 3) {
      // -Y = bottom face → plain
      canvas = _drawPlainFace(baseColor);
    } else {
      // All side faces → stamp label
      canvas = _drawSideFace(num, sku, baseColor);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    mats.push(new THREE.MeshPhongMaterial({
      map:         tex,
      shininess:   35,
      transparent: true,
      opacity:     0,   // start invisible, fades in during animation
    }));
  }
  return mats;
}

// ── Side face: circle stamp + number + SKU + subtle texture ──
function _drawSideFace(num, sku, baseColor) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');

  // Base cardboard-like flat fill using the carton color
  ctx.fillStyle = baseColor || '#3B82F6';
  ctx.fillRect(0, 0, S, S);

  // Very subtle darker overlay to give depth
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(0, 0, S, S);

  // ── Circle stamp (like "No.1" photo) ──
  const cx = S / 2, cy = S * 0.44, cr = S * 0.30;
  // Outer circle
  ctx.beginPath();
  ctx.arc(cx, cy, cr, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth   = S * 0.022;
  ctx.stroke();

  // Inner circle (thinner)
  ctx.beginPath();
  ctx.arc(cx, cy, cr * 0.84, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth   = S * 0.010;
  ctx.stroke();

  // Six small star dots around circle (like stamp)
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const dx = Math.cos(angle) * cr * 0.92;
    const dy = Math.sin(angle) * cr * 0.92;
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, S * 0.018, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    ctx.fill();
  }

  // "No." label small
  ctx.font         = `bold ${S * 0.078}px Arial, sans-serif`;
  ctx.fillStyle    = 'rgba(255,255,255,0.88)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor  = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur   = S * 0.012;
  ctx.fillText('No.', cx, cy - S * 0.045);

  // Big carton number
  ctx.font         = `bold ${S * 0.22}px Arial, sans-serif`;
  ctx.fillStyle    = '#FFFFFF';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowBlur   = S * 0.018;
  ctx.fillText(String(num), cx, cy + S * 0.14);

  // ── SKU name below circle ──
  ctx.shadowBlur = 0;
  const skuShort = sku.length > 10 ? sku.substring(0, 9) + '…' : sku;
  ctx.font         = `bold ${S * 0.072}px Arial, sans-serif`;
  ctx.fillStyle    = 'rgba(255,255,255,0.90)';
  ctx.textBaseline = 'middle';
  ctx.fillText(skuShort, cx, cy + cr + S * 0.085);

  // Thin bottom border line
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth   = S * 0.008;
  ctx.beginPath();
  ctx.moveTo(S * 0.12, cy + cr + S * 0.14);
  ctx.lineTo(S * 0.88, cy + cr + S * 0.14);
  ctx.stroke();

  return c;
}

// ── Top face: "this side up" double arrows ──
function _drawTopFace(baseColor) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');

  ctx.fillStyle = baseColor || '#3B82F6';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(0, 0, S, S);

  // Rounded square border (like the reference photo)
  const pad = S * 0.10;
  const r   = S * 0.09;
  ctx.beginPath();
  ctx.moveTo(pad + r, pad);
  ctx.lineTo(S - pad - r, pad);
  ctx.quadraticCurveTo(S - pad, pad, S - pad, pad + r);
  ctx.lineTo(S - pad, S - pad - r);
  ctx.quadraticCurveTo(S - pad, S - pad, S - pad - r, S - pad);
  ctx.lineTo(pad + r, S - pad);
  ctx.quadraticCurveTo(pad, S - pad, pad, S - pad - r);
  ctx.lineTo(pad, pad + r);
  ctx.quadraticCurveTo(pad, pad, pad + r, pad);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth   = S * 0.028;
  ctx.stroke();

  // Two upward arrows side by side
  const arrowW  = S * 0.09;
  const arrowH  = S * 0.38;
  const headH   = S * 0.14;
  const gap     = S * 0.06;
  const cx      = S / 2;
  const yTop    = S * 0.18;
  const yBot    = S * 0.72;

  for (let side = -1; side <= 1; side += 2) {
    const ax = cx + side * (arrowW / 2 + gap / 2);

    // Arrow shaft
    ctx.fillStyle = 'rgba(255,255,255,0.90)';
    ctx.fillRect(ax - arrowW * 0.35, yTop + headH, arrowW * 0.70, arrowH - headH);

    // Arrow head (triangle)
    ctx.beginPath();
    ctx.moveTo(ax, yTop);                      // tip
    ctx.lineTo(ax - arrowW * 0.70, yTop + headH); // left base
    ctx.lineTo(ax + arrowW * 0.70, yTop + headH); // right base
    ctx.closePath();
    ctx.fill();
  }

  // Baseline under arrows
  ctx.fillStyle = 'rgba(255,255,255,0.90)';
  ctx.fillRect(cx - arrowW - gap * 1.4, yBot, (arrowW * 2 + gap * 2.8), S * 0.030);

  return c;
}

// ── Bottom face: plain ──
function _drawPlainFace(baseColor) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor || '#3B82F6';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, 0, S, S);
  return c;
}

function _buildLabels() { /* no-op — textures are baked into meshes */ }
function _removeLabels() { labelSprites.length = 0; }
let _labelsBuilt = true; // textures baked at spawn time


/* ─────────────────────────────────────────────────────────────
   MATERIAL HELPERS — handle single or array materials
───────────────────────────────────────────────────────────── */
function _setMeshOpacity(mesh, opacity) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) m.opacity = opacity;
}
function _setMeshEmissive(mesh, hex, intensity) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (m.emissive) { m.emissive.setHex(hex); m.emissiveIntensity = intensity; }
  }
}

/* ─────────────────────────────────────────────────────────────
   SELECTION — dims all others, full-bright on selected
───────────────────────────────────────────────────────────── */
function selectCarton(instanceId) {
  selectedMesh = packedMeshes.find(o => o.data.instanceId === instanceId) || null;

  for (const obj of packedMeshes) {
    if (obj === selectedMesh) {
      _setMeshOpacity(obj.mesh, 1.0);
      _setMeshEmissive(obj.mesh, 0xFF6600, 0.45);
      obj.edges.material.color.setHex(0xFFFFFF);
      obj.edges.material.opacity = 1.0;
    } else {
      _setMeshOpacity(obj.mesh, 0.12);
      _setMeshEmissive(obj.mesh, 0x000000, 0);
      obj.edges.material.opacity = 0.05;
    }
  }

  const resetBtn = document.getElementById('btn-reset-colors');
  if (resetBtn) resetBtn.classList.add('selection-active');
}

function clearSelection() {
  selectedMesh = null;
  for (const obj of packedMeshes) {
    _setMeshOpacity(obj.mesh, showWireframe ? 0.92 : 0.96);
    _setMeshEmissive(obj.mesh, 0x000000, 0);
    obj.edges.material.color.setHex(0x000000);
    obj.edges.material.opacity = showWireframe ? 0.4 : 0.0;
  }
  const resetBtn = document.getElementById('btn-reset-colors');
  if (resetBtn) resetBtn.classList.remove('selection-active');
}

/* ─────────────────────────────────────────────────────────────
   VIEW TOGGLES
───────────────────────────────────────────────────────────── */
function toggleWireframe(on) {
  showWireframe = on;
  for (const obj of packedMeshes) {
    if (selectedMesh) {
      if (obj === selectedMesh) {
        obj.edges.material.opacity = 1.0;
        _setMeshOpacity(obj.mesh, 1.0);
      } else {
        obj.edges.material.opacity = 0.05;
        _setMeshOpacity(obj.mesh, 0.12);
      }
    } else {
      obj.edges.material.opacity = on ? 0.4 : 0.0;
      _setMeshOpacity(obj.mesh, on ? 0.92 : 0.96);
    }
  }
}

function toggleExplode(on) {
  isExploded = on;
  if (!container) return;
  const cx = container.length * SCALE / 2;
  const cy = container.height * SCALE / 2;
  const cz = container.width  * SCALE / 2;

  for (const obj of packedMeshes) {
    const base = obj.basePos;
    if (on) {
      const dx = (base.x - cx) * 0.4;
      const dy = (base.y - cy) * 0.4;
      const dz = (base.z - cz) * 0.4;
      obj.mesh.position.set(base.x + dx, base.y + dy, base.z + dz);
      obj.edges.position.copy(obj.mesh.position);
    } else {
      obj.mesh.position.copy(base);
      obj.edges.position.copy(base);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   EXPORTS
───────────────────────────────────────────────────────────── */
window.FCOS_RENDERER = {
  init,
  destroy,
  renderPacked,
  showEmptyContainer,
  setCameraView,
  toggleWireframe,
  toggleExplode,
  toggleDoor,
  selectCarton,
  clearSelection,
  playPauseAnim,
  setAnimSpeed,
};

// Global shortcut so HTML onclick can call it
window.resetCartonSelection = function() {
  clearSelection();
  document.querySelectorAll('#manifest-body tr').forEach(r => r.classList.remove('active-row'));
  document.querySelectorAll('.seq-step').forEach(s => s.classList.remove('highlight'));
  if (window.clearCartonLocationInfo) window.clearCartonLocationInfo();
};

})();
