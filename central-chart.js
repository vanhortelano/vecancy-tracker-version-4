// Trading-style time-series chart (canvas, no libraries).
// Drag to move through time, wheel/pinch buttons to zoom, hover for values.
// Points with v === null are drawn as GAPS (no data is ever invented).
window.CChart = (function(){
  function create(canvas, cb){
    const ctx = canvas.getContext("2d");
    const S = {series:[], t0:0, t1:1, latest:1, dataMin:0, exhausted:false, fmt:v=>String(Math.round(v*10)/10), hover:null};
    let drag = null, olderAt = 0;
    const L = 54, R = 16, T = 14, B = 30;
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

    function box(){
      const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(r.width*d) || canvas.height !== Math.round(r.height*d)){ canvas.width = Math.round(r.width*d); canvas.height = Math.round(r.height*d); }
      ctx.setTransform(d,0,0,d,0,0);
      return {w:r.width, h:r.height};
    }
    const tx = (t, w) => L + (t - S.t0) / (S.t1 - S.t0) * (w - L - R);
    const xt = (x, w) => S.t0 + (x - L) / (w - L - R) * (S.t1 - S.t0);

    function tickLabel(t, span){
      const d = new Date(t);
      return span <= 2*864e5 ? d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})
        : span <= 400*864e5 ? d.toLocaleDateString([], {month:"short", day:"numeric"}) : d.toLocaleDateString([], {month:"short", year:"2-digit"});
    }

    function draw(){
      const {w, h} = box(); ctx.clearRect(0, 0, w, h);
      const ink = css("--ink"), soft = css("--soft"), line = css("--line");
      const span = S.t1 - S.t0;
      let lo = Infinity, hi = -Infinity;
      S.series.forEach(s => s.points.forEach(p => { if (p.v != null && p.t >= S.t0 && p.t <= S.t1){ lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); } }));
      if (!isFinite(lo)){ lo = 0; hi = 1; }
      if (hi === lo){ hi += 1; lo = Math.max(0, lo - 1); }
      const pad = (hi - lo) * .12; lo = Math.max(0, lo - pad); hi += pad;
      const ty = v => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
      ctx.font = "11px 'DM Sans', sans-serif"; ctx.textBaseline = "middle";
      // grid + y labels
      ctx.strokeStyle = line; ctx.fillStyle = soft; ctx.lineWidth = 1; ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++){ const v = lo + (hi - lo) * i / 4, y = ty(v); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.fillText(S.fmt(v), L - 8, y); }
      // x labels
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (let i = 0; i <= 5; i++){ const t = S.t0 + span * i / 5, x = tx(t, w); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, h - B); ctx.stroke(); ctx.fillText(tickLabel(t, span), Math.min(Math.max(x, L + 18), w - R - 18), h - B + 8); }
      // lines (clipped to plot)
      ctx.save(); ctx.beginPath(); ctx.rect(L, T - 2, w - L - R, h - T - B + 4); ctx.clip();
      S.series.forEach(s => {
        ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.combined ? 3 : 2; ctx.lineJoin = "round"; ctx.beginPath();
        let pen = false, shown = 0;
        s.points.forEach(p => {
          if (p.v == null){ pen = false; return; }
          const x = tx(p.t, w), y = ty(p.v);
          if (!pen){ ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
          if (x >= L && x <= w - R) shown++;
        });
        ctx.stroke();
        if (shown < 60) s.points.forEach(p => { if (p.v == null) return; const x = tx(p.t, w); if (x < L || x > w - R) return; ctx.beginPath(); ctx.arc(x, ty(p.v), 3, 0, 7); ctx.fill(); });
      });
      ctx.restore();
      // empty message
      if (!S.series.some(s => s.points.some(p => p.v != null && p.t >= S.t0 && p.t <= S.t1))){
        ctx.fillStyle = soft; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "13px 'DM Sans', sans-serif";
        ctx.fillText("No recorded data in this period (gaps are shown, never estimated)", (L + w - R) / 2, (T + h - B) / 2);
      }
      // hover
      if (S.hover != null){
        const x = tx(S.hover, w); ctx.strokeStyle = soft; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, h - B); ctx.stroke(); ctx.setLineDash([]);
        const rows = [];
        S.series.forEach(s => { let best = null; s.points.forEach(p => { if (p.v != null && (!best || Math.abs(p.t - S.hover) < Math.abs(best.t - S.hover))) best = p; }); if (best && Math.abs(best.t - S.hover) <= Math.max(span / 40, 36e5)) rows.push({c:s.color, n:s.name, v:S.fmt(best.v), t:best.t}); });
        if (rows.length){
          ctx.font = "12px 'DM Sans', sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
          const head = new Date(rows[0].t).toLocaleString([], {month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"});
          const bw = Math.max(ctx.measureText(head).width, ...rows.map(r => ctx.measureText(r.n + "  " + r.v).width + 18)) + 20, bh = 24 + rows.length * 18;
          let bx = x + 12; if (bx + bw > w - R) bx = x - bw - 12;
          ctx.fillStyle = css("--card"); ctx.strokeStyle = line; ctx.beginPath(); ctx.roundRect(bx, T + 4, bw, bh, 10); ctx.fill(); ctx.stroke();
          ctx.fillStyle = soft; ctx.fillText(head, bx + 10, T + 18);
          rows.forEach((r, i) => { const y = T + 38 + i * 18; ctx.fillStyle = r.c; ctx.beginPath(); ctx.arc(bx + 14, y, 4, 0, 7); ctx.fill(); ctx.fillStyle = ink; ctx.fillText(r.n + "  " + r.v, bx + 26, y); });
        }
      }
    }

    function clamp(){ // never scroll into the future
      const span = S.t1 - S.t0;
      if (S.t1 > S.latest){ S.t1 = S.latest; S.t0 = S.t1 - span; }
      if (S.t0 < S.dataMin && !S.exhausted && Date.now() - olderAt > 800){ olderAt = Date.now(); cb && cb.needOlder && cb.needOlder(); }
    }
    canvas.style.touchAction = "pan-y"; canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", e => { drag = {x:e.clientX, t0:S.t0, t1:S.t1}; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; });
    canvas.addEventListener("pointermove", e => {
      const r = canvas.getBoundingClientRect(), w = r.width;
      if (drag){ const dt = (e.clientX - drag.x) / (w - L - R) * (drag.t1 - drag.t0); S.t0 = drag.t0 - dt; S.t1 = drag.t1 - dt; clamp(); S.hover = null; }
      else S.hover = xt(e.clientX - r.left, w);
      draw();
    });
    const end = () => { drag = null; canvas.style.cursor = "grab"; };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => { S.hover = null; draw(); });
    canvas.addEventListener("wheel", e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.25 : .8, xt(e.clientX - canvas.getBoundingClientRect().left, canvas.getBoundingClientRect().width)); }, {passive:false});
    function zoom(f, at){
      const span = Math.max(30*60e3, (S.t1 - S.t0) * f), c = at == null ? (S.t0 + S.t1) / 2 : at, k = (c - S.t0) / (S.t1 - S.t0);
      S.t0 = c - span * k; S.t1 = S.t0 + span; clamp(); draw();
    }
    new ResizeObserver(draw).observe(canvas);

    return {
      setData(series, o){ S.series = series; Object.assign(S, o || {}); draw(); },
      setWindow(a, b){ S.t0 = a; S.t1 = b; draw(); },
      zoom, redraw: draw,
      window: () => [S.t0, S.t1]
    };
  }
  return {create};
})();
