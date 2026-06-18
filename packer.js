

(function (global) {
  'use strict';

  /**
   * Build all distinct orientations for a box (l × w × h).
   * @param {number} l  original length
   * @param {number} w  original width
   * @param {number} h  original height
   * @param {number} rot  1 = fixed, 2 = keep-Z-up, 6 = all permutations
   * @returns {{ l, w, h }[]}
   */
  function getOrientations(l, w, h, rot) {
    if (rot === 1) return [{ l, w, h }];
    if (rot === 2) return [{ l, w, h }, { l: w, w: l, h }];

    const seen = new Set();
    const result = [];
    [[l,w,h],[l,h,w],[w,l,h],[w,h,l],[h,l,w],[h,w,l]].forEach(([a, b, c]) => {
      const key = [a, b, c].slice().sort().join(',');
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ l: a, w: b, h: c });
      }
    });
    return result;
  }

  /**
   * Pack a list of carton-type descriptors into a container.
   *
   * @param {number} cL  container length  (cm)
   * @param {number} cW  container width   (cm)
   * @param {number} cH  container height  (cm)
   * @param {number} maxWeight  max payload (kg); use Infinity to skip limit
   * @param {Array}  cartonTypes  array of { l, w, h, qty, wt, sku, rot, color, id }
   *
   * @returns {{ placements, totalWeight, totalItems }}
   *   placements: [{ x, y, z, l, w, h, item }]
   */
  function pack(cL, cW, cH, maxWeight, cartonTypes) {
    // Flatten carton types → individual item instances, largest-volume-first
    const items = [];
    for (const type of cartonTypes) {
      for (let i = 0; i < type.qty; i++) {
        items.push({ ...type });
      }
    }
    items.sort((a, b) => (b.l * b.w * b.h) - (a.l * a.w * a.h));

    // Extreme-point set — starts at the container origin
    let eps = [{ x: 0, y: 0, z: 0 }];
    const placements = [];
    let totalWeight = 0;

    for (const item of items) {
      // Respect weight limit (skip if wt = 0, i.e. unset)
      if (item.wt && totalWeight + item.wt > maxWeight) continue;

      const orientations = getOrientations(item.l, item.w, item.h, item.rot);
      let best = null;
      let bestScore = Infinity;

      for (const ep of eps) {
        for (const o of orientations) {
          const { l, w, h } = o;

          // Fits inside container?
          if (ep.x + l > cL + 0.01) continue;
          if (ep.y + h > cH + 0.01) continue;
          if (ep.z + w > cW + 0.01) continue;

          // Overlaps with any already-placed box?
          let overlaps = false;
          for (const p of placements) {
            if (
              ep.x < p.x + p.l && ep.x + l > p.x &&
              ep.y < p.y + p.h && ep.y + h > p.y &&
              ep.z < p.z + p.w && ep.z + w > p.z
            ) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) continue;

          // Score: gravity-first (low Y), then depth (low Z), then width (low X)
          const score = ep.y * 1e6 + ep.z * 1e3 + ep.x;
          if (score < bestScore) {
            bestScore = score;
            best = { x: ep.x, y: ep.y, z: ep.z, l, w, h, item, o };
          }
        }
      }

      if (!best) continue;

      const { x, y, z, l, w, h } = best;
      placements.push({ x, y, z, l, w, h, item });
      totalWeight += item.wt;

      // Add three new extreme points after each placement
      eps.push({ x: x + l, y,       z       });
      eps.push({ x,        y: y + h, z       });
      eps.push({ x,        y,        z: z + w });

      // Prune: remove points inside placed boxes or out-of-bounds
      const seen2 = new Set();
      eps = eps.filter(ep => {
        if (ep.x >= cL || ep.y >= cH || ep.z >= cW) return false;
        for (const p of placements) {
          if (
            ep.x >= p.x && ep.x < p.x + p.l &&
            ep.y >= p.y && ep.y < p.y + p.h &&
            ep.z >= p.z && ep.z < p.z + p.w
          ) return false;
        }
        const key = `${ep.x},${ep.y},${ep.z}`;
        if (seen2.has(key)) return false;
        seen2.add(key);
        return true;
      });
    }

    return {
      placements,
      totalWeight,
      totalItems: items.length,
    };
  }

  // Public API
  global.Packer = { pack };

})(window);
