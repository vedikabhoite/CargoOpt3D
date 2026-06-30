/**
 * app.js — FCOS v2 Application Controller
 *
 * UX improvements over v1:
 *   - Guided 3-step stepper (Shipment → Cartons → Optimize)
 *   - Container type picker (visual grid, not dropdown)
 *   - mm / cm unit toggle (converts on input, stores in mm)
 *   - Carton quick templates (Small / Medium / Large)
 *   - Keyboard shortcuts: Enter saves carton form, Escape cancels
 *   - 3D controls hint overlay (auto-hides after 4s)
 *   - Unfit banner when cartons can't be packed
 *   - Stepper step-click navigation
 *   - Toast messages that stay longer for errors
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────────── */
const state = {
  currentStep:    1,
  unit:           'mm',     // 'mm' or 'cm' — display unit
  cartons:        [],
  lastResult:     null,
  lastSequence:   null,
  rendererReady:  false,
  editingId:      null,
};

/* ─────────────────────────────────────────────────────────────
   CARTON TEMPLATES  (stored internally in mm)
───────────────────────────────────────────────────────────── */
const TEMPLATES = {
  small:  { l: 400, w: 300, h: 250, weight: 8,  label: 'Small box' },
  medium: { l: 600, w: 400, h: 350, weight: 18, label: 'Medium box' },
  large:  { l: 1200, w: 800, h: 600, weight: 45, label: 'Large box' },
};

/* ─────────────────────────────────────────────────────────────
   DOM SHORTCUTS
───────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const els = {
  // Shipment
  shipmentId:      $('shipment-id'),
  customerName:    $('customer-name'),
  destination:     $('destination'),
  dispatchDate:    $('dispatch-date'),
  freightManager:  $('freight-manager'),
  maxPayload:      $('max-payload'),
  customDimsWrap:  $('custom-dims-wrap'),
  customL:         $('custom-l'),
  customW:         $('custom-w'),
  customH:         $('custom-h'),
  csVolume:        $('cs-volume'),
  csPayload:       $('cs-payload'),
  headerShipmentId: $('header-shipment-id'),

  // Carton form
  cartonFormCard:  $('carton-form-card'),
  cfcTitle:        $('cfc-title'),
  skuInput:        $('sku'),
  cartonL:         $('carton-l'),
  cartonW:         $('carton-w'),
  cartonH:         $('carton-h'),
  cartonWeight:    $('carton-weight'),
  cartonQty:       $('carton-qty'),
  cartonRotation:  $('carton-rotation'),
  cartonColor:     $('carton-color'),
  btnSaveCarton:   $('btn-save-carton'),
  btnAutoColor:    $('btn-auto-color'),
  btnAddCarton:    $('btn-add-carton'),
  btnCloseForm:    $('btn-close-form'),
  cartonList:      $('carton-list'),
  cartonEmptyState: $('carton-empty-state'),

  // KPIs
  kpiSpace:        $('kpi-space'),
  kpiWeight:       $('kpi-weight'),
  kpiCartons:      $('kpi-cartons'),
  kpiLayers:       $('kpi-layers'),
  kpiWeightTotal:  $('kpi-weight-total'),
  kpiScore:        $('kpi-score'),

  // Result actions
  btnOptimize:     $('btn-optimize'),
  btnPdfReport:    $('btn-pdf-report'),
  btnExportCsv:    $('btn-export-csv'),
  btnExportCsvR:   $('btn-export-csv-r'),
  unfitBanner:     $('unfit-banner'),
  unfitText:       $('unfit-text'),
  unfitHint:       $('unfit-hint'),

  // Manifest
  manifestBody:    $('manifest-body'),
  manifestSearch:  $('manifest-search'),
  manifestSort:    $('manifest-sort'),

  // Sequence
  sequenceList:    $('sequence-list'),
  btnToggleSeq:    $('btn-toggle-sequence'),

  // Viewer toggles
  btnWireframe:    $('btn-wireframe'),
  btnExplode:      $('btn-explode'),

  // Viewport
  vpPlaceholder:   $('vp-placeholder'),
  cartonTooltip:   $('carton-tooltip'),
  controlsOverlay: $('controls-overlay'),
  vpLegend:        $('vp-legend'),

  // Toast
  toast:           $('toast'),
};

/* ─────────────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  generateShipmentId();
  setDefaultDate();
  updateContainerSummary();
  bindEvents();

  // Init 3D renderer immediately and show empty container
  FCOS_RENDERER.init('viewport');
  state.rendererReady = true;
  const ph = document.getElementById('vp-placeholder');
  if (ph) ph.style.display = 'none';
  FCOS_RENDERER.showEmptyContainer(getContainerSpec());

  // Init FCL mode badge
  _updateModeBadge('FCL');

  showToast('Welcome to FCOS — start with Step 1 on the left.', 'info');
});

/* ─────────────────────────────────────────────────────────────
   SHIPMENT
───────────────────────────────────────────────────────────── */
function generateShipmentId() {
  const ts  = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 5).toUpperCase();
  const id  = `FCOS-${ts}-${rnd}`;
  els.shipmentId.value = id;
  els.headerShipmentId.textContent = id;
}

