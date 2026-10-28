// Run with node --test; set XM_PLAYWRIGHT_MODULE / XM_CHROME_PATH when using
// a bundled Playwright installation instead of the optional local package.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webAIPageScript } from '../app/electron/web-ai-dom.mjs';
import { createJianyingWebScan } from '../app/electron/jianying-web-scan.mjs';
const { chromium } = await import(process.env.XM_PLAYWRIGHT_MODULE || 'playwright');
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zZAAAAAASUVORK5CYII=';

test('thumbnail-only and named attachments wait for upload, then submit the complete prompt once', async t => {
  const browser = await chromium.launch({ ...(process.env.XM_CHROME_PATH ? { executablePath: process.env.XM_CHROME_PATH } : {}), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('https://chat.deepseek.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8">
    <style>form{width:640px;height:210px;margin:300px auto 0;padding:16px}textarea{display:block;width:610px;height:50px}img{width:64px;height:64px}#attachment{height:64px}</style>
    <article><img id="old" src="data:image/png;base64,${pixel}"><span>old answer</span></article>
    <form><div id="attachment"></div><textarea></textarea><input type="file" accept="image/*" hidden><div role="progressbar" hidden></div><button type="button" aria-label="发送">发送</button></form>
    <script>
      window.uploads=[]; window.sent=[]; window.mode='thumbnail'; window.prepared=[];
      document.querySelector('input').onchange=e=>{
        const file=e.target.files[0]; uploads.push({name:file.name,size:file.size});
        prepared.push(document.querySelector('textarea').value);
        const attachment=document.querySelector('#attachment'); attachment.replaceChildren();
        if(mode==='thumbnail'){const image=new Image();image.src=URL.createObjectURL(file);attachment.append(image);}
        if(mode==='named'){const name=document.createElement('span');name.textContent=file.name;attachment.append(name);}
        if(mode==='background'){const div=document.createElement('div');div.style.cssText='width:64px;height:64px';div.style.backgroundImage='url('+URL.createObjectURL(file)+')';attachment.append(div);}
        document.querySelector('[role=progressbar]').hidden=false;
        document.querySelector('button').disabled=true;
        e.target.value=''; // React can reset this after creating the thumbnail.
      };
      document.querySelector('button').onclick=()=>{sent.push(document.querySelector('textarea').value);document.querySelector('textarea').value='';document.querySelector('#attachment').replaceChildren();};
    </script>` }));
  await page.goto('https://chat.deepseek.com/');
  const run = input => page.evaluate(webAIPageScript({ ...input, host: 'chat.deepseek.com' }));
  const finish = () => page.evaluate(() => { document.querySelector('[role=progressbar]').hidden = true; document.querySelector('button').disabled = false; });
  for (const mode of ['thumbnail', 'named', 'background']) {
    await page.evaluate(mode => window.mode = mode, mode);
    const filename = `xm-drafts-${mode}.jpg`;
    const prompt = `Complete scan prompt for ${mode}\n截图只找草稿\n` + 'Long instruction. '.repeat(100);
    const receipt = await run({ command: 'prepare-image', filename, image: pixel, prompt });
    assert.equal(receipt.state, 'uploaded');
    assert.equal(await page.evaluate(() => prepared.at(-1)), prompt, 'question must already be complete when upload begins');
    const ready = () => run({ command: 'image-ready', filename, upload: receipt.upload });
    if (mode === 'thumbnail') await page.waitForFunction(() => document.querySelector('#attachment img')?.naturalWidth > 0);
    assert.equal((await ready()).state, 'uploading');
    await page.evaluate(() => document.querySelector('[role=progressbar]').hidden = true);
    assert.equal((await ready()).state, 'uploading', 'disabled Send still blocks submission');
    await finish();
    assert.equal((await ready()).state, 'ready');
    assert.equal((await run({ command: 'image-ready', filename: 'xm-drafts-wrong.jpg', upload: receipt.upload })).state, 'uploading');
    assert.equal((await run({ command: 'fill', prompt })).state, 'filled');
    assert.equal((await run({ command: 'send', prompt })).state, 'sent');
    assert.equal(await page.evaluate(() => sent.at(-1)), prompt);
  }
  assert.equal(await page.evaluate(() => sent.length), 3);

  // A previously displayed image or a new chat avatar must not count as our attachment.
  await page.evaluate(() => window.mode = 'none');
  const filename = 'xm-drafts-missing.jpg';
  const missing = await run({ command: 'upload-image', filename, image: pixel });
  await finish();
  await page.evaluate(() => { const image = document.querySelector('#old').cloneNode(); image.src += '#new-avatar'; document.querySelector('article').append(image); });
  assert.equal((await run({ command: 'image-ready', filename, upload: missing.upload })).state, 'uploading');
  await page.evaluate(() => document.querySelector('#attachment').textContent = '上传失败');
  assert.equal((await run({ command: 'image-ready', filename, upload: missing.upload })).state, 'unsupported');

  // Preserve a user draft and support pages which remove the file input after upload.
  await page.evaluate(() => { document.querySelector('#attachment').textContent = ''; document.querySelector('textarea').value = 'Unsent user text'; });
  assert.equal((await run({ command: 'upload-image', filename, image: pixel })).state, 'draft');
  await page.evaluate(() => { document.querySelector('textarea').value = ''; window.mode = 'thumbnail'; });
  const removed = await run({ command: 'upload-image', filename, image: pixel });
  await page.waitForFunction(() => document.querySelector('#attachment img')?.naturalWidth > 0);
  await finish();
  await page.evaluate(() => document.querySelector('input').remove());
  assert.equal((await run({ command: 'image-ready', filename, upload: removed.upload })).state, 'ready');
  assert.equal((await run({ command: 'upload-image', filename, image: pixel })).state, 'unsupported');
});

test('the complete scan uses the existing page, fills first, submits each screenshot once and reads both results', async t => {
  const browser = await chromium.launch({ ...(process.env.XM_CHROME_PATH ? { executablePath: process.env.XM_CHROME_PATH } : {}), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('https://chat.deepseek.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8">
    <article class="markdown">Existing conversation</article>
    <style>form{width:640px;height:220px}textarea{display:block;width:610px;height:80px}.preview{width:64px;height:64px;background-size:cover}</style>
    <form><div id="attachment"></div><textarea></textarea><input type="file" accept="image/*" hidden><button type="button" aria-label="发送" disabled>发送</button></form>
    <script>
      window.events=[];window.sent=[];
      const editor=document.querySelector('textarea'), button=document.querySelector('button'), attachment=document.querySelector('#attachment');
      editor.oninput=()=>{events.push('fill');button.disabled=!editor.value;};
      document.querySelector('input').onchange=e=>{
        events.push('upload');window.questionAtUpload=editor.value;
        const preview=document.createElement('div');preview.className='preview';preview.style.backgroundImage='url('+URL.createObjectURL(e.target.files[0])+')';attachment.append(preview);
        button.disabled=true;e.target.value='';setTimeout(()=>button.disabled=false,30);
      };
      button.onclick=()=>{
        events.push('send');sent.push(editor.value);
        const token=editor.value.match(/本次任务标识：([^\\n]+)/)[1];editor.value='';attachment.replaceChildren();
        const answer=document.createElement('pre');answer.textContent=JSON.stringify({xmTaskId:token,result:sent.length===1?{heading:{x:1,y:2}}:{drafts:[]}});document.body.append(answer);
      };
    </script>` }));
  await page.goto('https://chat.deepseek.com/');
  const notifications = [], commands = [];
  const controller = new AbortController();
  const driver = createJianyingWebScan({
    notify: task => notifications.push(task), delay: () => new Promise(resolve => setTimeout(resolve, 40)),
    driver: { visible: () => true, run: async (_id, input) => { commands.push(input.command); const result = await page.evaluate(webAIPageScript({ ...input, host: 'chat.deepseek.com' })); if (result.state === 'enter') { await page.keyboard.press('Enter'); return { state: 'sent' }; } return result; } },
  });
  assert.equal(await driver.request({ prompt: 'Find drafts heading', image: pixel }, controller.signal), '{"heading":{"x":1,"y":2}}');
  assert.equal(await driver.request({ prompt: 'Find draft cards', image: pixel }, controller.signal), '{"drafts":[]}');
  assert.deepEqual(await page.evaluate(() => events), ['fill', 'upload', 'send', 'fill', 'upload', 'send']);
  assert.equal(commands.filter(x => x === 'send').length, 2);
  assert.equal(await page.locator('article').innerText(), 'Existing conversation');
  assert.equal(browser.contexts()[0].pages().length, 1);
  driver.close(); assert.equal(notifications.at(-1), null);
  assert.equal(page.isClosed(), false);
});

