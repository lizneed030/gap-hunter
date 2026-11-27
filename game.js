'use strict';

const canvas = document.getElementById('game');
const context = canvas.getContext('2d');
const elements = Object.fromEntries(['shotCount', 'rank', 'shots', 'rankProgress', 'rankList', 'notice', 'overlay', 'overlayTag', 'overlayTitle', 'overlayText', 'overlayFoot', 'start', 'shoot', 'pause', 'sound', 'restart', 'best', 'footerHint'].map(name => [name, document.getElementById(name)]));
const difficulties = { easy: { gap: 18, speed: 0.82 }, normal: { gap: 12, speed: 1.15 }, hard: { gap: 10, speed: 1.5 } };
const ranks = [
  { maxShots: 1, range: '1 支', name: '传说中的神射手', message: '真有人能一箭射中？！' },
  { maxShots: 3, range: '2～3 支', name: '王牌猎手', message: '有点本事，不是蒙的吧？' },
  { maxShots: 7, range: '4～7 支', name: '精英猎手', message: '眼力不错，出手也够稳！' },
  { maxShots: 15, range: '8～15 支', name: '熟练猎手', message: '找到感觉了，这箭漂亮！' },
  { maxShots: 30, range: '16～30 支', name: '新手猎手', message: '虽然绕了点路，总算射中了！' },
  { maxShots: 50, range: '31～50 支', name: '随缘猎手', message: '主打一个箭多，总有一支能中。' },
  { maxShots: Infinity, range: '51 支及以上', name: '怪物的放生员', message: '怪物都快和你混熟了。' }
];
const geometry = { width: 420, height: 700, center: 210, gateTop: 285, gateBottom: 325, monsterY: 202, bowY: 579, arrowRadius: 3 };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const game = { phase: 'idle', resumePhase: null, difficulty: 'normal', shots: 0, bowX: 80, motion: -0.98, arrow: null, stuckArrows: [], hitArrow: null, particles: [], time: 0, timer: 0, noticeTimer: 0, recoil: 0, flash: 0, monsterAlive: true, best: null, sound: false };
let audioContext;
let previousTime = 0;
let frameId;

try {
  const stored = Number(localStorage.getItem('gap-hunter-best-shots-v3'));
  if (Number.isSafeInteger(stored) && stored > 0) game.best = stored;
} catch {}

function gapWidth() {
  return difficulties[game.difficulty].gap;
}

function hunterRank(shots = game.shots) {
  if (!Number.isSafeInteger(shots) || shots < 1) return null;
  return ranks.find(rank => shots <= rank.maxShots);
}

function updateHud() {
  const rank = game.monsterAlive ? null : hunterRank();
  elements.shotCount.textContent = String(game.shots);
  elements.rank.textContent = rank ? rank.name : '命中后揭晓';
  elements.best.textContent = game.best === null ? '—' : `${game.best} 支`;
  elements.shots.textContent = rank ? `第 ${game.shots} 支箭，首次命中！` : '可无限尝试 · 射中即结算';
  elements.rankProgress.textContent = rank ? `用了 ${game.shots} 支箭 · ${rank.message}` : '按首次命中用箭数评级，越少越强。';
  elements.rankList.innerHTML = ranks.map(candidate => `<li class="${candidate === rank ? 'current' : ''}"><span>${candidate.name}</span><b>${candidate.range}</b></li>`).join('');
  canvas.parentElement.classList.toggle('settled', game.phase === 'result');
  elements.shoot.disabled = game.phase !== 'playing' || Boolean(game.arrow);
  elements.pause.disabled = !['playing', 'countdown', 'transition', 'paused'].includes(game.phase);
  elements.pause.textContent = game.phase === 'paused' ? '继续' : '暂停';
  document.querySelectorAll('[data-difficulty]').forEach(button => {
    const selected = button.dataset.difficulty === game.difficulty;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = game.phase !== 'idle';
  });
}

function notify(text, bad = false, duration = 1.1) {
  elements.notice.textContent = text;
  elements.notice.className = `notice visible${bad ? ' bad' : ''}`;
  game.noticeTimer = duration;
}

