/**
 * app.js — UI Controller
 *
 * Owns: form state, carton type list, stats updates,
 * manifest table, legend panel.
 *
 * Depends on: Packer (packer.js) and Renderer (renderer.js)
 * both loaded before this file.
 */

(function () {
  'use strict';

  /* ── CONSTANTS ── */
  const COLORS = [
    0xF59E0B, 0x2DD4BF, 0x818CF8, 0x34D399,
    0xF472B6, 0x60A5FA, 0xFB923C, 0xA78BFA,
    0x4ADE80, 0xFACC15, 0x38BDF8, 0xF87171,
  ];

  const PRESETS = {
    20: [589,  234, 239, 21700],
    40: [1203, 234, 239, 26680],
    hc: [1203, 234, 269, 26480],
    lt: [1360, 248, 278, 15000],
  };

  /* ── STATE ── */
  let types    = [];   // carton type objects
  let places   = [];   // current placement results
  let colorIdx = 0;

  /* ─────────────────────────────────────────────
     CONTAINER PRESETS
  ───────────────────────────────────────────── */
  function setPreset(type, el) {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    const [l, w, h, wt] = PRESETS[type];
    document.getElementById('cL').value    = l;
    document.getElementById('cW').value    = w;
    document.getElementById('cH').value    = h;
    document.getElementById('cMaxWt').value = wt;
  }

  /* ─────────────────────────────────────────────
     ADD CARTON TYPE
  ───────────────────────────────────────────── */
  function addCarton() {
    const l   = +document.getElementById('bL').value;
    const w   = +document.getElementById('bW').value;
    const h   = +document.getElementById('bH').value;
    const qty = +document.getElementById('bQty').value || 1;
    const wt  = +document.getElementById('bWt').value  || 0;
    const sku = document.getElementById('bSKU').value.trim()
                || `SKU-${String(types.length + 1).padStart(3, '0')}`;
    const rot = +document.getElementById('bRot').value;
    const fb  = document.getElementById('fb');

    if (!l || !w || !h || l <= 0 || w <= 0 || h <= 0) {
      fb.innerHTML = '<div class="feedback fb-warn">Enter valid L, W, H (all > 0)</div>';
      return;
    }

    const color = COLORS[colorIdx % COLORS.length];
    colorIdx++;
    types.push({ l, w, h, qty, wt, sku, rot, color, id: Date.now() });

    fb.innerHTML = `<div class="feedback fb-ok">Added ${qty}× ${sku} (${l}×${w}×${h} cm)</div>`;
    _renderCartonList();
    ['bL', 'bW', 'bH', 'bQty', 'bWt', 'bSKU'].forEach(id => {
      document.getElementById(id).value = '';
    });
  }

  function removeType(id) {
    types = types.filter(t => t.id !== id);
    _renderCartonList();
  }

  /* ─────────────────────────────────────────────
     RENDER CARTON LIST
  ───────────────────────────────────────────── */
  function _renderCartonList() {
    const el = document.getElementById('cartonList');
    const ctC = document.getElementById('ctC');
    ctC.textContent = types.length ? `(${types.length})` : '';

    if (!types.length) {
      el.innerHTML = '<div class="empty-note">No types added yet.</div>';
      return;
    }

    el.innerHTML = types.map(t => {
      const hex = '#' + t.color.toString(16).padStart(6, '0');
      return `
        <div class="carton-row">
          <div class="c-swatch" style="background:${hex}"></div>
          <div class="c-info">
            <div class="c-name">${t.sku}</div>
            <div class="c-meta">${t.l}×${t.w}×${t.h} cm · ${t.qty} pcs · ${t.wt}kg</div>
          </div>
          <button class="c-del" onclick="App.removeType(${t.id})">✕</button>
        </div>`;
    }).join('');
  }

  /* ─────────────────────────────────────────────
     RUN OPTIMIZATION
  ───────────────────────────────────────────── */
  function run() {
    const fb = document.getElementById('fb');

    if (!types.length) {
      fb.innerHTML = '<div class="feedback fb-warn">Add at least one carton type first.</div>';
      return;
    }

    const cL    = +document.getElementById('cL').value;
    const cW    = +document.getElementById('cW').value;
    const cH    = +document.getElementById('cH').value;
    const maxWt = +document.getElementById('cMaxWt').value || Infinity;

    if (!cL || !cW || !cH) {
      fb.innerHTML = '<div class="feedback fb-warn">Set container dimensions first.</div>';
      return;
    }

    // Run packing algorithm
    const result = Packer.pack(cL, cW, cH, maxWt, types);
    places = result.placements;

    // ── Update stats ──
    const cVol   = cL * cW * cH;
    const pVol   = places.reduce((s, p) => s + p.l * p.w * p.h, 0);
    const util   = (pVol / cVol) * 100;
    const totReq = types.reduce((s, t) => s + t.qty, 0);
    const ys     = places.map(p => p.y + p.h);
    const maxH   = ys.length ? Math.max(...ys) : 0;
    const layers = places.length
      ? new Set(places.map(p => Math.round(p.y))).size : 0;

    _setStat('sv1', `${util.toFixed(1)}<span class="u"> %</span>`);
    _setBar('sb1', util,
      util > 80 ? 'var(--green)' : util > 55 ? 'var(--amber)' : 'var(--red)');

    _setStat('sv2', places.length);
    document.getElementById('ss2').textContent = `of ${totReq} requested`;

    _setStat('sv3', `${result.totalWeight.toFixed(0)}<span class="u"> kg</span>`);
    _setBar('sb3', result.totalWeight / (maxWt || result.totalWeight || 1) * 100, 'var(--indigo)');

    _setStat('sv4', layers);
    document.getElementById('ss4').textContent = `height ${maxH.toFixed(0)} cm`;

    _setStat('sv5', `${(cVol / 1e6).toFixed(2)}<span class="u"> m³</span>`);
    document.getElementById('ss5').textContent = `${(pVol / 1e6).toFixed(2)} m³ packed`;

    // ── Render 3D ──
    Renderer.buildScene({ l: cL, w: cW, h: cH }, places);

    // ── Update manifest + legend ──
    _renderManifest();
    _renderLegend();

    fb.innerHTML = '';
  }

  /* ─────────────────────────────────────────────
     CLEAR ALL
  ───────────────────────────────────────────── */
  function clearAll() {
    types = []; places = []; colorIdx = 0;
    _renderCartonList();
    document.getElementById('fb').innerHTML = '';
    document.getElementById('mBody').innerHTML =
      '<tr><td colspan="9" class="no-data">Run optimization to see placement manifest.</td></tr>';
    document.getElementById('mBadge').textContent = '0 placements';
    document.getElementById('legItems').innerHTML =
      '<div style="font-size:11px;color:var(--muted2)">Run to visualize</div>';

    ['sv1','sv2','sv3','sv4','sv5'].forEach(id =>
      document.getElementById(id).innerHTML = '—'
    );
    document.getElementById('ss2').textContent = 'of — requested';
    document.getElementById('ss4').textContent = 'height —';
    document.getElementById('ss5').textContent = '— m³ packed';
    ['sb1','sb3'].forEach(id => document.getElementById(id).style.width = '0%');

    Renderer.clearScene();
  }

  /* ─────────────────────────────────────────────
     MANIFEST TABLE
  ───────────────────────────────────────────── */
  function _renderManifest() {
    document.getElementById('mBadge').textContent = `${places.length} placements`;

    if (!places.length) {
      document.getElementById('mBody').innerHTML =
        '<tr><td colspan="9" class="no-data">No placements generated.</td></tr>';
      return;
    }

    document.getElementById('mBody').innerHTML = places.map((p, i) => {
      const hex     = '#' + p.item.color.toString(16).padStart(6, '0');
      const isNative = p.l === p.item.l && p.w === p.item.w && p.h === p.item.h;
      const vol     = (p.l * p.w * p.h / 1e6).toFixed(4);
      return `
        <tr>
          <td class="mono">${i + 1}</td>
          <td>
            <span style="display:inline-block;width:7px;height:7px;border-radius:2px;
              background:${hex};margin-right:5px;vertical-align:middle"></span>
            ${p.item.sku}
          </td>
          <td class="mono">${p.l}×${p.w}×${p.h}</td>
          <td class="mono">${p.x.toFixed(0)}</td>
          <td class="mono">${p.y.toFixed(0)}</td>
          <td class="mono">${p.z.toFixed(0)}</td>
          <td style="color:var(--muted2)">${isNative ? 'L×W×H' : 'rotated'}</td>
          <td class="mono">${p.item.wt}</td>
          <td class="mono">${vol}</td>
        </tr>`;
    }).join('');
  }

  /* ─────────────────────────────────────────────
     LEGEND
  ───────────────────────────────────────────── */
  function _renderLegend() {
    document.getElementById('legItems').innerHTML = types.map(t => {
      const hex = '#' + t.color.toString(16).padStart(6, '0');
      return `
        <div class="leg-item">
          <div class="leg-swatch" style="background:${hex}"></div>
          <span>${t.sku} ×${t.qty}</span>
        </div>`;
    }).join('');
  }

  /* ─────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────── */
  function _setStat(id, html) {
    document.getElementById(id).innerHTML = html;
  }
  function _setBar(id, pct, color) {
    const el = document.getElementById(id);
    el.style.width      = Math.min(pct, 100) + '%';
    el.style.background = color;
  }

  /* ─────────────────────────────────────────────
     BOOT
  ───────────────────────────────────────────── */
  function _boot() {
    Renderer.init();
    Renderer.initTooltip();

    // Pre-load two demo carton types
    const demos = [
      { bL: 60, bW: 40, bH: 30, bQty: 80, bWt: 12, bSKU: 'SKU-001', bRot: 6 },
      { bL: 45, bW: 45, bH: 45, bQty: 40, bWt: 8,  bSKU: 'SKU-002', bRot: 6 },
    ];
    demos.forEach(d => {
      Object.entries(d).forEach(([k, v]) => {
        document.getElementById(k).value = v;
      });
      addCarton();
    });
    document.getElementById('fb').innerHTML = '';
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

  // Public API — called from inline onclick handlers in HTML
  window.App = {
    setPreset,
    addCarton,
    removeType,
    run,
    clearAll,
    // camera + view controls delegated to Renderer
    cam:             p  => Renderer.setCameraPreset(p),
    toggleExplode:   ()  => Renderer.toggleExplode(),
    toggleWire:      ()  => Renderer.toggleWireframe(),
  };

})();
