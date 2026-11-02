import electron from 'electron';
import os from 'node:os';

const { BrowserWindow, screen } = electron || {};

/**
 * 月薪喵 desktop plugin.
 * - Orb window: transparent, always-on-top cat mascot that can dock to the Jianying window.
 * - Panel window: separate always-on-top frosted-glass (Windows 11 acrylic) control panel that
 *   operates Jianying automation / watermark / punctuation guard in place, like a Jianying plugin.
 */
const ORB_SIZE = { width: 230, height: 256 };
const PANEL_SIZE = { width: 390, height: 420 };

export function supportsAcrylic(release = os.release()) {
  const build = Number(String(release).split('.')[2] || 0);
  return process.platform === 'win32' && build >= 22621;
}

const SHARED_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: transparent !important; border: none !important; box-shadow: none !important;
    font-family: "Microsoft YaHei", "Segoe UI Variable Text", system-ui, sans-serif; color: #f5f7fa; user-select: none; }
  button, input, select { font: inherit; }
  button { cursor: pointer; }
`;

function orbHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>月薪喵</title><style>${SHARED_STYLE}
  .stage { position: relative; width: 230px; height: 256px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
    padding-bottom: 4px; cursor: pointer; background: transparent !important; border: none !important; box-shadow: none !important; -webkit-app-region: no-drag; }
  /* SpeechBubble 1:1 from sprmorn/DesktopPet-Miao (white rounded rect + 2px #FFB6C1 pink border, zero frosted border on window) */
  .bubble { position: absolute; top: 4px; left: 50%; transform: translateX(-50%) translateY(6px) scale(.92);
    max-width: 222px; min-width: 148px; width: max-content; padding: 8px 13px; border-radius: 15px;
    background: #ffffff; border: 2px solid #FFB6C1; color: #000000;
    font-size: 12.5px; font-weight: 700; line-height: 1.38; text-align: center; white-space: normal; word-break: break-word;
    opacity: 0; transition: opacity .2s ease, transform .2s cubic-bezier(.34,1.56,.64,1); pointer-events: none; z-index: 10; }
  .bubble.show { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  .bubble.interactive { pointer-events: auto; cursor: default; }
  .choice-btns { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 7px; }
  .choice-btn { padding: 4px 10px; border-radius: 999px; border: 1.5px solid #ff8da6; background: #fff0f4; color: #b81d4e;
    font-size: 11.5px; font-weight: 700; transition: all .15s; }
  .choice-btn:hover { background: #ffb6c1; color: #000; transform: translateY(-1px); }
  .choice-btn.cancel { padding: 4px 7px; border-color: #e2e8f0; background: #f8fafc; color: #64748b; }
  .wm-prog-wrap { position: relative; margin-top: 9px; padding-top: 6px; width: 100%; }
  .wm-prog { position: relative; height: 10px; width: 100%; border-radius: 999px; background: #ffe4ec; border: 1.5px solid #ffb6c1; overflow: hidden; box-shadow: inset 0 1px 2px rgba(255,105,135,.22); }
  .wm-prog > i { display: block; height: 100%; width: 0%; border-radius: 999px;
    background-color: #ff5c8a;
    background-image: repeating-linear-gradient(-45deg, rgba(255,255,255,.42) 0, rgba(255,255,255,.42) 8px, transparent 8px, transparent 16px);
    background-size: 22.6px 22.6px;
    animation: fastCandySpin .28s linear infinite;
    transition: width .2s ease; }
  @keyframes fastCandySpin { from { background-position: 0 0; } to { background-position: 22.6px 0; } }
  .wm-fish { position: absolute; top: -3px; left: 4%; transform: translate(-50%, 0) scaleX(-1); font-size: 15px; line-height: 1;
    filter: drop-shadow(0 2px 3px rgba(255,77,121,.35)); pointer-events: none; transition: left .2s ease;
    animation: fishSwim .42s ease-in-out infinite alternate; z-index: 2; }
  @keyframes fishSwim { from { transform: translate(-50%, -2px) scaleX(-1) rotate(-7deg); } to { transform: translate(-50%, 2px) scaleX(-1) rotate(7deg); } }
  .pet-wrap { position: relative; width: 176px; height: 176px; display: flex; align-items: center; justify-content: center;
    background: transparent !important; border: none !important; box-shadow: none !important; }
  .pet-gif { width: 172px; height: 172px; object-fit: contain; background: transparent !important; border: none !important;
    pointer-events: none; -webkit-user-drag: none; animation: idleBreathe 1.6s ease-in-out infinite; }
  .fish-svg { width: 146px; height: 146px; overflow: visible; pointer-events: none; filter: drop-shadow(0 8px 14px rgba(15,23,42,.26)); animation: fishFloat 2.8s ease-in-out infinite; display: none; }
  .fish-tail { transform-origin: 120px 80px; animation: fishWag 1.1s ease-in-out infinite; }
  .stage[data-working="1"] .fish-tail { animation-duration: .32s; }
  @keyframes fishFloat { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-6px) rotate(1.5deg); } }
  @keyframes fishWag { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(9deg); } 75% { transform: rotate(-9deg); } }
  @keyframes idleBreathe { 0%,100% { transform: scale(1) } 50% { transform: scale(0.972) } }
  .stage.jumping .pet-wrap { animation: jumpJoy .4s ease-out; }
  @keyframes jumpJoy { 0% { transform: translateY(0) } 50% { transform: translateY(-28px) } 100% { transform: translateY(0) } }
  </style></head><body>
  <div class="stage" id="stage" data-pose="default" data-theme="miao">
    <div class="bubble" id="bubble">
      <div id="bubbleText"></div>
      <div class="choice-btns" id="choiceBtns" style="display:none">
        <button type="button" class="choice-btn" id="chooseRename">✏️ 改名</button>
        <button type="button" class="choice-btn" id="chooseWatermark">💧 加水印</button>
        <button type="button" class="choice-btn cancel" id="chooseCancel" title="取消">✕</button>
      </div>
      <div class="wm-prog-wrap" id="wmProg" style="display:none">
        <div class="wm-prog"><i id="wmProgFill"></i></div>
        <span class="wm-fish" id="wmProgFish" aria-hidden="true">🐟</span>
      </div>
    </div>
    <div class="pet-wrap" id="pet-wrap">
      <img class="pet-gif" id="pet-gif" src="/miao/default.gif" alt="月薪喵" draggable="false" />
      <svg class="fish-svg" id="fish-svg" viewBox="0 0 160 150" aria-label="大肥鱼">
        <defs>
          <radialGradient id="fgBody" cx="38%" cy="30%" r="68%">
            <stop offset="0%" stop-color="#8be4ff"/><stop offset="52%" stop-color="#4ba8e8"/><stop offset="100%" stop-color="#2869b8"/>
          </radialGradient>
          <linearGradient id="fgBelly" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fffdf9"/><stop offset="100%" stop-color="#e3f4ff"/>
          </linearGradient>
        </defs>
        <g class="fish-tail">
          <path d="M118 76 C138 50, 155 54, 150 76 C156 96, 138 102, 118 82 Z" fill="url(#fgBody)"/>
          <path d="M123 77 L145 65 M123 80 L145 91" stroke="#b9f0ff" stroke-width="2" stroke-linecap="round" opacity=".65"/>
        </g>
        <path d="M64 38 C76 18, 102 22, 102 42 Z" fill="#5cb8f0"/>
        <ellipse cx="74" cy="78" rx="52" ry="43" fill="url(#fgBody)"/>
        <path d="M30 84 C38 114, 98 118, 114 86 C96 72, 48 70, 30 84 Z" fill="url(#fgBelly)"/>
        <ellipse cx="46" cy="68" rx="9.5" ry="10.5" fill="#fff"/>
        <circle cx="44" cy="68" r="5.5" fill="#172554"/>
        <circle cx="42" cy="65" r="2.2" fill="#fff"/>
        <ellipse cx="38" cy="83" rx="6.5" ry="3.8" fill="#ff8da6" opacity=".62"/>
        <path d="M25 79 Q30 83 35 79" fill="none" stroke="#1e3a8a" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M70 88 C62 104, 80 110, 86 92 Z" fill="#3b8ed6" opacity=".9"/>
      </svg>
    </div>
  </div>
  <script>
    const api = window.blackObsidian;
    const stage = document.getElementById('stage');
    const bubble = document.getElementById('bubble');
    const bubbleText = document.getElementById('bubbleText');
    const choiceBtns = document.getElementById('choiceBtns');
    const wmProg = document.getElementById('wmProg');
    const wmProgFill = document.getElementById('wmProgFill');
    const wmProgFish = document.getElementById('wmProgFish');
    const petGif = document.getElementById('pet-gif');
    const fishSvg = document.getElementById('fish-svg');
    let bubbleTimer = 0, gifTimer = 0, currentKey = 'default', choiceActive = false, workingActive = false, lastNoticeToken = '', petTheme = 'miao';

    const GIF_MAP = {
      default: '/miao/default.gif',
      angry: '/miao/angry.gif',
      comfort: '/miao/comfort.gif',
      enjoy: '/miao/enjoy.gif',
      cry: '/miao/cry.gif',
      play: '/miao/play.gif',
      float: '/miao/float.gif'
    };

    const IDLE_POOL = [
      { key: 'comfort', duration: 5500, lines: ['好舒服呀~ 蹭蹭~ 🥰', '剪片辛苦啦，摸摸头~', '把文件拖给我可以改名或加水印哦~'] },
      { key: 'enjoy', duration: 5500, lines: ['今天也要开心导片哦 ✨', '啦啦啦~ 爆款预定！', '有我在，标点句号绝不丢！'] },
      { key: 'play', duration: 6000, lines: ['一起来玩手机呀~ 📱', '刷会儿手机放松一下眼睛吧~'] },
      { key: 'float', duration: 6000, lines: ['我去休息一下啦~ 💤', '呼噜噜…充个电~'] },
      { key: 'cry', duration: 5000, lines: ['拍拍小肚皮~ 陪陪我好不好~', '渲染队列交给我盯紧啦~'] }
    ];

    function applyPetTheme(nextTheme) {
      petTheme = nextTheme === 'dafeyu' ? 'dafeyu' : 'miao';
      stage.dataset.theme = petTheme;
      petGif.style.display = petTheme === 'miao' ? 'block' : 'none';
      fishSvg.style.display = petTheme === 'dafeyu' ? 'block' : 'none';
    }

    function showMessage(text, duration = 3000, opts = {}) {
      if (!text) return;
      choiceActive = Boolean(opts.choice);
      bubbleText.textContent = text;
      choiceBtns.style.display = opts.choice ? 'flex' : 'none';
      wmProg.style.display = typeof opts.progress === 'number' ? 'block' : 'none';
      if (typeof opts.progress === 'number') {
        const pct = Math.max(4, Math.min(100, opts.progress));
        wmProgFill.style.width = pct + '%';
        if (wmProgFish) wmProgFish.style.left = Math.max(6, Math.min(94, pct)) + '%';
      }
      bubble.classList.toggle('interactive', Boolean(opts.choice));
      bubble.classList.add('show');
      clearTimeout(bubbleTimer);
      if (duration > 0 && !opts.choice && !opts.working) {
        bubbleTimer = setTimeout(() => {
          if (!choiceActive && !workingActive) bubble.classList.remove('show');
        }, duration);
      }
    }

    function switchGif(key, message, duration = 5200, opts = {}) {
      const target = GIF_MAP[key] || GIF_MAP.default;
      if (currentKey !== key) {
        currentKey = key;
        petGif.src = target;
      }
      stage.dataset.pose = key;
      stage.dataset.working = opts.working ? '1' : '0';
      if (message) showMessage(message, (opts.choice || opts.working) ? 0 : Math.min(duration, 3600), opts);
      clearTimeout(gifTimer);
      if (key !== 'default' && !opts.choice && !opts.working) {
        gifTimer = setTimeout(() => {
          if (workingActive) return;
          currentKey = 'default';
          petGif.src = GIF_MAP.default;
          stage.dataset.pose = 'default';
        }, duration);
      }
    }

    (function greetByTime() {
      const h = new Date().getHours();
      if (h >= 5 && h < 11) switchGif('enjoy', '早上好呀！新的一天元气满满~ ☀️', 4500);
      else if (h >= 11 && h < 14) switchGif('comfort', '中午好！记得按时吃饭休息哦~ 🍱', 4500);
      else if (h >= 14 && h < 19) switchGif('play', '下午好！点我可展开自动化悬浮窗~ ✨', 4500);
      else if (h >= 19 && h < 23) switchGif('comfort', '晚上好！把视频拖给我可改名或加水印~ 🥰', 4500);
      else switchGif('float', '夜深了，早点休息哦~ 💤', 5500);
    })();

    setInterval(() => {
      if (currentKey !== 'default' || choiceActive || workingActive) return;
      if (Math.random() < 0.6) {
        const pick = IDLE_POOL[Math.floor(Math.random() * IDLE_POOL.length)];
        const line = Math.random() < 0.55 ? pick.lines[Math.floor(Math.random() * pick.lines.length)] : '';
        switchGif(pick.key, line, pick.duration);
      }
    }, 8500);

    window.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
    window.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation();
      const files = Array.from(e.dataTransfer?.files || []);
      const paths = files.map(f => f.path || f.name).filter(Boolean);
      if (!paths.length) return;
      const res = await api?.companionAction?.('drop-paths', paths);
      const count = res?.droppedFilesCount || paths.length;
      switchGif('comfort', '收到 ' + count + ' 个文件，要对这些文件做什么呢？', 15000, { choice: true });
    });

    document.getElementById('chooseRename').onclick = e => {
      e.stopPropagation();
      choiceActive = false;
      bubble.classList.remove('show', 'interactive');
      api?.companionAction?.('drop-choice', 'rename');
    };
    document.getElementById('chooseWatermark').onclick = e => {
      e.stopPropagation();
      choiceActive = false;
      workingActive = true;
      switchGif('play', '努力加样片水印中 0%…', 0, { working: true, progress: 4 });
      api?.companionAction?.('drop-choice', 'watermark');
    };
    document.getElementById('chooseCancel').onclick = e => {
      e.stopPropagation();
      choiceActive = false;
      bubble.classList.remove('show', 'interactive');
      api?.companionAction?.('drop-choice', 'cancel');
    };

    const togglePanel = () => {
      if (choiceActive) return;
      petGif.style.transform = 'scale(0.94)';
      setTimeout(() => { petGif.style.transform = ''; }, 150);
      api?.companionAction?.('panel', 'toggle');
    };

    stage.addEventListener('dblclick', e => {
      if (e.target.closest('.choice-btns')) return;
      stage.classList.remove('jumping');
      void stage.offsetWidth;
      stage.classList.add('jumping');
      switchGif('enjoy', '双击好开心！✨', 4500);
    });

    let down = false, dragged = false, startX = 0, startY = 0, lastX = 0, lastY = 0;
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('.choice-btns')) return;
      down = true; dragged = false;
      startX = lastX = e.screenX;
      startY = lastY = e.screenY;
      try { stage.setPointerCapture(e.pointerId); } catch {}
    });
    stage.addEventListener('pointermove', e => {
      if (!down) return;
      const total = Math.hypot(e.screenX - startX, e.screenY - startY);
      if (total >= 5) dragged = true;
      if (dragged) {
        const dx = e.screenX - lastX, dy = e.screenY - lastY;
        lastX = e.screenX; lastY = e.screenY;
        if (dx || dy) {
          api?.companionAction?.('move-by', { dx, dy });
          if (e.screenX <= 12 || e.screenY <= 12 || e.screenX >= window.screen.availWidth - 12 || e.screenY >= window.screen.availHeight - 12) {
            switchGif('angry', '哎呀！撞疼我了！😣', 3000);
          }
        }
      }
    });
    stage.addEventListener('pointerup', e => {
      if (!down) return;
      down = false;
      try { stage.releasePointerCapture(e.pointerId); } catch {}
      if (!dragged) togglePanel();
    });

    function render(s) {
      if (!s) return;
      if (s.petTheme) applyPetTheme(s.petTheme);
      const wm = s.watermark || {}, jy = s.jianying || {};
      if (s.pendingDropCount > 0 && !wm.running) {
        workingActive = false;
        switchGif('comfort', '收到 ' + s.pendingDropCount + ' 个文件，要对这些文件做什么呢？', 15000, { choice: true });
        return;
      }
      if (wm.running) {
        choiceActive = false;
        workingActive = true;
        switchGif('play', '努力加水印中 ' + (wm.overallProgress || 0) + '% (' + (wm.completedCount || 0) + '/' + (wm.totalCount || 0) + ')…', 0, { working: true, progress: wm.overallProgress || 4 });
      } else if (jy.extractProgress && jy.extractProgress.percent < 100) {
        choiceActive = false;
        workingActive = true;
        switchGif('play', '努力提取字幕中 ' + (jy.extractProgress.percent || 0) + '% (' + (jy.extractProgress.current || 0) + '/' + (jy.extractProgress.total || 0) + ')…', 0, { working: true, progress: jy.extractProgress.percent || 4 });
      } else if (workingActive) {
        workingActive = false;
        choiceActive = false;
        if (s.orbNoticeToken) lastNoticeToken = s.orbNoticeToken;
        switchGif('default', s.orbNotice || '已经输出在原目录下啦 ✨', 5200);
      } else if (s.orbNotice && s.orbNoticeToken && s.orbNoticeToken !== lastNoticeToken) {
        lastNoticeToken = s.orbNoticeToken;
        choiceActive = false;
        switchGif('default', s.orbNotice, 5200);
      } else if (jy.exporting) {
        showMessage('正在自动导出剪映视频… 🚀', 2500);
      }
    }
    api?.onCompanionState?.(render);
    api?.companionAction?.('sync').then(render).catch(() => {});
  </script></body></html>`;
}