function showOverlay(tag, title, text, button, foot) {
  elements.overlayTag.textContent = tag;
  elements.overlayTitle.textContent = title;
  elements.overlayText.innerHTML = text;
  elements.start.innerHTML = `${button} <span>↗</span>`;
  elements.overlayFoot.textContent = foot;
  elements.overlay.classList.toggle('result', game.phase === 'result');
  elements.overlay.hidden = false;
}

function resetRound() {
  game.arrow = null;
  game.stuckArrows = [];
  game.hitArrow = null;
  game.monsterAlive = true;
  game.motion = -0.98;
  game.bowX = geometry.center + Math.sin(game.motion) * 151;
  game.recoil = 0;
  game.flash = 0;
}

function startGame() {
  if (game.phase === 'paused') {
    game.phase = game.resumePhase;
    elements.overlay.hidden = true;
    updateHud();
    return;
  }
  game.shots = 0;
  game.particles = [];
  resetRound();
  game.phase = 'countdown';
  game.timer = 1.6;
  elements.overlay.hidden = true;
  elements.footerHint.textContent = '点击画面 / 点击按钮 / 按空格，均可射箭';
  notify('准备 · 看准缝隙', false, 1.6);
  updateHud();
}

function returnHome() {
  game.phase = 'idle';
  game.shots = 0;
  game.particles = [];
  game.noticeTimer = 0;
  elements.notice.className = 'notice';
  resetRound();
  showOverlay('FEWER ARROWS · BETTER HUNTER', '这一箭，你能中吗？', '首次射中就结算，用箭越少越厉害。<br>可以无限尝试，射偏的箭会留在挡板上。', '开始挑战', '不需要摄像头 · 无需联网');
  elements.footerHint.textContent = '看准缝隙，再出手。';
  updateHud();
}

function pauseGame() {
  if (game.phase === 'paused') return startGame();
  if (!['playing', 'countdown', 'transition'].includes(game.phase)) return;
  game.resumePhase = game.phase;
  game.phase = 'paused';
  showOverlay('TAKE A BREATH', '休息一下。', '弓箭和飞行中的箭都已暂停。<br>准备好后，继续寻找出手时机。', '继续挑战', '本局进度已保留');
  updateHud();
}

function playSound(type) {
  if (!game.sound) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = type === 'miss' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(type === 'hit' ? 520 : type === 'miss' ? 150 : 750, now);
    oscillator.frequency.exponentialRampToValueAtTime(type === 'hit' ? 1040 : 70, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.26);
  } catch {}
}

function fireArrow() {
  if (game.phase !== 'playing' || game.arrow) return;
  game.shots += 1;
  game.arrow = { x: game.bowX, y: geometry.bowY - 53, passedGate: false };
  game.recoil = 1;
  playSound('shoot');
  updateHud();
}

function burst(positionX, positionY, colors) {
  const count = reducedMotion ? 8 : 26;
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 150;
    game.particles.push({ x: positionX, y: positionY, velocityX: Math.cos(angle) * speed, velocityY: Math.sin(angle) * speed - 50, life: 0.6 + Math.random() * 0.4, color: colors[index % colors.length], size: 2 + Math.random() * 4 });
  }
}

function missArrow(positionX, positionY) {
  game.stuckArrows.push({ x: positionX, y: positionY });
  game.arrow = null;
  game.flash = 0.22;
  burst(positionX, positionY, ['#ff9b56', '#ffda85', '#9b5948']);
  playSound('miss');
  notify('箭插在挡板上了 · 再来一箭！', true, 0.7);
  updateHud();
}

function hitMonster() {
  if (game.phase !== 'playing' || !game.arrow || !game.monsterAlive) return;
  game.hitArrow = { x: game.arrow.x, y: geometry.monsterY + 28 };
  game.arrow = null;
  game.monsterAlive = false;
  game.best = game.best === null ? game.shots : Math.min(game.best, game.shots);
  try { localStorage.setItem('gap-hunter-best-shots-v3', String(game.best)); } catch {}
  burst(geometry.center, geometry.monsterY, ['#d6ee85', '#f3ffd2', '#de96b4', '#ffcb79']);
  playSound('hit');
  notify(`命中！你用了 ${game.shots} 支箭`, false, 0.85);
  game.phase = 'transition';
  game.timer = 0.85;
  updateHud();
}

