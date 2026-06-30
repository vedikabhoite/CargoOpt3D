/**
 * packer.js — FCOS Optimization Engine
 *
 * Algorithm: Extreme Point Bin Packing with Knapsack Selection
 *
 * Coordinate system (internal to packer):
 *   X = depth axis.  X=0 is the BACK WALL, X=CL is the DOOR.
 *   Y = height.      Y=0 is the floor.
 *   Z = width.       Z=0 is left wall, Z=CW is right wall.
 *
 * This means the extreme-point sort (X ascending, Y ascending, Z ascending)
 * naturally fills from the back wall first, fully packing each depth-slice
 * before advancing toward the door — exactly how real freight is loaded.
 *
 * The renderer flips X back for display:  draw_x = CL - item.x - item.l
 * so the door appears at the front in the 3D view.
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const MM_TOLERANCE = 1; // floating-point gap tolerance (mm)

/* ─────────────────────────────────────────────────────────────
   CONTAINER PRESETS  (all dimensions in mm)
───────────────────────────────────────────────────────────── */
const CONTAINER_PRESETS = {
  '20ft':  { length: 5898,  width: 2352, height: 2393, maxPayload: 21727 },
  '40ft':  { length: 12032, width: 2352, height: 2393, maxPayload: 26750 },
  '40hc':  { length: 12032, width: 2352, height: 2698, maxPayload: 26330 },
  '45hc':  { length: 13556, width: 2352, height: 2698, maxPayload: 27600 },
  'custom': null,
};

