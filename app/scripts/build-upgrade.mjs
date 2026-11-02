import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = path.join(root, 'baseline');
const jsName = 'index-sP0cbikv.js';
const cssName = 'index-DzzkVdoP.css';

const compiled = process.argv[2]
  ? fs.readFileSync(process.argv[2], 'utf8')
  : (await build({
      entryPoints: [path.join(root, 'src/upgrade.tsx')],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'BOSMusicUpgrade',
      jsxFactory: 'i.createElement',
      jsxFragment: 'i.Fragment',
      target: 'chrome140',
      minify: true,
    })).outputFiles[0].text;

if (!compiled.includes('GlobalThemePicker') || !compiled.includes('useGlobalTheme')) {
  throw new Error('Bundle must include src/upgrade.tsx and global themes.');
}

let code = fs.readFileSync(path.join(original, jsName), 'utf8');

function replaceOnce(before, after) {
  if (code.split(before).length !== 2) throw new Error(`Expected exactly one patch location: ${before.slice(0, 80)}`);
  code = code.replace(before, after);
}

// 1. Splice upgraded Music Studio
const start = code.indexOf('function b3('), end = code.indexOf('function M3(', start);
if (start < 0 || end < 0) throw new Error('Unsupported baseline: Music component not found.');
code = code.slice(0, start) + compiled + '\nfunction b3({providers:U,onGoProviders:Q}){return i.createElement(BOSMusicUpgrade.MusicStudio,{providers:U,onGoProviders:Q})}\n' + code.slice(end);

// 2. Shell & Nav bar setup
replaceOnce('function A3(){', 'function A3(){const bosGlobalTheme=BOSMusicUpgrade.useGlobalTheme();');
replaceOnce('[Nl,_l]=i.useState(!1);i.useEffect', '[Nl,_l]=i.useState(!1);const bosAutomation=BOSMusicUpgrade.useScriptAutomation(x);i.useEffect');

// 3. 图1: 视觉主题移到最下面 (UsageGuide 在上方，GlobalThemePicker 移到 section.provider-stack 最下方)
replaceOnce(
  'd==="providers"&&s.jsxs("section",{className:"provider-stack"',
  'd==="providers"&&s.jsx(BOSMusicUpgrade.UsageGuide,{}),d==="providers"&&s.jsxs("section",{className:"provider-stack"'
);
replaceOnce(
  'add-arrow",size:20})]})]}),d==="chat"',
  'add-arrow",size:20})]})]}),d==="providers"&&s.jsx(BOSMusicUpgrade.GlobalThemePicker,{}),d==="chat"'
);

// 4. 图3: 合并「还没有添加供应商」与「添加供应商」两个框，不在初始列表强制插入写死标题的卡片
replaceOnce(
  'x.length===0&&s.jsxs("div",{className:"empty-state",children:[s.jsx(Ec,{size:24}),s.jsx("strong",{children:"还没有添加供应商"}),s.jsx("span",{children:"连接任意兼容协议的 AI 服务，模型会显示在这里。"})]}),',
  ''
);
replaceOnce('[Q,Y]=i.useState("openai")', '[Q,Y]=i.useState("gemini")');
replaceOnce('Il=(y="openai")=>{Y(y),U(!0)}', 'Il=(y="gemini")=>{Y(y),U(!0)}');