function panelHtml(acrylic) {
  const surface = acrylic ? 'rgba(16, 20, 26, 0.56)' : 'linear-gradient(160deg, rgba(24,28,36,.98), rgba(12,15,20,.99))';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>悬浮窗 · 剪映自动化</title><style>${SHARED_STYLE}
  body { background: ${surface}; }
  .wrap { height: 100%; display: flex; flex-direction: column; gap: 9px; padding: 12px 12px 10px; animation: pop .24s cubic-bezier(.34,1.56,.64,1); }
  @keyframes pop { from { opacity: 0; transform: translateY(6px) scale(.98) } to { opacity: 1; transform: none } }
  header { display: flex; align-items: center; gap: 9px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,.1); cursor: move; -webkit-app-region: drag; }
  .avatar { width: 34px; height: 34px; border-radius: 10px; object-fit: contain; background: transparent; pointer-events: none; }
  header h1 { font-size: 13.5px; font-weight: 800; letter-spacing: -.01em; }
  header p { font-size: 10.5px; color: #aab3bf; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  header .grow { flex: 1; min-width: 0; }
  .icon { -webkit-app-region: no-drag; width: 27px; height: 27px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14);
    background: rgba(255,255,255,.06); color: #d7dde5; font-size: 12px; display: inline-flex; align-items: center; justify-content: center; transition: all .15s; }
  .icon:hover { border-color: #ffcf6e; color: #ffcf6e; }
  .icon.on { background: rgba(255,207,110,.2); border-color: #ffcf6e; color: #ffcf6e; }
  .theme-mini { -webkit-app-region: no-drag; width: 19px; height: 19px; border-radius: 6px; border: 1px solid rgba(255,255,255,.06);
    background: rgba(255,255,255,.02); color: rgba(255,255,255,.32); font-size: 9.5px; opacity: .42;
    display: inline-flex; align-items: center; justify-content: center; transition: all .18s; padding: 0; }
  .theme-mini:hover { opacity: .95; border-color: rgba(255,207,110,.4); color: #ffcf6e; background: rgba(255,255,255,.08); }

  /* 4-Stage Top Bar moved from Main Window into Floating Window */
  .stage-bar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; background: rgba(0,0,0,.28); padding: 4px; border-radius: 12px; border: 1px solid rgba(255,255,255,.09); }
  .stage-tab { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 6px 7px; border-radius: 9px;
    border: 1px solid transparent; background: transparent; color: #aeb7c4; text-align: left; transition: all .16s; }
  .stage-tab:hover { color: #f3f6fa; background: rgba(255,255,255,.05); }
  .stage-tab.active { background: rgba(255,207,110,.16); border-color: rgba(255,207,110,.55); color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,.22); }
  .stage-num { font-size: 9.5px; font-weight: 800; color: #ffcf6e; letter-spacing: .04em; }
  .stage-tab strong { font-size: 11.5px; font-weight: 750; line-height: 1.2; }

  .scroll { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 9px; padding-right: 2px; }
  .scroll::-webkit-scrollbar { width: 4px } .scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 4px }
  .card { padding: 10px 11px; border-radius: 13px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.07); display: flex; flex-direction: column; gap: 8px; }
  .card.active { border-color: rgba(255,207,110,.65); }
  .card[hidden], #jyPostScanArea[hidden] { display: none !important; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .title { font-size: 12px; font-weight: 750; display: flex; align-items: center; gap: 6px; }
  .meta { font-size: 10.5px; color: #aab3bf; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 195px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #64748b; flex-shrink: 0; }
  .dot.on { background: #8ee06b; box-shadow: 0 0 6px #8ee06b; } .dot.run { background: #ffcf6e; box-shadow: 0 0 8px #ffcf6e; }

  .hotkeys { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  .hk { padding: 2px 7px; border-radius: 999px; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.1); font-size: 10px; color: #c6cfdb; }
  .hk kbd { color: #ffcf6e; font-weight: 800; font-family: Consolas, monospace; margin-right: 3px; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
  .btn { padding: 7px 8px; border-radius: 9px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.07);
    color: #f1f4f8; font-size: 11px; font-weight: 650; transition: all .15s; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
  .btn:hover:not(:disabled) { border-color: #ffcf6e; background: rgba(255,207,110,.14); transform: translateY(-1px); }
  .btn:disabled { opacity: .42; cursor: not-allowed; }
  .btn.primary { background: #ffcf6e; border-color: #ffcf6e; color: #1c1206; font-weight: 750; }
  .btn.danger { border-color: rgba(248,113,113,.6); color: #fca5a5; }
  .btn.active { background: rgba(255,207,110,.22); border-color: #ffcf6e; color: #ffcf6e; }
  .btn-spin { width: 11px; height: 11px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; display: inline-block; animation: bspin .65s linear infinite; flex-shrink: 0; }
  @keyframes bspin { to { transform: rotate(360deg); } }

  .field { display: flex; flex-direction: column; gap: 4px; }
  .field > span, .field .row > span { font-size: 10.5px; color: #b9c2ce; font-weight: 600; }
  .input, .select { width: 100%; padding: 6px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.32); color: #f5f7fa; font-size: 11px; outline: none; }
  .select option { background: #181d24; color: #f5f7fa; padding: 4px 8px; }
  .input:focus, .select:focus { border-color: #ffcf6e; }
  .path-row { display: flex; align-items: center; gap: 5px; }
  .path-row .input { flex: 1; min-width: 0; }

  .table-wrap { max-height: 150px; overflow-y: auto; overscroll-behavior: contain; border-radius: 9px; border: 1px solid rgba(255,255,255,.1); background: rgba(0,0,0,.24); }
  .table-wrap::-webkit-scrollbar { width: 4px; }
  .table-wrap::-webkit-scrollbar-thumb { background: rgba(255,255,255,.24); border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,.07); }
  th { position: sticky; top: 0; background: rgba(18,22,28,.95); color: #9aa5b4; font-size: 10px; }
  tr.sel { background: rgba(255,207,110,.13); }
  .empty-tip { padding: 14px 10px; text-align: center; font-size: 11px; color: #94a3b8; }

  .drop-guide { padding: 12px; border-radius: 11px; border: 1.5px dashed rgba(255,182,193,.65); background: rgba(255,182,193,.08);
    text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; transition: all .16s; }
  .drop-guide:hover, .drop-guide.drag { background: rgba(255,182,193,.16); border-color: #ffb6c1; }
  .drop-guide strong { font-size: 11.5px; color: #ffd6e0; }
  .drop-guide small { font-size: 10px; color: #cbd5e1; line-height: 1.45; }

  details.sub-panel { border-top: 1px solid rgba(255,255,255,.09); padding-top: 7px; }
  details.sub-panel > summary { font-size: 11px; font-weight: 700; color: #d7dde5; cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; }
  .waits-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 6px; }
  .waits-grid label { display: flex; flex-direction: column; gap: 2px; font-size: 9.5px; color: #aab3bf; }

  .bar { height: 6px; border-radius: 999px; background: rgba(0,0,0,.35); overflow: hidden; }
  .bar > i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ffcf6e, #ff7aa2); transition: width .25s; }
  .log { font-size: 10.5px; color: #c4cbd4; background: rgba(0,0,0,.26); border-radius: 8px; padding: 6px 8px; line-height: 1.45;
    max-height: 64px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
  .jobs { display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto; }
  .job { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #d7dde5; padding: 4px 6px; border-radius: 7px; background: rgba(0,0,0,.2); }
  .job span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .job b { font-weight: 600; color: #aab3bf; } .job b.done { color: #8ee06b; } .job b.err { color: #fca5a5; } .job b.run { color: #ffcf6e; }
  .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999;
    background: rgba(10, 14, 20, 0.78); backdrop-filter: blur(5px);
    display: flex; align-items: center; justify-content: center; padding: 14px; animation: pop .18s ease-out; }
  .modal-overlay[hidden] { display: none !important; }
  .modal-dialog { width: 100%; max-width: 330px; background: #1a202c; border: 1px solid rgba(255,207,110,.45);
    border-radius: 13px; padding: 13px 14px; box-shadow: 0 16px 36px rgba(0,0,0,.6); display: flex; flex-direction: column; gap: 8px; }

  details.sub-panel.log-panel { border-top: 1px solid rgba(255,255,255,.09); padding-top: 7px; margin-top: auto; }
  summary.log-summary { font-size: 11px; font-weight: 700; color: #d7dde5; cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; user-select: none; }
  summary.log-summary .summary-title { display: flex; align-items: center; gap: 5px; }
  summary.log-summary .log-arrow { font-size: 9px; color: #ffcf6e; transition: transform .18s ease; display: inline-block; }
  details[open] summary.log-summary .log-arrow { transform: rotate(90deg); }
  .modal { border-color: #ffcf6e; background: rgba(255,207,110,.14); }
  .modal p { font-size: 11px; line-height: 1.55; white-space: pre-wrap; }
  .toast { position: fixed; left: 12px; right: 12px; bottom: 48px; padding: 8px 10px; border-radius: 10px; font-size: 11px;
    background: rgba(20,16,12,.94); border: 1px solid rgba(255,207,110,.55); color: #ffe2a8; opacity: 0; transform: translateY(6px); transition: all .2s; pointer-events: none; z-index: 30; }
  .toast.show { opacity: 1; transform: none; }
  footer { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  </style></head><body><div class="wrap">
  <header id="panelHeader">
    <img class="avatar" id="panelAvatar" src="/miao/default.gif" alt="月薪喵" draggable="false" />
    <div class="grow"><h1>剪映自动化 · 悬浮窗</h1><p id="dockLabel">桌面置顶 · 可磁吸剪映窗口</p></div>
    <button class="theme-mini" id="petThemeBtn" title="切换桌宠主题：月薪喵 / 大肥鱼">🐟</button>
    <button class="icon" id="pkSwitch" title="剪贴板句号守护开关">🛡️</button>
    <button class="icon" id="dockBtn" title="自动磁吸跟随剪映窗口（默认关闭，点击开启）">🧲</button>
    <button class="icon" id="closeBtn" title="收起悬浮窗面板（不退出软件）">✕</button>
  </header>

  <!-- 4-Stage Top Bar (01 批量导出 / 02 字幕工程 / 03 批量改名 / 04 样片水印) -->
  <nav class="stage-bar" role="tablist" aria-label="剪映自动化四阶段导航">
    <button type="button" class="stage-tab active" data-stage="export" role="tab">
      <span class="stage-num">01</span><strong>批量导出</strong>
    </button>
    <button type="button" class="stage-tab" data-stage="subtitles" role="tab">
      <span class="stage-num">02</span><strong>字幕工程</strong>
    </button>
    <button type="button" class="stage-tab" data-stage="rename" role="tab">
      <span class="stage-num">03</span><strong>批量改名</strong>
    </button>
    <button type="button" class="stage-tab" data-stage="watermark" role="tab">
      <span class="stage-num">04</span><strong>样片水印</strong>
    </button>
  </nav>

  <!-- Confirmation Modal Overlay -->
  <div class="modal-overlay" id="modalCard" hidden>
    <div class="modal-dialog">
      <div class="title" id="modalTitle" style="font-size:13px;font-weight:750;color:#ffcf6e">⚠️ 安全确认</div>
      <p id="modalMsg" style="font-size:11.5px;line-height:1.6;color:#e2e8f0;white-space:pre-wrap;margin:4px 0 8px"></p>
      <div class="grid">
        <button class="btn" id="modalNo">取消</button>
        <button class="btn primary" id="modalYes">确认执行</button>
      </div>
    </div>
  </div>

  <!-- Wait Times Modal Overlay -->
  <div class="modal-overlay" id="waitsModalOverlay" hidden>
    <div class="modal-dialog">
      <div class="row" style="align-items:flex-start">
        <div>
          <div class="title" style="font-size:12.5px;font-weight:750;color:#ffcf6e">⏱️ 导出步骤等待时间参数</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:2px">
            <span id="waitsModeLabel" style="color:#ffcf6e;font-weight:700">收起至首页 · 后台</span> · 两种模式独立记忆
          </div>
        </div>
        <button class="btn" id="jyCloseWaitsModalTop" style="padding:2px 6px;font-size:11px;min-width:0">✕</button>
      </div>
      <div class="waits-grid" style="margin-top:6px">
        <label><span>打开草稿(s)</span><input type="number" step="0.1" min="0.1" class="input" id="w_open_draft" value="8"></label>
        <label><span>点击导出(s)</span><input type="number" step="0.1" min="0.1" class="input" id="w_export" value="3"></label>
        <label><span>确认导出(s)</span><input type="number" step="0.1" min="0.1" class="input" id="w_confirm" value="1"></label>
        <label><span>收起首页(s)</span><input type="number" step="0.1" min="0.1" class="input" id="w_popup_close" value="1.5"></label>
        <label><span>关闭窗口(s)</span><input type="number" step="0.1" min="0.1" class="input" id="w_close_btn" value="2"></label>
        <label><span>关闭草稿(s)</span><input type="number" step="0.1" min="0.1" class="input" id="w_draft_close" value="1.5"></label>
      </div>
      <div class="grid" style="margin-top:8px">
        <button class="btn" id="jyCloseWaitsModal">取消</button>
        <button class="btn primary" id="jySaveWaitsModal">保存当前模式参数</button>
      </div>
    </div>
  </div>

  <div class="scroll">

    <!-- STAGE 01: 批量导出 -->
    <div class="card" id="stageExport">
      <div class="field">
        <span>导出模式（切换模式自动匹配对应坐标）</span>
        <div class="grid" id="jyModeBox" role="radiogroup" aria-label="导出模式选择">
          <button type="button" class="btn active" id="jyModeReturnHome" data-mode="return_home">收起至首页 · 后台</button>
          <button type="button" class="btn" id="jyModeWaitClose" data-mode="wait_close">等待完成 · 逐个</button>
        </div>
      </div>
      <div class="row">
        <div class="title"><span class="dot" id="jyDot"></span><span id="jyMeta">就绪</span></div>
        <button class="btn danger" id="jyStop" style="padding:3px 8px;font-size:10px">中断 · F10</button>
      </div>
      <div class="hotkeys">
        <span class="hk"><kbd>F8</kbd>录制坐标</span>
        <span class="hk"><kbd>F9</kbd>跳过等待</span>
        <span class="hk"><kbd>F10</kbd>紧急中断</span>
      </div>
      <div class="log" id="jyGuideBox">打开剪映首页后，可录制坐标或 AI 扫描草稿列表。</div>
      <div class="grid-3">
        <button class="btn" id="jyWizard">🎯 录制坐标</button>
        <button class="btn" id="jyScan">📸 截图识别</button>
        <button class="btn primary" id="jyExport">🚀 批量导出</button>
      </div>

      <div id="jyPostScanArea" style="display:flex;flex-direction:column;gap:8px">
      <div class="table-wrap">
        <table>
          <thead><tr><th style="width:42px">起点</th><th>草稿名称</th><th style="width:64px">状态</th></tr></thead>
          <tbody id="jyQueueBody">
            <tr><td colspan="3" class="empty-tip">点击「📸 截图识别」AI 扫描剪映首页草稿</td></tr>
          </tbody>
        </table>
      </div>

      <div class="field">
        <span>AI 视觉识别模型（已配置供应商-模型）</span>
        <select class="select" id="jyModelSelect">
          <option value="">请先在主窗口添加可用模型</option>
        </select>
      </div>
      <button class="btn" id="jyOpenWaitsModal" type="button" style="padding:6px 10px;font-size:11px">⏱️ 调整等待时间参数</button>

      <details class="sub-panel log-panel" open>
        <summary class="log-summary">
          <span class="summary-title"><span class="log-arrow">▸</span> 批量导出日志</span>
          <span class="log-count" id="jyLogCount_export">0 条</span>
        </summary>
        <div class="log" id="jyLog_export" style="margin-top:6px">等待指令…</div>
      </details>
      </div>
    </div>

    <!-- STAGE 02: 字幕工程 -->
    <div class="card" id="stageSubtitles" hidden>
      <div class="title">02 字幕工程（自动记忆上次目录）</div>
      <div class="field">
        <span>剪映草稿根目录 (JianyingPro Drafts)</span>
        <div class="path-row">
          <input class="input" id="jyDraftDir" placeholder="选择或粘贴剪映 Drafts 草稿根目录（自动记忆）" />
          <button class="btn" id="jyPickDraftDir">浏览</button>
        </div>
      </div>
      <div class="field">
        <span>SRT 字幕导出目录</span>
        <div class="path-row">
          <input class="input" id="jySubOut" placeholder="选择或粘贴字幕导出文件夹（默认桌面）" />
          <button class="btn" id="jyPickSubOut">浏览</button>
        </div>
      </div>
      <div class="grid">
        <button class="btn primary" id="jyExtract">提取字幕并隐藏轨道</button>
        <button class="btn" id="jyFonts">统一 Noto Sans Bold</button>
      </div>
      <div class="grid">
        <button class="btn" id="jyPunctuation">检查并还原标准标点</button>
        <button class="btn" id="jyUnhide">恢复所有草稿字幕显示</button>
      </div>
      <small style="font-size:10px;color:#94a3b8">提示：检查并还原标准标点可将保护标点（․﹒‚﹐）还原为标准英文 . , 且不改动样式与时间轴；修改前请先退出剪映，工具会自动备份草稿 JSON。</small>
      <details class="sub-panel log-panel" open>
        <summary class="log-summary">
          <span class="summary-title"><span class="log-arrow">▸</span> 字幕工程日志</span>
          <span class="log-count" id="jyLogCount_sub">0 条</span>
        </summary>
        <div class="log" id="jyLog_sub" style="margin-top:6px">就绪，可提取或恢复草稿字幕…</div>
      </details>
    </div>

    <!-- STAGE 03: 批量改名 -->
    <div class="card" id="stageRename" hidden>
      <div class="drop-guide" id="renameDropZone">
        <strong>🐾 请将需要改名的文件或文件夹拖放到「月薪喵」上</strong>
        <small>支持拖放整个文件夹（自动处理子文件），也可直接拖入此处或点击下方按钮选择</small>
      </div>
      <div class="row">
        <span class="meta" id="renameFilesMeta">尚未拖入文件</span>
        <div style="display:flex;gap:5px">
          <button class="btn" id="jyPickRenameDir" style="padding:4px 8px;font-size:10px">选文件夹</button>
          <button class="btn" id="jyPickRenameFiles" style="padding:4px 8px;font-size:10px">选文件</button>
          <button class="btn" id="jyClearRenameFiles" style="padding:4px 8px;font-size:10px">清除列表</button>
        </div>
      </div>
      <div class="grid">
        <button class="btn active" id="renameModeTpl">按集数模板</button>
        <button class="btn" id="renameModeAi">AI 智能命名</button>
      </div>
      <div class="field">
        <span>命名模板</span>
        <input class="input" id="renameTemplate" value="短剧名称_第1集" placeholder="例如：短剧名称_第1集" />
      </div>
      <div class="grid">
        <button class="btn" id="jyPreviewRename">生成改名预览</button>
        <button class="btn primary" id="jyExecuteRename" disabled>开始执行改名</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>原文件名</th><th>新文件名</th></tr></thead>
          <tbody id="jyPlanBody">
            <tr><td colspan="2" class="empty-tip">拖入文件并选择模式后点击「生成改名预览」</td></tr>
          </tbody>
        </table>
      </div>
      <details class="sub-panel log-panel" open>
        <summary class="log-summary">
          <span class="summary-title"><span class="log-arrow">▸</span> 批量改名日志</span>
          <span class="log-count" id="jyLogCount_rename">0 条</span>
        </summary>
        <div class="log" id="jyLog_rename" style="margin-top:6px">就绪，拖入文件后可生成改名预览…</div>
      </details>
    </div>

    <!-- STAGE 04: 样片水印 -->
    <div class="card" id="stageWatermark" hidden>
      <div class="drop-guide" id="wmDropZone">
        <strong>💧 请将需要加水印的视频或文件夹拖放到「月薪喵」上</strong>
        <small>选择「加水印」后将在原视频同目录直接输出「原文件名+样片.mp4」，月薪喵实时显示进度并在完成后粉框提醒</small>
      </div>
      <div class="row">
        <div class="title"><span class="dot" id="wmDot"></span>批量样片水印</div>
        <div style="display:flex;align-items:center;gap:5px">
          <span class="meta" id="wmMeta">空闲</span>
          <button class="btn" id="wmClear" style="padding:3px 8px;font-size:10px">清除列表</button>
        </div>
      </div>
      <div class="bar"><i id="wmBar"></i></div>
      <div class="jobs" id="wmJobs"></div>
      <div class="grid">
        <button class="btn" id="wmAdd">＋ 添加视频</button>
        <button class="btn primary" id="wmRun">开始合成</button>
      </div>
      <details class="sub-panel log-panel" open>
        <summary class="log-summary">
          <span class="summary-title"><span class="log-arrow">▸</span> 样片水印日志</span>
          <span class="log-count" id="jyLogCount_wm">0 条</span>
        </summary>
        <div class="log" id="jyLog_wm" style="margin-top:6px">就绪，拖入视频即可批量合成样片…</div>
      </details>
    </div>
  </div>

  <footer>
    <button class="btn" id="launchJy">🚀 启动剪映</button>
    <button class="btn" id="openMain">🏠 返回主工作台</button>
  </footer>
  <div class="toast" id="toast"></div>
  </div>
  <script>
    const api = window.blackObsidian, $ = id => document.getElementById(id);
    let state = null, toastTimer = 0, currentStage = localStorage.getItem('xm.jianying.stage') || 'export';
    let selectedDraftIdx = 0, aiRenameMode = false, renameFolder = '', waitsDirty = false, lastForceStageToken = '', showJyParams = false, lastJyNotice = '', currentExportMode = 'return_home';
    let modelOptions = [], lastModelsSignature = '';

    function updateModeButtons(mode) {
      currentExportMode = mode === 'wait_close' ? 'wait_close' : 'return_home';
      if ($('jyModeReturnHome')) $('jyModeReturnHome').classList.toggle('active', currentExportMode === 'return_home');
      if ($('jyModeWaitClose')) $('jyModeWaitClose').classList.toggle('active', currentExportMode === 'wait_close');
    }

    const toast = msg => {
      const t = $('toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
    };

    $('panelHeader').addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
      api?.companionAction?.('panel-drag');
    });

    function switchStage(stage, notifyCat = false) {
      if (!['export', 'subtitles', 'rename', 'watermark'].includes(stage)) stage = 'export';
      currentStage = stage;
      loadCachedModels();
      if (stage === 'rename' && $('jyPreviewRename')) {
        $('jyPreviewRename').textContent = aiRenameMode ? '生成 AI 预览' : '生成改名预览';
      }
      try { localStorage.setItem('xm.jianying.stage', stage); } catch {}
      document.querySelectorAll('.stage-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.stage === stage);
      });
      $('stageExport').hidden = stage !== 'export';
      $('stageSubtitles').hidden = stage !== 'subtitles';
      $('stageRename').hidden = stage !== 'rename';
      $('stageWatermark').hidden = stage !== 'watermark';
      if (notifyCat) {
        if (stage === 'rename' || stage === 'watermark') {
          toast('请将需要改名或加水印的文件/文件夹拖放到月薪喵上~');
          api?.companionAction?.('prompt-drop', stage);
        } else {
          api?.companionAction?.('set-stage', stage);
        }
      }
    }

    document.querySelectorAll('.stage-tab').forEach(btn => {
      btn.onclick = () => switchStage(btn.dataset.stage, true);
    });

    function formatProviderLabel(p) {
      const rawName = String(p?.name || '').trim();
      if (rawName && rawName !== 'Provider Select') return rawName;
      if (p?.protocol === 'gemini') return 'Gemini AI Studio';
      if (p?.protocol === 'openai') return 'OpenAI 兼容';
      if (p?.protocol === 'anthropic') return 'Anthropic';
      return String(p?.id || 'AI').trim();
    }

    function loadCachedModels(providersFromState) {
      try {
        let cached = providersFromState;
        if (!Array.isArray(cached) || !cached.length) {
          cached = JSON.parse(
            localStorage.getItem('black-obsidian.providers.v1') ||
            localStorage.getItem('xm.providers.cache') ||
            '[]'
          );
        } else {
          try {
            const jsonStr = JSON.stringify(cached);
            localStorage.setItem('xm.providers.cache', jsonStr);
            localStorage.setItem('black-obsidian.providers.v1', jsonStr);
          } catch {}
        }
        const savedKey = localStorage.getItem('xm.jianying.model') || '';
        const sel = $('jyModelSelect');
        if (!sel) return;
        const opts = [];
        for (const p of (Array.isArray(cached) ? cached : [])) {
          const pName = formatProviderLabel(p);
          const pid = p?.id || pName;
          const models = Array.isArray(p?.models) ? p.models : [];
          for (const rawM of models) {
            const m = String(rawM || '').trim();
            if (!m) continue;
            opts.push({
              key: pid + '::' + m,
              label: pName + '-' + m,
              provider: p,
              model: m
            });
          }
        }
        modelOptions = opts;
        const sig = opts.map(o => o.key + '=' + o.label).join('|');
        if (sig !== lastModelsSignature) {
          lastModelsSignature = sig;
          if (opts.length) {
            sel.innerHTML = opts.map(o => '<option value="' + o.key.replace(/"/g, '&quot;') + '">' + o.label.replace(/</g, '&lt;') + '</option>').join('');
            if (savedKey && opts.some(o => o.key === savedKey)) {
              sel.value = savedKey;
            } else {
              sel.value = opts[0].key;
              try { localStorage.setItem('xm.jianying.model', opts[0].key); } catch {}
            }
          } else {
            sel.innerHTML = '<option value="">请先在主窗口添加可用模型</option>';
          }
        } else if (opts.length && savedKey && opts.some(o => o.key === savedKey) && sel.value !== savedKey && document.activeElement !== sel) {
          sel.value = savedKey;
        }
        sel.onchange = () => {
          try { localStorage.setItem('xm.jianying.model', sel.value); } catch {}
        };
      } catch {}
    }
    loadCachedModels();

    function getSelectedModelConnection() {
      const key = $('jyModelSelect')?.value || '';
      const matched = (key ? modelOptions.find(o => o.key === key) : null) || modelOptions[0] || null;
      return matched ? { provider: matched.provider, model: matched.model } : undefined;
    }

    const act = async (action, value, btnEl, loadingLabel) => {
      let origHtml = '';
      if (btnEl && !btnEl.disabled) {
        origHtml = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = '<span class="btn-spin"></span>' + (loadingLabel || '启动中…');
      }
      try {
        const res = await api.companionAction(action, value);
        if (res && res.error) toast(res.error);
        else if (res) render(res);
        return res;
      } catch (e) {
        toast(String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      } finally {
        if (btnEl && origHtml) {
          setTimeout(() => {
            btnEl.disabled = false;
            if (btnEl.querySelector('.btn-spin')) btnEl.innerHTML = origHtml;
          }, action === 'launch-jy' ? 1400 : 260);
        }
      }
    };

    (async function restoreRememberedPaths() {
      try {
        const savedDraft = localStorage.getItem('xm.jianying.draftDir') || '';
        const savedSub = localStorage.getItem('xm.jianying.subtitleOutput') || '';
        if (savedDraft) $('jyDraftDir').value = savedDraft;
        if (savedSub) $('jySubOut').value = savedSub;
        if (savedDraft || savedSub) {
          await api?.companionAction?.('jy-paths', { draftDir: savedDraft || undefined, subtitleOutput: savedSub || undefined });
        }
      } catch {}
    })();

    const statusText = { pending: '排队', processing: '合成中', done: '完成', error: '失败', cancelled: '取消' };

    function render(s) {
      if (!s) return;
      state = s;
      loadCachedModels(Array.isArray(s.providers) && s.providers.length ? s.providers : undefined);
      if (s.activeStage && s.forceStageToken && s.forceStageToken !== lastForceStageToken) {
        lastForceStageToken = s.forceStageToken;
        if (s.activeStage !== currentStage) {
          switchStage(s.activeStage, false);
        }
      }
      if ($('petThemeBtn')) {
        const isFish = s.petTheme === 'dafeyu';
        $('petThemeBtn').textContent = isFish ? '🐱' : '🐟';
        $('petThemeBtn').title = isFish ? '当前：大肥鱼（点击切换回月薪喵）' : '当前：月薪喵（点击切换大肥鱼主题）';
      }
      const jy = s.jianying || {}, wm = s.watermark || {};
      if (jy.notice && jy.notice !== lastJyNotice) {
        lastJyNotice = jy.notice;
        toast(jy.notice);
      }
      $('dockBtn').className = 'icon' + (s.autoDock ? ' on' : '');
      $('pkSwitch').className = 'icon' + (s.periodEnabled ? ' on' : '');
      $('dockLabel').textContent = (s.jianyingFound ? (s.autoDock ? '✓ 已吸附剪映' : '已检测到剪映') : '桌面置顶') + (s.periodEnabled ? ' · 句号守护中' : '');

      const jyRun = jy.busy || jy.exporting || jy.recording;
      $('jyDot').className = 'dot ' + (jyRun ? 'run' : jy.ready ? 'on' : '');
      $('jyMeta').textContent = jy.status || '就绪';
      $('jyGuideBox').textContent = jy.guide || jy.lastLog || '打开剪映首页后，可录制坐标或 AI 扫描草稿列表。';
      const allLogs = Array.isArray(jy.logs) ? jy.logs : [];
      const exportLogs = allLogs.filter(l => !/✓\\s+.*\\.srt|统一\\s+Noto|恢复所有草稿字幕|还原标准标点|受保护标点/i.test(l));
      if ($('jyLog_export')) {
        $('jyLog_export').textContent = exportLogs.length ? exportLogs.join('\\n') : (jy.lastLog || '等待指令…');
        $('jyLogCount_export').textContent = exportLogs.length + ' 条';
      }
      const subLogs = allLogs.filter(l => /字幕|srt|轨道|Noto|草稿|标点/i.test(l));
      if ($('jyLog_sub')) {
        $('jyLog_sub').textContent = subLogs.length ? subLogs.join('\\n') : '就绪，可提取或恢复草稿字幕…';
        $('jyLogCount_sub').textContent = subLogs.length + ' 条';
      }
      const renameLogs = allLogs.filter(l => /改名|重命名|预览|模板/i.test(l));
      if ($('jyLog_rename')) {
        $('jyLog_rename').textContent = renameLogs.length ? renameLogs.join('\\n') : (Array.isArray(jy.plan) && jy.plan.length ? '已生成 ' + jy.plan.length + ' 个改名预览项' : '就绪，拖入文件后可生成改名预览…');
        $('jyLogCount_rename').textContent = renameLogs.length + ' 条';
      }
      const jobs = Array.isArray(wm.jobs) ? wm.jobs : [];
      if ($('jyLog_wm')) {
        const wmLogs = jobs.map(j => (j.status === 'done' ? '✓ ' : j.status === 'error' ? '✕ ' : '• ') + (j.inputPath ? j.inputPath.split(/[\\\\/]/).pop() : '视频') + ' → ' + (j.status === 'processing' ? j.progress + '%' : statusText[j.status] || j.status));
        $('jyLog_wm').textContent = wmLogs.length ? wmLogs.join('\\n') : (wm.running ? '正在硬件加速合成样片…' : '就绪，拖入视频即可批量合成样片…');
        $('jyLogCount_wm').textContent = jobs.length + ' 个任务';
      }

      if (!$('jyWizard').querySelector('.btn-spin')) $('jyWizard').disabled = jyRun || !jy.ready;
      if (!$('jyScan').querySelector('.btn-spin')) $('jyScan').disabled = jyRun || !jy.ready;
      if (!$('jyExport').querySelector('.btn-spin')) {
        $('jyExport').disabled = jyRun || !jy.ready || !jy.queueCount;
        $('jyExport').textContent = jy.queueCount ? '🚀 导出 (' + jy.queueCount + ')' : '🚀 批量导出';
      }

      const queue = Array.isArray(jy.queue) ? jy.queue : [];
      if (selectedDraftIdx >= queue.length) selectedDraftIdx = 0;
      const qBody = $('jyQueueBody');
      if (!queue.length) {
        qBody.innerHTML = '<tr><td colspan="3" class="empty-tip">点击「📸 截图识别」AI 扫描剪映首页草稿</td></tr>';
      } else {
        qBody.innerHTML = '';
        queue.forEach((item, idx) => {
          const tr = document.createElement('tr');
          if (idx === selectedDraftIdx) tr.className = 'sel';
          tr.onclick = () => { selectedDraftIdx = idx; render(state); };
          tr.innerHTML = '<td><input type="radio" name="jy-q" ' + (idx === selectedDraftIdx ? 'checked' : '') + '/></td><td>' +
            String(item.name || '').replace(/</g, '&lt;') + '</td><td>' + String(item.st || '待导出') + '</td>';
          qBody.appendChild(tr);
        });
      }

      if (jy.extractProgress && jy.extractProgress.percent < 100) {
        $('jyExtract').textContent = '提取中 ' + jy.extractProgress.percent + '% (' + jy.extractProgress.current + '/' + jy.extractProgress.total + ')…';
      } else if (!$('jyExtract').querySelector('.btn-spin')) {
        $('jyExtract').textContent = '提取字幕并隐藏轨道';
      }

      if (jy.mode) updateModeButtons(jy.mode);
      if (jy.waits && !waitsDirty) {
        for (const k of ['open_draft', 'export', 'confirm', 'popup_close', 'close_btn', 'draft_close']) {
          const el = $('w_' + k);
          if (el && jy.waits[k] !== undefined && document.activeElement !== el) el.value = jy.waits[k];
        }
      }

      if (jy.draftDir) {
        $('jyDraftDir').value = jy.draftDir;
        try { localStorage.setItem('xm.jianying.draftDir', jy.draftDir); } catch {}
      }
      if (jy.subtitleOutput) {
        $('jySubOut').value = jy.subtitleOutput;
        try { localStorage.setItem('xm.jianying.subtitleOutput', jy.subtitleOutput); } catch {}
      }

      const rFiles = Array.isArray(s.renameFiles) ? s.renameFiles : [];
      const fCount = Number(jy.fileCount || rFiles.length || 0);
      $('renameFilesMeta').textContent = fCount > 0 ? ('✓ 已载入 ' + fCount + ' 个待改名文件') : (renameFolder ? ('目录：' + renameFolder) : '尚未拖入文件');
      const plan = Array.isArray(jy.plan) ? jy.plan : [];
      $('jyExecuteRename').disabled = jyRun || !plan.length;
      if (!$('jyExecuteRename').querySelector('.btn-spin')) {
        $('jyExecuteRename').textContent = plan.length ? ('开始执行改名 (' + plan.length + ')') : '开始执行改名';
      }
      const pBody = $('jyPlanBody');
      if (plan.length) {
        pBody.innerHTML = plan.map(p => '<tr><td>' + String(p.old_name || '').replace(/</g, '&lt;') + '</td><td>' + String(p.new_name || '').replace(/</g, '&lt;') + '</td></tr>').join('');
      } else if (rFiles.length) {
        pBody.innerHTML = rFiles.map((fp, i) => {
          const base = String(fp || '').split(/[\\\\/]/).pop() || fp;
          const extMatch = base.match(/(\\.[^.]+)$/);
          const ext = extMatch ? extMatch[1] : '';
          const tpl = ($('renameTemplate').value.trim() || '短剧名称_第1集').replace(/(\\d+)(?!.*\\d)/, m => String(Number(m) + i));
          return '<tr><td>' + String(base).replace(/</g, '&lt;') + '</td><td style="color:#ffcf6e">' + String(tpl + ext).replace(/</g, '&lt;') + ' (点上方生成预览确认)</td></tr>';
        }).join('');
      } else {
        pBody.innerHTML = '<tr><td colspan="2" class="empty-tip">拖入文件并选择模式后点击「生成改名预览」</td></tr>';
      }

      const m = jy.modal;
      $('modalCard').hidden = !m;
      if (m) { $('modalTitle').textContent = m.title || '确认'; $('modalMsg').textContent = m.message || ''; }

      $('wmDot').className = 'dot ' + (wm.running ? 'run' : wm.totalCount ? 'on' : '');
      $('wmMeta').textContent = wm.totalCount ? wm.completedCount + '/' + wm.totalCount + ' · ' + wm.overallProgress + '%' : '空闲';
      $('wmBar').style.width = (wm.overallProgress || 0) + '%';
      if (!$('wmRun').querySelector('.btn-spin')) {
        $('wmRun').textContent = wm.running ? '停止合成' : '开始合成';
        $('wmRun').className = 'btn ' + (wm.running ? 'danger' : 'primary');
        $('wmRun').disabled = !wm.running && !(wm.jobs || []).some(j => j.status !== 'done' && j.status !== 'processing');
      }
      $('wmJobs').innerHTML = '';
      (wm.jobs || []).slice(-6).forEach(j => {
        const row = document.createElement('div'); row.className = 'job';
        const name = document.createElement('span'); name.textContent = j.fileName; name.title = j.outputPath || '';
        const st = document.createElement('b');
        st.className = j.status === 'done' ? 'done' : j.status === 'error' ? 'err' : j.status === 'processing' ? 'run' : '';
        st.textContent = j.status === 'processing' ? j.progress + '%' : statusText[j.status] || j.status;
        row.append(name, st);
        if (j.status === 'done') { row.style.cursor = 'pointer'; row.title = '点击定位成片'; row.onclick = () => act('wm-open', j.outputPath); }
        $('wmJobs').append(row);
      });
    }

    $('closeBtn').onclick = () => act('panel', false);
    $('dockBtn').onclick = () => act('toggle-dock');
    $('pkSwitch').onclick = () => act('toggle-period');
    if ($('petThemeBtn')) $('petThemeBtn').onclick = () => act('toggle-pet-theme');
    $('jyWizard').onclick = () => act('jy-wizard', { mode: currentExportMode }, $('jyWizard'), '录制中…');
    $('jyScan').onclick = () => act('jy-scan', { modelKey: $('jyModelSelect').value, connection: getSelectedModelConnection() }, $('jyScan'), '识别中…');
    $('jyExport').onclick = () => act('jy-export', { index: selectedDraftIdx }, $('jyExport'), '启动导出…');
    $('jyStop').onclick = () => act('jy-stop');
    function populateWaitsInputs(mode, waitsData) {
      const modeWaits = mode === 'wait_close'
        ? (waitsData?.waitsWaitClose || waitsData?.waits || {})
        : (waitsData?.waitsReturnHome || waitsData?.waits || {});
      ['open_draft', 'export', 'confirm', 'popup_close', 'close_btn', 'draft_close'].forEach(k => {
        const el = $('w_' + k);
        if (el && modeWaits[k] !== undefined) el.value = modeWaits[k];
      });
      if ($('waitsModeLabel')) {
        $('waitsModeLabel').textContent = mode === 'wait_close' ? '等待完成 · 逐个' : '收起至首页 · 后台';
      }
    }

    const switchExportMode = newMode => {
      updateModeButtons(newMode);
      populateWaitsInputs(currentExportMode, state?.jianying);
      act('jy-settings', { mode: currentExportMode });
    };
    if ($('jyModeReturnHome')) $('jyModeReturnHome').onclick = () => switchExportMode('return_home');
    if ($('jyModeWaitClose')) $('jyModeWaitClose').onclick = () => switchExportMode('wait_close');

    $('jyOpenWaitsModal').onclick = () => {
      waitsDirty = false;
      populateWaitsInputs(currentExportMode, state?.jianying);
      $('waitsModalOverlay').hidden = false;
    };
    const closeWaitsModal = () => { $('waitsModalOverlay').hidden = true; waitsDirty = false; };
    $('jyCloseWaitsModal').onclick = closeWaitsModal;
    $('jyCloseWaitsModalTop').onclick = closeWaitsModal;

    ['open_draft', 'export', 'confirm', 'popup_close', 'close_btn', 'draft_close'].forEach(k => {
      $('w_' + k).oninput = () => { waitsDirty = true; };
    });
    $('jySaveWaitsModal').onclick = () => {
      const currentMode = currentExportMode || 'return_home';
      const waits = {};
      ['open_draft', 'export', 'confirm', 'popup_close', 'close_btn', 'draft_close'].forEach(k => {
        waits[k] = Number($('w_' + k).value) || 1;
      });
      waitsDirty = false;
      act('jy-settings', { mode: currentMode, targetMode: currentMode, waits }, $('jySaveWaitsModal'), '保存中…');
      $('waitsModalOverlay').hidden = true;
      toast('已保存当前模式的等待时间参数 ✨');
    };

    const tableWrap = document.querySelector('#stageExport .table-wrap');
    if (tableWrap) {
      tableWrap.addEventListener('wheel', e => {
        e.stopPropagation();
      }, { passive: false });
    }

    let pathTimer = null;
    const syncPaths = () => {
      clearTimeout(pathTimer);
      pathTimer = setTimeout(() => {
        const dDir = $('jyDraftDir')?.value?.trim() || '';
        const sOut = $('jySubOut')?.value?.trim() || '';
        try { if (dDir) localStorage.setItem('xm.jianying.draftDir', dDir); } catch {}
        try { if (sOut) localStorage.setItem('xm.jianying.subtitleOutput', sOut); } catch {}
        act('jy-paths', { draftDir: dDir, subtitleOutput: sOut });
      }, 400);
    };
    if ($('jyDraftDir')) { $('jyDraftDir').oninput = syncPaths; $('jyDraftDir').onchange = syncPaths; }
    if ($('jySubOut')) { $('jySubOut').oninput = syncPaths; $('jySubOut').onchange = syncPaths; }

    $('jyPickDraftDir').onclick = async () => {
      const res = await act('jy-pick-path', 'draftDir', $('jyPickDraftDir'), '选择中…');
      if (res?.jianying?.draftDir) {
        try { localStorage.setItem('xm.jianying.draftDir', res.jianying.draftDir); } catch {}
      }
    };
    $('jyPickSubOut').onclick = async () => {
      const res = await act('jy-pick-path', 'subtitleOutput', $('jyPickSubOut'), '选择中…');
      if (res?.jianying?.subtitleOutput) {
        try { localStorage.setItem('xm.jianying.subtitleOutput', res.jianying.subtitleOutput); } catch {}
      }
    };
    $('jyExtract').onclick = () => act('jy-extract', null, $('jyExtract'), '提取中…');
    $('jyFonts').onclick = () => act('jy-fonts', null, $('jyFonts'), '处理中…');
    if ($('jyPunctuation')) $('jyPunctuation').onclick = () => act('jy-punctuation', null, $('jyPunctuation'), '检查中…');
    $('jyUnhide').onclick = () => act('jy-unhide', null, $('jyUnhide'), '恢复中…');

    $('renameModeTpl').onclick = () => {
      aiRenameMode = false;
      $('renameModeTpl').classList.add('active');
      $('renameModeAi').classList.remove('active');
      $('jyPreviewRename').textContent = '生成改名预览';
    };
    $('renameModeAi').onclick = () => {
      aiRenameMode = true;
      $('renameModeAi').classList.add('active');
      $('renameModeTpl').classList.remove('active');
      $('jyPreviewRename').textContent = '生成 AI 预览';
    };
    $('jyPickRenameDir').onclick = async () => {
      const res = await act('jy-pick-rename-dir', null, $('jyPickRenameDir'), '选择中…');
      if (res?.renameFolder) renameFolder = res.renameFolder;
    };
    $('jyPickRenameFiles').onclick = () => act('jy-pick-rename-files', null, $('jyPickRenameFiles'), '选择中…');
    $('jyClearRenameFiles').onclick = () => { renameFolder = ''; act('jy-clear-rename-files', null, $('jyClearRenameFiles'), '清除中…'); };
    $('jyPreviewRename').onclick = () => act('jy-preview-rename', {
      folder: renameFolder,
      template: $('renameTemplate').value.trim() || '短剧名称_第1集',
      ai: aiRenameMode,
      modelKey: $('jyModelSelect').value,
      connection: getSelectedModelConnection()
    }, $('jyPreviewRename'), aiRenameMode ? 'AI 生成中…' : '生成中…');
    $('jyExecuteRename').onclick = () => act('jy-execute-rename', null, $('jyExecuteRename'), '改名中…');

    ['renameDropZone', 'wmDropZone'].forEach(id => {
      const z = $(id);
      z.onclick = () => act('prompt-drop', currentStage);
      z.ondragover = e => { e.preventDefault(); z.classList.add('drag'); };
      z.ondragleave = () => z.classList.remove('drag');
      z.ondrop = async e => {
        e.preventDefault();
        z.classList.remove('drag');
        const files = Array.from(e.dataTransfer?.files || []);
        const paths = files.map(f => f.path || f.name).filter(Boolean);
        if (paths.length) await act('drop-paths', paths);
      };
    });

    $('modalYes').onclick = () => state?.jianying?.modal && act('jy-modal', { id: state.jianying.modal.id, confirmed: true });
    $('modalNo').onclick = () => state?.jianying?.modal && act('jy-modal', { id: state.jianying.modal.id, confirmed: false });
    $('wmAdd').onclick = () => act('wm-add');
    $('wmClear').onclick = () => act('wm-clear', null, $('wmClear'), '清除中…');
    $('wmRun').onclick = () => act(state?.watermark?.running ? 'wm-cancel' : 'wm-start', null, $('wmRun'), '启动中…');
    $('launchJy').onclick = () => act('launch-jy', null, $('launchJy'), '启动剪映中…');
    $('openMain').onclick = () => act('navigate', '');

    switchStage(currentStage, false);
    api?.onCompanionState?.(render);
    act('sync');
  </script></body></html>`;
}

// Base64 keeps Chromium's data-URL parser away from percent-encoding edge cases in the inline markup.
const toDataUrl = html => 'data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64');

function companionHtml() {
  const orb = orbHtml();
  const panelAcrylic = panelHtml(true);
  const panelSolid = panelHtml(false);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>悬浮窗 · 剪映自动化</title></head><body style="margin:0;background:transparent;overflow:hidden"><script>
    (function () {
      var params = new URLSearchParams(location.search);
      var mode = params.get('mode') === 'panel' ? 'panel' : 'orb';
      var acrylic = params.get('acrylic') !== '0';
      var html = mode === 'panel' ? (acrylic ? ${JSON.stringify(panelAcrylic)} : ${JSON.stringify(panelSolid)}) : ${JSON.stringify(orb)};
      document.open();
      document.write(html);
      document.close();
    })();
  </script></body></html>`;
}

/** Exposed for offscreen previews, static bundling, and tests. */
export const companionMarkup = { orbHtml, panelHtml, companionHtml, toDataUrl };

export function createCompanionDock({
  preloadPath,
  iconPath,
  baseUrl = '',
  getJianyingState,
  getWatermarkState,
  getPeriodStatus,
  onAction,
}) {
  let orb = null;
  let panel = null;
  let panelOpen = false;
  let autoDock = false;
  let visible = false;
  let pollTimer = null;
  let lastJianying = null;
  let activeStage = 'export';
  let forceStageToken = '';
  let petTheme = 'miao';
  let pendingDropFiles = [];
  let renameFiles = [];
  let orbNotice = '';
  let orbNoticeToken = '';
  let cachedProviders = null;
  const acrylic = supportsAcrylic();
  const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  const resolveOrbUrl = () => normalizedBaseUrl ? `${normalizedBaseUrl}/companion-orb.html` : toDataUrl(orbHtml());
  const resolvePanelUrl = () => normalizedBaseUrl ? `${normalizedBaseUrl}/companion-panel.html?acrylic=${acrylic ? '1' : '0'}` : toDataUrl(panelHtml(acrylic));

  const webPreferences = { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false, preload: preloadPath };
  const alive = w => w && !w.isDestroyed();

  function workArea(point) {
    try {
      return (point ? screen.getDisplayNearestPoint(point) : screen.getPrimaryDisplay()).workArea;
    } catch {
      return { x: 0, y: 0, width: 1920, height: 1040 };
    }
  }

  async function ensureOrb() {
    if (alive(orb)) return orb;
    const area = workArea();
    orb = new BrowserWindow({
      x: area.x + area.width - ORB_SIZE.width - 24,
      y: area.y + area.height - ORB_SIZE.height - 28,
      ...ORB_SIZE,
      frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      roundedCorners: false, thickFrame: false, backgroundColor: '#00000000',
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: true, icon: iconPath,
      webPreferences,
    });
    orb.setAlwaysOnTop(true, 'screen-saver');
    orb.on('move', () => placePanel());
    orb.on('closed', () => { orb = null; visible = false; });
    try {
      await orb.loadURL(resolveOrbUrl());
    } catch {
      if (alive(orb)) await orb.loadURL(toDataUrl(orbHtml()));
    }
    return orb;
  }

  async function ensurePanel() {
    if (alive(panel)) return panel;
    panel = new BrowserWindow({
      ...PANEL_SIZE,
      show: false, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, icon: iconPath, roundedCorners: true,
      ...(acrylic ? { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' } : { backgroundColor: '#14181e' }),
      webPreferences,
    });
    panel.setAlwaysOnTop(true, 'screen-saver');
    panel.on('closed', () => { panel = null; panelOpen = false; });
    try {
      await panel.loadURL(resolvePanelUrl());
    } catch {
      if (alive(panel)) await panel.loadURL(toDataUrl(panelHtml(acrylic)));
    }
    return panel;
  }

  function placePanel() {
    if (!alive(panel) || !alive(orb) || !panelOpen) return;
    const [ox, oy] = orb.getPosition();
    const area = workArea({ x: ox, y: oy });
    let x = ox - PANEL_SIZE.width - 8;
    if (x < area.x) x = ox + ORB_SIZE.width + 8;
    let y = oy + ORB_SIZE.height - PANEL_SIZE.height;
    y = Math.max(area.y + 8, Math.min(y, area.y + area.height - PANEL_SIZE.height - 8));
    x = Math.max(area.x + 8, Math.min(x, area.x + area.width - PANEL_SIZE.width - 8));
    panel.setBounds({ x: Math.round(x), y: Math.round(y), ...PANEL_SIZE }, false);
  }

  async function snapshot() {
    let jy = null, wm = null, period = null;
    try { jy = await getJianyingState?.(); } catch { jy = lastJianying; }
    if (jy) lastJianying = jy;
    try { wm = await getWatermarkState?.(); } catch { /* ignore */ }
    try { period = await getPeriodStatus?.(); } catch { /* ignore */ }
    const jw = jy?.jianyingWindow || {};
    const logs = Array.isArray(jy?.logs) ? jy.logs : [];
    return {
      visible, panelOpen, autoDock, acrylic, activeStage, forceStageToken, petTheme,
      providers: cachedProviders,
      pendingDropCount: pendingDropFiles.length,
      renameFiles,
      orbNotice, orbNoticeToken,
      jianyingFound: Boolean(jw.found && !jw.minimized),
      jianyingWindow: jw,
      jianying: {
        ready: Boolean(jy?.ready), busy: Boolean(jy?.busy), exporting: Boolean(jy?.exporting), recording: Boolean(jy?.recording),
        status: jy?.status || '引擎预热中…', guide: jy?.guide || '', modal: jy?.modal || null,
        queue: Array.isArray(jy?.queue) ? jy.queue : [],
        queueCount: Array.isArray(jy?.queue) ? jy.queue.length : 0,
        plan: Array.isArray(jy?.plan) ? jy.plan : [],
        fileCount: Number(jy?.fileCount || 0),
        mode: jy?.mode || 'return_home',
        waits: jy?.waits || {},
        waitsReturnHome: jy?.waitsReturnHome || jy?.waits || {},
        waitsWaitClose: jy?.waitsWaitClose || jy?.waits || {},
        templates: Array.isArray(jy?.templates) ? jy.templates : [],
        templateId: jy?.templateId || '',
        resolution: Array.isArray(jy?.resolution) ? jy.resolution : [1920, 1080],
        draftDir: jy?.draftDir || '',
        subtitleOutput: jy?.subtitleOutput || '',
        logs,
        lastLog: logs.length ? String(logs[logs.length - 1]) : '',
      },
      watermark: wm || { running: false, totalCount: 0, completedCount: 0, overallProgress: 0, jobs: [] },
      periodEnabled: Boolean(period?.enabled),
    };
  }

  async function broadcastState() {
    const snap = await snapshot();
    for (const w of [orb, panel]) if (alive(w)) w.webContents.send('bos:companion-state', snap);
    return snap;
  }

  async function tick() {
    if (!visible || !alive(orb)) return;
    const snap = await broadcastState();
    const jw = snap.jianyingWindow;
    if (autoDock && jw?.found && !jw.minimized && jw.width > 300 && jw.height > 300) {
      const x = jw.x + jw.width - ORB_SIZE.width - 16;
      const y = jw.y + 44;
      const [cx, cy] = orb.getPosition();
      if (Math.abs(cx - x) > 3 || Math.abs(cy - y) > 3) orb.setPosition(Math.round(x), Math.round(y), false);
    }
  }

  function startLoop() {
    if (!pollTimer) pollTimer = setInterval(() => { void tick(); }, 1200);
  }
  function stopLoop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function setPanel(open) {
    panelOpen = open === 'toggle' ? !panelOpen : Boolean(open);
    if (panelOpen) {
      const p = await ensurePanel();
      placePanel();
      p.show();
      p.moveTop?.();
      p.focus();
    } else if (alive(panel)) {
      panel.hide();
    }
    return broadcastState();
  }

  async function show(openPanel = false) {
    visible = true;
    const o = await ensureOrb();
    o.showInactive();
    o.moveTop?.();
    startLoop();
    if (openPanel) await setPanel(true);
    return broadcastState();
  }

  async function hide() {
    visible = false;
    stopLoop();
    if (alive(panel)) panel.hide();
    panelOpen = false;
    if (alive(orb)) orb.hide();
    return snapshot();
  }

  async function toggle() {
    if (!visible || !alive(orb) || !orb.isVisible() || !panelOpen || !alive(panel) || !panel.isVisible()) {
      return show(true);
    }
    return hide();
  }

  function setNoticeOnOrb(msg) {
    orbNotice = msg;
    orbNoticeToken = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6);
  }

  async function handleAction(action, value) {
    if (action === 'sync') return broadcastState();
    if (action === 'sync-providers') {
      if (Array.isArray(value)) cachedProviders = value;
      return broadcastState();
    }
    if (action === 'show') return show(Boolean(value));
    if (action === 'hide') return hide();
    if (action === 'toggle') return toggle();
    if (action === 'panel' || action === 'expand') return setPanel(value);
    if (action === 'set-stage') {
      activeStage = String(value || 'export');
      return broadcastState();
    }
    if (action === 'toggle-pet-theme') {
      petTheme = petTheme === 'dafeyu' ? 'miao' : 'dafeyu';
      setNoticeOnOrb(petTheme === 'dafeyu' ? '🐟 已切换为「大肥鱼」主题~' : '🐱 已切换回「月薪喵」主题~');
      return broadcastState();
    }
    if (action === 'prompt-drop') {
      activeStage = String(value || activeStage || 'rename');
      setNoticeOnOrb('请把需要改名或加水印的文件/文件夹，直接拖放到我身上吧~ 🐾');
      return broadcastState();
    }
    if (action === 'move-by') {
      if (alive(orb)) {
        autoDock = false;
        const [cx, cy] = orb.getPosition();
        const dx = Number(value?.dx) || 0;
        const dy = Number(value?.dy) || 0;
        orb.setPosition(Math.round(cx + dx), Math.round(cy + dy), false);
        placePanel();
      }
      return broadcastState();
    }
    if (action === 'toggle-dock') { autoDock = !autoDock; await tick(); return broadcastState(); }
    try {
      const extra = await onAction?.(action, value, {
        setPendingDrop: files => { pendingDropFiles = files || []; },
        getPendingDrop: () => pendingDropFiles,
        setRenameFiles: files => { renameFiles = files || []; },
        setStage: (st, force = true) => {
          activeStage = st;
          if (force) forceStageToken = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6);
        },
        openPanel: () => setPanel(true),
        notifyOrb: setNoticeOnOrb,
      });
      const snap = await broadcastState();
      return extra && typeof extra === 'object' ? { ...snap, ...extra } : snap;
    } catch (error) {
      const snap = await broadcastState();
      return { ...snap, error: String(error?.message || error || '操作失败').replace(/^Error:\s*/, '') };
    }
  }

  function dispose() {
    stopLoop();
    for (const w of [panel, orb]) if (alive(w)) { try { w.destroy(); } catch { /* ignore */ } }
    panel = null;
    orb = null;
  }

  return { show, hide, toggle, handleAction, broadcastState, dispose };
}
