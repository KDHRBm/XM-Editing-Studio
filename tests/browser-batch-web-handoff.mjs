import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
const { chromium } = await import(process.env.XM_PLAYWRIGHT_MODULE || 'playwright');

test('episode retry yields its native modal to DSH and restores results, errors and cancellation; API keeps the modal', async t => {
  const bundle = await build({ stdin: { contents: `
    import * as React from 'react'; import {createRoot} from 'react-dom/client';
    import {BatchAnalysis} from './app/src/BatchAnalysis.jsx';
    import {WebAIStudio} from './app/src/WebAIStudio.jsx';
    import {batchQueue} from './app/src/BatchAnalysisStore.mjs';
    globalThis.i = React; globalThis.queue = batchQueue;
    globalThis.layouts = []; globalThis.requests = [];
    const listeners = new Set(); let task = null, pending = null;
    globalThis.notify = value => { task = value; listeners.forEach(fn => fn(value)); };
    globalThis.finishRequest = outcome => {
      const request = pending; pending = null; notify(null);
      if (outcome === 'error') request.reject(new Error('测试连接失败'));
      else if (outcome === 'cancel') request.reject(new DOMException('已中断分析', 'AbortError'));
      else request.resolve({ episodes: request.body.episodes.map(e => ({id:e.id,value:{analysis:{summary:'本集新配乐分析',keywords:['温暖']},matches:[{id:'piano',reason:'钢琴衬托本集重逢情绪'}]}})) });
    };
    const analyze = (body, webTask) => new Promise((resolve,reject) => {
      requests.push({body,webTask}); pending = {body,resolve,reject}; if(webTask) notify(webTask);
    });
    globalThis.blackObsidian = {
      getMusicLibrary: async () => ({tracks:[{id:'piano',title:'温暖钢琴'}],directories:[{path:'fixture'}]}),
      companyDSHConfig: async () => ({entryUrl:'http://localhost/company-fixture'}),
      onWebAnalysisTask: fn => {listeners.add(fn);return () => listeners.delete(fn);},
      getWebAnalysisTask: async () => task,
      layoutWebAI: async input => {layouts.push(input);return {};}, webAIAction: async () => ({}),
      analyzeWebScript: request => analyze(request.input,{id:request.id,token:'stage-one',provider:request.provider,stage:'分析剧本',message:'测试分析中'}),
      webAnalysisAction: async (_id,action) => {if(action === 'cancel')finishRequest('cancel');},
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url,options) => {
      if(!String(url).startsWith('/api/script/'))return originalFetch(url,options);
      return Response.json(await analyze(JSON.parse(options.body),null));
    };
    function App(){return <><BatchAnalysis active providers={[{id:'g',protocol:'gemini',name:'Gemini',apiKey:'fixture',models:['gemini-test']}]} onNavigate={()=>{}}/><WebAIStudio active={false} onNavigate={()=>{}}/></>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment' });
  const css = (await Promise.all(['app/src/script-automation.css','app/src/batch-analysis.css'].map(file => fs.readFile(file,'utf8')))).join('\n');
  const server = createServer((req,res) => {
    res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript;charset=utf-8' : 'text/html;charset=utf-8');
    res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : `<!doctype html><meta charset="utf-8"><style>${css}\n.bos-web-ai[hidden]{display:none}.bos-web-ai-overlay{position:fixed;inset:0;background:white;z-index:1000;overflow:auto}.bos-web-ai-slot{height:350px;min-width:400px}body{margin:20px;font:14px sans-serif}</style><div id="root"></div><script src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({headless:true,...(process.env.XM_CHROME_PATH ? {executablePath:process.env.XM_CHROME_PATH} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1400,height:1100}});
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => queue.snapshot().loaded);
  await page.evaluate(async () => {
    const id = await queue.createProject('弹窗衔接测试');
    await queue.import([{episodeNumber:1,title:'第1集',script:'[EN] A: Welcome home.'}],{analyzerKey:'webai:dsh::公司 DSH',subtitleLanguage:'en'},id);
  });
  await page.getByLabel('跑量剪辑流模型').selectOption('webai:dsh::公司 DSH');
  await page.getByRole('button',{name:'查看第1集字幕与音乐',exact:true}).click();
  const detail = page.locator('.bos-batch-dialog');
  const retry = () => detail.getByRole('button',{name:'重新分析整段音乐',exact:true}).click();
  const webReady = () => page.waitForFunction(() => layouts.at(-1)?.visible && layouts.at(-1)?.provider === 'dsh' && !document.querySelector('.bos-batch-dialog').open);
  await retry(); await webReady();
  assert.equal(await detail.isVisible(),false,'native top layer must be released before the DSH driver can send');
  // Each web phase can emit null before the next request. Do not reopen the
  // detail modal between script analysis and music matching.
  await page.evaluate(() => notify(null));
  await page.waitForFunction(() => !document.querySelector('.bos-web-ai').getClientRects().length);
  assert.equal(await detail.evaluate(node => node.open),false);
  await page.evaluate(() => notify({id:'second-stage',token:'stage-two',provider:'dsh',stage:'匹配音乐',message:'测试选曲中'}));
  await webReady();
  await page.evaluate(() => finishRequest('success'));
  await detail.waitFor({state:'visible'});
  assert.match(await detail.innerText(),/本集音乐推荐已更新/);
  assert.match(await detail.innerText(),/钢琴衬托本集重逢情绪/);
  assert.equal(await detail.getByRole('button',{name:'本地音乐推荐 · 1 首'}).getAttribute('aria-pressed'),'true');

  await retry(); await webReady(); await page.evaluate(() => finishRequest('error'));
  await detail.waitFor({state:'visible'});
  assert.match(await detail.innerText(),/测试连接失败/);
  assert.match(await detail.innerText(),/钢琴衬托本集重逢情绪/,'failure preserves the previous recommendation');
  await retry(); await webReady();
  await page.locator('.bos-web-ai').getByRole('button',{name:'中断分析',exact:true}).click();
  await detail.waitFor({state:'visible'});
  assert.match(await detail.innerText(),/钢琴衬托本集重逢情绪/);

  await detail.getByRole('button',{name:'关闭任务详情'}).click();
  await page.getByLabel('跑量剪辑流模型').selectOption('g::gemini-test');
  await page.getByRole('button',{name:'查看第1集字幕与音乐',exact:true}).click();
  await retry();
  await page.waitForFunction(() => requests.at(-1)?.body.provider?.protocol === 'gemini');
  assert.equal(await detail.isVisible(),true,'API retry stays in the episode modal');
  assert.equal(await detail.evaluate(node => node.matches(':modal')),true);
  await page.evaluate(() => finishRequest('success'));
  await page.waitForFunction(() => !queue.snapshot().running);
  assert.equal(await detail.isVisible(),true);
  assert.equal(await page.evaluate(() => requests.length),4);
  assert.deepEqual(errors,[]);
});
