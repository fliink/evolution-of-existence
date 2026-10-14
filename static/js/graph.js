/* Force-directed graph of linked entries, drawn on a <canvas>. No dependencies.
 *
 *   <canvas id="graph" data-graph="graph-data" data-height="560"></canvas>
 *   <script type="application/json" id="graph-data">{ "nodes": [...], "edges": [...], "focus": "id?" }</script>
 *
 * Optional controls, matched to the canvas by its id:
 *   <input type="checkbox" data-graph-toggle-tags="graph">   show or hide tag nodes
 *   <button data-graph-reset="graph">                        re-center and shake out the layout
 *
 * Drag a node to move it, drag the background to pan, scroll to zoom, click a node to open it.
 */
(function () {
  'use strict';

  const cssVar = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  document.querySelectorAll('canvas[data-graph]').forEach((canvas) => {
    const source = document.getElementById(canvas.dataset.graph);
    if (!source) return;
    try {
      graph(canvas, JSON.parse(source.textContent));
    } catch (err) {
      console.error('graph:', err);
    }
  });

  function graph(canvas, data) {
    const ctx = canvas.getContext('2d');
    const focusId = data.focus || null;
    const TEMP_FLOOR = 0.2;

    let nodes = [];
    let edges = [];
    let byId = new Map();
    let width = 0;
    let height = 0;
    let dpr = 1;
    let k = 80; // ideal edge length in world pixels
    let temp = 0; // max displacement per tick; cools toward TEMP_FLOOR
    let showTags = true;
    let hover = null;
    let drag = null;
    let pan = null;
    let running = false;
    const view = { scale: 1, x: 0, y: 0, manual: false };

    /* ---------- layout (Fruchterman–Reingold with gravity) ---------- */

    function build(keepPositions) {
      const previous = keepPositions ? byId : new Map();
      byId = new Map();
      const visible = data.nodes.filter((n) => showTags || n.kind !== 'tag');
      nodes = visible.map((n, i) => {
        const old = previous.get(n.id);
        const angle = (i / visible.length) * Math.PI * 2;
        const radius = 60 + (i % 5) * 30;
        const node = Object.assign({}, n, {
          x: old ? old.x : Math.cos(angle) * radius,
          y: old ? old.y : Math.sin(angle) * radius,
          dx: 0,
          dy: 0,
          degree: 0,
        });
        byId.set(n.id, node);
        return node;
      });

      edges = [];
      const seen = new Set();
      const ordered = data.edges.slice().sort((a, b) => (a.kind === 'link' ? 0 : 1) - (b.kind === 'link' ? 0 : 1));
      for (const e of ordered) {
        const a = byId.get(e.s);
        const b = byId.get(e.t);
        if (!a || !b || a === b) continue;
        const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a, b, kind: e.kind });
        a.degree++;
        b.degree++;
      }
      for (const n of nodes) {
        const base = n.kind === 'pillar' ? 9 : n.kind === 'tag' || n.kind === 'thought' ? 3.5 : 5;
        n.r = base + Math.min(7, Math.sqrt(n.degree) * 1.6);
      }
      const focus = focusId && byId.get(focusId);
      if (focus) {
        focus.x = 0;
        focus.y = 0;
        focus.r += 2;
      }
      reheat();
    }

    function reheat() {
      const area = Math.max(width, 320) * Math.max(height, 240);
      k = Math.max(45, Math.min(110, 0.6 * Math.sqrt(area / Math.max(nodes.length, 1))));
      temp = Math.max(30, Math.max(width, height) / 8);
      wake();
    }

    function tick() {
      const n = nodes.length;
      const cutoff = 2.5 * k * (2.5 * k);
      for (const node of nodes) {
        node.dx = 0;
        node.dy = 0;
      }

      // every pair repels (within a cutoff so loners don't fly off)
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < n; j++) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > cutoff) continue;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = dx * dx + dy * dy || 0.01;
          }
          const d = Math.sqrt(d2);
          const f = (k * k) / d;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.dx += fx;
          a.dy += fy;
          b.dx -= fx;
          b.dy -= fy;
        }
      }

      // linked nodes attract
      for (const e of edges) {
        const dx = e.a.x - e.b.x;
        const dy = e.a.y - e.b.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = ((d * d) / k) * (e.kind === 'tag' ? 0.5 : 1);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        e.a.dx -= fx;
        e.a.dy -= fy;
        e.b.dx += fx;
        e.b.dy += fy;
      }

      // everything drifts gently toward the middle; movement is capped by temperature
      for (const node of nodes) {
        if ((drag && node === drag.node) || node.id === focusId) continue;
        node.dx -= node.x * 0.08;
        node.dy -= node.y * 0.08;
        const len = Math.sqrt(node.dx * node.dx + node.dy * node.dy) || 1;
        const step = Math.min(len, temp);
        node.x += (node.dx / len) * step;
        node.y += (node.dy / len) * step;
      }
      temp = Math.max(TEMP_FLOOR, temp * 0.96);
    }

    /* ---------- drawing ---------- */

    function fit() {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of nodes) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }
      const padX = 120; // room for labels to the right of nodes
      const padY = 40;
      const w = Math.max(maxX - minX, 1) + padX * 2;
      const h = Math.max(maxY - minY, 1) + padY * 2;
      view.scale = Math.min(width / w, height / h, 1.5);
      view.x = -((minX + maxX) / 2) * view.scale;
      view.y = -((minY + maxY) / 2) * view.scale;
    }

    const sx = (x) => width / 2 + x * view.scale + view.x;
    const sy = (y) => height / 2 + y * view.scale + view.y;

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (!nodes.length) return;
      if (!view.manual) fit();

      const color = {
        line: cssVar('--line', '#333'),
        muted: cssVar('--muted', '#888'),
        strong: cssVar('--text-strong', '#fff'),
        bg: cssVar('--bg', '#000'),
        elev: cssVar('--bg-elev', '#111'),
        accent: cssVar('--accent', '#8f7dff'),
        font: cssVar('--font-body', 'sans-serif'),
      };
      const active = drag ? drag.node : hover;
      const near = new Set();
      if (active) {
        near.add(active);
        for (const e of edges) {
          if (e.a === active) near.add(e.b);
          if (e.b === active) near.add(e.a);
        }
      }

      for (const e of edges) {
        const lit = active && (e.a === active || e.b === active);
        ctx.beginPath();
        ctx.moveTo(sx(e.a.x), sy(e.a.y));
        ctx.lineTo(sx(e.b.x), sy(e.b.y));
        ctx.setLineDash(e.kind === 'tag' ? [3, 4] : []);
        ctx.lineWidth = lit ? 1.8 : 1;
        ctx.strokeStyle = lit ? active.color || color.accent : color.line;
        ctx.globalAlpha = active && !lit ? 0.3 : e.kind === 'tag' ? 0.8 : 1;
        ctx.stroke();
      }
      ctx.setLineDash([]);

      const labelAll = nodes.length <= 60;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (const node of nodes) {
        const x = sx(node.x);
        const y = sy(node.y);
        const isFocus = node.id === focusId;
        ctx.globalAlpha = active && !near.has(node) ? 0.3 : 1;

        ctx.beginPath();
        ctx.arc(x, y, node.r, 0, Math.PI * 2);
        if (node.kind === 'page') {
          ctx.fillStyle = color.elev;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = color.muted;
          ctx.stroke();
        } else if (node.kind === 'tag') {
          ctx.fillStyle = color.bg;
          ctx.fill();
          ctx.setLineDash([2, 2]);
          ctx.lineWidth = 1;
          ctx.strokeStyle = color.muted;
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = node.color || color.muted;
          ctx.fill();
        }
        if (isFocus || node === active) {
          ctx.beginPath();
          ctx.arc(x, y, node.r + 3.5, 0, Math.PI * 2);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = color.strong;
          ctx.stroke();
        }
        if (labelAll || near.has(node) || node.kind === 'pillar' || isFocus) {
          ctx.font = (node.kind === 'pillar' || isFocus ? '600 13px ' : '12px ') + color.font;
          const lx = x + node.r + 6;
          ctx.lineWidth = 3;
          ctx.strokeStyle = color.bg;
          ctx.strokeText(node.title, lx, y);
          ctx.fillStyle = node === active || isFocus ? color.strong : color.muted;
          ctx.fillText(node.title, lx, y);
        }
      }
      ctx.globalAlpha = 1;
    }

    function wake() {
      if (running) return;
      running = true;
      requestAnimationFrame(frame);
    }

    function frame() {
      const settled = temp <= TEMP_FLOOR + 1e-9;
      if (!settled) tick();
      draw();
      if (settled && !drag) {
        running = false;
        return;
      }
      requestAnimationFrame(frame);
    }

    /* ---------- interaction ---------- */

    function pointAt(ev) {
      const rect = canvas.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      return { px, py, x: (px - width / 2 - view.x) / view.scale, y: (py - height / 2 - view.y) / view.scale };
    }

    function nodeAt(p) {
      let best = null;
      let bestD = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(sx(n.x) - p.px, sy(n.y) - p.py);
        if (d <= n.r + 5 && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    }

    canvas.addEventListener('pointerdown', (ev) => {
      const p = pointAt(ev);
      const n = nodeAt(p);
      canvas.setPointerCapture(ev.pointerId);
      view.manual = true;
      if (n) drag = { node: n, moved: false, startX: p.px, startY: p.py };
      else pan = { px: p.px, py: p.py, x: view.x, y: view.y };
      wake();
    });

    canvas.addEventListener('pointermove', (ev) => {
      const p = pointAt(ev);
      if (drag) {
        drag.node.x = p.x;
        drag.node.y = p.y;
        if (Math.hypot(p.px - drag.startX, p.py - drag.startY) > 3) drag.moved = true;
        temp = Math.max(temp, 2);
        wake();
        return;
      }
      if (pan) {
        view.x = pan.x + (p.px - pan.px);
        view.y = pan.y + (p.py - pan.py);
        draw();
        return;
      }
      const n = nodeAt(p);
      if (n !== hover) {
        hover = n;
        canvas.style.cursor = n && n.url && n.id !== focusId ? 'pointer' : n ? 'grab' : 'default';
        if (!running) draw();
      }
    });

    canvas.addEventListener('pointerup', () => {
      if (drag) {
        const n = drag.node;
        const clicked = !drag.moved;
        drag = null;
        if (clicked && n.url && n.id !== focusId) {
          location.href = n.url;
          return;
        }
      }
      pan = null;
      wake();
    });

    canvas.addEventListener('pointercancel', () => {
      drag = null;
      pan = null;
    });

    canvas.addEventListener('pointerleave', () => {
      if (hover) {
        hover = null;
        if (!running) draw();
      }
    });

    canvas.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const p = pointAt(ev);
        const next = Math.min(4, Math.max(0.25, view.scale * Math.exp(-ev.deltaY * 0.0015)));
        const ratio = next / view.scale;
        view.x = p.px - width / 2 - (p.px - width / 2 - view.x) * ratio;
        view.y = p.py - height / 2 - (p.py - height / 2 - view.y) * ratio;
        view.scale = next;
        view.manual = true;
        if (!running) draw();
      },
      { passive: false }
    );

    /* ---------- sizing, theme, controls ---------- */

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const wanted = Number(canvas.dataset.height) || Math.round(rect.width * 0.6);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(160, Math.min(wanted, Math.round(window.innerHeight * 0.75)));
      dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      if (!running) draw();
    }

    new ResizeObserver(resize).observe(canvas.parentElement);
    new MutationObserver(() => { if (!running) draw(); }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (!running) draw(); });
    }

    if (canvas.id) {
      document.querySelectorAll('[data-graph-toggle-tags="' + canvas.id + '"]').forEach((el) => {
        showTags = el.checked;
        el.addEventListener('change', () => {
          showTags = el.checked;
          build(true);
        });
      });
      document.querySelectorAll('[data-graph-reset="' + canvas.id + '"]').forEach((el) => {
        el.addEventListener('click', () => {
          view.manual = false;
          build(false);
        });
      });
    }

    resize();
    build(false);
    // Settle a little before the first paint; fully if the visitor prefers no motion.
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (let i = 0; i < (reduceMotion ? 400 : 25); i++) tick();
    draw();
  }
})();
