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
replaceOnce('[Nl,_l]=i.useState(!1);i.useEffect', '[Nl,_l]=i.useState(!1);const bosAutomation=BOSMusicUpgrade.useScriptAutomation(x);BOSMusicUpgrade.useInterfaceMotion(d);i.useEffect');
replaceOnce('d==="providers"&&s.jsxs("section",{className:"provider-stack"', 'd==="providers"&&s.jsx(BOSMusicUpgrade.GlobalThemePicker,{}),d==="providers"&&s.jsx(BOSMusicUpgrade.UsageGuide,{}),d==="providers"&&s.jsxs("section",{className:"provider-stack"');
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
  {id:"companion",label:"动画设置",sub:"大肥鱼桌面动画",Icon:props=>i.createElement(BOSMusicUpgrade.PetNavIcon,props)},
  {id:"providers",label:"模型与连接",sub:"配置供应商与模型",Icon:Ec}
];`);
replaceOnce('workspace:{eyebrow:"工作空间"', 'batch:{eyebrow:"跑量剪辑流",title:"多集剧本，一起整理。",description:"自动识别集数，批量分析剧情；字幕与本地音乐按集保存。"},workspace:{eyebrow:"工作空间"');
replaceOnce('workspace:{eyebrow:"工作空间"', 'companion:{eyebrow:"动画设置",title:"大肥鱼桌面动画",description:"选择动画与显示大小。"},workspace:{eyebrow:"工作空间"');
replaceOnce('d==="providers"&&s.jsx(BOSMusicUpgrade.GlobalThemePicker,{})', 'd==="companion"&&s.jsx(BOSMusicUpgrade.CompanionSettings,{}),d==="providers"&&s.jsx(BOSMusicUpgrade.GlobalThemePicker,{})');
replaceOnce('workspace:{eyebrow:"工作空间"', 'webai:{eyebrow:"国内 AI",title:"官方网页，直接使用。",description:"内嵌 DeepSeek 与豆包，使用自己的账号登录，无需配置 API。"},jianying:{eyebrow:"JianYing-Ai-Pro",title:"剪映自动化工作台",description:"批量导出、字幕工程与智能命名，复用已配置的 AI 连接。"},watermark:{eyebrow:"加样片水印",title:"让样片，带上你的标记。",description:"选择视频，批量叠加样片水印。处理在本机完成，支持离线使用。"},workspace:{eyebrow:"工作空间"');
replaceOnce('d==="workspace"&&s.jsx(z3,{models:Zl,onNavigate:T,providers:x,automation:bosAutomation})', 'd==="workspace"&&s.jsx(z3,{models:Zl,onNavigate:T,providers:x,automation:bosAutomation}),s.jsx(BOSMusicUpgrade.JianyingStudio,{active:d==="jianying"||d==="watermark",providers:x,onNavigate:T}),s.jsx(BOSMusicUpgrade.WebAIStudio,{active:d==="webai",providers:x,automation:bosAutomation,onNavigate:T}),s.jsx(BOSMusicUpgrade.BatchAnalysis,{active:d==="batch",providers:x,onNavigate:T})');
replaceOnce('className:`app-shell ${d==="chat"?"chat-open":""}`', 'className:`app-shell ${d==="chat"?"chat-open":d==="music"?"music-open":d==="webai"?"webai-open":""}`,"data-bos-theme":bosGlobalTheme');
replaceOnce('const[d,T]=i.useState("providers")', 'const[d,T]=i.useState(new URLSearchParams(location.search).get("floating")==="jianying"?"jianying":"batch")');
replaceOnce('className:`app-shell ${d==="chat"?"chat-open":d==="music"?"music-open":d==="webai"?"webai-open":""}`,"data-bos-theme":bosGlobalTheme', 'className:`app-shell ${new URLSearchParams(location.search).get("floating")==="jianying"?"xm-floating":""} ${d==="chat"?"chat-open":d==="music"?"music-open":d==="webai"?"webai-open":""}`,"data-bos-theme":bosGlobalTheme');
replaceOnce('children:[s.jsxs("aside",{className:"sidebar"', 'children:[s.jsx(BOSMusicUpgrade.TitleBar,{onNavigate:T}),s.jsxs("aside",{className:"sidebar"');
replaceOnce('function z3({models:d,onNavigate:T})', 'function BOSOriginalWorkspace({models:d,onNavigate:T})');
replaceOnce('Ys.createRoot(document.getElementById("root"))', 'function z3(props){return i.createElement("section",{className:"bos-workspace"},i.createElement(BOSMusicUpgrade.ScriptAutomation,props))}\nYs.createRoot(document.getElementById("root"))');
const legacyWorkspaceStart = code.indexOf('function BOSOriginalWorkspace(');
const legacyWorkspaceEnd = code.indexOf('function z3(props)', legacyWorkspaceStart);
if (legacyWorkspaceStart < 0 || legacyWorkspaceEnd < 0) throw new Error('Legacy workspace removal location changed.');
code = code.slice(0, legacyWorkspaceStart) + code.slice(legacyWorkspaceEnd);
replaceOnce('最近使用的模型、对话和音乐创作都在这里继续。', '从剧本到配乐，管理批量创作与剪映素材。');
replaceOnce(',s.jsx("span",{className:"status-spacer"})," ",s.jsx("span",{children:"配置保存在本机浏览器，请求转发至你填写的服务地址"})', '');
code = code.replace('if(!w.preview)throw new Error', 'if(!w.preview&&!w.ok)throw new Error');
code = code.replace('title:"让灵感发出声音",description:"选择已接入的音乐生成模型，描述你想听到的场景与情绪，直接通过中转站发起创作。"', 'title:"让灵感，自成旋律。",description:"从一种风格，到一首完整的作品。定制声音的质感，编排音乐的起承转合。"');
replaceOnce(
  '{value:"gemini",label:"Gemini Generative"},{value:"custom",label:"自定义（OpenAI 兼容）"}],v3={openai:[],anthropic:[],gemini:[],custom:[]}',
  '{value:"gemini",label:"Gemini AI Studio（官方免填地址）"},{value:"deepseek",label:"DeepSeek 官方 API（免填地址）"},{value:"custom",label:"自定义（OpenAI 兼容）"},{value:"suno",label:"Suno 异步音乐"}],v3={openai:[],anthropic:[],gemini:["gemini-3.5-flash","gemini-3.5-flash-lite","gemini-3.8-flash","gemini-3.8-flash-lite"],deepseek:["deepseek-flash","deepseek-v4-pro"],custom:[],suno:[]}'
);
replaceOnce('[Q,Y]=i.useState("openai")', '[Q,Y]=i.useState("gemini")');
replaceOnce('Il=(y="openai")=>{Y(y),U(!0)}', 'Il=(y="gemini")=>{Y(y),U(!0)}');

const providerStart = code.indexOf('function p3({provider:d,onChange:T,onRemove:x,onTest:v}){');
const providerEnd = code.indexOf('function E3({providers:d,messages:T,value:x,onChange:v,onSubmit:R,busy:U,onGoProviders:Q}){', providerStart);
if (providerStart < 0 || providerEnd < 0) throw new Error('Provider card baseline changed.');
let providerUi = code.slice(providerStart, providerEnd);
function replaceProvider(before, after) {
  if (providerUi.split(before).length !== 2) throw new Error(`Provider UI patch location changed: ${before.slice(0, 80)}`);
  providerUi = providerUi.replace(before, after);
}
replaceProvider(
  'function p3({provider:d,onChange:T,onRemove:x,onTest:v}){var',
  `function p3({provider:d,onChange:T,onRemove:x,onTest:v}){const fetchApiModels=async()=>{
    if(!d.apiKey?.trim()||fetchingModels)return;
    setFetchingModels(!0);
    try{
      const response=await fetch('/api/providers/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:d})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'获取模型列表失败');
      setApiModels(data.models||[]);
      if(!(d.models||[]).length&&data.models?.length)T({models:data.models.slice(0,4)});
      if(!data.models?.length)dl('当前密钥没有返回可用的对话模型。');
    }catch(error){dl(error.message||'获取模型列表失败');C(!1)}
    finally{setFetchingModels(!1)}
  };var`
);
replaceProvider(
  '[pl,C]=i.useState(!1),hl=(v3[d.protocol]??[]).filter(q=>!(d.models||[]).includes(q));i.useEffect',
  '[pl,C]=i.useState(!1),[apiModels,setApiModels]=i.useState([]),[fetchingModels,setFetchingModels]=i.useState(!1),hl=[...new Set([...(v3[d.protocol]??[]),...apiModels])].filter(q=>!(d.models||[]).includes(q));i.useEffect(()=>{if(Q&&d.apiKey?.trim())void fetchApiModels()},[Q]);i.useEffect'
);
replaceProvider('const Nl=q=>{T({protocol:q})}', 'const Nl=q=>{const gem=q==="gemini",deep=q==="deepseek";setApiModels([]);T({protocol:q,models:gem?["gemini-3.5-flash","gemini-3.5-flash-lite","gemini-3.8-flash","gemini-3.8-flash-lite"]:deep?["deepseek-flash","deepseek-v4-pro"]:[],...(gem?{name:"Gemini AI Studio",description:"Google AI Studio 官方直连 · 免填 Base URL",baseUrl:"https://generativelanguage.googleapis.com/v1beta"}:deep?{name:"DeepSeek 官方 API",description:"DeepSeek 官方直连 · 免填 Base URL",baseUrl:"https://api.deepseek.com"}:{})})}');
replaceProvider('className:"provider-card"', 'className:`provider-card ${d.protocol==="gemini"?"gemini-provider":""}`');
replaceProvider('s.jsx("strong",{children:d.name}),s.jsx("span",{children:d.description||"自定义 AI 服务 · 独立协议适配"})', 's.jsx("strong",{children:d.name||"AI 连接"}),s.jsx("span",{children:d.protocol==="gemini"?"Google AI Studio 官方直连 · 免填 Base URL":d.protocol==="deepseek"?"DeepSeek 官方直连 · 免填 Base URL":d.description||"自定义 AI 服务 · 独立协议适配"})');
replaceProvider('s.jsx("span",{children:"协议适配器"})', 's.jsx("span",{children:"Provider Select"})');
replaceProvider('children:[s.jsxs("label",{className:"field-group",children:[s.jsx("span",{children:"Base URL"})', 'children:[!["gemini","deepseek"].includes(d.protocol)&&s.jsxs("label",{className:"field-group",children:[s.jsx("span",{children:"Base URL"})');
replaceProvider(
  's.jsx("div",{className:"model-menu-title",children:"选择可用模型"}),hl.map(q=>',
  's.jsx("div",{className:"model-menu-title",children:"选择可用模型"}),s.jsx("button",{type:"button",className:"model-fetch-action",onClick:fetchApiModels,disabled:fetchingModels||!d.apiKey?.trim(),children:fetchingModels?"正在获取模型…":"从 API 获取最新模型"}),s.jsxs("div",{className:"model-menu-list",children:[hl.map(q=>'
);
replaceProvider('s.jsx("p",{className:"model-empty",children:"添加你服务商提供的模型 ID"}),s.jsxs("form"', 's.jsx("p",{className:"model-empty",children:"添加你服务商提供的模型 ID"})]}),s.jsxs("form"');
replaceProvider('disabled:j||!X||!((Il=d.baseUrl)!=null&&Il.trim())||!((Bl=d.apiKey)!=null&&Bl.trim())', 'disabled:j||!X||(!["gemini","deepseek"].includes(d.protocol)&&!((Il=d.baseUrl)!=null&&Il.trim()))||!((Bl=d.apiKey)!=null&&Bl.trim())');
replaceProvider('function S3({onClose:d,onAdd:T,initialProtocol:x="openai"})', 'function S3({onClose:d,onAdd:T,initialProtocol:x="gemini"})');
replaceProvider(
  'const dl=v.trim()||"自定义中转站";T({id:`provider-${Date.now()}`,name:dl,description:"自定义服务 · 独立协议配置",protocol:U,baseUrl:Y.trim(),apiKey:b.trim(),models:[O.trim()],markIcon:"",tone:"custom"})',
  'const gem=U==="gemini",deep=U==="deepseek",dl=v.trim()||(gem?"Gemini AI Studio":deep?"DeepSeek 官方 API":"自定义中转站");T({id:`provider-${Date.now()}`,name:dl,description:gem?"Google AI Studio 官方直连 · 免填 Base URL":deep?"DeepSeek 官方直连 · 免填 Base URL":"自定义服务 · 独立协议配置",protocol:U,baseUrl:gem?"https://generativelanguage.googleapis.com/v1beta":deep?"https://api.deepseek.com":Y.trim(),apiKey:b.trim(),models:O.trim()?[O.trim()]:(gem?["gemini-3.5-flash","gemini-3.5-flash-lite","gemini-3.8-flash","gemini-3.8-flash-lite"]:deep?["deepseek-flash","deepseek-v4-pro"]:[]),markIcon:"",tone:"custom"})'
);
replaceProvider('children:["协议适配器",s.jsx("select"', 'children:["Provider Select",s.jsx("select"');
replaceProvider('s.jsxs("label",{children:["Base URL",s.jsx("input",{required:!0', '!["gemini","deepseek"].includes(U)&&s.jsxs("label",{children:["Base URL",s.jsx("input",{required:!0');
replaceProvider('children:["模型 ID",s.jsx("input",{required:!0', 'children:["模型 ID",s.jsx("input",{required:!["gemini","deepseek"].includes(U)');
replaceProvider('密钥明文保存在此浏览器；请求会转发到你填写的服务地址。', '密钥明文保存在本机浏览器；官方 API 协议固定直连官方地址，其他协议会转发到你填写的服务地址。');
code = code.slice(0, providerStart) + providerUi + code.slice(providerEnd);
replaceOnce(",s.jsx(\"div\",{className:\"brand-kicker\",children:\"聚合多元模型 · 创作无限可能\"})", "");
replaceOnce("s.jsxs(\"div\",{className:\"sidebar-foot\",children:[s.jsx(\"div\",{className:\"side-rule\"}),s.jsx(\"p\",{children:\"多重协议 · 一站接入\"}),s.jsxs(\"p\",{className:\"muted\",children:[\"让全球的模型能力\",s.jsx(\"br\",{}),\"为你的创意所用。\"]}),s.jsxs(\"div\",{className:\"local-mode\",children:[s.jsx(\"span\",{className:\"status-dot\"}),\" 本机 API 代理\"]})]})", "s.jsx(\"div\",{className:\"sidebar-foot\",children:s.jsx(\"p\",{className:\"sidebar-author\",children:\"作者：小马\"})})");
code = code.replaceAll('黑曜信号台', 'XM剪辑台');
fs.writeFileSync(path.join(root, 'dist/client/assets/music-studio.js'), code);
// Replace the original decorative rail with functional local shortcuts.
const railStart = code.indexOf('s.jsxs("aside",{className:"inspiration-rail"');
const railEnd = code.indexOf(',R&&s.jsx(S3', railStart);
if (railStart < 0 || railEnd < 0) throw new Error('Right sidebar patch location changed.');
code = code.slice(0, railStart) + 's.jsx(BOSMusicUpgrade.QuickRail,{}),s.jsx(BOSMusicUpgrade.SidebarResizer,{})' + code.slice(railEnd);
fs.writeFileSync(path.join(root, 'dist/client/assets/music-studio.js'), code);
const css = [fs.readFileSync(path.join(original, cssName), 'utf8'), fs.readFileSync(path.join(root, 'src/music-studio.css'), 'utf8'), fs.readFileSync(path.join(root, 'src/global-themes.css'), 'utf8'), fs.readFileSync(path.join(root, 'src/script-automation.css'), 'utf8'), fs.readFileSync(path.join(root, 'src/batch-analysis.css'), 'utf8'), fs.readFileSync(path.join(root, 'src/watermark-studio.css'), 'utf8'), fs.readFileSync(path.join(root, 'src/release-140.css'), 'utf8'), fs.readFileSync(path.join(root, 'src/companion-settings.css'), 'utf8')].join('\n');
fs.writeFileSync(path.join(root, 'dist/client/assets/music-studio.css'), css);
// Auxiliary windows share exactly the same eleven palettes, without main-page styles.
const themeSource = fs.readFileSync(path.join(root, 'src/global-themes.css'), 'utf8');
const themeEnd = themeSource.indexOf('.app-shell[data-bos-theme]');
if (themeEnd < 0) throw new Error('Theme palette boundary changed.');
fs.writeFileSync(path.join(root, 'dist/client/theme-tokens.css'), themeSource.slice(0, themeEnd));
const version = createHash('sha256').update(code).update(css).digest('hex').slice(0, 12);
let html = fs.readFileSync(path.join(original, 'index.html'), 'utf8').replace(jsName, `music-studio.js?v=${version}`).replace(cssName, `music-studio.css?v=${version}`).replaceAll('黑曜信号台', 'XM剪辑台');
fs.writeFileSync(path.join(root, 'dist/client/index.html'), html);
console.log('Built music-studio.js and music-studio.css');
