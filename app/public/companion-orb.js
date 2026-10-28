const api = window.blackObsidian;
const stage = document.getElementById('stage');
const label = document.getElementById('label');
const videos = [document.getElementById('clip-a'), document.getElementById('clip-b')];
const clips = {
  idle: ['idle/待机呼吸休闲.webm'],
  click: ['click/点击回应-元气挥手.webm', 'click/点击回应-开心跃动.webm', 'click/点击回应-害羞惊讶.webm'],
  drag: ['drag/被鼠标拖拽悬空反馈.webm'],
  move: ['move/漂浮踏步.webm'],
  random: ['random/哈欠连天.webm', 'random/鲸鱼吐泡泡特效.webm', 'random/超大伸懒腰.webm'],
  busy: ['random/工作状态-忙碌点按.webm'],
  done: ['random/工作状态-雀跃庆祝.webm'],
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let settings = {}, down = null, moved = false, soundContext, reactionId = 0, motionId = 0;
let active = 0, currentKind = 'idle', playToken = 0, idleTimer, finishTimer, wasBusy = false;

const urlFor = file => new URL('companion/shenshen/' + file.split('/').map(encodeURIComponent).join('/'), location.href).href;
const pick = kind => { const group = clips[kind] || clips.idle; return group[Math.floor(Math.random() * group.length)]; };
const motionEnabled = () => settings.motion !== false && !reducedMotion.matches;
let loading = false;
function play(kind, file = pick(kind)) {
  if (!motionEnabled() && kind !== 'idle') return;
  if (kind === 'idle' && currentKind === 'idle' && !loading && videos[active].readyState >= 2) {
    if (motionEnabled()) videos[active].play().catch(() => {}); else videos[active].pause();
    return;
  }
  const token = ++playToken;
  clearTimeout(finishTimer);
  loading = true;
  const nextIndex = 1 - active, next = videos[nextIndex], previous = videos[active];
  const failed = () => {
    if (token !== playToken) return;
    loading = false;
    clearTimeout(finishTimer);
    if (kind !== 'idle') { currentKind = 'failed'; play('idle'); }
    else { label.textContent = (settings.name || '大肥鱼') + ' · 动画暂不可用'; label.hidden = false; }
  };
  next.pause(); next.onloadeddata = null; next.onerror = null;
  next.src = urlFor(file); next.loop = kind === 'idle';
  next.onloadeddata = async () => {
    if (token !== playToken) return;
    try {
      if (motionEnabled()) await next.play();
      if (token !== playToken) return;
      clearTimeout(finishTimer);
      currentKind = kind; loading = false;
      next.classList.add('visible'); previous.classList.remove('visible'); previous.pause(); active = nextIndex;
      if (!motionEnabled()) next.pause();
      else if (kind !== 'idle') finishTimer = setTimeout(() => { if (token === playToken) play('idle'); }, Math.max(1200, (next.duration || 4) * 1000 + 500));
    } catch { failed(); }
  };
  next.onerror = failed;
  finishTimer = setTimeout(failed, 8000);
  next.load();
}
for (const video of videos) video.addEventListener('ended', () => {
  if (video === videos[active] && currentKind !== 'idle' && !loading) play('idle');
});
function syncMotion() {
  scheduleIdle();
  if (!motionEnabled()) {
    videos.forEach(video => video.pause());
    if (currentKind !== 'idle' || loading) { currentKind = 'paused'; play('idle'); }
  } else if (!loading) play('idle');
}
function scheduleIdle() {
  clearInterval(idleTimer);
  if (settings.motion !== false && !reducedMotion.matches) idleTimer = setInterval(() => {
    if (!document.hidden && currentKind === 'idle') play('random');
  }, (settings.idleInterval || 30) * 1000);
}
function sound() {
  if (!settings.sound || !settings.volume) return;
  try {
    soundContext ||= new AudioContext();
    const oscillator = soundContext.createOscillator(), gain = soundContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(540, soundContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(780, soundContext.currentTime + .1);
    gain.gain.setValueAtTime(settings.volume / 100 * .08, soundContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, soundContext.currentTime + .15);
    oscillator.connect(gain).connect(soundContext.destination);
    oscillator.start(); oscillator.stop(soundContext.currentTime + .15);
  } catch { /* Sound is optional. */ }
}
function openPanel() { sound(); play('click'); api?.companionAction?.('panel', 'toggle'); }
stage.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  down = { x: event.screenX, y: event.screenY, lastX: event.screenX, lastY: event.screenY };
  moved = false; stage.setPointerCapture(event.pointerId);
});
stage.addEventListener('pointermove', event => {
  if (!down) return;
  const dx = event.screenX - down.lastX, dy = event.screenY - down.lastY;
  if (!moved && Math.hypot(event.screenX - down.x, event.screenY - down.y) > 5) { moved = true; play('drag'); }
  if (moved && (dx || dy)) {
    down.lastX = event.screenX; down.lastY = event.screenY;
    api?.companionAction?.('move-by', { dx, dy });
  }
});
function release(event) {
  if (!down) return;
  down = null;
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  if (moved) play('idle'); else openPanel();
}
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', event => { moved = true; release(event); });
stage.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPanel(); }
});
function render(state) {
  const previousMotion = settings.motion, previousInterval = settings.idleInterval;
  settings = state?.settings || {};
  if (previousMotion !== settings.motion) syncMotion();
  else if (previousInterval !== settings.idleInterval) scheduleIdle();
  if (state?.reactionId && state.reactionId !== reactionId) { reactionId = state.reactionId; sound(); play('click'); }
  if (state?.motionId && state.motionId !== motionId) { motionId = state.motionId; play('move'); }
  const busy = Boolean(state?.jianying?.busy || state?.watermark?.running);
  if (busy && !wasBusy) play('busy');
  if (!busy && wasBusy) play('done');
  wasBusy = busy;
  document.body.dataset.palette = settings.palette || 'original';
  stage.classList.toggle('busy', busy);
  stage.style.setProperty('--pet-scale', { small: '.82', normal: '1', large: '1.12' }[settings.size] || '1');
  const name = settings.name || '大肥鱼';
  stage.setAttribute('aria-label', `打开${name}快捷面板`);
  document.title = name;
  label.textContent = state?.watermark?.running ? '水印处理中' : state?.jianying?.busy ? '剪映处理中' : name;
  label.hidden = !busy && settings.showName === false;
}
reducedMotion.addEventListener('change', syncMotion);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) videos.forEach(video => video.pause()); else syncMotion();
});
currentKind = 'initial'; play('idle'); scheduleIdle();
api?.onCompanionState?.(render);
api?.companionAction?.('sync').then(render).catch(() => {});
