/* Circle Packing – browser port of github.com/o1i2000/Circle-Packing-Genetic-Algorithm-
 * The original Processing (Java) sketch has been rewritten in JavaScript so every
 * algorithm runs live in the visitor's browser. Each algorithm runs in its own
 * Web Worker so the page stays responsive while the GA evolves.
 */

/* ---------------------------------------------------------------------------
 * CORE – the algorithms. This function is used on the main thread (to redraw
 * solutions) and is also stringified into a Web Worker.
 * ------------------------------------------------------------------------- */
function CPCore() {
  const CX = 250, CY = 250;
  const COS = new Float64Array(360), SIN = new Float64Array(360);
  for (let a = 0; a < 360; a++) { COS[a] = Math.cos(a * Math.PI / 180); SIN[a] = Math.sin(a * Math.PI / 180); }

  /* Ordered placement (Bunch.orderedPlace + Circle.computePosition).
   * The first circle goes in the centre. Each next circle tests 360 points
   * around every circle already placed, discards points that overlap, and takes
   * the free point closest to the centre.
   * Speed-ups that give the same result: compare squared distances, skip any
   * point no closer than the best found so far before testing overlap, and test
   * the last circle that blocked a point first. */
  function placeOrder(r) {
    const n = r.length, xs = new Int32Array(n), ys = new Int32Array(n);
    xs[0] = CX; ys[0] = CY;
    let lastHit = 0;
    for (let k = 1; k < n; k++) {
      const rk = r[k];
      let best = -1, bx = 0, by = 0;
      for (let i = 0; i < k; i++) {
        const rad = rk + r[i] + 1, xi = xs[i], yi = ys[i];
        for (let a = 0; a < 360; a++) {
          const px = xi + Math.trunc(COS[a] * rad);
          const py = yi + Math.trunc(SIN[a] * rad);
          const dxc = px - CX, dyc = py - CY, d = dxc * dxc + dyc * dyc;
          if (best >= 0 && d >= best) continue;           // could not improve
          // collision test (check last blocker first)
          let hit = false;
          if (lastHit < k) {
            const dx = px - xs[lastHit], dy = py - ys[lastHit], s = rk + r[lastHit];
            if (dx * dx + dy * dy < s * s) hit = true;
          }
          if (!hit) {
            for (let j = 0; j < k; j++) {
              const dx = px - xs[j], dy = py - ys[j], s = rk + r[j];
              if (dx * dx + dy * dy < s * s) { hit = true; lastHit = j; break; }
            }
          }
          if (!hit) { best = d; bx = px; by = py; }
        }
      }
      if (best >= 0) { xs[k] = bx; ys[k] = by; } else { xs[k] = 0; ys[k] = 0; }
    }
    let bound = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - CX, dy = ys[i] - CY;
      const d = r[i] + Math.sqrt(dx * dx + dy * dy);
      if (d >= bound) bound = d;
    }
    return { xs, ys, bound };
  }

  // Evaluate an ordering of circle ids (a genome)
  function evaluate(order, radii) {
    const r = new Array(order.length);
    for (let i = 0; i < order.length; i++) r[i] = radii[order[i]];
    return placeOrder(r);
  }

  // Shuffle used by the original Individual / RandomPlace
  function shuffle(a) {
    for (let i = 0; i < a.length; i++) {
      const j = Math.floor(Math.random() * a.length);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  const identity = n => Array.from({ length: n }, (_, i) => i);

  /* GreedyPlace: sort radii ascending and place in that order */
  function greedy(radii) {
    const order = identity(radii.length).sort((a, b) => radii[a] - radii[b]);
    return { order, bound: evaluate(order, radii).bound };
  }

  /* OrderedCrossover.doCrossover */
  function orderedCrossover(p1, p2) {
    const n = p1.length, child = new Array(n).fill(-1), used = new Uint8Array(n);
    const a = Math.floor(Math.random() * n), b = Math.floor(Math.random() * n);
    const s = Math.min(a, b), e = Math.max(a, b);
    for (let i = s; i <= e; i++) { child[i] = p1[i]; used[p1[i]] = 1; }
    let pos = (e + 1) % n;
    for (let i = 0; i < n; i++) {
      const g = p2[(i + e + 1) % n];
      if (!used[g]) { child[pos] = g; used[g] = 1; pos = (pos + 1) % n; }
    }
    return child;
  }

  /* Individual.mutate – swap two genes with probability mutRate */
  function mutate(g, mutRate) {
    if (Math.random() < mutRate) {
      const i = Math.floor(Math.random() * g.length), j = Math.floor(Math.random() * g.length);
      const t = g[i]; g[i] = g[j]; g[j] = t;
    }
  }

  /* Population.tournamentSelection */
  function tournament(pop, fit, size, pressure) {
    const picks = [];
    for (let i = 0; i < size; i++) picks.push(Math.floor(Math.random() * pop.length));
    if (Math.random() < pressure) {
      let bi = picks[0];
      for (const p of picks) if (fit[p] < fit[bi]) bi = p;
      return pop[bi];
    }
    return pop[picks[0]];
  }

  /* Worker message loop */
  if (typeof window === 'undefined' && typeof self !== 'undefined') {
    self.onmessage = (ev) => {
      const { algo, radii, params } = ev.data;
      const n = radii.length;
      const t0 = Date.now();
      let lastPost = 0;
      const post = (m) => self.postMessage(Object.assign({ algo, ms: Date.now() - t0 }, m));

      if (algo === 'greedy') {
        const g = greedy(radii);
        post({ type: 'done', bestOrder: g.order, best: g.bound, evals: 1, history: [[1, g.bound]] });
        return;
      }

      if (algo === 'random') {
        let best = Infinity, bestOrder = null, hist = [];
        for (let it = 1; it <= params.iterations; it++) {
          const order = shuffle(identity(n));
          const b = evaluate(order, radii).bound;
          if (b < best) { best = b; bestOrder = order; }
          hist.push([it, best]);
          const now = Date.now();
          if (now - lastPost > 60 || it === params.iterations) {
            lastPost = now;
            post({ type: it === params.iterations ? 'done' : 'progress', iter: it, total: params.iterations,
                   best, bestOrder, evals: it, history: hist });
            hist = [];
          }
        }
        return;
      }

      if (algo === 'ga') {
        const { popSize, generations, mutation, tournamentSize, pressure } = params;
        let pop = [], fit = [];
        let best = Infinity, bestOrder = null, evals = 0;
        const evalPop = () => {
          let sum = 0, genBest = Infinity;
          for (let i = 0; i < pop.length; i++) {
            const b = evaluate(pop[i], radii).bound; fit[i] = b; evals++; sum += b;
            if (b < genBest) genBest = b;
            if (b < best) { best = b; bestOrder = pop[i].slice(); }
          }
          return { mean: sum / pop.length, genBest };
        };
        for (let i = 0; i < popSize; i++) pop.push(shuffle(identity(n)));
        fit = new Array(popSize);
        let s = evalPop();
        let hist = [[evals, best, s.mean, s.genBest, 0]];
        for (let gen = 1; gen <= generations; gen++) {
          const pool = [];
          for (let i = 0; i < popSize; i++) pool.push(tournament(pop, fit, tournamentSize, pressure));
          const next = [];
          for (let i = 0; i < popSize; i++) {
            const a = pool[Math.floor(Math.random() * pool.length)];
            const b = pool[Math.floor(Math.random() * pool.length)];
            const child = orderedCrossover(a, b);
            mutate(child, mutation);
            next.push(child);
          }
          pop = next;
          s = evalPop();
          hist.push([evals, best, s.mean, s.genBest, gen]);
          const now = Date.now();
          if (now - lastPost > 60 || gen === generations) {
            lastPost = now;
            post({ type: gen === generations ? 'done' : 'progress', iter: gen, total: generations,
                   best, bestOrder, evals, history: hist });
            hist = [];
          }
        }
        if (generations === 0) post({ type: 'done', iter: 0, total: 0, best, bestOrder, evals, history: hist });
      }
    };
  }

  return { placeOrder, evaluate, greedy, orderedCrossover };
}

if (typeof module !== 'undefined') module.exports = CPCore;

/* ---------------------------------------------------------------------------
 * UI
 * ------------------------------------------------------------------------- */
if (typeof window !== 'undefined') (function () {
  const core = CPCore();

  // Test sets from the original sketch (comment = target boundary noted in the code)
  const DATASETS = {
    r1:   { radii: [10,12,15,20,21,30,30,30,50,40], target: '≈110' },
    r2:   { radii: [10,40,25,15,18], target: '≈90' },
    r3:   { radii: [10,34,10,55,30,14,70,14], target: '≈150' },
    r4:   { radii: [5,50,50,50,50,50,50], target: '≈173' },
    r5:   { radii: [10,34,10,55,30,14,70,14,50,16,23,76,34,10,12,15,16,11,48,20], target: '≈180' },
    t1:   { radii: [20,22,17,17,7,21,11,5,23,8], target: '≈63' },
    t2:   { radii: [8,14,8,15,11,17,21,16,6,18,24,13,20,10], target: '< 82 (best seen 67)' },
    t3:   { radii: [24,16,19,7,14,24,15,6,16,16,23,10,9,10,18,22,7,9,7,13,14,8,18,6,8], target: '< 100 (best seen 88)' },
    t4:   { radii: [6,12,20,6,14,19,9,20,10,13,12,14,23,17,16,19,15,10,12,18,21,6,20,17,13,20,17,6,21,15,12,9,14,20,23,16,23,9,23,18], target: '≈121' },
    t5:   { radii: [17,23,17,13,18,21,23,22,7,9,8,13,20,11,10,19,10,14,12,22,19,10,17,11,21,8,15,16,19,21,17,19,8,6,13,13,14,19,18,23,20,24,24,13,13,19,7,6,10,8,8,10,24,19,2], target: '< 160' },
    hard: { radii: [50,13,11,23,37,10,30,30,25,28,6,40,6,10,6,10,10,17,27,19,26,27,24,12,14,15,20], target: '—' },
    test1:{ radii: [10,20,30,40,50,60,70,80,90,100], target: '—' }
  };

  const ALGOS = ['greedy', 'random', 'ga'];
  const NAMES = { greedy: 'Greedy', random: 'Random search', ga: 'Genetic algorithm' };
  const $ = id => document.getElementById(id);

  let radii = DATASETS.r5.radii.slice();
  let workers = {};
  let state = {};
  const resetState = () => ALGOS.forEach(a => state[a] = { best: null, bestOrder: null, evals: 0, ms: 0, history: [], running: false, iter: 0, total: 0 });
  resetState();

  const workerURL = URL.createObjectURL(new Blob(['(' + CPCore.toString() + ')()'], { type: 'text/javascript' }));

  /* ---------- colours (follow the site's light / dark theme) ---------- */
  function colours() {
    const cs = getComputedStyle(document.body);
    const v = (n, f) => (cs.getPropertyValue(n).trim() || f);
    return {
      text: v('--cp-text', '#333'), muted: v('--cp-muted', '#6c757d'), grid: v('--cp-grid', '#e2e5e9'),
      circleFill: v('--cp-circle-fill', 'rgba(0,123,255,0.12)'), circleStroke: v('--cp-circle-stroke', '#2b6cb0'),
      first: v('--cp-first', 'rgba(240,120,40,0.30)'), bound: v('--cp-bound', '#e53e3e'),
      greedy: v('--cp-greedy', '#6c757d'), random: v('--cp-random', '#d69e2e'), ga: v('--cp-ga', '#2b6cb0'), mean: v('--cp-mean', 'rgba(43,108,176,0.35)')
    };
  }

  function fitCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* ---------- draw one packing ---------- */
  function drawPacking(algo) {
    const cv = $('cv-' + algo); const { ctx, w, h } = fitCanvas(cv); const c = colours();
    ctx.clearRect(0, 0, w, h);
    const s = state[algo];
    if (!s.bestOrder) {
      ctx.fillStyle = c.muted; ctx.font = '14px Arial'; ctx.textAlign = 'center';
      ctx.fillText(s.running ? 'Running…' : 'Press run to see a result', w / 2, h / 2);
      return;
    }
    const order = s.bestOrder;
    const r = order.map(i => radii[i]);
    const p = core.placeOrder(r);
    const scale = (Math.min(w, h) / 2 - 8) / p.bound;
    const tx = x => w / 2 + (x - 250) * scale, ty = y => h / 2 + (y - 250) * scale;
    // boundary
    ctx.setLineDash([6, 4]); ctx.strokeStyle = c.bound; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, p.bound * scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    // circles
    for (let k = 0; k < r.length; k++) {
      ctx.beginPath(); ctx.arc(tx(p.xs[k]), ty(p.ys[k]), r[k] * scale, 0, Math.PI * 2);
      ctx.fillStyle = k === 0 ? c.first : c.circleFill; ctx.fill();
      ctx.strokeStyle = c.circleStroke; ctx.lineWidth = 1; ctx.stroke();
      if (r[k] * scale > 7) {
        ctx.fillStyle = c.text; ctx.font = Math.max(9, Math.min(13, r[k] * scale * 0.6)) + 'px Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(order[k]), tx(p.xs[k]), ty(p.ys[k]));
      }
    }
  }

  /* ---------- convergence chart ---------- */
  function niceTicks(min, max, count) {
    const span = max - min || 1; const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= step0);
    const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
    return out;
  }
  function drawChart() {
    const cv = $('cv-chart'); const { ctx, w, h } = fitCanvas(cv); const c = colours();
    ctx.clearRect(0, 0, w, h);
    const series = [];
    if (state.ga.history.length) {
      if ($('show-mean').checked) series.push({ name: 'GA generation mean', color: c.mean, pts: state.ga.history.map(d => [d[0], d[2]]), width: 1.5 });
      series.push({ name: 'GA best so far', color: c.ga, pts: state.ga.history.map(d => [d[0], d[1]]), width: 2.5 });
    }
    if (state.random.history.length) series.push({ name: 'Random best so far', color: c.random, pts: state.random.history, width: 2.5 });
    const greedyVal = state.greedy.best;
    if (!series.length && greedyVal == null) {
      ctx.fillStyle = c.muted; ctx.font = '14px Arial'; ctx.textAlign = 'center';
      ctx.fillText('Convergence appears here while algorithms run', w / 2, h / 2); return;
    }
    let xmax = 1, ymin = Infinity, ymax = -Infinity;
    series.forEach(s => s.pts.forEach(([x, y]) => { xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }));
    if (greedyVal != null) { ymin = Math.min(ymin, greedyVal); ymax = Math.max(ymax, greedyVal); }
    const pad = (ymax - ymin) * 0.08 || 5; ymin -= pad; ymax += pad;
    const L = 52, R = 14, T = 14, B = 40; const pw = w - L - R, ph = h - T - B;
    const X = x => L + (x / xmax) * pw, Y = y => T + (1 - (y - ymin) / (ymax - ymin)) * ph;
    ctx.font = '11px Arial'; ctx.fillStyle = c.muted; ctx.strokeStyle = c.grid; ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    niceTicks(ymin, ymax, 5).forEach(v => { ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(w - R, Y(v)); ctx.stroke(); ctx.fillText(v.toFixed(0), L - 6, Y(v)); });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    niceTicks(0, xmax, Math.max(2, Math.floor(pw / 90))).forEach(v => ctx.fillText(v >= 1000 ? (v / 1000) + 'k' : v, X(v), h - B + 6));
    ctx.fillText('Placements evaluated', L + pw / 2, h - 16);
    ctx.save(); ctx.translate(12, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Boundary radius', 0, 0); ctx.restore();
    if (greedyVal != null) {
      ctx.setLineDash([5, 4]); ctx.strokeStyle = c.greedy; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(L, Y(greedyVal)); ctx.lineTo(w - R, Y(greedyVal)); ctx.stroke(); ctx.setLineDash([]);
    }
    series.forEach(s => {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineJoin = 'round'; ctx.beginPath();
      s.pts.forEach(([x, y], i) => i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))); ctx.stroke();
    });
    // legend (HTML)
    const leg = [];
    if (greedyVal != null) leg.push(['Greedy (single placement)', c.greedy, true]);
    series.slice().reverse().forEach(s => leg.push([s.name, s.color, false]));
    $('chart-legend').innerHTML = leg.map(([n, col, dash]) =>
      `<span class="cp-leg"><i style="border-top:3px ${dash ? 'dashed' : 'solid'} ${col}"></i>${n}</span>`).join('');
  }

  /* ---------- stats + table ---------- */
  function updateStats() {
    ALGOS.forEach(a => {
      const s = state[a];
      $('best-' + a).textContent = s.best == null ? '—' : s.best.toFixed(1);
      let sub = '';
      if (s.running && a !== 'greedy') sub = `${a === 'ga' ? 'Generation' : 'Iteration'} ${s.iter} / ${s.total}`;
      else if (s.best != null) sub = `${s.evals.toLocaleString()} placement${s.evals === 1 ? '' : 's'} · ${(s.ms / 1000).toFixed(2)}s`;
      $('sub-' + a).textContent = sub;
      $('prog-' + a).style.width = (s.total ? (100 * s.iter / s.total) : (s.best != null ? 100 : 0)) + '%';
      $('card-' + a).classList.toggle('running', s.running);
    });
    const rows = ALGOS.filter(a => state[a].best != null);
    const tb = $('results-body');
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="5" class="cp-empty">No results yet</td></tr>'; return; }
    const minB = Math.min(...rows.map(a => state[a].best));
    const g = state.greedy.best;
    tb.innerHTML = rows.map(a => {
      const s = state[a];
      const vsG = g != null && a !== 'greedy' ? ((s.best - g) / g * 100) : null;
      return `<tr class="${s.best === minB ? 'cp-winner' : ''}">
        <td>${NAMES[a]}${s.running ? ' <span class="cp-live">running</span>' : ''}</td>
        <td class="num">${s.best.toFixed(1)}</td>
        <td class="num">${vsG == null ? '—' : (vsG > 0 ? '+' : '') + vsG.toFixed(1) + '%'}</td>
        <td class="num">${s.evals.toLocaleString()}</td>
        <td class="num">${(s.ms / 1000).toFixed(2)}s</td></tr>`;
    }).join('');
  }

  let raf = null;
  function render() { if (raf) return; raf = requestAnimationFrame(() => { raf = null; ALGOS.forEach(drawPacking); drawChart(); updateStats(); }); }

  /* ---------- running ---------- */
  function readParams() {
    const num = (id, lo, hi, d) => { const v = parseFloat($(id).value); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    return {
      iterations: Math.round(num('p-iter', 1, 20000, 450)),
      popSize: Math.round(num('p-pop', 4, 500, 100)),
      generations: Math.round(num('p-gens', 0, 1000, 100)),
      mutation: num('p-mut', 0, 1, 0.029),
      tournamentSize: Math.round(num('p-tourn', 1, 200, 20)),
      pressure: num('p-press', 0, 1, 0.4)
    };
  }

  function run(algo) {
    if (!readRadii()) return;
    stop(algo);
    state[algo] = { best: null, bestOrder: null, evals: 0, ms: 0, history: [], running: true, iter: 0, total: 0 };
    const wk = new Worker(workerURL); workers[algo] = wk;
    wk.onmessage = ({ data }) => {
      const s = state[algo];
      s.best = data.best; s.bestOrder = data.bestOrder; s.evals = data.evals; s.ms = data.ms;
      s.iter = data.iter || 0; s.total = data.total || 0;
      s.history.push(...data.history);
      if (data.type === 'done') { s.running = false; wk.terminate(); delete workers[algo]; refreshButtons(); }
      render();
    };
    wk.onerror = (e) => { state[algo].running = false; console.error(e); render(); refreshButtons(); };
    wk.postMessage({ algo, radii, params: readParams() });
    refreshButtons(); render();
  }
  function stop(algo) {
    const list = algo ? [algo] : ALGOS;
    list.forEach(a => { if (workers[a]) { workers[a].terminate(); delete workers[a]; state[a].running = false; } });
    refreshButtons(); render();
  }
  function refreshButtons() { $('btn-stop').disabled = !Object.keys(workers).length; }

  /* ---------- dataset handling ---------- */
  function readRadii() {
    const sel = $('dataset').value;
    if (sel !== 'custom') { radii = DATASETS[sel].radii.slice(); $('radii-error').textContent = ''; return true; }
    const vals = $('radii-input').value.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (vals.length < 2 || vals.some(v => !Number.isInteger(v) || v <= 0 || v > 500)) {
      $('radii-error').textContent = 'Enter at least two whole numbers between 1 and 500, separated by commas.'; return false;
    }
    if (vals.length > 80) { $('radii-error').textContent = 'Please use 80 circles or fewer.'; return false; }
    $('radii-error').textContent = ''; radii = vals; return true;
  }
  function onDataset() {
    const sel = $('dataset').value;
    if (sel !== 'custom') {
      $('radii-input').value = DATASETS[sel].radii.join(', ');
      $('dataset-meta').textContent = `${DATASETS[sel].radii.length} circles · target noted in original code: ${DATASETS[sel].target}`;
    } else {
      $('dataset-meta').textContent = 'Type your own radii below.';
    }
    $('radii-input').readOnly = sel !== 'custom';
    stop(); resetState(); readRadii(); render();
  }

  /* ---------- wire up ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    const dsSel = $('dataset');
    Object.keys(DATASETS).forEach(k => {
      const o = document.createElement('option'); o.value = k; o.textContent = `${k} (${DATASETS[k].radii.length} circles)`; dsSel.appendChild(o);
    });
    const oc = document.createElement('option'); oc.value = 'custom'; oc.textContent = 'Custom…'; dsSel.appendChild(oc);
    dsSel.value = 'r5';
    dsSel.addEventListener('change', onDataset);
    $('radii-input').addEventListener('input', () => { if (dsSel.value === 'custom') { stop(); resetState(); readRadii(); render(); } });
    $('btn-greedy').onclick = () => run('greedy');
    $('btn-random').onclick = () => run('random');
    $('btn-ga').onclick = () => run('ga');
    $('btn-all').onclick = () => ALGOS.forEach(run);
    $('btn-stop').onclick = () => stop();
    $('btn-match').onclick = () => { const p = readParams(); $('p-iter').value = p.popSize * (p.generations + 1); };
    $('show-mean').onchange = render;
    $('btn-preset-fast').onclick = () => { $('p-pop').value = 40; $('p-gens').value = 50; };
    $('btn-preset-orig').onclick = () => { $('p-pop').value = 100; $('p-gens').value = 100; $('p-mut').value = 0.029; $('p-tourn').value = 20; $('p-press').value = 0.4; $('p-iter').value = 450; };
    window.addEventListener('resize', render);
    new MutationObserver(render).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    onDataset();
  });
})();
