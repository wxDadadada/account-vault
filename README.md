# 拾钥 · Keyfolio

一个自用的账号管家：按个人或公司主体整理平台账号，保存密码和每次变更，用一句话快速录入或查询。

基于 [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) 改造。采用 React + TypeScript + shadcn/ui，后端使用 Node.js + Fastify，数据库为 SQLite + Drizzle。一个容器同时提供前端和 API。

## 已实现

- 账号增删改查、收藏、标签、状态、登录入口、密码生成与复制。
- 个人／公司主体、主体别名、自定义分类、账号归属和分类筛选。
- 本地关键词搜索、平台常见别名匹配、自然语言查询真实账号和变更记录。
- 聊天式 AI 助手：信息不全时逐项追问，支持持续补充、更正、批量录入和指定已有账号更新，核对后加密保存。
- 对话式查找：保留查询上下文，可继续补充主体、收藏、状态或时间条件，也可放宽条件重新查找。
- 本地规则整理无需模型；可配置自己的 DeepSeek、Moonshot 或兼容 Chat Completions 服务。
- 每次账号修改自动记录版本，可查看差异并恢复。密码及旧密码均随账号库加密。
- 浏览器端 AES-GCM 加密、主密码、恢复密钥、跨标签锁定与共享闲置计时、可选 TOTP 双重验证。
- 加密文件导入导出、服务器每日 SQLite 快照、并发更新冲突检测。
- 桌面侧栏与卡片／列表视图；手机底部导航与中间新增入口、底部抽屉及主屏幕图标。
- 明确标记的示例体验，示例只在内存中使用，不写入正式数据库。

## 日常管理增强

- 分区首页、直接复制账号／密码和前往平台，桌面密度切换、手机默认列表、视图记忆。
- 组合筛选、加密保存常用视图、多选批量整理与独立回收站。
- CSV／TSV 文件和 Excel 粘贴导入，字段对应、逐行预览、重复项处理。
- 账号别名、场景模板、加密自定义字段、账号级 TOTP 验证码。
- 本地账号检查与到期提醒；提醒在打开并解锁账号库时显示。

完整用法和兼容边界见 [账号库日常管理增强](docs/collection-enhancement.md)。

## 最快启动：Docker

需要 Docker 和 Docker Compose。

