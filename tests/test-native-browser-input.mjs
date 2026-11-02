import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runNativeWebAI } from '../app/native-host/web-ai-driver.mjs';

test('native AI cancellation returns promptly and cancels exactly the pending host request', async () => {
  const calls = [], controller = new AbortController(); let finish;
  const invoke = (cmd, value) => { calls.push({ cmd, ...value }); return cmd === 'web-ai-run' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(); };
  const pending = runNativeWebAI(invoke, 'deepseek', { command: 'send' }, controller.signal);
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/);
  assert.deepEqual(calls.map(x => x.cmd), ['web-ai-run', 'web-ai-cancel']);
  assert.equal(calls[0].requestId, calls[1].requestId);
  finish({ state: 'enter' }); await Promise.resolve();
  assert.equal(calls.length, 2);
});

test('native AI pre-abort never executes, success removes abort listeners, timeout cancels late work', async () => {
  const calls = [], controller = new AbortController();
  controller.abort();
  await assert.rejects(runNativeWebAI(() => { calls.push('unexpected'); }, 'deepseek', {}, controller.signal));
  assert.equal(calls.length, 0);
  const active = new AbortController();
  const invoke = async (cmd, p) => { calls.push([cmd, p.requestId]); return { state: 'sent' }; };
  assert.equal((await runNativeWebAI(invoke, 'doubao', { command: 'send' }, active.signal)).state, 'sent');
  active.abort(); await Promise.resolve(); assert.equal(calls.length, 1);
  await assert.rejects(runNativeWebAI(async (cmd, p) => { calls.push([cmd, p.requestId]); if (cmd === 'web-ai-run') throw new Error('timeout'); }, 'deepseek', {}), /timeout/);
  assert.equal(calls.at(-1)[0], 'web-ai-cancel'); assert.equal(calls.at(-1)[1], calls.at(-2)[1]);
});

test('native browser input rejects stale replies and sends trusted Enter only to its own WebView', { skip: process.platform !== 'win32' || !process.env.XM_WEBVIEW2_TEST_DLL_DIR, timeout: 90000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xm-browser-input-'));
  try {
    const sdk = process.env.XM_WEBVIEW2_TEST_DLL_DIR;
    for (const name of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll']) await fs.copyFile(path.join(sdk, name), path.join(directory, name));
    const exe = path.join(directory, 'verify.exe');
    const refs = ['System.dll', 'System.Core.dll', 'System.Web.Extensions.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', ...['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll'].map(n => path.join(directory, n))];
    const sources = ['app/native-host/Infrastructure.cs', 'app/native-host/BrowserInput.cs', 'tests/NativeBrowserInputTests.cs'];
    const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const compiled = spawnSync(compiler, ['/nologo', '/utf8output', '/codepage:65001', '/platform:x64', '/out:' + exe, ...refs.map(r => '/reference:' + r), ...sources.map(n => path.resolve(n))], { encoding: 'utf8', windowsHide: true });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const result = spawnSync(exe, process.env.XM_BROWSER_INPUT_DESKTOP_TEST === '1' ? ['--desktop'] : [], { encoding: 'utf8', windowsHide: true, timeout: 70000 });
    assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error || ''));
    console.log(result.stdout.trim());
  } finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
