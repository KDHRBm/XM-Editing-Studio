import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = path.join(root, 'baseline');
const jsName = 'index-sP0cbikv.js';
const cssName = 'index-DzzkVdoP.css';
const compiled = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : (await build({ entryPoints: [path.join(root, 'src/upgrade.jsx')], bundle: true, write: false, format: 'iife', globalName: 'BOSMusicUpgrade', jsxFactory: 'i.createElement', jsxFragment: 'i.Fragment', target: 'chrome140', minify: true })).outputFiles[0].text;
if (!compiled.includes('GlobalThemePicker') || !compiled.includes('useGlobalTheme')) throw new Error('Bundle must include src/upgrade.jsx and global themes.');
let code = fs.readFileSync(path.join(original, jsName), 'utf8');
function replaceOnce(before, after) {
  if (code.split(before).length !== 2) throw new Error(`Expected exactly one patch location: ${before}`);
  code = code.replace(before, after);
}
const start = code.indexOf('function b3('), end = code.indexOf('function M3(', start);
if (start < 0 || end < 0) throw new Error('Unsupported baseline: Music component not found.');
code = code.slice(0, start) + compiled + '\nfunction b3({providers:U,onGoProviders:Q}){return i.createElement(BOSMusicUpgrade.MusicStudio,{providers:U,onGoProviders:Q})}\n' + code.slice(end);
replaceOnce('function A3(){', 'function A3(){const bosGlobalTheme=BOSMusicUpgrade.useGlobalTheme();');
replaceOnce('[Nl,_l]=i.useState(!1);i.useEffect', '[Nl,_l]=i.useState(!1);const bosAutomation=BOSMusicUpgrade.useScriptAutomation(x);i.useEffect');
replaceOnce('d==="providers"&&s.jsxs("section",{className:"provider-stack"', 'd==="providers"&&s.jsx(BOSMusicUpgrade.UsageGuide,{}),d==="providers"&&s.jsxs("section",{className:"provider-stack"');
replaceOnce('d==="workspace"&&s.jsx(z3,{models:Zl,onNavigate:T})', 'd==="workspace"&&s.jsx(z3,{models:Zl,onNavigate:T,providers:x,automation:bosAutomation})');
// Lazy icon wrappers resolve after the upgrade bundle initializes; the baseline
// navigation array is evaluated earlier than that bundle.
replaceOnce('const y3=[{id:"providers",label:"模型与连接",sub:"配置供应商与模型",Icon:Ec},{id:"chat",label:"对话",sub:"与 AI 深度交流",Icon:Sc},{id:"music",label:"音乐",sub:"用 AI 模型生成音乐",Icon:K1},{id:"workspace",label:"工作空间",sub:"我的创作与灵感",Icon:P8}];', `const y3=[
  {id:"batch",label:"跑量剪辑流",sub:"多集字幕与本地配乐",Icon:props=>i.createElement(BOSMusicUpgrade.BatchNavIcon,props)},
  {id:"workspace",label:"工作空间",sub:"我的创作与灵感",Icon:P8},
  {id:"music",label:"音乐",sub:"用 AI 模型生成音乐",Icon:K1},
  {id:"jianying",label:"JianYing-Ai-Pro",sub:"剪映批量生产工具",Icon:props=>i.createElement(BOSMusicUpgrade.JianyingNavIcon,props)},
  {id:"chat",label:"对话",sub:"与 AI 深度交流",Icon:Sc},
  {id:"webai",label:"国内 AI",sub:"DeepSeek · 豆包网页版",Icon:props=>i.createElement(BOSMusicUpgrade.WebAiNavIcon,props)},
  {id:"providers",label:"模型与连接",sub:"配置供应商与模型",Icon:Ec}
];`);
replaceOnce('workspace:{eyebrow:"工作空间"', 'batch:{eyebrow:"跑量剪辑流",title:"多集剧本，一起整理。",description:"自动识别集数，批量分析剧情；字幕与本地音乐按集保存。"},workspace:{eyebrow:"工作空间"');
replaceOnce('workspace:{eyebrow:"工作空间"', 'webai:{eyebrow:"国内 AI",title:"官方网页，直接使用。",description:"内嵌 DeepSeek 与豆包，使用自己的账号登录，无需配置 API。"},jianying:{eyebrow:"JianYing-Ai-Pro",title:"剪映自动化工作台",description:"批量导出、字幕工程与智能命名，复用已配置的 AI 连接。"},watermark:{eyebrow:"加样片水印",title:"让样片，带上你的标记。",description:"选择视频，批量叠加样片水印。处理在本机完成，支持离线使用。"},workspace:{eyebrow:"工作空间"');
replaceOnce('d==="workspace"&&s.jsx(z3,{models:Zl,onNavigate:T,providers:x,automation:bosAutomation})', 'd==="workspace"&&s.jsx(z3,{models:Zl,onNavigate:T,providers:x,automation:bosAutomation}),s.jsx(BOSMusicUpgrade.JianyingStudio,{active:d==="jianying"||d==="watermark",providers:x,onNavigate:T}),s.jsx(BOSMusicUpgrade.WebAIStudio,{active:d==="webai",providers:x,automation:bosAutomation,onNavigate:T}),s.jsx(BOSMusicUpgrade.BatchAnalysis,{active:d==="batch",providers:x,onNavigate:T})');
replaceOnce('className:`app-shell ${d==="chat"?"chat-open":""}`', 'className:`app-shell ${d==="chat"?"chat-open":d==="music"?"music-open":d==="webai"?"webai-open":""}`,"data-bos-theme":bosGlobalTheme');
replaceOnce('children:[s.jsxs("aside",{className:"sidebar"', 'children:[s.jsx(BOSMusicUpgrade.TitleBar,{onNavigate:T}),s.jsxs("aside",{className:"sidebar"');
replaceOnce('function z3({models:d,onNavigate:T})', 'function BOSOriginalWorkspace({models:d,onNavigate:T})');
replaceOnce('Ys.createRoot(document.getElementById("root"))', 'function z3(props){return i.createElement("section",{className:"bos-workspace"},i.createElement(BOSMusicUpgrade.ScriptAutomation,props),i.createElement(BOSMusicUpgrade.GlobalThemePicker))}\nYs.createRoot(document.getElementById("root"))');
const legacyWorkspaceStart = code.indexOf('function BOSOriginalWorkspace(');
const legacyWorkspaceEnd = code.indexOf('function z3(props)', legacyWorkspaceStart);
if (legacyWorkspaceStart < 0 || legacyWorkspaceEnd < 0) throw new Error('Legacy workspace removal location changed.');
code = code.slice(0, legacyWorkspaceStart) + code.slice(legacyWorkspaceEnd);
replaceOnce('最近使用的模型、对话和音乐创作都在这里继续。', '从剧本到配乐，管理批量创作与剪映素材，也可在这里切换全局主题。');
code = code.replace('if(!w.preview)throw new Error', 'if(!w.preview&&!w.ok)throw new Error');
code = code.replace('title:"让灵感发出声音",description:"选择已接入的音乐生成模型，描述你想听到的场景与情绪，直接通过中转站发起创作。"', 'title:"让灵感，自成旋律。",description:"从一种风格，到一首完整的作品。定制声音的质感，编排音乐的起承转合。"');
code = code.replace('{value:"custom",label:"自定义（OpenAI 兼容）"}],v3={openai:[],anthropic:[],gemini:[],custom:[]}', '{value:"custom",label:"自定义（OpenAI 兼容）"},{value:"suno",label:"Suno 异步音乐"}],v3={openai:[],anthropic:[],gemini:[],custom:[],suno:[]}');
code = code.replaceAll('黑曜信号台', 'XM剪辑台');
fs.writeFileSync(path.join(root, 'dist/client/assets/music-studio.js'), code);
// Replace the original decorative rail with functional local shortcuts.
const railStart = code.indexOf('s.jsxs("aside",{className:"inspiration-rail"');
const railEnd = code.indexOf(',R&&s.jsx(S3', railStart);
if (railStart < 0 || railEnd < 0) throw new Error('Right sidebar patch location changed.');
code = code.slice(0, railStart) + 's.jsx(BOSMusicUpgrade.QuickRail,{}),s.jsx(BOSMusicUpgrade.SidebarResizer,{})' + code.slice(railEnd);
fs.writeFileSync(path.join(root, 'dist/client/assets/music-studio.js'), code);
const css = [fs.readFileSync(path.join(original, cssName), 'utf8'), fs.readFileSync(path.join(root, 'src/music-studio.css'), 'utf8'), fs.readFileSync(path.join(root, 'src/global-themes.css'), 'utf8'), fs.readFileSync(path.join(root, 'src/script-automation.css'), 'utf8'), fs.readFileSync(path.join(root, 'src/batch-analysis.css'), 'utf8'), fs.readFileSync(path.join(root, 'src/watermark-studio.css'), 'utf8'), fs.readFileSync(path.join(root, 'src/release-140.css'), 'utf8')].join('\n');
fs.writeFileSync(path.join(root, 'dist/client/assets/music-studio.css'), css);
const version = createHash('sha256').update(code).update(css).digest('hex').slice(0, 12);
let html = fs.readFileSync(path.join(original, 'index.html'), 'utf8').replace(jsName, `music-studio.js?v=${version}`).replace(cssName, `music-studio.css?v=${version}`).replaceAll('黑曜信号台', 'XM剪辑台');
fs.writeFileSync(path.join(root, 'dist/client/index.html'), html);
console.log('Built music-studio.js and music-studio.css');