// 5. Workspaces & Navigation
code = code.replace(',s.jsx("div",{className:"brand-kicker",children:"聚合多元模型 · 创作无限可能"})', '');
replaceOnce('d==="workspace"&&s.jsx(z3,{models:Zl,onNavigate:T})', 'd==="workspace"&&s.jsx(z3,{models:Zl,onNavigate:T,providers:x,automation:bosAutomation})');
replaceOnce('{id:"providers",label:"模型与连接",sub:"配置供应商与模型",Icon:Ec}', '{id:"providers",label:"接口与主题",sub:"API 配置 · 视觉主题",Icon:Ec}');
replaceOnce('s.jsxs("div",{className:"sidebar-foot",children:[s.jsx("div",{className:"side-rule"}),s.jsx("p",{children:"多重协议 · 一站接入"}),s.jsxs("p",{className:"muted",children:["让全球的模型能力",s.jsx("br",{}),"为你的创意所用。"]}),s.jsxs("div",{className:"local-mode",children:[s.jsx("span",{className:"status-dot"})," 本机 API 代理"]})]})', 's.jsx(BOSMusicUpgrade.SidebarCredits,{})');
replaceOnce('{id:"workspace",label:"工作空间",sub:"我的创作与灵感",Icon:P8}]', '{id:"workspace",label:"工作空间",sub:"字幕 · 曲库 · 配乐队列",Icon:P8},{id:"jianying",label:"剪映自动化",sub:"导出 · 字幕 · 改名 · 水印",Icon:P8},{id:"webai",label:"国内 AI",sub:"DeepSeek · 豆包免 Key",Icon:P8}]');
replaceOnce('workspace:{eyebrow:"工作空间"', 'webai:{eyebrow:"WEB AI STUDIO",title:"国内 AI 免密工作台",description:"内嵌 DeepSeek 与豆包官方网页，登录账号即可协同分析剧本与生成提示词。"},jianying:{eyebrow:"JIANYING AUTOMATION",title:"剪映自动化与样片水印",description:"无人值守草稿批量导出、SRT 字幕提取、AI 视频批量改名与原版红薯样片硬件加速水印合成。"},watermark:{eyebrow:"NATIVE HW WATERMARK",title:"样片批量水印",description:"基于 Windows Media Foundation 原生 C# 硬件加速引擎，高速批量合成红薯样片水印。"},workspace:{eyebrow:"WORKSPACE"');
replaceOnce('d==="workspace"&&s.jsx(z3,{models:Zl,onNavigate:T,providers:x,automation:bosAutomation})', 'd==="workspace"&&s.jsx(z3,{models:Zl,onNavigate:T,providers:x,automation:bosAutomation}),s.jsx(BOSMusicUpgrade.JianyingStudio,{active:d==="jianying"||d==="watermark",providers:x,onNavigate:T}),s.jsx(BOSMusicUpgrade.WebAIStudio,{active:d==="webai",providers:x,automation:bosAutomation,onNavigate:T})');
replaceOnce('className:`app-shell ${d==="chat"?"chat-open":""}`', 'className:`app-shell ${d==="chat"?"chat-open":d==="music"?"music-open":d==="webai"?"webai-open":""}`,"data-bos-theme":bosGlobalTheme');
replaceOnce('function z3({models:d,onNavigate:T})', 'function BOSOriginalWorkspace({models:d,onNavigate:T})');
replaceOnce('Ys.createRoot(document.getElementById("root"))', 'function z3(props){return i.createElement("section",{className:"bos-workspace"},i.createElement(BOSMusicUpgrade.ScriptAutomation,props))}\nYs.createRoot(document.getElementById("root"))');
replaceOnce('最近使用的模型、对话和音乐创作都在这里继续。', '自动提取对白字幕、匹配本地曲库与管理 Suno 异步配乐队列。');
code = code.replace('if(!w.preview)throw new Error', 'if(!w.preview&&!w.ok)throw new Error');
code = code.replace('title:"让灵感发出声音",description:"选择已接入的音乐生成模型，描述你想听到的场景与情绪，直接通过中转站发起创作。"', 'title:"灵感编曲室",description:"定制流派质感与段落起承转合，一键合成完整配乐。"');

// 6. n6 & v3: Gemini AI Studio 免 Base URL，内置预设模型
replaceOnce(
  '{value:"gemini",label:"Gemini Generative"},{value:"custom",label:"自定义（OpenAI 兼容）"}],v3={openai:[],anthropic:[],gemini:[],custom:[]}',
  '{value:"gemini",label:"Gemini AI Studio（官方免填地址）"},{value:"openai",label:"OpenAI-compatible"},{value:"custom",label:"自定义（OpenAI 兼容）"},{value:"suno",label:"Suno 异步音乐"}],v3={openai:[],anthropic:[],gemini:["gemini-3.5-flash","gemini-3.5-flash-lite","gemini-3.8-flash","gemini-3.8-flash-lite"],custom:[],suno:[]}'
);
replaceOnce(
  'function g3(){var v,R;const d=D8(u6,[]),T=(Array.isArray(d)?d:[]).map(U=>{if(U.protocol!=="suno")return U;let Q=U.baseUrl||"";',
  'function g3(){var v,R;const GEM_DEFS=["gemini-3.5-flash","gemini-3.5-flash-lite","gemini-3.8-flash","gemini-3.8-flash-lite"];const d=D8(u6,[]),T=(Array.isArray(d)?d:[]).map(U=>{if(U.protocol==="gemini"&&(!U.models||!U.models.length||(U.models.length===1&&U.models[0]==="gemini-2.5-flash"))){return{...U,models:GEM_DEFS}}if(U.protocol!=="suno")return U;let Q=U.baseUrl||"";'
);