function showResult() {
  game.phase = 'result';
  const rank = hunterRank();
  showOverlay('FIRST HIT · CHALLENGE COMPLETE', rank.name, `首次命中用了 <strong>${game.shots} 支箭</strong><br>${rank.message}`, '再挑战一次', `最佳纪录：${game.best} 支箭 · 用箭越少，评级越高`);
  elements.footerHint.textContent = '本次挑战已结算 · 再挑战可以冲击更少用箭';
  updateHud();
}

function update(delta) {
  if (game.phase === 'paused') return;
  game.time += delta;
  game.recoil = Math.max(0, game.recoil - delta * 4);
  game.flash = Math.max(0, game.flash - delta);
  if (game.noticeTimer > 0) {
    game.noticeTimer -= delta;
    if (game.noticeTimer <= 0) elements.notice.className = 'notice';
  }
  game.particles.forEach(particle => {
    particle.x += particle.velocityX * delta;
    particle.y += particle.velocityY * delta;
    particle.velocityY += delta * 210;
    particle.life -= delta;
  });
  game.particles = game.particles.filter(particle => particle.life > 0);
  if (game.phase === 'countdown') {
    game.timer -= delta;
    if (game.timer <= 0) {
      game.phase = 'playing';
      notify('看准了，就放箭', false, 0.9);
      updateHud();
    }
    return;
  }
  if (game.phase === 'transition') {
    game.timer -= delta;
    if (game.timer <= 0) {
      showResult();
    }
    return;
  }
  if (game.phase !== 'playing') return;
  game.motion += delta * difficulties[game.difficulty].speed;
  game.bowX = geometry.center + Math.sin(game.motion) * 151;
  if (!game.arrow) return;
  const arrow = game.arrow;
  const previousY = arrow.y;
  arrow.y -= delta * 760;
  if (!arrow.passedGate && previousY >= geometry.gateBottom && arrow.y <= geometry.gateBottom) {
    const halfGap = gapWidth() / 2;
    if (arrow.x - geometry.arrowRadius <= geometry.center - halfGap || arrow.x + geometry.arrowRadius >= geometry.center + halfGap) {
      missArrow(arrow.x, geometry.gateBottom);
      return;
    }
    arrow.passedGate = true;
  }
  if (arrow.passedGate && previousY >= geometry.monsterY + 28 && arrow.y <= geometry.monsterY + 28) {
    if (Math.abs(arrow.x - geometry.center) <= 45) return hitMonster();
  }
  if (arrow.y < -60) missArrow(arrow.x, geometry.gateBottom);
}

function polygon(points, fill, stroke, width = 1) {
  context.beginPath();
  points.forEach(([positionX, positionY], index) => index ? context.lineTo(positionX, positionY) : context.moveTo(positionX, positionY));
  context.closePath();
  if (fill) { context.fillStyle = fill; context.fill(); }
  if (stroke) { context.strokeStyle = stroke; context.lineWidth = width; context.stroke(); }
}

