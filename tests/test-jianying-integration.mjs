import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { buildJianyingAIRequest, requestJianyingAI } from '../app/electron/jianying-ai.mjs';
import { createJianyingHost } from '../app/electron/jianying-host.mjs';
import { createAutoUpdater, compareSemver } from '../app/electron/auto-updater.mjs';
import { createQuickLaunch } from '../app/electron/quick-launch.mjs';
import { splitScript } from '../app/shared/script-score.mjs';
import { splitDramaEpisodes } from '../app/shared/drama-episodes.mjs';

const connection = { provider: { protocol: 'gemini', baseUrl: 'https://example.com/v1beta', apiKey: 'secret-fixture' }, model: 'gemini-test' };
test('existing Gemini/relay connections carry images correctly and keys never go in request bodies', async () => {
  const native = buildJianyingAIRequest(connection, { prompt: 'test', image: 'YWJj' });
  assert.match(native.url.pathname, /v1beta\/models\/gemini-test:generateContent$/);
  assert.equal(native.body.contents[0].parts[1].inlineData.data, 'YWJj'); assert.doesNotMatch(JSON.stringify(native.body), /secret-fixture/);
  const relay = { ...connection, provider: { ...connection.provider, protocol: 'openai', baseUrl: 'https://example.com/v1/chat/completions' } };
  const request = buildJianyingAIRequest(relay, { prompt: 'test', image: 'YWJj' });
  assert.equal(request.url.pathname, '/v1/chat/completions'); assert.match(request.body.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  let calls = 0;
  const output = await requestJianyingAI(connection, { prompt: 'test' }, null, async () => { calls++; return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }) }; });
  assert.equal(output, '[]'); assert.equal(calls, 1);
  await assert.rejects(requestJianyingAI(connection, { prompt: 'test' }, null, async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Bad secret-fixture' } }) })), error => !error.message.includes('secret-fixture') && error.message.includes('401'));
});
test('quick folders persist eight entries, only configured folders open, removal never deletes contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-quick-test-'));
  try {
    let count = 0; const opened = [];
    const options = { settingsFile: path.join(root, 'quick.json'), shell: { openPath: async value => { opened.push(value); return ''; } }, chooseDirectory: async () => { const folder = path.join(root, String(++count)); await fs.mkdir(folder); return folder; }, discover: async () => [] };
    const quick = createQuickLaunch(options); let state;
    const additions = await Promise.allSettled(Array.from({ length: 10 }, () => quick.addFolder()));
    assert.equal(additions.filter(item => item.status === 'fulfilled').length, 8);
    assert.equal(count, 8, 'extra concurrent clicks do not open extra dialogs or lose saved folders');
    state = await quick.scan();
    assert.equal(state.folders.length, 8); await assert.rejects(quick.addFolder(), /八个/);
    await quick.openFolder(state.folders[0].id); assert.deepEqual(opened, [state.folders[0].path]);
    await assert.rejects(quick.openFolder('unconfigured'), /不存在/);
    const persisted = await createQuickLaunch(options).scan(); assert.equal(persisted.folders.length, 8);
    await quick.removeFolder(state.folders[0].id); assert.equal((await fs.stat(state.folders[0].path)).isDirectory(), true);
    await assert.rejects(quick.launch(), /未找到/); assert.equal(opened.length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('shortcut launch uses only a discovered existing executable and never launches during detection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-launch-test-'));
  try {
    const file = path.join(root, 'JianyingPro.exe'); await fs.writeFile(file, 'fixture-not-executable');
    const opened = []; const quick = createQuickLaunch({ settingsFile: path.join(root, 'settings.json'), discover: async () => [{ path: file }], shell: { openPath: async value => { opened.push(value); return ''; } } });
    await quick.scan(); assert.equal(opened.length, 0); await assert.rejects(quick.select('C:/arbitrary.exe'), /重新检测/);
    await quick.select(file); await quick.launch(); assert.deepEqual(opened, [file]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('subtitle punctuation survives line breaks, including a trailing comma', () => {
  const lines = splitScript('[EN] A: Hello,\n[EN] B: Go.\n[EN] A: Wait... No,.');
  assert.equal(lines[0].text, 'Hello,'); assert.ok(lines.some(line => line.text === 'Go.'));
  assert.equal(lines.map(line => line.text).join(' ').replace(/\s/g, ''), 'Hello,Go.Wait...No,.');
});

const saved = new Map();
globalThis.localStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
globalThis.i = { createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...(props || {}), children }) : ({ type, props: props || {}, children }), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect: () => {}, useMemo: fn => fn(), useRef: value => ({ current: value }), useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
const compiled = await build({ entryPoints: ['app/src/upgrade.tsx'], bundle: true, write: false, platform: 'browser', format: 'esm', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function nodes(tree, predicate) { if (!tree || typeof tree !== 'object') return []; return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flat(Infinity).flatMap(child => nodes(child, predicate))]; }
const textOf = tree => (tree?.children || []).flat(Infinity).map(child => typeof child === 'object' ? textOf(child) : child ?? '').join('');
test('sixth page exposes four separately collapsible panels, 4-stage top bar with watermark, and reuses existing provider choices', () => {
  const tree = ui.JianyingStudio({ active: true, providers: [{ id: 'existing', name: '已有连接', protocol: 'openai', models: ['gemini-test'], apiKey: 'hidden-key' }], onNavigate: () => {} });
  const stageTabs = nodes(tree, node => node.type === 'button' && String(node.props.className || '').includes('bos-stage-tab'));
  assert.equal(stageTabs.length, 4, 'JianyingStudio must expose 4 top-level stage tabs (批量导出, 字幕工程, 批量改名, 样片水印)');
  const toggles = nodes(tree, node => node.type === 'button' && node.props['aria-controls']?.startsWith('jy-'));
  assert.equal(toggles.length, 4); assert.equal(new Set(toggles.map(item => item.props['aria-controls'])).size, 4);
  assert.match(textOf(tree), /已有连接/); assert.doesNotMatch(textOf(tree), /hidden-key/);
  const exportPanel = nodes(tree, node => node.props.id === 'jy-export')[0];
  const connections = nodes(tree, node => node.props.id === 'jy-settings')[0];
  assert.match(textOf(exportPanel), /导出模式与参数/); assert.match(textOf(exportPanel), /保存等待时间/);
  assert.doesNotMatch(textOf(connections), /坐标模板|保存等待时间/);
  const optionsToggle = nodes(exportPanel, node => node.props['aria-controls'] === 'bos-jy-export-options-body')[0];
  assert.equal(optionsToggle.props['aria-expanded'], true);
});
test('workspace removes music requirements and SRT restoration while preserving direct-copy fallback', () => {
  globalThis.window = { location: { origin: 'http://127.0.0.1:37651' } };
  const tree = ui.ScriptAutomation({ providers: [], automation: { queue: {}, jobs: [], running: false }, onNavigate: () => {} });
  assert.doesNotMatch(textOf(tree), /配乐要求|选择 SRT|下载标点还原/);
  assert.match(textOf(tree), /原工具方式/); assert.match(textOf(tree), /复制到剪映/);
});
test('right quick rail is removed while the left sidebar keeps an accessible resize handle and bottom-left collapsed dependencies/author credits', async () => {
  assert.equal(ui.QuickRail, undefined);
  const handle = ui.SidebarResizer(); assert.equal(handle.props.role, 'separator'); assert.equal(handle.props['aria-orientation'], 'vertical');
  const credits = ui.SidebarCredits();
  const creditsText = textOf(credits);
  assert.match(creditsText, /作者：\s*小马/);
  assert.match(creditsText, /重构：\s*塔奇/);
  assert.match(creditsText, /贡献代码/);
  assert.match(creditsText, /项目依赖/);
  const drawer = nodes(credits, n => n.props?.id === 'bos-credits-projects')[0];
  assert.equal(drawer.props.hidden, true, 'SidebarCredits project dependencies must be collapsed by default');
  const contributeLink = nodes(credits, n => n.type === 'a' && String(n.props.className || '').includes('bos-credits-contribute'))[0];
  assert.equal(contributeLink.props.href, 'https://github.com/Kirota233/XM-Editing-Studio');
  assert.equal(ui.OPEN_SOURCE_PROJECTS.length, 4);
  for (const name of ['watermarker', 'JianYing-Period-Keeper', 'JianYing-AI-Pro', 'DesktopPet-Miao']) {
    assert.match(creditsText, new RegExp(name));
  }
  const titleBar = ui.TitleBar();
  assert.match(textOf(titleBar), /v1\.7\.3/);
  assert.match(textOf(titleBar), /悬浮窗/);
  const jyTree = ui.JianyingStudio({ active: true, providers: [], onNavigate: () => {} });
  assert.match(textOf(jyTree), /剪映自动化功能请使用桌面「悬浮窗」/);
  assert.match(textOf(jyTree), /开启悬浮窗/);
  const { companionMarkup } = await import('../app/electron/companion-dock.mjs');
  const orbMarkup = companionMarkup.orbHtml();
  for (const gif of ['default.gif', 'angry.gif', 'comfort.gif', 'enjoy.gif', 'cry.gif', 'play.gif', 'float.gif']) {
    assert.match(orbMarkup, new RegExp(`/miao/${gif}`));
  }
  assert.doesNotMatch(orbMarkup, /class="tag"/);
  assert.doesNotMatch(orbMarkup, /backdrop-filter/);
  assert.match(orbMarkup, /id="chooseRename"/);
  assert.match(orbMarkup, /id="chooseWatermark"/);
  assert.match(orbMarkup, /id="wmProgFill"/);
  assert.match(orbMarkup, /id="wmProgFish"/);
  assert.match(orbMarkup, /fastCandySpin/);
  assert.match(orbMarkup, /已经输出在原目录下啦/);
  assert.match(orbMarkup, /id="fish-svg"/);
  const panelMarkup = companionMarkup.panelHtml(true);
  assert.match(panelMarkup, /data-stage="export"[\s\S]*批量导出/);
  assert.match(panelMarkup, /data-stage="subtitles"[\s\S]*字幕工程/);
  assert.match(panelMarkup, /data-stage="rename"[\s\S]*批量改名/);
  assert.match(panelMarkup, /data-stage="watermark"[\s\S]*样片水印/);
  assert.match(panelMarkup, /id="petThemeBtn"/);
  assert.match(panelMarkup, /forceStageToken/);
  assert.match(panelMarkup, /id="jyWizard"/);
  assert.match(panelMarkup, /id="jyScan"/);
  assert.match(panelMarkup, /id="jyModeBox"/);
  assert.match(panelMarkup, /id="jyModeReturnHome"/);
  assert.match(panelMarkup, /id="jyModeWaitClose"/);
  assert.match(panelMarkup, /切换模式自动匹配对应坐标/);
  assert.match(panelMarkup, /id="jyModelSelect"/);
  assert.doesNotMatch(panelMarkup, /id="jyTplSelect"/);
  assert.doesNotMatch(panelMarkup, /id="jyAutoNameTpl"/);
  assert.doesNotMatch(panelMarkup, /id="jyTplNameInput"/);
  assert.doesNotMatch(panelMarkup, /id="jyFetchModelsBtn"/);
  assert.match(panelMarkup, /xm\.jianying\.draftDir/);

  const episodes = splitDramaEpisodes(
    '《霸总归来》完整剧本\n第1集 初遇\n[EN] A: Who are you?\n[EN] B: Leave me alone.\n\n第2集 反击\n[EN] A: You will regret this.\n[EN] B: Never!\n\n第3集 真相\n[EN] A: So it was you all along.'
  );
  assert.equal(episodes.length, 3);
  assert.equal(episodes[0].episodeLabel, '第1集');
  assert.equal(episodes[1].episodeLabel, '第2集');
  assert.equal(episodes[2].episodeLabel, '第3集');
  assert.match(episodes[0].script, /Who are you\?/);
  assert.match(episodes[2].script, /So it was you all along\./);
});

test('C# JianYingEngine native binary responds to status, settings, regex preview and rename over JSON-RPC', async () => {
  if (process.platform !== 'win32') return;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-cs-engine-'));
  const host = createJianyingHost({ appDirectory: path.resolve('app'), dataDirectory: root });
  try {
    const initial = await host.run('status', {});
    assert.equal(initial.ready, true);
    assert.equal(initial.busy, false);
    assert.equal(initial.mode, 'return_home');

    const updated = await host.run('settings', { mode: 'wait_close', waits: { open_draft: 5.5 } });
    assert.equal(updated.mode, 'wait_close');
    assert.equal(updated.waits.open_draft, 5.5);

    const mediaDir = path.join(root, 'videos');
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'ep1.mp4'), 'video-1');
    await fs.writeFile(path.join(mediaDir, 'ep2.mp4'), 'video-2');

    const previewed = await host.run('preview', { folder: mediaDir, template: '测试短剧_第1集', ai: false });
    assert.equal(previewed.plan.length, 2);
    assert.equal(previewed.plan[0].new_name, '测试短剧_第1集.mp4');

    const renamed = await host.run('rename', {});
    assert.equal(renamed.plan.length, 0);
    assert.equal(await fs.readFile(path.join(mediaDir, '测试短剧_第1集.mp4'), 'utf8'), 'video-1');
    assert.equal(await fs.readFile(path.join(mediaDir, '测试短剧_第2集.mp4'), 'utf8'), 'video-2');

    // Test AI smart rename with missing extensions in model output and markdown code fences
    const aiMediaDir = path.join(root, 'ai_videos');
    await fs.mkdir(aiMediaDir, { recursive: true });
    await fs.writeFile(path.join(aiMediaDir, '圣诞老爸16.mp4'), 'ai-video-1');
    await fs.writeFile(path.join(aiMediaDir, '圣诞老爸28下(1).mp4'), 'ai-video-2');

    const mockAiConn = {
      provider: { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'test-key' },
      model: 'gemini-2.5-flash',
    };
    const aiHost = createJianyingHost({
      appDirectory: path.resolve('app'),
      dataDirectory: path.join(root, 'ai-host-data'),
      requestAI: async () => '```json\n[\n  {"old": "圣诞老爸16", "new": "圣诞老爸1上"},\n  {"old": "圣诞老爸28下(1).mp4", "new": "圣诞老爸1下"}\n]\n```',
    });
    try {
      await aiHost.run('preview', { folder: aiMediaDir, template: '圣诞老爸1上', ai: true }, mockAiConn);
      let aiState = await aiHost.run('status', {});
      for (let i = 0; i < 50 && aiState.busy; i++) {
        await new Promise(r => setTimeout(r, 100));
        aiState = await aiHost.run('status', {});
      }
      assert.equal(aiState.busy, false);
      assert.equal(aiState.plan.length, 2);
      assert.equal(aiState.plan[0].new_name, '圣诞老爸1上.mp4');
      assert.equal(aiState.plan[1].new_name, '圣诞老爸1下.mp4');
      assert.equal(aiState.plan[0].mode, 'AI重命名');

      const aiRenamed = await aiHost.run('rename', {});
      assert.equal(aiRenamed.plan.length, 0);
      assert.equal(await fs.readFile(path.join(aiMediaDir, '圣诞老爸1上.mp4'), 'utf8'), 'ai-video-1');
      assert.equal(await fs.readFile(path.join(aiMediaDir, '圣诞老爸1下.mp4'), 'utf8'), 'ai-video-2');
    } finally {
      await aiHost.dispose();
    }
  } finally {
    await host.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('auto-updater checks GitHub release, verifies SHA-256 on download, and launches installer', async () => {
  assert.equal(compareSemver('1.4.1', '1.4.0'), 1);
  assert.equal(compareSemver('v1.4.0', '1.4.0'), 0);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-updater-test-'));
  try {
    const payload = Buffer.from('mock-installer-binary');
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update(payload).digest('hex');
    let spawned = null;
    const updater = createAutoUpdater({
      currentVersion: '1.4.0',
      downloadDirectory: root,
      fetcher: async url => {
        if (String(url).endsWith('/releases/latest')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              tag_name: 'v1.5.0',
              html_url: 'https://github.com/Kirota233/XM-Editing-Studio/releases/tag/v1.5.0',
              assets: [
                { name: 'XM-Editing-Studio-1.5.0-Windows-x64-Setup.exe', browser_download_url: 'https://example.com/setup.exe' },
                { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.com/SHA256SUMS.txt' },
              ],
            }),
          };
        }
        if (String(url).endsWith('SHA256SUMS.txt')) {
          return { ok: true, status: 200, text: async () => `${sha}  XM-Editing-Studio-1.5.0-Windows-x64-Setup.exe\n` };
        }
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-length', String(payload.length)]]),
          body: (async function* () { yield payload; })(),
        };
      },
      spawnInstaller: file => { spawned = file; },
    });

    const checked = await updater.check();
    assert.equal(checked.status, 'available');
    assert.equal(checked.latestVersion, '1.5.0');
    assert.equal(checked.hasUpdate, true);

    const downloaded = await updater.download();
    assert.equal(downloaded.status, 'ready');
    assert.equal(downloaded.progress, 100);

    const installed = await updater.install();
    assert.equal(installed.ok, true);
    assert.equal(spawned, downloaded.installerPath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('unmarked Spanish dialogues with speaker colon and episode header extract cleanly', () => {
  const script = `第1集 迷失\nMARÍA: ¡Hola, José! ¿Cómo estás?\nJOSÉ: Muy bien, gracias. ¿Y tú?\n▲ PAUSA\nMARÍA: Espera un momento, por favor.`;
  const lines = splitScript(script);
  assert.equal(lines.length, 5);
  assert.equal(lines[0].language, 'es');
  assert.equal(lines[0].text, '¡Hola, José!');
  assert.equal(lines[1].text, '¿Cómo estás?');
  assert.equal(lines[2].text, 'Muy bien, gracias.');
  assert.equal(lines[3].text, '¿Y tú?');
  assert.equal(lines[4].text, 'Espera un momento, por favor.');
});

test('C# JianYingEngine supports --draft-io-native argument with structured error handling', async () => {
  if (process.platform !== 'win32') return;
  const { spawnSync } = await import('node:child_process');
  const exePath = path.resolve('app/build/jianying/JianYingEngine.exe');
  const res = spawnSync(exePath, ['--draft-io-native', 'invalid_mode', 'fake_path.json', 'fake_dll.dll'], { encoding: 'utf8', windowsHide: true });
  assert.equal(res.status, 1);
  const json = JSON.parse(res.stdout.trim());
  assert.match(json.error, /无效草稿操作/);
});

test('companion panel and orb HTML templates contain syntactically valid scripts and stage tabs', async () => {
  const { companionMarkup } = await import('../app/electron/companion-dock.mjs');
  const panelHtmlAcrylic = companionMarkup.panelHtml(true);
  const panelHtmlSolid = companionMarkup.panelHtml(false);
  const orbHtml = companionMarkup.orbHtml();

  function verifyHtmlScripts(html, context) {
    const regex = /<script[\s\S]*?>([\s\S]*?)<\/script>/gi;
    let match;
    let count = 0;
    while ((match = regex.exec(html)) !== null) {
      count++;
      const code = match[1];
      assert.doesNotThrow(() => {
        new Function(code);
      }, `${context} script #${count} contains syntax errors`);
    }
    assert.ok(count > 0, `${context} must contain at least one <script> tag`);
  }

  verifyHtmlScripts(panelHtmlAcrylic, 'companionMarkup.panelHtml(true)');
  verifyHtmlScripts(panelHtmlSolid, 'companionMarkup.panelHtml(false)');
  verifyHtmlScripts(orbHtml, 'companionMarkup.orbHtml()');

  const panelDisk = await fs.readFile('app/public/companion-panel.html', 'utf8');
  verifyHtmlScripts(panelDisk, 'app/public/companion-panel.html');

  for (const stage of ['export', 'subtitles', 'rename', 'watermark']) {
    assert.match(panelDisk, new RegExp(`data-stage="${stage}"`), `Stage tab ${stage} missing`);
  }
  assert.match(panelDisk, /id="stageExport"/);
  assert.match(panelDisk, /id="stageSubtitles"/);
  assert.match(panelDisk, /id="stageRename"/);
  assert.match(panelDisk, /id="stageWatermark"/);
  assert.match(panelDisk, /id="modalCard"\s+hidden/);
  assert.match(panelDisk, /id="waitsModalOverlay"\s+hidden/);
  assert.match(panelDisk, /\.modal-overlay\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});