源码仓库：[wxDadadada/account-vault](https://github.com/wxDadadada/account-vault)。镜像仓库：[wxdadadada/account-vault](https://hub.docker.com/r/wxdadadada/account-vault)，提供 `linux/amd64` 和 `linux/arm64`，版本标签为 `0.1.0`，`latest` 指向最近发布版。

只需下载 `docker-compose.yml`，默认使用发布镜像，无需源码或 `.env`：

```bash
mkdir -p account-vault
cd account-vault
curl -fsSL https://raw.githubusercontent.com/wxDadadada/account-vault/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

需要从源码构建时，在克隆后的项目根目录执行以下命令，并将可选 `.env` 中的 `IMAGE` 设为 `keyfolio:local`，供后续启动使用：

```bash
docker build -t keyfolio:local .
IMAGE=keyfolio:local docker compose up -d
```

浏览器打开 **http://localhost:4318**。首次创建用户名和至少 12 个字符的主密码，保存恢复密钥，即可使用。

SQLite、双重验证服务密钥和自动快照持久保存在 `keyfolio_data` 命名卷中。平时使用 `docker compose down` 可保留数据；**不要加 `-v`，它会删除数据卷**。

```bash
docker compose ps
docker compose logs --tail=50 app
docker compose restart app
```

远程访问需要配置域名、HTTPS、可信代理 `TRUSTED_PROXIES` 和服务器初始化令牌；旧版远程实例升级前也需补充可信代理配置，见 [部署与恢复](docs/deployment.md)。

## 本地开发

需要 Node.js 22.19+，推荐 Node.js 22 LTS；pnpm 版本固定为 11.19.0。

```bash
npm install -g pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm dev
```

前端为 **http://127.0.0.1:5188**，开发 API 为 `127.0.0.1:4318`，数据目录为项目内 `data/`。这与 Docker 命名卷是两套独立存储。开发 API 和 Docker 默认都使用 4318 端口，切换运行方式前请停止前一种方式。

本地生产运行：

```bash
pnpm build
pnpm start
```

`pnpm start` 读取可选的 `.env`，默认开启生产模式并使用 4318 端口。`pnpm dev` 使用默认开发端口；自定义开发 API 端口时还需修改 `vite.config.ts` 中的代理目标。

## 日常使用

1. 在“主体”中创建个人或公司，可添加简称作为别名。
2. 点“添加账号”，或点“开始记录”打开聊天助手。可以一次说全，也可以先说 `帮我记一个账号`，再依次回答平台、账号和所属主体；不归属任何主体可选“暂不分配”。
3. 可继续说 `备注改为生产环境`、`第2个账号改为 ops@example.com`。密码填入独立安全字段；点“核对并保存”检查卡片，再确认保存。信息齐全时也可发送 `确认保存`。多账号输入每行一条，并分别填写密码。
4. 搜索框支持平台、账号、邮箱、手机、标签、备注和主体；“智能查找”支持先说 `查找阿里云`，再说 `只看星河科技的`、`最近7天修改过密码`，或用 `不限主体`、`不限时间` 放宽条件。打开结果后关闭详情会回到原对话。
5. 在账号详情或“变更”中查看版本。恢复版本会产生一条新的变更记录。
6. 在“设置”中配置 AI、双重验证、自动锁定、历史数量及备份。
7. 点击头像或锁定按钮，先确认退出登录；取消会继续保留当前页面。自动锁定、其他页面发起的锁定和会话失效会直接清除解锁状态。示例体验退出也需要确认。

账号、主体和分类编辑有未保存修改时，关闭或取消会先询问是否放弃；未修改的表单可以直接关闭。聊天助手关闭或重开当前对话时也会保护未保存草稿。确认框默认聚焦“继续使用”或“继续编辑”，按 Esc 取消本次确认。

云端 AI 默认未连接。填写接口地址、模型名称和 API Key，点“测试连接”，然后保存配置。模型名称以你的服务商实际提供的名称为准。云端对话发送当前模式的消息上下文、当前非密码草稿或筛选条件、分类名称和连接配置；密码安全字段、完整账号库及查询结果不会放入模型请求。自然语言里的主体或邮箱仍属于发送内容，可按需切换“本地助手”。

记录与查找分别保留当前对话和未发送的输入，可来回切换。核对页发现还有未发送的补充时，会提示先返回对话处理，再保存账号。对话仅在内存中保留，关闭助手、刷新页面或锁定后清除；“新对话”清除当前模式的消息和未保存草稿。每次最多整理 20 个账号，每段对话最多 32 次输入、合计 24,000 字符。回复失败或停止回复会保留输入及已有草稿，便于重试。

本地规则是常见表述的确定性提取器，不等同于大模型。它支持平台、账号、主体、标签、邮箱、手机和简单时间查询；复杂表述建议配置模型或手动核对。

## 数据与安全边界

账号、密码、主体、历史和 AI 配置作为一个整体在设备上加密。服务器保存密文、用户名、派生登录凭据的 scrypt 哈希、会话和必要时间戳。解锁后的搜索在浏览器内存中完成，没有明文搜索索引。

主密码和恢复密钥都丢失时无法解密。修改主密码后会产生新的恢复密钥；旧备份仍需要导出当时对应的密码或密钥。账号记录的历史恢复只影响拾钥中的记录，平台实际密码需要在对应平台修改。

这是单用户、单服务实例应用。每次保存同步整个密文，适用于个人账号库；SQLite 应放在本机磁盘。详见 [架构与边界](docs/architecture.md)。

## 验证

```bash
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
pnpm audit
# Docker 已启动且完成镜像构建时：
pnpm test:docker
```

浏览器测试使用独立临时数据目录和端口，覆盖桌面与手机视口。容器验证使用独立临时容器和卷，测试结束会清理自身创建的资源。验证范围与当前结果见 [验证记录](docs/verification.md)。

## 代码位置

- `src/vault/App.tsx`：应用外壳与按需加载入口。
- `src/vault/pages/`：账号库、登录、主体、历史和设置页面。
- `src/vault/components/`：业务弹窗、账号详情、AI 助手和统一表单控件。
- `src/vault/lib/`：加密、账号模型与规则、AI 解析、表格导入和浏览器工具。
- `src/vault/state/`、`src/vault/hooks/`：账号库状态、会话操作与交互 hooks。
- `src/components/ui/`：当前业务实际使用的 shadcn/ui 基础组件。
- `server/`：登录与会话、SQLite、备份、AI 转发。
- `shared/`：前后端协议和结构校验。
- `tests/`：加密、业务、接口和部署边界测试。
- `tests/browser/`：桌面与手机浏览器回归测试。
- `scripts/`：开发与生产启动、构建清理和隔离验证脚本。
- `Dockerfile`：源码构建；`docker-compose.yml`：直接拉取镜像并部署。

完整目录约定、常用命令与维护方式见 [开发与目录约定](docs/development.md)，文档入口见 [docs/README.md](docs/README.md)。

上游来源见 [来源与许可](docs/upstream.md)，原始说明和历次验收记录保存在 `docs/archive/`，保留上游 MIT 许可。