function ellipse(positionX, positionY, radiusX, radiusY, color) {
  context.beginPath();
  context.ellipse(positionX, positionY, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

function strokeLine(points, color, width = 1) {
  context.beginPath();
  points.forEach(([positionX, positionY], index) => index ? context.lineTo(positionX, positionY) : context.moveTo(positionX, positionY));
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.stroke();
}

function drawBackground() {
  const sky = context.createLinearGradient(0, 0, 0, 700);
  sky.addColorStop(0, '#1e2e3e');
  sky.addColorStop(0.5, '#3e3c44');
  sky.addColorStop(1, '#15252b');
  context.fillStyle = sky;
  context.fillRect(0, 0, 420, 700);
  const halo = context.createRadialGradient(210, 200, 5, 210, 200, 150);
  halo.addColorStop(0, '#ffbf7722'); halo.addColorStop(1, '#ffbf7700');
  context.fillStyle = halo; context.fillRect(0, 40, 420, 320);
  ellipse(322, 122, 32, 32, '#c5c7aa17');
  ellipse(334, 114, 29, 29, '#22313e');
  for (let index = 0; index < 32; index += 1) {
    const positionX = (index * 137.2 + 30) % 420;
    const positionY = (index * 83.7 + 52) % 270;
    ellipse(positionX, positionY, index % 3 === 0 ? 1.3 : 0.7, 0.8, '#e5e8d752');
  }
  polygon([[0, 360], [45, 278], [91, 349], [151, 243], [212, 362], [285, 269], [360, 350], [420, 272], [420, 700], [0, 700]], '#303b43');
  polygon([[0, 411], [65, 335], [120, 395], [168, 355], [232, 433], [296, 347], [346, 392], [420, 326], [420, 700], [0, 700]], '#26343c');
  polygon([[0, 456], [44, 407], [102, 463], [162, 423], [219, 490], [300, 410], [359, 455], [420, 399], [420, 700], [0, 700]], '#1c2d34');
  const mist = context.createLinearGradient(0, 480, 0, 700);
  mist.addColorStop(0, '#233b3a00'); mist.addColorStop(1, '#12262a');
  context.fillStyle = mist; context.fillRect(0, 430, 420, 270);
  context.setLineDash([2, 8]);
  strokeLine([[210, 351], [210, 502]], '#d6ee8522');
  context.setLineDash([]);
  strokeLine([[35, 616], [385, 616]], '#c6d7c622');
  for (let positionX = 43; positionX < 390; positionX += 16) strokeLine([[positionX, 614], [positionX, 619]], '#c6d7c62b');
  for (let index = 0; index < 12; index += 1) {
    const positionX = (index * 71 + Math.sin(game.time * 0.5 + index) * 10 + 420) % 420;
    const positionY = 690 - ((game.time * (9 + index % 4) + index * 47) % 370);
    ellipse(positionX, positionY, 1, 1.7, '#f4b87a42');
  }
}

function drawGate(startX, endX, mirror) {
  context.save();
  const top = geometry.gateTop;
  const bottom = geometry.gateBottom;
  polygon([[startX, top + 4], [startX + 12, top - 2], [endX - 19, top], [endX, top + 9], [endX - 2, bottom - 8], [endX - 13, bottom + 2], [startX, bottom - 2]], '#302a2d', '#65504a', 2);
  context.beginPath(); context.rect(startX, top, endX - startX, bottom - top); context.clip();
  const glow = context.createLinearGradient(0, top, 0, bottom);
  glow.addColorStop(0, '#ff844a'); glow.addColorStop(0.2, '#75342d'); glow.addColorStop(0.5, '#d65d31'); glow.addColorStop(0.65, '#4a2d2d'); glow.addColorStop(1, '#ff9445');
  context.fillStyle = glow; context.fillRect(startX, top + 4, endX - startX, 31);
  for (let index = 0; index < 9; index += 1) {
    const positionX = startX + index * 31 - 15;
    const offset = (index + mirror) % 3 * 3;
    polygon([[positionX, top + 5], [positionX + 25, top + 2 + offset], [positionX + 40, top + 13], [positionX + 22, top + 21], [positionX + 1, top + 17]], '#30272c');
    polygon([[positionX - 12, bottom - 3], [positionX + 6, top + 21], [positionX + 23, top + 24], [positionX + 30, bottom]], '#392a2c');
  }
  strokeLine([[startX, top + 17], [startX + 27, top + 14], [startX + 49, top + 21], [startX + 77, top + 17], [startX + 99, top + 20], [endX, top + 15]], '#ffd08a', 1.4);
  if (game.flash > 0) { context.fillStyle = `rgba(255,181,97,${game.flash * 2})`; context.fillRect(startX, top, endX - startX, 40); }
  context.restore();
}

function drawMonster() {
  const bob = reducedMotion || !game.monsterAlive ? 0 : Math.sin(game.time * 2.3) * 3;
  context.save(); context.translate(geometry.center, geometry.monsterY + bob);
  if (!game.monsterAlive) context.globalAlpha = 0.65;
  ellipse(0, 51 - bob, 35, 6, '#00000033');
  polygon([[-31, -17], [-43, -47], [-22, -31], [-13, -23]], '#d8c5a3', '#5c5256', 2);
  polygon([[31, -17], [43, -47], [22, -31], [13, -23]], '#d8c5a3', '#5c5256', 2);
  polygon([[-31, 8], [-55, 12], [-48, 28], [-33, 24]], '#956477', '#4c3d50', 2);
  polygon([[31, 8], [55, 12], [48, 28], [33, 24]], '#956477', '#4c3d50', 2);
  const body = context.createLinearGradient(0, -35, 0, 40);
  body.addColorStop(0, '#b67d92'); body.addColorStop(1, '#725168');
  ellipse(0, 0, 43, 36, body);
  ellipse(-20, -20, 12, 6, '#d497a446');
  ellipse(-15, 0, 12, 13, '#332b3b'); ellipse(15, 0, 12, 13, '#332b3b');
  ellipse(-14, 1, 6, 8, '#e6ed98'); ellipse(14, 1, 6, 8, '#e6ed98');
  ellipse(-13, 2, 2.5, 6, '#273638'); ellipse(13, 2, 2.5, 6, '#273638');
  if (!game.monsterAlive) {
    ellipse(-15, 0, 12, 13, '#332b3b'); ellipse(15, 0, 12, 13, '#332b3b');
    for (const eyeX of [-15, 15]) {
      strokeLine([[eyeX - 5, -5], [eyeX + 5, 5]], '#e6ed98', 2.5);
      strokeLine([[eyeX + 5, -5], [eyeX - 5, 5]], '#e6ed98', 2.5);
    }
  }
  strokeLine([[-28, -14], [-7, -9]], '#583d53', 4); strokeLine([[28, -14], [7, -9]], '#583d53', 4);
  ellipse(0, 22, 13, 7, '#412d40');
  polygon([[-10, 18], [-4, 18], [-6, 25]], '#ead9ba'); polygon([[10, 18], [4, 18], [6, 25]], '#ead9ba');
  ellipse(-24, 33, 10, 6, '#64495e'); ellipse(24, 33, 10, 6, '#64495e');
  context.fillStyle = '#d3d6be'; context.font = '9px "Microsoft YaHei", sans-serif'; context.textAlign = 'center';
  context.fillText(game.monsterAlive ? '裂 隙 守 卫' : '已 击 败', 0, -62);
  context.fillStyle = '#2b3340'; context.fillRect(-24, -54, 48, 4);
  if (game.monsterAlive) { context.fillStyle = '#d6ee85'; context.fillRect(-23, -53, 46, 2); }
  context.restore();
}

function drawArrow(positionX, positionY, glowing = true) {
  context.save(); context.translate(positionX, positionY);
  if (glowing) {
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, 18);
    glow.addColorStop(0, '#f9cc7a66'); glow.addColorStop(1, '#f9cc7a00');
    context.fillStyle = glow; context.fillRect(-18, -18, 36, 36);
  }
  strokeLine([[0, 8], [0, 60]], '#e4cc99', 3);
  strokeLine([[1, 12], [1, 54]], '#775b45', 1);
  polygon([[0, -8], [-5, 8], [0, 5], [5, 8]], '#f4ddaa', '#ae7048', 1);
  polygon([[-1, 49], [-7, 57], [-7, 66], [-1, 60]], '#d6ee85');
  polygon([[1, 49], [7, 57], [7, 66], [1, 60]], '#99b76d');
  context.restore();
}

function drawBow() {
  const positionX = game.bowX;
  const positionY = geometry.bowY;
  context.save(); context.translate(positionX, positionY + game.recoil * 5);
  ellipse(0, 38, 43, 5, '#00000035');
  const aligned = Math.abs(positionX - geometry.center) < gapWidth() / 2 - geometry.arrowRadius;
  ellipse(0, 38, 3, 3, aligned ? '#d6ee85' : '#96aaa8');
  context.beginPath(); context.moveTo(-55, 4); context.bezierCurveTo(-46, -32, -21, -21, 0, -7); context.bezierCurveTo(21, -21, 46, -32, 55, 4);
  context.strokeStyle = '#201e21'; context.lineWidth = 12; context.stroke();
  context.strokeStyle = '#ba8252'; context.lineWidth = 8; context.stroke();
  context.strokeStyle = '#edbd76'; context.lineWidth = 2; context.stroke();
  strokeLine([[-55, 4], [0, 23 + game.recoil * 9], [55, 4]], '#dfcfb0', 1.4);
  strokeLine([[-55, 0], [-55, 8]], '#e6c487', 5); strokeLine([[55, 0], [55, 8]], '#e6c487', 5);
  strokeLine([[0, -13], [0, 0]], '#5b453a', 9);
  for (let index = 0; index < 4; index += 1) strokeLine([[-4, -12 + index * 4], [4, -10 + index * 4]], '#d7b58a', 1.5);
  context.restore();
  if (!game.arrow && game.monsterAlive) drawArrow(positionX, positionY - 53 + game.recoil * 5);
}

function draw() {
  context.setTransform(canvas.width / 420, 0, 0, canvas.height / 700, 0, 0);
  drawBackground();
  drawMonster();
  drawGate(-10, geometry.center - gapWidth() / 2, 0);
  drawGate(geometry.center + gapWidth() / 2, 430, 1);
  game.stuckArrows.forEach(arrow => drawArrow(arrow.x, arrow.y, false));
  if (game.hitArrow) drawArrow(game.hitArrow.x, game.hitArrow.y, false);
  context.fillStyle = '#edbc8c88'; context.font = '9px Consolas, monospace'; context.textAlign = 'center';
  context.fillText('↑', geometry.center, geometry.gateBottom + 19);
  drawBow();
  if (game.arrow) {
    const trail = context.createLinearGradient(0, game.arrow.y, 0, game.arrow.y + 100);
    trail.addColorStop(0, '#d6ee8535'); trail.addColorStop(1, '#d6ee8500');
    context.fillStyle = trail; context.fillRect(game.arrow.x - 2, game.arrow.y, 4, 100);
    drawArrow(game.arrow.x, game.arrow.y);
  }
  game.particles.forEach(particle => {
    context.globalAlpha = Math.min(1, particle.life * 2);
    context.fillStyle = particle.color;
    context.fillRect(particle.x, particle.y, particle.size, particle.size);
  });
  context.globalAlpha = 1;
}

function frame(timestamp) {
  const delta = previousTime ? Math.min((timestamp - previousTime) / 1000, 0.04) : 0;
  previousTime = timestamp;
  update(delta);
  draw();
  frameId = requestAnimationFrame(frame);
}

function resizeCanvas() {
  const density = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(420 * density);
  canvas.height = Math.round(700 * density);
  draw();
}

elements.start.addEventListener('click', startGame);
elements.shoot.addEventListener('click', fireArrow);
canvas.addEventListener('click', fireArrow);
elements.pause.addEventListener('click', pauseGame);
elements.restart.addEventListener('click', returnHome);
elements.sound.addEventListener('click', () => {
  game.sound = !game.sound;
  elements.sound.textContent = game.sound ? '音效 开' : '音效 关';
  elements.sound.title = game.sound ? '关闭音效' : '打开音效';
  elements.sound.setAttribute('aria-pressed', String(game.sound));
  if (game.sound) playSound('hit');
  else if (audioContext) audioContext.suspend().catch(() => {});
});
document.querySelectorAll('[data-difficulty]').forEach(button => button.addEventListener('click', () => {
  if (game.phase !== 'idle') return;
  game.difficulty = button.dataset.difficulty;
  returnHome();
}));
document.addEventListener('keydown', event => {
  if (event.code === 'Space' && game.phase === 'playing' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) {
    event.preventDefault();
    if (!event.repeat) fireArrow();
  }
  if (event.code === 'Escape' && !event.repeat) pauseGame();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && ['playing', 'countdown', 'transition'].includes(game.phase)) pauseGame();
  previousTime = 0;
});
window.addEventListener('blur', () => {
  if (['playing', 'countdown', 'transition'].includes(game.phase)) pauseGame();
});
window.addEventListener('resize', resizeCanvas);
updateHud();
resizeCanvas();
frameId = requestAnimationFrame(frame);
