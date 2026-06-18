(function (global) {
  'use strict';

  /* ── private state ── */
  let scene, camera, renderer;
  let meshes  = [];   // all dynamic scene objects (boxes + edges + floor)
  let cMesh   = null; // container ghost mesh
  let CL = 1, CW = 1, CH = 1;
  let exploded = false;
  let wired    = false;

  /* raycaster */
  const rc = new THREE.Raycaster();
  const mv = new THREE.Vector2();

  /* ─────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────── */
  function init() {
    const canvas = document.getElementById('canvas3d');

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070B12);

    // Lighting rig
    const amb  = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(amb);

    const sun  = new THREE.DirectionalLight(0xfff8e7, 0.9);
    sun.position.set(800, 1200, 600);
    sun.castShadow = true;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0x2DD4BF, 0.2);
    fill.position.set(-600, 200, -400);
    scene.add(fill);

    const rim  = new THREE.DirectionalLight(0x818CF8, 0.15);
    rim.position.set(200, -100, 800);
    scene.add(rim);

    // Floor grid
    const grid = new THREE.GridHelper(2000, 40, 0x1a2332, 0x111827);
    grid.name = 'grid';
    scene.add(grid);

    // Camera
    camera = new THREE.PerspectiveCamera(45, 1, 1, 10000);
    camera.position.set(700, 600, 900);
    camera.lookAt(294, 119, 117);

    _setupOrbit(canvas);
    _resize();
    window.addEventListener('resize', _resize);
    _loop();
  }

  /* ─────────────────────────────────────────────
     RENDER LOOP
  ───────────────────────────────────────────── */
  function _loop() {
    requestAnimationFrame(_loop);
    renderer.render(scene, camera);
  }

  /* ─────────────────────────────────────────────
     RESIZE
  ───────────────────────────────────────────── */
  function _resize() {
    const vp = document.getElementById('vp');
    renderer.setSize(vp.clientWidth, vp.clientHeight);
    camera.aspect = vp.clientWidth / vp.clientHeight;
    camera.updateProjectionMatrix();
  }

  /* ─────────────────────────────────────────────
     ORBIT CONTROLS  (manual — no OrbitControls dep)
  ───────────────────────────────────────────── */
  function _setupOrbit(canvas) {
    let drag = false, rightDrag = false, lx = 0, ly = 0;
    const S = { th: 0.8, ph: 0.9, r: 1200 };
    const T = { x: 294, y: 119, z: 117 };

    function update() {
      camera.position.set(
        T.x + S.r * Math.sin(S.ph) * Math.sin(S.th),
        T.y + S.r * Math.cos(S.ph),
        T.z + S.r * Math.sin(S.ph) * Math.cos(S.th)
      );
      camera.lookAt(T.x, T.y, T.z);
    }
    update();

    // expose for camera preset switching
    window._OS = { S, T, update };

    canvas.addEventListener('mousedown', e => {
      drag = true; rightDrag = e.button === 2;
      lx = e.clientX; ly = e.clientY;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mouseup', () => { drag = false; });

    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (rightDrag) {
        T.x -= dx * 1.2;
        T.z -= dy * 1.2;
      } else {
        S.th -= dx * 0.008;
        S.ph = Math.max(0.08, Math.min(Math.PI - 0.08, S.ph + dy * 0.008));
      }
      update();
    });

    canvas.addEventListener('wheel', e => {
      S.r = Math.max(80, Math.min(5000, S.r + e.deltaY * 1.2));
      update();
    }, { passive: true });

    // Touch
    let touches = [], lastPinch = 0;
    canvas.addEventListener('touchstart', e => { touches = [...e.touches]; lastPinch = 0; }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - touches[0].clientX;
        const dy = e.touches[0].clientY - touches[0].clientY;
        S.th -= dx * 0.012;
        S.ph = Math.max(0.08, Math.min(Math.PI - 0.08, S.ph + dy * 0.012));
        update(); touches = [...e.touches];
      } else if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (lastPinch) S.r = Math.max(80, Math.min(5000, S.r - (d - lastPinch) * 3));
        lastPinch = d; update();
      }
    }, { passive: true });
  }

  /* ─────────────────────────────────────────────
     BUILD SCENE FROM PLACEMENTS
  ───────────────────────────────────────────── */
  function buildScene(containerDims, placements) {
    CL = containerDims.l;
    CW = containerDims.w;
    CH = containerDims.h;

    // Clear previous scene objects
    meshes.forEach(m => scene.remove(m));
    meshes = [];
    if (cMesh) { scene.remove(cMesh); cMesh = null; }

    // Container ghost + wireframe
    const cGeo = new THREE.BoxGeometry(CL, CH, CW);

    cMesh = new THREE.Mesh(cGeo, new THREE.MeshBasicMaterial({
      color: 0x2f81f7, transparent: true, opacity: 0.025, side: THREE.BackSide
    }));
    cMesh.position.set(CL / 2, CH / 2, CW / 2);
    scene.add(cMesh);

    const cEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(cGeo),
      new THREE.LineBasicMaterial({ color: 0xF59E0B, transparent: true, opacity: 0.55 })
    );
    cEdge.position.copy(cMesh.position);
    scene.add(cEdge);
    meshes.push(cEdge);

    // Floor plane
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(CL, CW),
      new THREE.MeshBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.7 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(CL / 2, 0, CW / 2);
    scene.add(floor);
    meshes.push(floor);

    // Reposition grid
    const grid = scene.getObjectByName('grid');
    if (grid) {
      grid.position.set(CL / 2, -0.5, CW / 2);
      grid.scale.set(CL / 2000, 1, CW / 2000);
    }

    // Boxes + edge lines
    placements.forEach((p, i) => {
      const geo = new THREE.BoxGeometry(p.l - 1.2, p.h - 1.2, p.w - 1.2);

      const mat = new THREE.MeshLambertMaterial({
        color: p.item.color, transparent: true, opacity: 0.85
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.x + p.l / 2, p.y + p.h / 2, p.z + p.w / 2);
      mesh.castShadow = true;
      mesh.userData = { ...p, index: i };
      scene.add(mesh);
      meshes.push(mesh);

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })
      );
      edge.position.copy(mesh.position);
      scene.add(edge);
      meshes.push(edge);
    });

    // Recentre camera
    if (window._OS) {
      const os = window._OS;
      os.T.x = CL / 2; os.T.y = CH / 4; os.T.z = CW / 2;
      os.S.r = Math.max(CL, CW, CH) * 2.2;
      os.update();
    }

    // Reset view toggles
    exploded = false;
    wired    = false;
    document.getElementById('vpEx').classList.remove('on');
    document.getElementById('vpWf').classList.remove('on');
  }

  /* ─────────────────────────────────────────────
     CAMERA PRESETS
  ───────────────────────────────────────────── */
  function setCameraPreset(preset) {
    ['vpPersp', 'vpFront', 'vpTop', 'vpSide'].forEach(id =>
      document.getElementById(id).classList.remove('on')
    );
    if (!window._OS) return;
    const { S, update } = window._OS;
    const r = Math.max(CL, CW, CH) * 2.2;

    switch (preset) {
      case 'persp': S.th = 0.8;       S.ph = 0.9;        S.r = r;       document.getElementById('vpPersp').classList.add('on'); break;
      case 'front': S.th = 0;         S.ph = Math.PI / 2; S.r = r;       document.getElementById('vpFront').classList.add('on'); break;
      case 'top':   S.th = 0;         S.ph = 0.06;        S.r = r * 1.2; document.getElementById('vpTop').classList.add('on');   break;
      case 'side':  S.th = Math.PI/2; S.ph = Math.PI / 2; S.r = r;       document.getElementById('vpSide').classList.add('on');  break;
    }
    update();
  }

  /* ─────────────────────────────────────────────
     EXPLODE MODE
  ───────────────────────────────────────────── */
  function toggleExplode() {
    exploded = !exploded;
    document.getElementById('vpEx').classList.toggle('on', exploded);

    meshes.filter(m => m.isMesh && m.userData.item).forEach(m => {
      const d = m.userData;
      if (exploded) {
        const cx = d.x + d.l / 2 - CL / 2;
        const cy = d.y + d.h / 2 - CH / 2;
        const cz = d.z + d.w / 2 - CW / 2;
        const len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
        m.position.set(
          d.x + d.l / 2 + (cx / len) * 90,
          d.y + d.h / 2 + (cy / len) * 90,
          d.z + d.w / 2 + (cz / len) * 90
        );
      } else {
        m.position.set(d.x + d.l / 2, d.y + d.h / 2, d.z + d.w / 2);
      }
    });
  }

  /* ─────────────────────────────────────────────
     WIREFRAME MODE
  ───────────────────────────────────────────── */
  function toggleWireframe() {
    wired = !wired;
    document.getElementById('vpWf').classList.toggle('on', wired);

    meshes.filter(m => m.isMesh && m.userData.item).forEach(m => {
      m.material.wireframe = wired;
      m.material.opacity   = wired ? 0.55 : 0.85;
    });
  }

  /* ─────────────────────────────────────────────
     HOVER TOOLTIP (raycaster)
  ───────────────────────────────────────────── */
  function initTooltip() {
    const vpEl = document.getElementById('vp');
    const tt   = document.getElementById('tt');

    vpEl.addEventListener('mousemove', e => {
      const rect = vpEl.getBoundingClientRect();
      mv.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      mv.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

      rc.setFromCamera(mv, camera);
      const hits = rc.intersectObjects(meshes.filter(m => m.isMesh));

      if (hits.length && hits[0].object.userData.item) {
        const d = hits[0].object.userData;
        const hex = '#' + d.item.color.toString(16).padStart(6, '0');

        document.getElementById('ttS').style.background = hex;
        document.getElementById('ttT').textContent  = d.item.sku;
        document.getElementById('ttSz').textContent = `${d.l}×${d.w}×${d.h}`;
        document.getElementById('ttP').textContent  = `${d.x.toFixed(0)}, ${d.y.toFixed(0)}, ${d.z.toFixed(0)}`;
        document.getElementById('ttW').textContent  = `${d.item.wt} kg`;
        document.getElementById('ttI').textContent  = `#${d.index + 1}`;

        tt.style.display = 'block';
        tt.style.left    = (e.clientX - rect.left + 14) + 'px';
        tt.style.top     = (e.clientY - rect.top  - 10) + 'px';
      } else {
        tt.style.display = 'none';
      }
    });

    vpEl.addEventListener('mouseleave', () => { tt.style.display = 'none'; });
  }

  /* ─────────────────────────────────────────────
     CLEAR SCENE
  ───────────────────────────────────────────── */
  function clearScene() {
    meshes.forEach(m => scene.remove(m));
    meshes = [];
    if (cMesh) { scene.remove(cMesh); cMesh = null; }
    exploded = false;
    wired    = false;
  }

  // Public API
  global.Renderer = {
    init,
    initTooltip,
    buildScene,
    setCameraPreset,
    toggleExplode,
    toggleWireframe,
    clearScene,
  };

})(window);
