# 部署与恢复

## 使用 Docker Hub 镜像

源码位于 [wxDadadada/account-vault](https://github.com/wxDadadada/account-vault)，镜像位于 [wxdadadada/account-vault](https://hub.docker.com/r/wxdadadada/account-vault)。镜像支持 `linux/amd64` 与 `linux/arm64`，Docker 会选择匹配的架构。固定版本使用 `0.1.0`，`latest` 随发布更新。

单文件部署只需 Docker 和 Compose，无需克隆源码或准备 `.env`：

```bash
mkdir -p account-vault
cd account-vault
curl -fsSL https://raw.githubusercontent.com/wxDadadada/account-vault/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
docker compose ps
```

`docker-compose.yml` 默认使用 `wxdadadada/account-vault:0.1.0`，自动选择 CPU 架构。可直接修改文件中的默认值，或在同目录创建 `.env` 覆盖配置；源码仓库中的 `.env.example` 提供完整示例。远程访问按下文设置 `APP_ORIGIN`、`TRUSTED_PROXIES` 和 HTTPS 代理。

后续拉取目标版本并启动：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

自定义 `IMAGE` 时，应将选择持续保存在 Compose 文件或 `.env` 中，以便后续启动和更新使用同一镜像来源。源码构建见本文末尾。

## 本机 Docker

在 `docker-compose.yml` 所在目录运行 `docker compose up -d`，打开 `http://localhost:4318`。Compose 默认仅绑定宿主机回环地址，数据位于持久卷。容器使用非 root 用户、只读根文件系统和独立可写数据卷。

查看实际卷名：

```bash
docker inspect "$(docker compose ps -q app)" --format '{{json .Mounts}}'
```

默认项目名为 `account-vault`，数据卷为 `account-vault_keyfolio_data`；使用 `-p` 或 `COMPOSE_PROJECT_NAME` 覆盖项目名时，卷名前缀也会改变。以上命令从正在运行的应用容器中读取实际 Mounts；核实卷名后再做恢复操作。

## 远程 HTTPS

1. 在 `docker-compose.yml` 同目录创建 `.env`；克隆了源码时也可复制 `.env.example` 为 `.env`。
2. 将 `APP_ORIGIN` 改为最终访问地址，例如 `https://vault.example.com`。它必须与浏览器地址的协议、域名和端口一致。
3. 设置 `TRUSTED_PROXIES` 为应用实际看到的直连代理 IP 或精确 CIDR，英文逗号分隔。本地 Node 与同机代理通常为 `127.0.0.1,::1`；Docker 中可能是桥接网关，不能直接套用回环地址。只填写自己控制的代理，禁止全网范围。
4. 用宿主机反向代理提供 TLS，将请求转发至 `127.0.0.1:4318`。保留请求的 Cookie、Origin 和自定义头，覆盖外部传入的客户端 IP 头，不缓存 `/api/`。后端保持回环绑定。
5. 运行 `docker compose up -d`。
6. 从服务器读取首次初始化令牌：

```bash
docker compose exec app cat /app/data/setup-token
```

7. 在首次创建页面填入令牌、用户名和主密码，保存恢复密钥。

令牌只用于尚未初始化的实例。服务端不会将它返回到浏览器。已有实例不接受第二次初始化。

同一域名完成 HTTPS 配置后，手机即可访问并通过浏览器菜单添加到主屏幕。应用提供 manifest 和图标；账号库需要连接服务器解锁与保存，不提供离线写入。

反向代理示例（Caddy，运行在宿主机）：

```caddyfile
vault.example.com {
    reverse_proxy 127.0.0.1:4318 {
        header_up X-Forwarded-For {remote_host}
    }
}
```

将示例域名换成自己的域名，并在 DNS 中指向服务器。此例适用于 Caddy 直接接收外部客户端连接；如果前面还有 CDN 或另一层代理，必须单独核实完整的可信代理链，见 [Caddy 转发头说明](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults)。不要把开发服务器作为公网入口。

Docker 宿主代理的候选网关可从当前容器查看：

```bash
docker inspect "$(docker compose ps -q app)" --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}'
```

网络模式、Docker Desktop 和宿主 NAT 可能改变实际来源，网关值需要与当前部署核对。仅信任网关本身的 IP，而不是整个共享容器网段。升级前可从旧容器检查；首次部署可先以默认本机配置启动检查网络，再启用远程配置。配置后用两个不同外部来源验证限流互不影响。远程 `APP_ORIGIN` 未配置可信代理时，应用会在打开数据库前停止启动并提示配置。

登录与恢复按可信来源限流；保存、同步、退出及安全设置使用经过数据库校验的有效会话额度。匿名流量不能消耗合法会话额度，伪造或过期 Cookie 按匿名来源计数，超限返回 `429 / RATE_LIMITED` 及重试时间。

## 配置项

| 变量               | 默认值                                | 用途                                                  |
| ------------------ | ------------------------------------- | ----------------------------------------------------- |
| `IMAGE`            | `wxdadadada/account-vault:0.1.0`      | Compose 镜像名；自行构建时可使用 `keyfolio:local`     |
| `APP_ORIGIN`       | `http://localhost:4318`               | 浏览器实际访问来源；远程须为 HTTPS                    |
| `PORT`             | `4318`                                | Compose 宿主机映射端口；Node 直接运行时为服务监听端口 |
| `HOST`             | Node 为 `127.0.0.1`，容器为 `0.0.0.0` | 服务绑定地址                                          |
| `DATA_DIR`         | Node 为 `./data`，容器为 `/app/data`  | SQLite 与服务密钥目录                                 |
| `BACKUP_DIR`       | 数据目录下 `backups`                  | SQLite 在线快照目录                                   |
| `AI_ALLOWED_HOSTS` | 见 `.env.example`                     | 允许连接的 AI 域名，英文逗号分隔                      |
| `TRUSTED_PROXIES`  | 空                                    | 可信直连代理 IP/CIDR；远程部署必填，本机直连可留空    |

修改 Compose 的 `PORT` 时也要修改 `APP_ORIGIN`。更改变量后用 `docker compose up -d` 重建容器，而非只运行 `restart`。

Compose 的 `.env` 用于变量插值，`IMAGE` 选择镜像，`PORT` 用于宿主映射；仅将 `APP_ORIGIN`、`AI_ALLOWED_HOSTS`、`TRUSTED_PROXIES` 显式传入容器。`HOST`、`DATA_DIR`、`BACKUP_DIR` 需要在 Compose 的 environment/volumes 中显式配置；只修改 `.env` 不会改变它们。本地 `pnpm start` 会加载 `.env` 中的这些服务变量。

自定义模型服务仅支持 HTTPS 公网域名，域名需加入 `AI_ALLOWED_HOSTS`。后台拒绝私网、回环、链路本地和重定向目标。接口使用 Chat Completions 格式；不支持任意厂商的私有协议，也不直接连接本地模型地址。

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

从旧版升级远程 HTTPS 实例时，先补充 `TRUSTED_PROXIES`；缺少该配置会拒绝启动。数据库与便携备份格式保持版本 1，现有主密码、恢复密钥及备份继续有效。更新后刷新所有已打开的标签页，以加载新的锁定逻辑。

先在界面导出一份加密备份。使用 Docker Hub 镜像时，将 `.env` 的 `IMAGE` 更新为目标版本，再执行：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

使用源码构建时，克隆或更新代码，在项目根目录运行以下命令。将 `.env` 的 `IMAGE` 设为 `keyfolio:local`，使后续启动继续使用本地镜像：

```bash
docker build -t keyfolio:local .
IMAGE=keyfolio:local docker compose up -d
docker compose ps
```

当前数据库版本为 1。应用启动会初始化空库；如果数据库版本高于代码支持版本，将停止启动，避免错误降级。当前不提供自动跨版本回退迁移。
