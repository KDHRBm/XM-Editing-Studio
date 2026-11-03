declare const i: any;

export interface OpenSourceProject {
  id: string;
  name: string;
  repoUrl: string;
  summary: string;
}

export const MAIN_REPO_URL = 'https://github.com/Kirota233/XM-Editing-Studio';

export const AUTHOR_CREDITS = {
  author: '小马',
  refactor: '塔奇',
};

export const OPEN_SOURCE_PROJECTS: OpenSourceProject[] = [
  {
    id: 'watermarker',
    name: 'watermarker',
    repoUrl: 'https://github.com/Kirota233/watermarker',
    summary: '红薯样片视频批量水印集成与样式系统',
  },
  {
    id: 'period-keeper',
    name: 'JianYing-Period-Keeper',
    repoUrl: 'https://github.com/Kirota233/JianYing-Period-Keeper',
    summary: '剪映字幕复制标点与句号保留守护',
  },
  {
    id: 'jianying-ai-pro',
    name: 'JianYing-AI-Pro',
    repoUrl: 'https://github.com/Kirota233/JianYing-AI-Pro',
    summary: '剪映智能工作台自动化核心',
  },
  {
    id: 'desktop-pet-miao',
    name: 'DesktopPet-Miao',
    repoUrl: 'https://github.com/sprmorn/DesktopPet-Miao',
    summary: '月薪喵桌面宠物随机待机动画与气泡灵感',
  },
];

export function SidebarCredits() {
  const [expanded, setExpanded] = i.useState(false);

  return (
    <div className="sidebar-foot bos-sidebar-credits" aria-label="项目依赖与著作人声明">
      <div className="bos-credits-card">
        <div className="bos-credits-head">
          <div className="bos-credits-authors">
            <span className="bos-credits-pill" title="项目原作者">
              作者：<strong>{AUTHOR_CREDITS.author}</strong>
            </span>
            <span className="bos-credits-sep" aria-hidden="true">｜</span>
            <span className="bos-credits-pill" title="架构与原生引擎重构">
              重构：<strong>{AUTHOR_CREDITS.refactor}</strong>
            </span>
          </div>
          <div className="bos-credits-actions">
            <a
              href={MAIN_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="bos-credits-contribute"
              title="前往 GitHub 原仓库参与开发与贡献代码"
            >
              贡献代码 ↗
            </a>
            <button
              type="button"
              className="bos-credits-toggle"
              aria-expanded={expanded}
              aria-controls="bos-credits-projects"
              onClick={() => setExpanded(!expanded)}
              title={expanded ? '收起项目依赖说明' : '展开项目依赖说明'}
            >
              {expanded ? '收起 ▴' : '项目依赖 ▾'}
            </button>
          </div>
        </div>

        <div id="bos-credits-projects" className="bos-credits-projects" hidden={!expanded}>
          <div className="bos-credits-subtitle">项目依赖 (GitHub)</div>
          <ul className="bos-credits-list">
            {OPEN_SOURCE_PROJECTS.map(proj => (
              <li key={proj.id} className="bos-credits-item">
                <a
                  href={proj.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="bos-credits-link"
                  title={`${proj.name} · ${proj.repoUrl}`}
                >
                  <span className="bos-credits-proj-name">{proj.name}</span>
                  <span className="bos-credits-ext" aria-hidden="true">↗</span>
                </a>
                <small className="bos-credits-desc">{proj.summary}</small>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