function setDefaultDate() {
  els.dispatchDate.value = new Date().toISOString().split('T')[0];
}

/* ─────────────────────────────────────────────────────────────
   CONTAINER SPEC
───────────────────────────────────────────────────────────── */
let selectedContainerType = '40ft';

function getContainerSpec() {
  const presets = FCOS_PACKER.CONTAINER_PRESETS;
  const type = selectedContainerType;
  if (type !== 'custom' && presets[type]) {
    return {
      type,
      label: document.querySelector(`.container-opt[data-type="${type}"] .copt-name`)?.textContent || type,
      ...presets[type],
      maxPayload: parseInt(els.maxPayload.value) || presets[type].maxPayload,
    };
  }
  return {
    type: 'custom', label: 'Custom',
    length:     toMM(parseFloat(els.customL.value) || 12032),
    width:      toMM(parseFloat(els.customW.value) || 2352),
    height:     toMM(parseFloat(els.customH.value) || 2393),
    maxPayload: parseInt(els.maxPayload.value) || 28000,
  };
}

function updateContainerSummary() {
  const spec = getContainerSpec();
  const vol  = (spec.length * spec.width * spec.height / 1e9).toFixed(2);
  els.csVolume.textContent  = `${vol} m³`;
  els.csPayload.textContent = `${spec.maxPayload.toLocaleString()} kg`;
  // Refresh empty container when spec changes
  if (state.rendererReady) {
    FCOS_RENDERER.showEmptyContainer(spec);
  }
}

/* ─────────────────────────────────────────────────────────────
   FCL / LCL MODE
───────────────────────────────────────────────────────────── */
let _shipmentMode = 'FCL';

function setShipmentMode(mode) {
  _shipmentMode = mode;
  document.getElementById('modeFCL')?.classList.toggle('active', mode === 'FCL');
  document.getElementById('modeLCL')?.classList.toggle('active', mode === 'LCL');
  const note = document.getElementById('lcl-note');
  if (note) note.classList.toggle('hidden', mode !== 'LCL');
  _updateModeBadge(mode);
}

function _updateModeBadge(mode) {
  const badge = document.getElementById('modeBadge');
  if (!badge) return;
  badge.textContent = mode;
  badge.className   = `mode-badge ${mode.toLowerCase()}`;
}

function getShipmentMode() { return _shipmentMode; }

/* ─────────────────────────────────────────────────────────────
   DOOR TOGGLE
───────────────────────────────────────────────────────────── */
function toggleDoor() {
  if (state.rendererReady) FCOS_RENDERER.toggleDoor();
}



/* ─────────────────────────────────────────────────────────────
   UNIT SYSTEM  (mm ↔ cm)
───────────────────────────────────────────────────────────── */
function toMM(val) {
  return state.unit === 'cm' ? val * 10 : val;
}
function fromMM(val) {
  return state.unit === 'cm' ? val / 10 : val;
}
function unitLabel() { return state.unit; }