// 7. 图2: 替换 p3 (卡片标题 Provider Select + 动态 API 拉取模型列表) 与 S3 (添加对话框)
const p3Start = code.indexOf('function p3({provider:d,onChange:T,onRemove:x,onTest:v}){');
const e3Start = code.indexOf('function E3({providers:d,messages:T,value:x,onChange:v,onSubmit:R,busy:U,onGoProviders:Q}){');
if (p3Start < 0 || e3Start < 0) throw new Error('p3 / S3 functions not found in baseline.');

const newP3AndS3 = `
function p3({provider:d,onChange:T,onRemove:x,onTest:v}){
  var ql,kl,jt,Il,Bl;
  const[R,U]=i.useState(!1),
       [Q,Y]=i.useState(!1),
       [_,b]=i.useState(""),
       [X,O]=i.useState(((ql=d.models)==null?void 0:ql[0])??""),
       [j,k]=i.useState(!1),
       [W,dl]=i.useState(""),
       [pl,C]=i.useState(!1),
       [apiModels,setApiModels]=i.useState([]),
       [fetchingModels,setFetchingModels]=i.useState(!1);

  const fetchApiModels = async () => {
    if (!d.apiKey || !d.apiKey.trim() || fetchingModels) return;
    setFetchingModels(!0);
    try {
      const resp = await fetch("/api/providers/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: d })
      });
      const data = await resp.json();
      if (data && data.ok && Array.isArray(data.models) && data.models.length > 0) {
        const filtered = d.protocol === "gemini"
          ? data.models.filter(m => /gemini/i.test(m) && !/embedding|embed|imagen|tts|whisper/i.test(m))
          : data.models;
        setApiModels(filtered);
        if (!d.models || d.models.length === 0) {
          T({ models: filtered.slice(0, 4) });
        }
      }
    } catch (e) {
    } finally {
      setFetchingModels(!1);
    }
  };

  i.useEffect(() => {
    if (Q && d.apiKey && d.apiKey.trim()) {
      fetchApiModels();
    }
  }, [Q]);

  const allAvailable = [...new Set([...apiModels, ...(v3[d.protocol] ?? [])])];
  const hl = allAvailable.filter(q => !(d.models || []).includes(q));

  i.useEffect(()=>{var q,Ol;(q=d.models)!=null&&q.includes(X)||O(((Ol=d.models)==null?void 0:Ol[0])??"")},[d.models,X]);
  i.useEffect(()=>{dl(""),C(!1)},[d.protocol,d.baseUrl,d.apiKey,d.models,X]);

  const Nl=q=>{
    const isGem = q === "gemini";
    T({
      protocol: q,
      name: isGem ? "Gemini AI Studio" : (d.name === "Gemini AI Studio" ? "Provider Select" : (d.name || "Provider Select")),
      description: isGem ? "Google AI Studio 官方直连 · 免填 Base URL" : (d.description || "自定义 AI 服务 · 独立协议适配"),
      ...(isGem ? { baseUrl: "https://generativelanguage.googleapis.com/v1beta" } : {})
    });
  };

  const _l=q=>{T({models:(d.models||[]).includes(q)?d.models.filter(Ol=>Ol!==q):[...d.models||[],q]})};
  const Zl=q=>{q.preventDefault();const Ol=_.trim();!Ol||(d.models||[]).includes(Ol)||(T({models:[...d.models||[],Ol]}),b(""))};

  const tl=async()=>{if(!(!X||j)){k(!0),dl("");try{const q=await v(d,X);C(!0),dl(\`连接成功 · \${q.latencyMs} ms\${q.message?\` · \${q.message}\`:q.preview?\` · \${q.preview}\`:""}\`)}catch(q){C(!1),dl(q.message||"连接测试失败，请检查地址、密钥和模型 ID。")}finally{k(!1)}}};

  const cardTitle = d.name || (d.protocol === "gemini" ? "Gemini AI Studio" : "Provider Select");

  return s.jsxs("article",{className:"provider-card",children:[
    s.jsxs("div",{className:"provider-heading",children:[
      s.jsx("div",{className:\`provider-mark \${d.tone||"custom"}\`,"aria-hidden":"true",children:d.markIcon?s.jsx("img",{src:d.markIcon,alt:""}):s.jsx(Ec,{size:20,weight:"duotone"})}),
      s.jsxs("div",{className:"provider-identity",children:[
        s.jsx("strong",{children:cardTitle}),
        s.jsx("span",{children:d.protocol==="gemini"?"Google AI Studio 官方直连 · 免填 Base URL":(d.description||"自定义 AI 服务 · 独立协议适配")})
      ]}),
      s.jsxs("label",{className:"protocol-control",children:[
        s.jsx("span",{children:"Provider Select"}),
        s.jsxs("span",{className:"select-wrap",children:[
          s.jsx("select",{value:d.protocol,onChange:q=>Nl(q.target.value),"aria-label":\`\${cardTitle} Provider Select\`,children:n6.map(q=>s.jsx("option",{value:q.value,children:q.label},q.value))}),
          s.jsx(pc,{size:14})
        ]})
      ]}),
      s.jsx("button",{className:"icon-button remove-button",type:"button",onClick:x,"aria-label":\`移除 \${cardTitle}\`,title:"移除供应商",children:s.jsx(h3,{size:17})})
    ]}),
    s.jsxs("div",{className:"provider-fields",children:[
      d.protocol!=="gemini"&&s.jsxs("label",{className:"field-group",children:[
        s.jsx("span",{children:"Base URL"}),
        s.jsx("input",{"aria-label":\`\${cardTitle} Base URL\`,value:d.baseUrl,onChange:q=>T({baseUrl:q.target.value}),spellCheck:"false",placeholder:"https://your-gateway.example/v1"})
      ]}),
      s.jsxs("label",{className:"field-group",children:[
        s.jsx("span",{children:"密钥"}),
        s.jsxs("span",{className:"secret-input",children:[
          s.jsx("input",{"aria-label":\`\${cardTitle} API 密钥\`,type:R?"text":"password",value:d.apiKey,onChange:q=>T({apiKey:q.target.value}),autoComplete:"new-password",placeholder:"粘贴 API Key"}),
          s.jsx("button",{type:"button",className:"reveal-button",onClick:()=>U(q=>!q),"aria-label":R?"隐藏密钥":"显示密钥",children:R?s.jsx(m3,{size:16}):s.jsx(s3,{size:16})})
        ]})
      ]}),
      s.jsxs("div",{className:"field-group models-field",children:[
        s.jsx("span",{children:"可用模型"}),
        s.jsxs("div",{className:"model-picker-wrap",children:[
          s.jsxs("div",{className:"model-picker",children:[
            (d.models||[]).map(q=>s.jsxs("button",{className:"model-chip",type:"button",title:\`移除 \${q}\`,onClick:()=>_l(q),children:[q,s.jsx(e6,{size:12,weight:"bold"})]},q)),
            s.jsx("button",{className:"model-add-button",type:"button","aria-label":"添加模型",onClick:()=>Y(q=>!q),children:s.jsx(Ja,{size:16})})
          ]}),
          Q&&s.jsxs("div",{className:"model-menu",children:[
            s.jsx("div",{className:"model-menu-title",children:"选择可用模型"}),
            s.jsxs("button",{
              type:"button",
              className:"model-fetch-action",
              style:{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 9px",marginBottom:"6px",borderRadius:"7px",border:"1px dashed rgba(255,207,110,.5)",background:"rgba(255,207,110,.08)",color:"#ffcf6e",fontSize:"11px",fontWeight:"700",cursor:fetchingModels?"wait":"pointer"},
              onClick:()=>fetchApiModels(),
              disabled:fetchingModels||!((d.apiKey||"").trim()),
              children:[
                s.jsx("span",{children:fetchingModels?"⏳ 正在从 API 拉取最新模型…":"🔄 从 API 获取最新模型列表"}),
                s.jsx(Ja,{size:14})
              ]
            }),
            s.jsxs("div",{className:"model-menu-list",tabIndex:0,onWheel:q=>q.stopPropagation(),children:[
              hl.map(q=>s.jsxs("button",{type:"button",className:"model-menu-item",onClick:()=>_l(q),children:[s.jsx("span",{children:q}),s.jsx(Ja,{size:14})]},q)),
              hl.length===0&&!fetchingModels&&s.jsx("p",{className:"model-empty",children:(d.apiKey||"").trim()?"暂无更多候选模型，可手动输入 ID 添加":"填写 API Key 后可从 API 获取最新模型"})
            ]}),
            s.jsxs("form",{className:"custom-model-form",onSubmit:Zl,children:[
              s.jsx("input",{value:_,onChange:q=>b(q.target.value),placeholder:"输入自定义模型 ID","aria-label":"自定义模型 ID"}),
              s.jsx("button",{type:"submit",disabled:!_.trim(),"aria-label":"添加自定义模型",children:s.jsx(Ja,{size:15})})
            ]})
          ]})
        ]})
      ]})
    ]}),
    s.jsxs("div",{className:"provider-test-row",children:[
      s.jsxs("label",{className:"test-model-select",children:[
        s.jsx("span",{children:"测试模型"}),
        s.jsx("select",{value:X,onChange:q=>O(q.target.value),disabled:!((kl=d.models)!=null&&kl.length),"aria-label":\`\${cardTitle} 测试模型\`,children:(d.models||[]).map(q=>s.jsx("option",{value:q,children:q},q))})
      ]}),
      s.jsx("span",{className:\`provider-test-status \${W?pl?"success":"failure":""}\`,role:"status",children:j?"正在连接模型…":W||((jt=d.models)!=null&&jt.length?gc(X)?"检查模型目录和异步接口，不会提交歌曲":"会发送简短测试请求，服务商可能按量计费":"请先添加模型 ID")}),
      s.jsx("button",{type:"button",className:"connection-test-button",onClick:tl,disabled:j||!X||(d.protocol!=="gemini"&&!((Il=d.baseUrl)!=null&&Il.trim()))||!((Bl=d.apiKey)!=null&&Bl.trim()),children:j?"测试中…":gc(X)?"测试异步接口":"测试连接"})
    ]})
  ]});
}

function S3({onClose:d,onAdd:T,initialProtocol:x="gemini"}){
  const[v,R]=i.useState(""),
       [U,Q]=i.useState(x),
       [Y,_]=i.useState(""),
       [b,X]=i.useState(""),
       [O,j]=i.useState(""),
       k=W=>{
         W.preventDefault();
         const isGem = U === "gemini";
         const dl = v.trim() || (isGem ? "Gemini AI Studio" : "Provider Select");
         T({
           id:\`provider-\${Date.now()}\`,
           name:dl,
           description:isGem ? "Google AI Studio 官方直连 · 免填 Base URL" : "自定义服务 · 独立协议配置",
           protocol:U,
           baseUrl:isGem ? (Y.trim() || "https://generativelanguage.googleapis.com/v1beta") : Y.trim(),
           apiKey:b.trim(),
           models:O.trim() ? [O.trim()] : (isGem ? ["gemini-3.5-flash","gemini-3.5-flash-lite","gemini-3.8-flash","gemini-3.8-flash-lite"] : ["gpt-4o"]),
           markIcon:"",
           tone:"custom"
         });
       };
  return s.jsx("div",{className:"modal-scrim",onMouseDown:W=>{W.target===W.currentTarget&&d()},children:s.jsxs("section",{className:"dialog",role:"dialog","aria-modal":"true","aria-labelledby":"add-provider-title",children:[
    s.jsxs("div",{className:"dialog-topline",children:[s.jsx("span",{className:"dialog-icon",children:s.jsx(Ja,{size:18})}),s.jsx("button",{type:"button",className:"icon-button",onClick:d,"aria-label":"关闭",children:s.jsx(e6,{size:18})})]}),
    s.jsx("h2",{id:"add-provider-title",children:"添加供应商"}),
    s.jsx("p",{children:"为每个连接选择适配协议，并填写独立的服务地址与密钥。"}),
    s.jsxs("form",{onSubmit:k,className:"dialog-form",children:[
      s.jsxs("label",{children:["连接名称",s.jsx("input",{autoFocus:!0,value:v,onChange:W=>R(W.target.value),placeholder:"例如：我的中转站"})]}),
      s.jsxs("label",{children:["Provider Select",s.jsx("select",{value:U,onChange:W=>Q(W.target.value),children:n6.map(W=>s.jsx("option",{value:W.value,children:W.label},W.value))})]}),
      U!=="gemini"&&s.jsxs("label",{children:["Base URL",s.jsx("input",{required:!0,value:Y,onChange:W=>_(W.target.value),placeholder:U==="anthropic"?"https://api.anthropic.com/v1":U==="gemini"?"https://generativelanguage.googleapis.com/v1beta":"https://api.openai.com/v1"})]}),
      s.jsxs("label",{children:["API 密钥",s.jsx("input",{required:!0,type:"password",value:b,onChange:W=>X(W.target.value),placeholder:"粘贴你的 API Key",autoComplete:"new-password"})]}),
      s.jsxs("label",{children:["模型 ID",s.jsx("input",{required:!1,value:O,onChange:W=>j(W.target.value),placeholder:U==="anthropic"?"例如：claude-sonnet-4-5":U==="gemini"?"例如：gemini-3.5-flash（留空自动使用）":"例如：gpt-4.1 或 chirp-v4"})]}),
      s.jsxs("div",{className:"dialog-note",children:[s.jsx(K8,{size:15})," 密钥明文保存在此浏览器；请求会转发到你填写的服务地址。"]}),
      s.jsxs("div",{className:"dialog-actions",children:[s.jsx("button",{type:"button",className:"button-quiet",onClick:d,children:"取消"}),s.jsxs("button",{type:"submit",className:"button-primary",children:[s.jsx(Ja,{size:16})," 添加连接"]})]})
    ]})
  ]})});
}

`;

