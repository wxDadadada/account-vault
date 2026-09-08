# 开发与目录约定

## 目录

```text
account-vault/
├── src/
│   ├── main.tsx                 # React 入口、路由和全局提供器
│   ├── vault/
│   │   ├── App.tsx              # 应用外壳、导航和按需加载
│   │   ├── pages/               # 账号库、登录、主体、历史、设置
│   │   ├── components/          # 详情、编辑、导入、AI 助手及共享控件
│   │   ├── hooks/               # 未保存保护与显示偏好
│   │   ├── state/               # Context、账号库状态和会话操作
│   │   └── lib/                 # 领域逻辑、加密、解析和浏览器工具
│   ├── components/ui/           # 业务实际引用的 shadcn/ui 基础组件
│   ├── context/                 # 全局主题
│   ├── lib/                     # 通用样式和 Cookie 工具
│   └── styles/                  # 主题变量、全局样式和业务样式
├── server/                     # Fastify、SQLite、认证、AI 转发
├── shared/                     # 前后端协议、结构校验和文本规则
├── tests/
│   ├── *.test.ts               # Node 测试：业务、加密、API 和部署
│   ├── fixtures.ts             # 虚构测试数据
│   └── browser/                # Playwright 桌面与手机场景
├── scripts/                    # 启动、清理和隔离验证脚本
├── public/                     # 网站图标与 Web App Manifest
├── docs/                       # 当前文档；历史材料在 archive/
├── Dockerfile                  # 多阶段构建和运行镜像
└── compose.yaml                # 本机部署、命名卷和服务配置
```

## 文件归属

- 新页面放在 `src/vault/pages/`，由 `App.tsx` 组织。业务弹窗和复用控件放在 `components/`；React 组件使用 PascalCase 文件名，工具和 hooks 使用 kebab-case。
- 账号模型、校验、历史与备份合并规则放在 `src/vault/lib/`。这里也包含 `api.ts`、剪贴板、下载和跨页锁定等浏览器工具；在 Node 测试中只导入目标模块。
- 页面通过 `state/context.ts` 的 `useVault` 使用账号库，通过 `state/store.tsx` 的统一操作完成加密提交和会话管理。
- 两端共用的协议放在 `shared/`；服务器内部代码放在 `server/`。服务器及共享代码保留 Node ESM 所需的 `.js` 导入后缀。
- `src/components/ui/` 只保留当前页面使用的基础组件。移除组件时检查静态导入、动态导入及其专属依赖；保留 `src/vite-env.d.ts` 等由 TypeScript 配置加载的声明文件。
- 基础组件沿用上游格式及导出惯例，当前不纳入 ESLint 和 Prettier；它们仍参与 TypeScript 检查、构建和浏览器回归。业务组件纳入全部检查。

## 常用命令

在项目根目录执行，使用 `package.json` 固定的 pnpm 11.19.0 和 Node.js 22.19+。

| 命令                             | 用途                                            |
| -------------------------------- | ----------------------------------------------- |
| `pnpm install --frozen-lockfile` | 按锁文件安装依赖                                |
| `pnpm dev`                       | 同时启动开发 API（4318）和前端（5188）          |
| `pnpm dev:api` / `pnpm dev:web`  | 单独启动 API 或前端                             |
| `pnpm clean`                     | 删除项目内 `build/` 和 `dist/`                  |
| `pnpm build`                     | 先清理产物，再做类型检查、前端打包和后端编译    |
| `pnpm start`                     | 加载可选 `.env`，用已构建产物运行完整服务       |
| `pnpm preview`                   | 仅预览 Vite 前端产物；完整服务使用 `pnpm start` |
| `pnpm check`                     | 格式、ESLint、Node 测试与生产构建               |
| `pnpm test:watch`                | 监听并运行 Node 测试                            |
| `pnpm test:browser`              | 构建后运行 Playwright 全量回归                  |
| `pnpm exec playwright test`      | 对现有构建运行浏览器回归，与 CI 用法相同        |
| `pnpm test:docker`               | 对 `keyfolio:local` 镜像运行独立容器演练        |

首次运行浏览器测试需执行 `pnpm exec playwright install chromium`。容器演练前需启动 Docker 并执行 `docker compose build`。

## 依赖与配置

`dependencies` 用于 Node 生产服务及其共用协议；前端库、类型声明、打包及检查工具放在 `devDependencies`，由 Docker 构建阶段打包为静态文件。运行阶段只安装生产依赖。调整依赖时同步 `pnpm-lock.yaml`，不手工编辑锁文件。

`tsconfig.app.json` 检查前端，`tsconfig.node.json` 检查构建配置、TypeScript 脚本和测试，`tsconfig.server.json` 将后端及共享模块输出到 `build/`。`components.json` 保留 shadcn/ui 的样式及路径配置。

CI 执行 `pnpm check`、桌面与手机浏览器回归及依赖审计。完整验证范围见 [验证记录](verification.md)。

## 生成文件与持久数据

| 路径                    | 内容与维护方式                                           |
| ----------------------- | -------------------------------------------------------- |
| `dist/`、`build/`       | 可重建产物，每次 `pnpm build` 先清理，避免旧编译文件残留 |
| `node_modules/`         | 依赖与 TypeScript 增量缓存，由 pnpm 管理                 |
| `work/browser-results/` | 最近一次浏览器测试的截图、失败追踪和结果                 |
| `work/tests/`           | 自动化测试专用临时 SQLite 目录，测试自行清理             |
| `work/` 其他目录        | 本机历史日志、截图与验收证据，按需人工归档               |
| `data/`、`backups/`     | 本地运行数据、密钥及备份，不属于构建清理范围             |
| `.env`                  | 本机配置；公开示例为 `.env.example`                      |

上述生成文件、运行数据和本机配置均被 Git 忽略。`pnpm clean` 仅处理固定的 `build/` 和 `dist/`，不会删除账号数据、备份、依赖或历史验证材料。Docker 使用独立的 `keyfolio_data` 命名卷，详见 [部署与恢复](deployment.md)。
