# 来源与许可

拾钥基于 [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) 改造，当前代码使用 React、TypeScript、Vite、TanStack Router、Tailwind CSS 与 shadcn/ui / Radix。

保留上游 [MIT 许可](../LICENSE)。上游原始介绍、作者和组件说明归档在 [原始 README](archive/shadcn-admin-readme.md)，其中的演示功能、Clerk 登录和启动步骤属于原模板。

当前 `src/components/ui/` 保留业务实际使用的 11 个基础组件：`alert-dialog`、`badge`、`button`、`checkbox`、`collapsible`、`dialog`、`dropdown-menu`、`input`、`label`、`select`、`textarea`。部分组件包含上游适配或本项目修改，更新前应检查现有实现并运行回归测试。

平台图标由已安装的 `simple-icons` 包随前端构建，相关来源见 [账号库日常管理增强](collection-enhancement.md)。

当前启动方式见 [项目 README](../README.md)，目录与维护命令见 [开发与目录约定](development.md)。
