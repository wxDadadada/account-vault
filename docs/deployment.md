# 部署与恢复

## 宝塔同机部署：一个 Compose 文件

源码位于 [wxDadadada/account-vault](https://github.com/wxDadadada/account-vault)，镜像位于 [wxdadadada/account-vault](https://hub.docker.com/r/wxdadadada/account-vault)。镜像支持 `linux/amd64` 与 `linux/arm64`，Docker 会选择匹配的架构。默认使用随发布更新的 `latest`，也保留固定版本标签供回退。

`docker-compose.yml` 面向 **宝塔和 Docker 在同一台 Linux 服务器** 的部署。域名、监听地址、端口、可信代理和镜像都直接写在文件里，无需 `.env`、环境变量导出或查询 Docker 网关。

```bash
mkdir -p account-vault
cd account-vault
curl -fsSL https://raw.githubusercontent.com/wxDadadada/account-vault/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

文件已配置 `APP_ORIGIN: https://account.wxda.cc`。使用其他域名时，只需将这一项改成浏览器实际访问的 HTTPS 地址，包含非默认端口，不包含页面路径。

宝塔中为该域名启用 HTTPS，并将反向代理目标设为 **`http://127.0.0.1:8188`**。保留 Cookie、Origin 和自定义请求头，不缓存 `/api/`。宝塔直接接收客户端请求时，使用 `proxy_set_header X-Forwarded-For $remote_addr;` 覆盖客户端传入的 IP 头；前面还有 CDN 或其他代理时，需要按实际可信代理链配置客户端 IP。

容器使用宿主网络，Node 仅监听 `127.0.0.1:8188`，所以宝塔连接应用时的地址固定为回环地址，`TRUSTED_PROXIES` 已配置为 `127.0.0.1,::1`。此模式使用 Linux Docker 的 [host 网络](https://docs.docker.com/engine/network/drivers/host/)，没有额外的端口映射；服务与镜像健康检查都使用 `8188`。宝塔的代理目标应填写 `127.0.0.1`，与应用的 IPv4 监听地址一致。

修改配置或更新镜像后只需运行：

```bash
docker compose up -d
```

`pull_policy: always` 会检查最新镜像，配置或镜像变化时 Compose 会重建容器。旧 `.env` 不会覆盖这份宝塔文件中的域名、端口或镜像。服务器数据保存在原有命名卷中。

首次创建账号库时，读取服务器生成的初始化令牌：

```bash
docker compose exec app cat /app/data/setup-token
```

在页面填入令牌、用户名和主密码，并保存恢复密钥。令牌只用于尚未初始化的实例；已有账号库不会重新初始化。

### “请求来源不受信任”

核对 `docker-compose.yml` 中的 `APP_ORIGIN` 与浏览器地址是否一致。例如浏览器访问 `https://account.wxda.cc/`，配置就是 `https://account.wxda.cc`。`8188` 是宝塔连接后端的端口，无需加到使用默认 HTTPS 端口的域名后面。修改文件后运行 `docker compose up -d` 并刷新页面；单独 `restart` 不会应用环境变量变更。

### AI 流式回复

`/api/ai/chat` 使用 SSE 传输进度与结果，响应带有 `X-Accel-Buffering: no` 和禁止缓存的标头，每 10 秒发送一次保活。一次模型整理及格式重试共用 120 秒上限。更新镜像后刷新页面即可启用新界面，模型服务需支持 Chat Completions；思考展示取决于模型是否返回 `reasoning_content`。

如果宝塔仍然等到最后才显示整段内容，请检查该路径是否被额外缓存，或忽略了 `X-Accel-Buffering`。可在现有的反向代理 `location` 中增加以下配置并重新加载 Nginx，保留原有代理地址与请求头设置：

```nginx
proxy_buffering off;
proxy_read_timeout 150s;
```

Nginx 对响应标头与缓冲的处理参见[官方代理模块文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)。新版 DeepSeek 预设为 `deepseek-v4-flash`，首次整理使用低强度思考，格式重试关闭思考以便尽快修正结构；已有加密 AI 配置不会被自动覆盖，其他服务商仍使用其配置的模型。

## 本机 Docker / Docker Desktop

本机使用独立的桥接网络配置 `docker-compose.local.yml`，无需启用 Docker Desktop 的 host 网络功能：

```bash
curl -fsSL https://raw.githubusercontent.com/wxDadadada/account-vault/main/docker-compose.local.yml -o docker-compose.local.yml
docker compose -f docker-compose.local.yml up -d
```

打开 **`http://localhost:8188`**。容器内部监听 `8188`，宿主机 `127.0.0.1:8188` 映射到容器 `8188`，健康检查也使用 `8188`。首次创建用户名和主密码，保存恢复密钥。

本机文件支持可选 `.env` 覆盖；`.env.example` 是其完整示例。已有 `.env` 如果将 `IMAGE` 固定到旧版本，请改为 `wxdadadada/account-vault:latest`。修改本机宿主端口 `PORT` 时，同时将 `APP_ORIGIN` 改为实际访问地址。

## 其他代理部署

宝塔单文件方案要求反向代理与 Docker 同机且通过回环地址连接。若代理运行在其他容器或其他服务器，请按实际网络设置监听地址和端口，只将受控直连代理的 IP 或精确 CIDR 写入 `TRUSTED_PROXIES`。不要使用全网 CIDR。远程 `APP_ORIGIN` 必须使用 HTTPS；未配置可信代理时，应用会在打开数据库前停止启动。

登录与恢复按可信来源限流；保存、同步、退出及安全设置使用经过数据库校验的有效会话额度。匿名流量不能消耗合法会话额度，伪造或过期 Cookie 按匿名来源计数，超限返回 `429 / RATE_LIMITED` 及重试时间。

## 配置项

宝塔部署直接编辑 `docker-compose.yml`。以下默认值指宝塔文件：

| 配置项             | 默认值                            | 用途                                 |
| ------------------ | --------------------------------- | ------------------------------------ |
| `image`            | `wxdadadada/account-vault:latest` | 每次启动检查最新发布版               |
| `APP_ORIGIN`       | `https://account.wxda.cc`         | 浏览器实际访问的 HTTPS 来源          |
| `HOST`             | `127.0.0.1`                       | 仅接受宿主机回环连接                 |
| `PORT`             | `8188`                            | 服务监听端口；保持与镜像健康检查一致 |
| `TRUSTED_PROXIES`  | `127.0.0.1,::1`                   | 信任同机宝塔的回环连接               |
| `DATA_DIR`         | 镜像内 `/app/data`                | SQLite 与服务密钥目录                |
| `BACKUP_DIR`       | 数据目录下 `backups`              | SQLite 在线快照目录                  |
| `AI_ALLOWED_HOSTS` | 见 Compose 文件                   | 允许连接的 AI 域名，英文逗号分隔     |

本机 `docker-compose.local.yml` 使用 `.env` 插值：`IMAGE` 选择镜像、`PORT` 选择宿主映射端口，`APP_ORIGIN`、`TRUSTED_PROXIES` 和 `AI_ALLOWED_HOSTS` 传入容器。其他服务变量需要在该文件的 `environment` 中显式配置。本地 `pnpm start` 会加载 `.env` 中的服务变量。

自定义模型服务仅支持 HTTPS 公网域名，域名需加入 `AI_ALLOWED_HOSTS`。后台拒绝私网、回环、链路本地和重定向目标。接口使用 Chat Completions 格式；不支持任意厂商的私有协议，也不直接连接本地模型地址。

## 数据卷

容器使用非 root 用户、只读根文件系统和独立可写数据卷。默认项目名为 `account-vault`，数据卷为 `account-vault_keyfolio_data`；使用 `-p` 或 `COMPOSE_PROJECT_NAME` 时，卷名前缀也会改变。升级时保持原目录、项目名和卷名。

查看运行中容器的实际数据卷：

```bash
docker inspect "$(docker compose ps -q app)" --format '{{json .Mounts}}'
```

## 两类备份

**便携加密备份**：在“设置 → 备份与恢复 → 导出备份”下载 `.keyfolio.json`，包含账号、主体、历史和加密配置。将文件复制到另一台设备或独立备份位置。恢复密钥与备份分开保存。

- 空白实例：首次创建页选择“从加密备份恢复”，使用该备份原密码或恢复密钥解密，再设置新用户名和主密码；完成后保存新恢复密钥。
- 已有实例：设置中导入并预览。合并不重复的账号和对应历史，保留当前 AI 配置、主密码和偏好；重复账号跳过，避免覆盖当前内容。
- 主体名称按去除首尾空白、忽略大小写匹配，同名且同类型复用当前主体和别名；不同主体之间名称与别名不得交叉重复。备份内或与当前空间冲突时，预览显示具体主体并停止合并，请先修改冲突名称或别名。冲突时不会静默删除别名来继续导入。已匹配主体沿用当前别名，备份中的别名不合并。
- 双重验证属于服务端登录设置，不包含在便携账号备份中；恢复后重新开启。

**服务器快照**：启动时及每小时检查，每个 UTC 日期创建一份一致的 SQLite 在线快照，保留最近 14 份。“立即备份”更新当天快照。默认位于 `/app/data/backups/`。同盘快照便于回退；异机副本用于磁盘或主机故障恢复。

## 从 SQLite 快照恢复

先保留当前数据的副本，再按以下顺序操作：

1. 停止应用服务，确保没有进程连接数据库。
2. 在同一个数据卷中，将选定快照复制为 `keyfolio.sqlite`，移除停机数据库残留的 `keyfolio.sqlite-wal` 和 `keyfolio.sqlite-shm`。
3. 保留匹配的 `server.key`，它用于解密 TOTP 验证器设置；备份全目录时应包含它。文件属主需为容器中的 UID/GID 1000，文件权限为 600。
4. 启动服务，使用快照对应的用户名、密码及验证器登录，核实账号与变更。

完整数据目录是最直接的服务器迁移单元。运行中不要直接复制单个活动 SQLite 文件；请复制在线快照，或先停机再复制整个目录。如果 `server.key` 遗失，恢复密钥流程可重置双重验证。

历史快照也保存了当时的登录设置和会话。对于回退到旧快照的实例，建议登录后修改主密码并保存新恢复密钥，从而撤销旧会话。

## 更新

升级宝塔部署时，在原目录替换 `docker-compose.yml`，确认其中 `APP_ORIGIN` 是实际域名，并保持原项目名及数据卷名。新版已包含同机宝塔需要的可信代理配置。数据库与便携备份格式保持版本 1，现有主密码、恢复密钥及备份继续有效。更新后刷新所有已打开的标签页，以加载新的锁定逻辑。

先在界面导出一份加密备份。使用 Docker Hub 的 `latest` 镜像时，无需修改版本号，执行以下命令即可更新。服务启动时不会在后台自动更新；需要更新时运行命令：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

使用源码构建时，克隆或更新代码，在项目根目录运行以下命令。本机使用 `docker-compose.local.yml`，可将 `.env` 的 `IMAGE` 设为 `keyfolio:local`。宝塔部署则直接将 `docker-compose.yml` 的 `image` 改为 `keyfolio:local`，并运行 `docker compose up -d --pull never`。

```bash
docker build -t keyfolio:local .
IMAGE=keyfolio:local docker compose -f docker-compose.local.yml up -d --pull never
docker compose -f docker-compose.local.yml ps
```

当前数据库版本为 1。应用启动会初始化空库；如果数据库版本高于代码支持版本，将停止启动，避免错误降级。当前不提供自动跨版本回退迁移。
