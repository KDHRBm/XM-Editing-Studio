import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { createWatermarkHost } from '../app/electron/watermark-host.mjs';

test('Native C# WatermarkEngine.exe binary exists, is compact (< 100KB), and verifies Windows Media Foundation runtime', async () => {
  if (process.platform !== 'win32') return;
  const exePath = path.resolve('app/build/watermark/WatermarkEngine.exe');
  const manifestPath = path.resolve('app/build/watermark/engine.json');
  const st = await fs.stat(exePath);
  assert.ok(st.isFile(), 'WatermarkEngine.exe must exist');
  assert.ok(st.size > 4096 && st.size < 102400, `WatermarkEngine.exe should be compact (<100KB), got ${st.size} bytes`);

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);

  const output = execFileSync(exePath, ['--verify-runtime'], { encoding: 'utf8', windowsHide: true }).trim();
  const parsed = JSON.parse(output);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.engine, 'windows-media-foundation-hw');
});

test('createWatermarkHost manages video batch queue, settings persistence, output path resolution, and clean disposal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-wm-host-test-'));
  try {
    const sampleA = path.join(root, '样片A.mp4');
    const sampleB = path.join(root, '样片B.mov');
    const outDir = path.join(root, 'output');
    await fs.writeFile(sampleA, 'fake-mp4-data-a');
    await fs.writeFile(sampleB, 'fake-mp4-data-b');
    await fs.mkdir(outDir, { recursive: true });

    const states = [];
    const host = createWatermarkHost({
      appDirectory: path.resolve('app'),
      dataDirectory: root,
      onStateChange: s => states.push(s),
    });

    try {
      const initial = await host.getState();
      assert.equal(initial.engine, 'windows-media-foundation-hw');
      assert.equal(initial.totalCount, 0);
      assert.equal(initial.settings.position, 'fullscreen');
      assert.equal(initial.settings.watermarkImage, 'builtin');
      assert.equal(initial.settings.suffix, '样片');

      // Add videos and verify deduplication of pending paths
      const afterAdd = await host.addVideos([sampleA, sampleB, sampleA]);
      assert.equal(afterAdd.totalCount, 2);
      assert.equal(afterAdd.jobs[0].fileName, '样片A.mp4');
      assert.equal(afterAdd.jobs[0].outputPath, path.join(root, '样片A样片.mp4'));

      // Update settings and verify pending job output paths update automatically
      const afterSettings = await host.updateSettings({
        watermarkText: 'XM 初剪审阅',
        position: 'bottom-right',
        opacity: 0.5,
        scale: 0.35,
        size: '720p',
        crf: 28,
        outputDir: outDir,
        suffix: '_审片版',
      });
      assert.equal(afterSettings.settings.watermarkText, 'XM 初剪审阅');
      assert.equal(afterSettings.settings.position, 'bottom-right');
      assert.equal(afterSettings.jobs[0].outputPath, path.join(outDir, '样片A_审片版.mp4'));

      // Remove one job and clear remaining
      const afterRemove = await host.removeJob(afterSettings.jobs[0].id);
      assert.equal(afterRemove.totalCount, 1);
      assert.equal(afterRemove.jobs[0].fileName, '样片B.mov');

      const afterClear = await host.clearJobs('all');
      assert.equal(afterClear.totalCount, 0);
      assert.ok(states.length >= 4);

      // Verify settings persisted on disk
      const hostReloaded = createWatermarkHost({
        appDirectory: path.resolve('app'),
        dataDirectory: root,
      });
      const reloadedState = await hostReloaded.getState();
      assert.equal(reloadedState.settings.watermarkText, 'XM 初剪审阅');
      assert.equal(reloadedState.settings.suffix, '_审片版');
      await hostReloaded.dispose();
    } finally {
      await host.dispose();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Native WatermarkStudio UI and Bottom-Right Radial BatchTray render without web-wrapper iframe', async () => {
  const saved = new Map();
  globalThis.localStorage = {
    getItem: key => saved.get(key) || null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key),
  };
  globalThis.i = {
    createElement: (type, props, ...children) =>
      typeof type === 'function' ? type({ ...(props || {}), children }) : { type, props: props || {}, children },
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: fn => fn(),
    useRef: value => ({ current: value }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };

  const compiled = await build({
    entryPoints: ['app/src/upgrade.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    jsxFactory: 'i.createElement',
    jsxFragment: 'i.Fragment',
  });
  const ui = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

  function nodes(tree, predicate) {
    if (!tree || typeof tree !== 'object') return [];
    return [
      ...(predicate(tree) ? [tree] : []),
      ...(tree.children || []).flat(Infinity).flatMap(child => nodes(child, predicate)),
    ];
  }
  const textOf = tree =>
    (tree?.children || [])
      .flat(Infinity)
      .map(child => (typeof child === 'object' ? textOf(child) : child ?? ''))
      .join('');

  // 1. Verify WatermarkStudio has NO iframe and renders native controls + built-in watermark.png preview
  const wmTree = ui.WatermarkStudio({ active: true });
  assert.equal(nodes(wmTree, n => n.type === 'iframe').length, 0, 'WatermarkStudio must not use an iframe web wrapper');
  const wmText = textOf(wmTree);
  assert.match(wmText, /实时画面水印预览/);
  assert.match(wmText, /C# 原生硬件加速/);
  assert.match(wmText, /原版全画幅覆盖/);
  assert.match(wmText, /红薯样片/);
  assert.match(wmText, /批量视频处理队列/);
  const previewImg = nodes(wmTree, n => n.type === 'img' && n.props.src === '/watermark.png');
  assert.equal(previewImg.length, 1, 'WatermarkStudio must preview the built-in /watermark.png from watermarker');

  // 2. Verify BatchTray renders bottom-right radial orb + 5 surrounding satellite nodes
  const trayTree = ui.BatchTray({ activeTab: 'watermark', onNavigate: () => {}, automation: { jobs: [] } });
  const satellites = nodes(trayTree, n => n.type === 'button' && String(n.props.className || '').includes('bos-tray-sat'));
  assert.equal(satellites.length, 5, 'BatchTray must render 5 surrounding radial satellite action buttons');
  const trayText = textOf(trayTree);
  assert.match(trayText, /水印/);
  assert.match(trayText, /剪映/);
  assert.match(trayText, /配乐/);
  assert.match(trayText, /句号/);
  assert.match(trayText, /AI 台/);

  // 3. Verify ScriptAutomation removes 全景视图 and elevates the 3 stage tabs to .bos-top-stage-bar
  globalThis.window = { location: { origin: 'http://127.0.0.1:37651' } };
  const scriptTree = ui.ScriptAutomation({ providers: [], automation: { queue: {}, jobs: [], running: false }, onNavigate: () => {} });
  const scriptText = textOf(scriptTree);
  assert.doesNotMatch(scriptText, /全景视图/, '全景视图 must be removed');
  const stageTabs = nodes(scriptTree, n => n.type === 'button' && String(n.props.className || '').includes('bos-stage-tab'));
  assert.equal(stageTabs.length, 3, 'Must expose 3 prominent top-level stage tabs');

  // 4. Verify GlobalThemePicker is mounted in providers (接口与主题) and not in workspace, and companionDock launches at startup
  const buildUpgradeSrc = await fs.readFile('app/scripts/build-upgrade.mjs', 'utf8');
  assert.match(buildUpgradeSrc, /d==="providers"&&s\.jsx\(BOSMusicUpgrade\.GlobalThemePicker/);
  assert.match(buildUpgradeSrc, /label:"接口与主题",sub:"API 配置 · 视觉主题"/);
  const hostSrc = await fs.readFile('app/native/XMStudioHost.cs', 'utf8');
  assert.match(hostSrc, /ShowCompanionAsync\(false\)/);
});
