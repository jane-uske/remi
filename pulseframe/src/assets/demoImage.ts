/**
 * Procedurally drawn default cover art ("Neon Horizon").
 * A synthwave landscape: gradient sky, glowing sun, layered mountain ridges
 * and a perspective grid floor. Drawn once on a 2D canvas — no binary assets.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDemoImage(): HTMLCanvasElement {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const rand = mulberry32(20260713);

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, size);
  sky.addColorStop(0, '#040110');
  sky.addColorStop(0.35, '#160a38');
  sky.addColorStop(0.62, '#3b1460');
  sky.addColorStop(0.7, '#71255f');
  sky.addColorStop(1, '#0a0417');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, size, size);

  // stars
  for (let i = 0; i < 260; i++) {
    const x = rand() * size;
    const y = rand() * size * 0.62;
    const r = rand() * 1.6 + 0.3;
    const a = rand() * 0.7 + 0.15;
    ctx.fillStyle = `rgba(${200 + rand() * 55}, ${200 + rand() * 55}, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // a few bright stars with glow
  for (let i = 0; i < 14; i++) {
    const x = rand() * size;
    const y = rand() * size * 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.25, 'rgba(190,220,255,0.5)');
    g.addColorStop(1, 'rgba(190,220,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  // sun
  const sunX = size * 0.5;
  const sunY = size * 0.52;
  const sunR = size * 0.21;
  const halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.2, sunX, sunY, sunR * 2.4);
  halo.addColorStop(0, 'rgba(255,140,190,0.55)');
  halo.addColorStop(0.5, 'rgba(255,90,160,0.16)');
  halo.addColorStop(1, 'rgba(255,90,160,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  const sun = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
  sun.addColorStop(0, '#ffe9a3');
  sun.addColorStop(0.45, '#ffb46b');
  sun.addColorStop(0.75, '#ff5e8e');
  sun.addColorStop(1, '#e6329f');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();

  // horizontal slats cut out of the lower sun
  ctx.fillStyle = sky;
  for (let i = 0; i < 6; i++) {
    const y = sunY + sunR * (0.08 + i * 0.16);
    const h = 3 + i * 2.4;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#160a38';
    ctx.fillRect(sunX - sunR - 6, y, sunR * 2 + 12, h);
    ctx.restore();
  }

  // mountain ridges (three depth layers)
  const ridge = (baseY: number, amp: number, color: string, seedOff: number) => {
    const r2 = mulberry32(777 + seedOff);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, size);
    let y = baseY;
    for (let x = 0; x <= size; x += 8) {
      const t = x / size;
      const jag = (r2() - 0.5) * amp * 0.55;
      const wave = Math.sin(t * Math.PI * (3 + seedOff * 0.7) + seedOff) * amp;
      y = y * 0.62 + (baseY + wave + jag) * 0.38;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(size, size);
    ctx.closePath();
    ctx.fill();
  };
  ridge(size * 0.56, 44, '#2a1150', 1);
  ridge(size * 0.62, 56, '#1a0a38', 2);
  ridge(size * 0.665, 40, '#0e0524', 3);

  // horizon mist
  const mist = ctx.createLinearGradient(0, size * 0.6, 0, size * 0.72);
  mist.addColorStop(0, 'rgba(255,120,200,0)');
  mist.addColorStop(0.6, 'rgba(255,120,200,0.14)');
  mist.addColorStop(1, 'rgba(255,120,200,0)');
  ctx.fillStyle = mist;
  ctx.fillRect(0, size * 0.55, size, size * 0.2);

  // grid floor
  const horizonY = size * 0.7;
  ctx.fillStyle = '#070312';
  ctx.fillRect(0, horizonY, size, size - horizonY);

  ctx.save();
  ctx.strokeStyle = 'rgba(90, 220, 255, 0.5)';
  ctx.shadowColor = 'rgba(90, 220, 255, 0.8)';
  ctx.shadowBlur = 6;
  // horizontal lines, spacing grows toward viewer
  for (let i = 0; i < 18; i++) {
    const f = i / 17;
    const y = horizonY + Math.pow(f, 2.1) * (size - horizonY);
    ctx.globalAlpha = 0.25 + f * 0.55;
    ctx.lineWidth = 1 + f * 2.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  // converging verticals
  const vpX = size * 0.5;
  for (let i = -12; i <= 12; i++) {
    const xBottom = vpX + i * (size / 9);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(vpX + i * 8, horizonY);
    ctx.lineTo(xBottom, size);
    ctx.stroke();
  }
  ctx.restore();

  // reflected glow on the floor under the sun
  const refl = ctx.createRadialGradient(sunX, horizonY, 0, sunX, horizonY, size * 0.4);
  refl.addColorStop(0, 'rgba(255,110,170,0.28)');
  refl.addColorStop(1, 'rgba(255,110,170,0)');
  ctx.fillStyle = refl;
  ctx.fillRect(0, horizonY, size, size - horizonY);

  // vignette baked lightly so thumbnails look finished too
  const vig = ctx.createRadialGradient(size / 2, size / 2, size * 0.42, size / 2, size / 2, size * 0.74);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(2,0,8,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, size, size);

  return canvas;
}