test('contenteditable questions mentioning unsupported images do not count as attachment errors', async t => {
  const browser = await chromium.launch({ ...(process.env.XM_CHROME_PATH ? { executablePath: process.env.XM_CHROME_PATH } : {}), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('https://chat.deepseek.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><form style="width:640px"><div id="attachment"></div><div role="textbox" contenteditable="true" style="min-height:60px"></div><input type="file" accept="image/*" hidden><button type="button" aria-label="发送">发送</button><script>document.querySelector('input').onchange=e=>{document.querySelector('#attachment').textContent=e.target.files[0].name;};</script>` }));
  await page.goto('https://chat.deepseek.com/');
  const prompt = '识别截图；如果无法识别图片，返回错误。If unsupported image, report it.';
  const input = { host: 'chat.deepseek.com', filename: 'xm-drafts-editor.jpg', image: pixel, prompt };
  const prepared = await page.evaluate(webAIPageScript({ ...input, command: 'prepare-image' }));
  assert.equal(prepared.state, 'uploaded');
  assert.equal(await page.locator('[contenteditable]').innerText(), prompt);
  assert.equal((await page.evaluate(webAIPageScript({ ...input, command: 'image-ready', upload: prepared.upload }))).state, 'ready');
  await page.locator('#attachment').evaluate(node => node.textContent = '上传失败');
  assert.equal((await page.evaluate(webAIPageScript({ ...input, command: 'image-ready', upload: prepared.upload }))).state, 'unsupported');
});

test('hidden textarea mirrors and prior chat messages cannot block an enabled image submission', async t => {
  const browser = await chromium.launch({ ...(process.env.XM_CHROME_PATH ? { executablePath: process.env.XM_CHROME_PATH } : {}), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('https://chat.deepseek.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8">
    <div class="history"><article><p>Previous task: If visual understanding is unavailable, return 当前模型无法识别图片布局。</p><pre>{"xmTaskId":"old-task","result":{"heading":null}}</pre></article></div>
    <div id="composer" style="width:760px;height:450px;border:1px solid #ddd">
      <div id="attachment" style="height:64px"></div><div class="editor-shell"><div class="auto-size-mirror" style="visibility:hidden;position:absolute;pointer-events:none"></div><textarea style="height:300px;width:740px"></textarea></div>
      <input type="file" accept="image/*" hidden><div id="toolbar"><button type="button">深度思考</button><button type="button">智能搜索</button><button id="send" type="button" aria-label="发送">↑</button></div>
    </div>
    <script>
      window.sent=[];
      const editor=document.querySelector('textarea'),attachment=document.querySelector('#attachment');
      editor.oninput=()=>document.querySelector('.auto-size-mirror').textContent=editor.value;
      document.querySelector('input').onchange=e=>{const img=new Image();img.src=URL.createObjectURL(e.target.files[0]);img.style.cssText='width:64px;height:64px';attachment.append(img);e.target.value='';};
      document.querySelector('#send').onclick=()=>{sent.push(editor.value);editor.value='';attachment.replaceChildren();};
    </script>` }));
  await page.goto('https://chat.deepseek.com/');
  const input = { host: 'chat.deepseek.com', filename: 'xm-drafts-mirror.jpg', image: pixel, prompt: 'Locate LOCAL PROJECT DRAFTS. '.repeat(25) + '\nIf visual understanding is unavailable, return {"error":"当前模型无法识别图片布局，请使用 Gemini"}.' };
  const prepared = await page.evaluate(webAIPageScript({ ...input, command: 'prepare-image' }));
  assert.equal(prepared.state, 'uploaded');
  await page.waitForFunction(() => document.querySelector('#attachment img')?.naturalWidth > 0);
  const readiness = await page.evaluate(webAIPageScript({ ...input, command: 'image-ready', upload: prepared.upload }));
  assert.equal(readiness.state, 'ready', 'a hidden sizing mirror is not a website upload error');
  assert.equal((await page.evaluate(webAIPageScript({ ...input, command: 'send' }))).state, 'sent');
  assert.deepEqual(await page.evaluate(() => sent), [input.prompt]);
});