/* ─────────────────────────────────────────────────────────────
   ORIENTATION GENERATOR
───────────────────────────────────────────────────────────── */
function getOrientations(l, w, h, constraint) {
  const all = [
    [l, w, h], [l, h, w],
    [w, l, h], [w, h, l],
    [h, l, w], [h, w, l],
  ];

  const seen = new Set();
  const unique = all.filter(([ol, ow, oh]) => {
    const key = `${ol},${ow},${oh}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (constraint === 'fixed')   return [[l, w, h]];
  if (constraint === 'upright') return unique.filter(([ol, ow, oh]) => oh === h || ow === h);
  return unique;
}

/* ─────────────────────────────────────────────────────────────
   AABB COLLISION TEST
───────────────────────────────────────────────────────────── */
function overlaps(ax, ay, az, al, aw, ah, bx, by, bz, bl, bw, bh) {
  return (
    ax < bx + bl - MM_TOLERANCE && ax + al > bx + MM_TOLERANCE &&
    ay < by + bh - MM_TOLERANCE && ay + ah > by + MM_TOLERANCE &&
    az < bz + bw - MM_TOLERANCE && az + aw > bz + MM_TOLERANCE
  );
}

/* ─────────────────────────────────────────────────────────────
   EXTREME POINT GENERATOR
   X=0 is back wall → candidates grow toward X=CL (door).
───────────────────────────────────────────────────────────── */
function addExtremePoints(points, x, y, z, l, h, w, container) {
  const candidates = [
    [x + l, y,     z    ],   // next slot toward the door
    [x,     y + h, z    ],   // directly above
    [x,     y,     z + w],   // to the right
  ];

  for (const [cx, cy, cz] of candidates) {
    if (cx >= container.length - MM_TOLERANCE) continue;
    if (cy >= container.height - MM_TOLERANCE) continue;
    if (cz >= container.width  - MM_TOLERANCE) continue;

    const key = `${Math.round(cx)},${Math.round(cy)},${Math.round(cz)}`;
    if (!points.has(key)) points.set(key, [cx, cy, cz]);
  }
}

/* ─────────────────────────────────────────────────────────────
   SUPPORT CHECK
───────────────────────────────────────────────────────────── */
function hasSupport(x, y, z, l, h, w, placed) {
  if (y <= MM_TOLERANCE) return true;

  const baseArea = l * w;
  let supportedArea = 0;

  for (const p of placed) {
    const topY = p.y + p.h;
    if (Math.abs(topY - y) > MM_TOLERANCE) continue;

    const ix = Math.max(x, p.x);
    const iz = Math.max(z, p.z);
    const fx = Math.min(x + l, p.x + p.l);
    const fz = Math.min(z + w, p.z + p.w);

    if (fx > ix && fz > iz) supportedArea += (fx - ix) * (fz - iz);
  }

  return supportedArea / baseArea >= 0.5;
}

/* ─────────────────────────────────────────────────────────────
   MAIN PACK FUNCTION
───────────────────────────────────────────────────────────── */
function packContainer(cartons, container) {
  const { length: CL, width: CW, height: CH, maxPayload } = container;
  const containerVolume = CL * CW * CH;

  /* ── Expand qty into individual items ── */
  let items = [];
  for (const c of cartons) {
    for (let i = 0; i < c.qty; i++) {
      items.push({ ...c, instanceId: `${c.sku}_${i + 1}` });
    }
  }

  /* ── Sort: largest volume first, then lightest first ── */
  items.sort((a, b) => {
    const volA = a.l * a.w * a.h;
    const volB = b.l * b.w * b.h;
    if (volB !== volA) return volB - volA;
    return a.weight - b.weight;
  });

  /* ── Extreme point set — seed at back-wall corner (X=0, Y=0, Z=0) ── */
  const epSet = new Map();
  epSet.set('0,0,0', [0, 0, 0]);

  const placed   = [];
  const unpacked = [];
  let totalWeight = 0;

  /* ── Place each item ── */
  for (const item of items) {
    if (totalWeight + item.weight > maxPayload) {
      unpacked.push({ ...item, reason: 'Exceeds max payload' });
      continue;
    }

    const orientations = getOrientations(item.l, item.w, item.h, item.rotation);

    let bestPlacement = null;

    /*
     * Sort priority — fill the back cross-section as a solid block first:
     *   1. X ascending  — back wall (X=0) before door (X=CL): NEVER open a
     *                      new depth slice until current slice is fully packed
     *   2. Z ascending  — left column before right column within same depth
     *   3. Y ascending  — fill bottom before stacking (gravity)
     *
     * Result: cartons stack floor-to-ceiling at the back wall, column by
     * column across the width, then the whole pattern advances toward the door.
     */
    const sortedPoints = Array.from(epSet.values()).sort(
      ([ax, ay, az], [bx, by, bz]) =>
        ax !== bx ? ax - bx :
        az !== bz ? az - bz :
        ay - by
    );

    outer:
    for (const [px, py, pz] of sortedPoints) {
      for (const [ol, oh, ow] of orientations) {
        if (px + ol > CL + MM_TOLERANCE) continue;
        if (py + oh > CH + MM_TOLERANCE) continue;
        if (pz + ow > CW + MM_TOLERANCE) continue;

        let collides = false;
        for (const p of placed) {
          if (overlaps(px, py, pz, ol, ow, oh, p.x, p.y, p.z, p.l, p.w, p.h)) {
            collides = true;
            break;
          }
        }
        if (collides) continue;

        if (!hasSupport(px, py, pz, ol, oh, ow, placed)) continue;

        bestPlacement = {
          x: px, y: py, z: pz,
          l: ol, h: oh, w: ow,
          rotated: !(ol === item.l && oh === item.h && ow === item.w),
        };
        break outer;
      }
    }

    if (!bestPlacement) {
      unpacked.push({ ...item, reason: 'No fitting position found' });
      continue;
    }

    const { x, y, z, l, h, w, rotated } = bestPlacement;
    totalWeight += item.weight;

    placed.push({
      instanceId: item.instanceId,
      sku:    item.sku,
      color:  item.color,
      weight: item.weight,
      x, y, z, l, h, w, rotated,
    });

    const usedKey = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    epSet.delete(usedKey);
    addExtremePoints(epSet, x, y, z, l, h, w, container);
  }

  /* ── KPIs ── */
  const usedVolume       = placed.reduce((s, p) => s + p.l * p.h * p.w, 0);
  const emptyVolume      = containerVolume - usedVolume;
  const spaceUtilisation  = usedVolume / containerVolume;
  const weightUtilisation = totalWeight / maxPayload;
  const layerBands        = computeLayers(placed);
  const optScore          = Math.round((spaceUtilisation * 0.7 + weightUtilisation * 0.3) * 100);

  return {
    packed: placed,
    unpacked,
    containerVolume,
    usedVolume,
    emptyVolume,
    spaceUtilisation,
    weightUtilisation,
    totalWeight,
    maxPayload,
    layers: layerBands,
    optScore,
    containerLength: CL,   // passed to renderer so it can flip X for display
  };
}

/* ─────────────────────────────────────────────────────────────
   LAYER COMPUTATION + CARTON NUMBERING
   Assigns each placed item:
     .layerNumber  — which horizontal band it belongs to (1-based)
     .cartonNumber — unique global number, counting left-to-right
                     (Z ascending = left → right) within each layer,
                     layers ordered bottom to top (Y ascending)
───────────────────────────────────────────────────────────── */
function computeLayers(placed) {
  if (!placed.length) return [];

  const bandSize = 500;
  const maxH     = Math.max(...placed.map(p => p.y + p.h));
  const bands    = Math.ceil(maxH / bandSize);
  const layers   = [];

  // First pass: assign layerNumber to each item
  for (let i = 0; i < bands; i++) {
    const yMin  = i * bandSize;
    const yMax  = (i + 1) * bandSize;
    const items = placed.filter(p => p.y >= yMin - MM_TOLERANCE && p.y < yMax - MM_TOLERANCE);
    if (items.length) {
      items.forEach(p => { p.layerNumber = i + 1; });
      layers.push({ layer: i + 1, yMin, yMax, items });
    }
  }

  // Second pass: assign cartonNumber globally, left-to-right per layer
  // Sort by layer (Y asc), then Z asc (left→right), then X asc (back→front)
  const sorted = [...placed].sort((a, b) => {
    if (a.layerNumber !== b.layerNumber) return a.layerNumber - b.layerNumber;
    if (a.z !== b.z) return a.z - b.z;
    return a.x - b.x;
  });
  sorted.forEach((item, idx) => {
    item.cartonNumber = idx + 1;
  });

  return layers;
}

/* ─────────────────────────────────────────────────────────────
   LOADING SEQUENCE GENERATOR
   Items are already in back-to-front order (X ascending in packer
   coords = back wall first). We sort by X ascending, Y ascending,
   Z ascending so steps reflect true loading order.
───────────────────────────────────────────────────────────── */
function generateLoadingSequence(packed, containerLength) {
  const CL = containerLength || 12032; // fallback

  // Sort: bottom layer first, back wall first (low X = back in packer coords), left first
  const sorted = [...packed].sort((a, b) =>
    a.y !== b.y ? a.y - b.y :
    a.x !== b.x ? a.x - b.x :
    a.z - b.z
  );

  const steps = [];

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];

    // item.x is packer-coord (0=back). Convert to depth fraction for labels.
    const depthFrac = item.x / CL;
    const depthPos  = depthFrac < 0.33 ? 'Rear' : depthFrac < 0.66 ? 'Middle' : 'Front';
    const sidePos   = item.z < CL * 0.08 ? 'Left' : item.z > CL * 0.16 ? 'Right' : 'Centre';
    const yPos      = item.y < 300 ? 'Bottom' : item.y > 900 ? 'Top' : '';

    const posLabel = [yPos, depthPos, sidePos].filter(Boolean).join(' ');

    let action = `Place at ${posLabel}`;
    if (i > 0) {
      const prev = sorted[i - 1];
      const abovePrev =
        Math.abs(item.x - prev.x) < 50 &&
        Math.abs(item.z - prev.z) < 50 &&
        Math.abs(item.y - (prev.y + prev.h)) < 50;
      if (abovePrev) action = `Stack directly above ${prev.sku}`;
    }

    steps.push({
      step:         i + 1,
      instanceId:   item.instanceId,
      sku:          item.sku,
      cartonNumber: item.cartonNumber,
      action,
      pos:          `(${Math.round(item.x)}, ${Math.round(item.y)}, ${Math.round(item.z)})`,
      layer:        item.layerNumber || (Math.floor(item.y / 500) + 1),
      weight:       item.weight,
    });
  }

  return steps;
}

/* ─────────────────────────────────────────────────────────────
   AUTO COLOR PALETTE
───────────────────────────────────────────────────────────── */
const AUTO_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#06B6D4', '#F97316', '#84CC16', '#EC4899', '#14B8A6',
  '#6366F1', '#FBBF24', '#A3E635', '#FB7185', '#34D399',
];

let _colorIdx = 0;
function nextAutoColor()  { return AUTO_COLORS[(_colorIdx++) % AUTO_COLORS.length]; }
function resetColorIdx()  { _colorIdx = 0; }

/* ─────────────────────────────────────────────────────────────
   EXPORTS
───────────────────────────────────────────────────────────── */
window.FCOS_PACKER = {
  CONTAINER_PRESETS,
  packContainer,
  generateLoadingSequence,
  nextAutoColor,
  resetColorIdx,
};