function setUnit(unit) {
  state.unit = unit;
  // Update all unit hint spans
  document.querySelectorAll('.unit-hint-form').forEach(el => el.textContent = unit);
  document.querySelectorAll('.unit-hint').forEach(el => el.textContent = unit);
  // Convert carton form values if they have content
  ['carton-l', 'carton-w', 'carton-h'].forEach(id => {
    const el = $(id);
    if (el.value) {
      const mmVal = unit === 'cm'
        ? parseFloat(el.value) * 10   // was mm, now showing cm: divide
        : parseFloat(el.value) / 10;  // was cm, now showing mm: multiply
      el.value = unit === 'cm'
        ? (parseFloat(el.value) / 10).toFixed(1)
        : (parseFloat(el.value) * 10).toFixed(0);
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   STEPPER NAVIGATION
───────────────────────────────────────────────────────────── */
function goToStep(step) {
  const prev = state.currentStep;
  if (prev === step) return;

  const goingBack = step < prev;

  // Animate outgoing page
  const outgoing = $(`page-${prev}`);
  if (outgoing) {
    if (goingBack) {
      outgoing.classList.add('slide-right');
    } else {
      outgoing.classList.add('slide-left');
    }
    outgoing.classList.remove('active');
  }

  state.currentStep = step;

  // Show incoming page (offset from opposite direction first, then animate in)
  const incoming = $(`page-${step}`);
  if (incoming) {
    incoming.classList.remove('active', 'slide-left', 'slide-right');
    incoming.classList.add(goingBack ? 'slide-left' : 'slide-right');
    // Force reflow so the initial offset is applied before transition
    incoming.getBoundingClientRect();
    incoming.classList.remove('slide-left', 'slide-right');
    incoming.classList.add('active');
  }

  // Clean up other pages
  for (let i = 1; i <= 3; i++) {
    if (i === prev || i === step) continue;
    const pg = $(`page-${i}`);
    if (!pg) continue;
    pg.classList.remove('active', 'slide-left', 'slide-right');
  }

  // Update stepper circles
  for (let i = 1; i <= 3; i++) {
    const stepEl = $(`step-tab-${i}`);
    if (!stepEl) continue;
    stepEl.classList.remove('active', 'done');
    if (i < step) stepEl.classList.add('done');
    else if (i === step) stepEl.classList.add('active');
  }

  if (step === 3) updateKPIPlaceholders();
}

function updateKPIPlaceholders() {
  // Show neutral state if no result yet
  if (!state.lastResult) {
    ['kpi-space','kpi-weight','kpi-cartons','kpi-layers','kpi-weight-total','kpi-score'].forEach(id => {
      const card = $(id);
      if (card) card.querySelector('.kpi-val').textContent = '—';
    });
  }
}

/* ─────────────────────────────────────────────────────────────
   CARTON FORM
───────────────────────────────────────────────────────────── */
function openCartonForm(prefill = null) {
  els.cartonFormCard.classList.add('open');
  els.btnAddCarton.style.display = 'none';

  if (prefill) {
    state.editingId = prefill.id || null;
    els.cfcTitle.textContent = prefill.id ? 'Edit carton' : 'New carton';
    els.skuInput.value       = prefill.sku   || '';
    els.cartonL.value        = fromMM(prefill.l || 0);
    els.cartonW.value        = fromMM(prefill.w || 0);
    els.cartonH.value        = fromMM(prefill.h || 0);
    els.cartonWeight.value   = prefill.weight || '';
    els.cartonQty.value      = prefill.qty    || 1;
    els.cartonRotation.value = prefill.rotation || 'all';
    els.cartonColor.value    = prefill.color  || FCOS_PACKER.nextAutoColor();
    els.btnSaveCarton.textContent = prefill.id ? 'Update carton' : 'Add carton';
  } else {
    state.editingId = null;
    clearCartonForm();
    els.cartonColor.value    = FCOS_PACKER.nextAutoColor();
    els.cfcTitle.textContent = 'New carton';
    els.btnSaveCarton.textContent = 'Add carton';
  }

  // Focus SKU field
  setTimeout(() => els.skuInput.focus(), 50);
}

function closeCartonForm() {
  els.cartonFormCard.classList.remove('open');
  els.btnAddCarton.style.display = '';
  state.editingId = null;
  clearCartonForm();
}

function clearCartonForm() {
  els.skuInput.value       = '';
  els.cartonL.value        = '';
  els.cartonW.value        = '';
  els.cartonH.value        = '';
  els.cartonWeight.value   = '';
  els.cartonQty.value      = '1';
  els.cartonRotation.value = 'all';
}

function saveCarton() {
  const sku = els.skuInput.value.trim();
  const l   = toMM(parseFloat(els.cartonL.value));
  const w   = toMM(parseFloat(els.cartonW.value));
  const h   = toMM(parseFloat(els.cartonH.value));
  const wt  = parseFloat(els.cartonWeight.value);
  const qty = parseInt(els.cartonQty.value);

  if (!sku)       return showToast('Enter a SKU or name for this carton.', 'error');
  if (!l||!w||!h) return showToast('All three dimensions are required.', 'error');
  if (!qty||qty<1) return showToast('Quantity must be at least 1.', 'error');
  const weight = isNaN(wt) || wt < 0 ? 0 : wt;

  // Check for duplicate SKU when adding new
  if (!state.editingId && state.cartons.find(c => c.sku === sku)) {
    return showToast(`"${sku}" already exists. Use a different name or edit it.`, 'error');
  }

  const carton = {
    id:       state.editingId || `c_${Date.now()}`,
    sku, l, w, h,
    weight, qty,
    rotation: els.cartonRotation.value,
    color:    els.cartonColor.value,
  };

  if (state.editingId) {
    const idx = state.cartons.findIndex(c => c.id === state.editingId);
    if (idx >= 0) state.cartons[idx] = carton;
    showToast(`${sku} updated.`, 'success');
  } else {
    state.cartons.push(carton);
    showToast(`${sku} × ${qty} added.`, 'success');
  }

  closeCartonForm();
  renderCartonList();
}

function deleteCarton(id) {
  const c = state.cartons.find(c => c.id === id);
  state.cartons = state.cartons.filter(c => c.id !== id);
  renderCartonList();
  showToast(`${c?.sku || 'Carton'} removed.`, 'info');
}

function applyTemplate(tplKey) {
  const tpl = TEMPLATES[tplKey];
  if (!tpl) return;
  openCartonForm({
    sku:      '',
    l: tpl.l, w: tpl.w, h: tpl.h,
    weight:   tpl.weight,
    qty:      1,
    rotation: 'all',
    color:    FCOS_PACKER.nextAutoColor(),
  });
  // Set display values based on unit
  els.cartonL.value = fromMM(tpl.l);
  els.cartonW.value = fromMM(tpl.w);
  els.cartonH.value = fromMM(tpl.h);
  els.cfcTitle.textContent = `New ${tpl.label}`;
  els.skuInput.focus();
}

/* ─────────────────────────────────────────────────────────────
   RENDER CARTON LIST
───────────────────────────────────────────────────────────── */
function renderCartonList() {
  document.querySelectorAll('.carton-item').forEach(el => el.remove());

  if (!state.cartons.length) {
    els.cartonEmptyState.style.display = '';
    return;
  }
  els.cartonEmptyState.style.display = 'none';

  for (const c of state.cartons) {
    const item = document.createElement('div');
    item.className = 'carton-item';
    const dimDisp = state.unit === 'cm'
      ? `${c.l/10}×${c.w/10}×${c.h/10} cm`
      : `${c.l}×${c.w}×${c.h} mm`;
    item.innerHTML = `
      <div class="ci-dot" style="background:${c.color}"></div>
      <div class="ci-info">
        <div class="ci-sku">${c.sku}</div>
        <div class="ci-dims">${dimDisp} · ${c.weight} kg</div>
      </div>
      <span class="ci-qty">×${c.qty}</span>
      <div class="ci-actions">
        <button class="ci-btn" data-id="${c.id}" data-action="edit" title="Edit">✎</button>
        <button class="ci-btn del" data-id="${c.id}" data-action="del" title="Remove">✕</button>
      </div>
    `;
    els.cartonList.appendChild(item);
  }

  document.querySelectorAll('.ci-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === 'edit') {
        const c = state.cartons.find(c => c.id === id);
        if (c) openCartonForm(c);
      } else {
        deleteCarton(id);
      }
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   OPTIMIZE
───────────────────────────────────────────────────────────── */
function runOptimize() {
  if (!state.cartons.length) {
    goToStep(2);
    return showToast('Add at least one carton type first.', 'error');
  }

  els.btnOptimize.disabled = true;
  els.btnOptimize.textContent = 'Optimizing…';

  setTimeout(() => {
    try {
      const spec   = getContainerSpec();
      const result = FCOS_PACKER.packContainer(state.cartons, spec);

      // LCL: cap packed items to 60% volume
      if (_shipmentMode === 'LCL') {
        const maxVol = spec.length * spec.width * spec.height * 0.60;
        let cumVol = 0;
        result.packed = result.packed.filter(p => {
          cumVol += p.l * p.w * p.h;
          if (cumVol <= maxVol) return true;
          result.unpacked.push({ ...p, reason: 'LCL 60% volume cap' });
          return false;
        });
      }

      const seq    = FCOS_PACKER.generateLoadingSequence(result.packed, result.containerLength);
      state.lastResult  = result;
      state.lastSequence = seq;

      // Init / render 3D
      if (!state.rendererReady) {
        FCOS_RENDERER.init('viewport');
        state.rendererReady = true;
        showControlsHint();
      }
      els.vpPlaceholder.style.display = 'none';
      FCOS_RENDERER.renderPacked(result, spec);

      // Show animation bar
      const animBar = document.getElementById('anim-bar');
      if (animBar) animBar.classList.add('visible');
      // Reset speed buttons to 1×
      document.querySelectorAll('.anim-speed-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.speed === '1');
      });

      updateKPIs(result);
      renderManifest();
      renderSequence(seq);
      renderLegend(result.packed);

      // Unfit banner
      if (result.unpacked.length > 0) {
        els.unfitBanner.classList.remove('hidden');
        els.unfitText.textContent = `${result.unpacked.length} carton${result.unpacked.length > 1 ? 's' : ''} couldn't fit.`;
        els.unfitHint.textContent = 'Try a larger container or split the shipment.';
        showToast(`${result.packed.length} packed, ${result.unpacked.length} didn't fit.`, 'info');
      } else {
        els.unfitBanner.classList.add('hidden');
        showToast(`All ${result.packed.length} cartons packed. Score: ${result.optScore}/100 ✓`, 'success');
      }
    } catch (err) {
      console.error(err);
      showToast('Optimization failed: ' + err.message, 'error');
    } finally {
      els.btnOptimize.disabled = false;
      els.btnOptimize.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1L9.5 5.5H14L10.5 8.5L12 13L7.5 10.5L3 13L4.5 8.5L1 5.5H5.5L7.5 1Z" stroke="currentColor" stroke-width="1.4" fill="currentColor" fill-opacity="0.15"/></svg>
        Run optimization
      `;
    }
  }, 40);
}

/* ─────────────────────────────────────────────────────────────
   KPIs
───────────────────────────────────────────────────────────── */
function updateKPIs(result) {
  const sp = (result.spaceUtilisation  * 100).toFixed(1);
  const wp = (result.weightUtilisation * 100).toFixed(1);

  setKPI('kpi-space',        `${sp}%`,   els.kpiSpace);
  setKPI('kpi-weight',       `${wp}%`,   els.kpiWeight);
  setKPI('kpi-cartons',      `${result.packed.length}`, els.kpiCartons);
  setKPI('kpi-layers',       `${result.layers.length}`, els.kpiLayers);
  setKPI('kpi-weight-total', `${result.totalWeight.toFixed(0)} kg`, els.kpiWeightTotal);
  setKPI('kpi-score',        `${result.optScore}`, els.kpiScore);

  // Progress bars
  const spBar = els.kpiSpace?.querySelector('.kpi-prog-fill');
  const wpBar = els.kpiWeight?.querySelector('.kpi-prog-fill');
  if (spBar) spBar.style.width = sp + '%';
  if (wpBar) wpBar.style.width = wp + '%';
}

function setKPI(id, value, el) {
  const card = el || $(id);
  if (!card) return;
  const vEl = card.querySelector('.kpi-val');
  if (vEl) vEl.textContent = value;
}

/* ─────────────────────────────────────────────────────────────
   MANIFEST
───────────────────────────────────────────────────────────── */
function renderManifest() {
  const result = state.lastResult;
  if (!result?.packed.length) return;

  const search = els.manifestSearch.value.toLowerCase();
  const sort   = els.manifestSort.value;
  let rows = [...result.packed];
  if (search) rows = rows.filter(r =>
    r.sku.toLowerCase().includes(search) ||
    String(r.cartonNumber).includes(search)
  );
  if (sort === 'sku')    rows.sort((a,b) => a.sku.localeCompare(b.sku));
  if (sort === 'weight') rows.sort((a,b) => b.weight - a.weight);
  if (sort === 'layer')  rows.sort((a,b) => (a.cartonNumber||0) - (b.cartonNumber||0));

  els.manifestBody.innerHTML = '';
  if (!rows.length) {
    els.manifestBody.innerHTML = '<tr><td colspan="6" class="manifest-empty">No matches.</td></tr>';
    return;
  }
  rows.forEach((item) => {
    const layer = item.layerNumber || (Math.floor(item.y/500)+1);
    const cNum  = item.cartonNumber || '—';
    const tr = document.createElement('tr');
    tr.dataset.instanceId = item.instanceId;
    tr.innerHTML = `
      <td class="carton-num-cell">#${cNum}</td>
      <td>
        <div class="manifest-sku-wrap">
          <span class="manifest-dot" style="background:${item.color}"></span>
          ${item.sku}
        </div>
        <div class="manifest-layer-badge">Layer ${layer}</div>
      </td>
      <td class="manifest-pos-cell">${Math.round(item.x)},${Math.round(item.y)},${Math.round(item.z)}</td>
      <td>${layer}</td>
      <td>${item.weight}kg</td>
      <td>${item.rotated?'↺':'—'}</td>
    `;
    tr.addEventListener('click', () => {
      document.querySelectorAll('#manifest-body tr').forEach(r => r.classList.remove('active-row'));
      tr.classList.add('active-row');
      FCOS_RENDERER.selectCarton(item.instanceId);
      highlightSequenceStep(item.instanceId);
      showCartonLocationInfo(item);
    });
    els.manifestBody.appendChild(tr);
  });
}

/* ─────────────────────────────────────────────────────────────
   CARTON LOCATION INFO PANEL
───────────────────────────────────────────────────────────── */
function showCartonLocationInfo(item) {
  const layer  = item.layerNumber || (Math.floor(item.y/500)+1);
  const cNum   = item.cartonNumber || '—';
  const posInLayer = item.positionInLayer || '—';

  // Build human-readable location
  const CL = state.lastResult.containerLength || 12032;
  const depthFrac = item.x / CL;
  const depthLabel = depthFrac < 0.33 ? 'Rear' : depthFrac < 0.66 ? 'Middle' : 'Front';
  const sideLabel  = item.z < CL * 0.08 ? 'Left' : item.z > CL * 0.16 ? 'Right' : 'Centre';
  const locationStr = `${depthLabel} · ${sideLabel}`;

  let infoEl = document.getElementById('carton-location-info');
  if (!infoEl) {
    infoEl = document.createElement('div');
    infoEl.id = 'carton-location-info';
    infoEl.className = 'carton-location-info';
    // Insert after manifest table
    const manifestWrap = document.querySelector('.manifest-wrap');
    if (manifestWrap && manifestWrap.parentNode) {
      manifestWrap.parentNode.insertBefore(infoEl, manifestWrap.nextSibling);
    }
  }
  infoEl.innerHTML = `
    <div class="cli-header">
      <span class="cli-carton-badge">#${cNum}</span>
      <span class="cli-sku">${item.sku}</span>
      <button class="cli-close" onclick="clearCartonLocationInfo()">✕</button>
    </div>
    <div class="cli-grid">
      <div class="cli-item">
        <div class="cli-lbl">Layer</div>
        <div class="cli-val">Layer ${layer}</div>
      </div>
      <div class="cli-item">
        <div class="cli-lbl">Location</div>
        <div class="cli-val">${locationStr}</div>
      </div>
      <div class="cli-item">
        <div class="cli-lbl">Weight</div>
        <div class="cli-val">${item.weight} kg</div>
      </div>
      <div class="cli-item">
        <div class="cli-lbl">Coords (mm)</div>
        <div class="cli-val mono">${Math.round(item.x)}, ${Math.round(item.y)}, ${Math.round(item.z)}</div>
      </div>
    </div>
  `;
  infoEl.classList.add('visible');
}

function clearCartonLocationInfo() {
  const infoEl = document.getElementById('carton-location-info');
  if (infoEl) infoEl.classList.remove('visible');
}
window.clearCartonLocationInfo = clearCartonLocationInfo;

/* ─────────────────────────────────────────────────────────────
   SEQUENCE
───────────────────────────────────────────────────────────── */
function renderSequence(sequence) {
  els.sequenceList.innerHTML = '';
  if (!sequence.length) {
    els.sequenceList.innerHTML = '<div class="seq-empty">No sequence available.</div>';
    return;
  }
  for (const step of sequence) {
    // Find matching packed item for carton/layer numbers
    const packedItem = state.lastResult?.packed.find(p => p.instanceId === step.instanceId);
    const cNum  = packedItem?.cartonNumber || step.step;
    const layer = packedItem?.layerNumber  || step.layer || 1;

    const div = document.createElement('div');
    div.className = 'seq-step';
    div.dataset.instanceId = step.instanceId || '';
    div.dataset.sku  = step.sku;
    div.dataset.step = step.step;
    div.innerHTML = `
      <div class="seq-num">#${cNum}</div>
      <div class="seq-content">
        <div class="seq-sku-row">
          <span class="seq-sku">${step.sku}</span>
          <span class="seq-layer-chip">Layer ${layer}</span>
        </div>
        <div class="seq-action">${step.action}</div>
        <div class="seq-pos">${step.pos}</div>
      </div>
    `;
    div.addEventListener('click', () => {
      document.querySelectorAll('.seq-step').forEach(s => s.classList.remove('highlight'));
      div.classList.add('highlight');
      if (packedItem) {
        FCOS_RENDERER.selectCarton(packedItem.instanceId);
        highlightManifestRow(packedItem.instanceId);
        showCartonLocationInfo(packedItem);
      }
    });
    els.sequenceList.appendChild(div);
  }
}

function highlightSequenceStep(instanceId) {
  const item = state.lastResult?.packed.find(p => p.instanceId === instanceId);
  if (!item) return;
  document.querySelectorAll('.seq-step').forEach(s => {
    s.classList.toggle('highlight', s.dataset.instanceId === instanceId);
  });
  const el = document.querySelector(`.seq-step[data-instance-id="${instanceId}"]`) ||
             document.querySelector(`.seq-step[data-sku="${item.sku}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function highlightManifestRow(instanceId) {
  document.querySelectorAll('#manifest-body tr').forEach(r => {
    r.classList.toggle('active-row', r.dataset.instanceId === instanceId);
  });
}

/* ─────────────────────────────────────────────────────────────
   LEGEND
───────────────────────────────────────────────────────────── */
function renderLegend(packed) {
  const seen = new Map();
  for (const item of packed) {
    if (!seen.has(item.sku)) seen.set(item.sku, item.color);
  }
  els.vpLegend.innerHTML = '';
  for (const [sku, color] of seen) {
    const div = document.createElement('div');
    div.className = 'legend-item';
    div.innerHTML = `<div class="legend-dot" style="background:${color}"></div><span>${sku}</span>`;
    els.vpLegend.appendChild(div);
  }
  els.vpLegend.classList.toggle('hidden', !seen.size);
}

/* ─────────────────────────────────────────────────────────────
   CONTROLS HINT OVERLAY
───────────────────────────────────────────────────────────── */
function showControlsHint() {
  const el = els.controlsOverlay;
  el.classList.remove('hidden', 'fade-out');
  setTimeout(() => el.classList.add('fade-out'), 3000);
  setTimeout(() => el.classList.add('hidden'), 3500);
}

/* ─────────────────────────────────────────────────────────────
   PDF EXPORT
───────────────────────────────────────────────────────────── */
function exportPdf() {
  if (!state.lastResult) return showToast('Run optimization first.', 'error');
  try {
    FCOS_REPORT.generateReport(
      {
        id:             els.shipmentId.value,
        customer:       els.customerName.value || 'N/A',
        destination:    els.destination.value  || 'N/A',
        dispatchDate:   els.dispatchDate.value  || 'N/A',
        freightManager: els.freightManager.value || 'N/A',
      },
      getContainerSpec(),
      state.lastResult,
      state.lastSequence || []
    );
    showToast('PDF report downloaded.', 'success');
  } catch (err) {
    showToast('PDF failed: ' + err.message, 'error');
  }
}

/* ─────────────────────────────────────────────────────────────
   CSV EXPORT
───────────────────────────────────────────────────────────── */
function exportCsv() {
  if (!state.lastResult?.packed.length) return showToast('No data to export.', 'error');
  const headers = ['#','SKU','X','Y','Z','L','H','W','Layer','Weight_kg','Rotated'];
  const rows = state.lastResult.packed.map((p,i) => [
    i+1, p.sku,
    Math.round(p.x), Math.round(p.y), Math.round(p.z),
    Math.round(p.l), Math.round(p.h), Math.round(p.w),
    Math.floor(p.y/500)+1, p.weight, p.rotated?'Yes':'No',
  ]);
  const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `FCOS_Manifest_${els.shipmentId.value}.csv` });
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported.', 'success');
}

/* ─────────────────────────────────────────────────────────────
   TOAST
───────────────────────────────────────────────────────────── */
let _toastTimer = null;
function showToast(msg, type = 'info') {
  const el = els.toast;
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type} show`;
  if (_toastTimer) clearTimeout(_toastTimer);
  const dur = type === 'error' ? 5000 : 3000;
  _toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

/* ─────────────────────────────────────────────────────────────
   EVENT BINDINGS
───────────────────────────────────────────────────────────── */
function bindEvents() {

  // ── Stepper tab clicks ───────────────────────────────
  document.querySelectorAll('.step[data-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = parseInt(btn.dataset.step);
      // Only allow going back; forward requires completing steps
      if (step < state.currentStep) goToStep(step);
      else if (step === 2 && state.currentStep === 1) goToStep(2);
      else if (step === 3) goToStep(3);
    });
  });

  // ── Step navigation buttons ───────────────────────────
  $('btn-next-1').addEventListener('click', () => goToStep(2));
  $('btn-next-2').addEventListener('click', () => goToStep(3));
  $('btn-back-2').addEventListener('click', () => goToStep(1));
  $('btn-back-3').addEventListener('click', () => goToStep(2));

  // ── Container type grid ───────────────────────────────
  document.querySelectorAll('.container-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.container-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedContainerType = btn.dataset.type;
      const isCustom = selectedContainerType === 'custom';
      els.customDimsWrap.classList.toggle('hidden', !isCustom);
      updateContainerSummary();
    });
  });

  // Update container summary when payload changes
  els.maxPayload.addEventListener('input', updateContainerSummary);
  ['custom-l','custom-w','custom-h'].forEach(id => {
    $(id)?.addEventListener('input', updateContainerSummary);
  });

  // ── Unit toggle ───────────────────────────────────────
  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setUnit(btn.dataset.unit);
    });
  });

  // ── Carton form ───────────────────────────────────────
  els.btnAddCarton.addEventListener('click', () => openCartonForm());
  els.btnCloseForm.addEventListener('click', closeCartonForm);
  els.btnSaveCarton.addEventListener('click', saveCarton);
  els.btnAutoColor.addEventListener('click', () => {
    els.cartonColor.value = FCOS_PACKER.nextAutoColor();
  });

  // ── Templates ─────────────────────────────────────────
  document.querySelectorAll('.tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => applyTemplate(btn.dataset.tpl));
  });

  // ── Keyboard shortcuts ────────────────────────────────
  document.addEventListener('keydown', e => {
    // Enter in carton form → save
    if (e.key === 'Enter' && els.cartonFormCard.classList.contains('open')) {
      const tag = document.activeElement.tagName;
      if (tag !== 'SELECT' && tag !== 'BUTTON') {
        e.preventDefault();
        saveCarton();
      }
    }
    // Escape → close form
    if (e.key === 'Escape' && els.cartonFormCard.classList.contains('open')) {
      closeCartonForm();
    }
  });

  // ── Optimize & exports ────────────────────────────────
  els.btnOptimize.addEventListener('click', runOptimize);
  els.btnPdfReport.addEventListener('click', exportPdf);
  els.btnExportCsv.addEventListener('click', exportCsv);
  els.btnExportCsvR?.addEventListener('click', exportCsv);

  // ── Manifest ──────────────────────────────────────────
  els.manifestSearch.addEventListener('input', renderManifest);
  els.manifestSort.addEventListener('change', renderManifest);

  els.btnToggleSeq?.addEventListener('click', () => {
    const isCollapsed = els.sequenceList.classList.toggle('collapsed');
    els.btnToggleSeq.textContent = isCollapsed ? 'View sequence' : 'Hide sequence';
    els.btnToggleSeq.classList.toggle('active', !isCollapsed);
  });

  // ── 3D view buttons ───────────────────────────────────
  document.querySelectorAll('.vp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.rendererReady) return;
      FCOS_RENDERER.setCameraView(btn.dataset.view);
    });
  });

  // ── Wireframe toggle ──────────────────────────────────
  els.btnWireframe.addEventListener('click', () => {
    els.btnWireframe.classList.toggle('active');
    if (state.rendererReady) {
      FCOS_RENDERER.toggleWireframe(els.btnWireframe.classList.contains('active'));
    }
  });

  // ── Explode toggle ────────────────────────────────────
  els.btnExplode.addEventListener('click', () => {
    els.btnExplode.classList.toggle('active');
    if (state.rendererReady) {
      FCOS_RENDERER.toggleExplode(els.btnExplode.classList.contains('active'));
    }
  });

  // ── Animation play/pause ──────────────────────────────
  $('btn-anim-playpause')?.addEventListener('click', () => {
    if (state.rendererReady) FCOS_RENDERER.playPauseAnim();
  });

  // ── Animation speed buttons ───────────────────────────
  document.querySelectorAll('.anim-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.rendererReady) FCOS_RENDERER.setAnimSpeed(parseFloat(btn.dataset.speed));
    });
  });
}

/* ── Global exports for inline onclick handlers ── */
window.setShipmentMode = setShipmentMode;
window.toggleDoor      = toggleDoor;