code = code.slice(0, p3Start) + newP3AndS3 + code.slice(e3Start);

// 8. Cache sync & App naming
replaceOnce(
  'window.localStorage.setItem(u6,JSON.stringify(x))',
  'window.localStorage.setItem(u6,JSON.stringify(x));window.localStorage.setItem("xm.providers.cache",JSON.stringify(x));window.blackObsidian?.companionAction?.("sync-providers",x)'
);
code = code.replaceAll('黑曜信号台', 'XM剪辑台');

// 9. Replace the original decorative rail with functional local shortcuts.
const railStart = code.indexOf('s.jsxs("aside",{className:"inspiration-rail"');
const railEnd = code.indexOf(',R&&s.jsx(S3', railStart);
if (railStart < 0 || railEnd < 0) throw new Error('Right sidebar patch location changed.');
code = code.slice(0, railStart) + 's.jsx(BOSMusicUpgrade.TitleBar,{onNavigate:T}),s.jsx(BOSMusicUpgrade.SidebarResizer,{})' + code.slice(railEnd);

fs.writeFileSync(path.join(root, 'dist/client/assets/music-studio.js'), code);

const css = [
  fs.readFileSync(path.join(original, cssName), 'utf8'),
  fs.readFileSync(path.join(root, 'src/music-studio.css'), 'utf8'),
  fs.readFileSync(path.join(root, 'src/global-themes.css'), 'utf8'),
  fs.readFileSync(path.join(root, 'src/script-automation.css'), 'utf8')
].join('\n');
fs.writeFileSync(path.join(root, 'dist/client/assets/music-studio.css'), css);

const version = createHash('sha256').update(code).update(css).digest('hex').slice(0, 12);
let html = fs.readFileSync(path.join(original, 'index.html'), 'utf8')
  .replace(jsName, `music-studio.js?v=${version}`)
  .replace(cssName, `music-studio.css?v=${version}`)
  .replaceAll('黑曜信号台', 'XM剪辑台');

fs.writeFileSync(path.join(root, 'dist/client/index.html'), html);
console.log('Built music-studio.js and music-studio.css');
