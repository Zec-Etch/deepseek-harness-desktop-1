# Desktop 管道 WebRoute 适配器

[English](README.md) | 中文

这个私有包在不打开 TCP 监听端口的前提下，为 Desktop 本地载体保留经过审查的
`WebRoute` 注册子集。它不是 Web 部署服务器，也不会用于 Remote Gateway 模式。

已支持并验证的 API 包括精确路由与最长前缀路由注册、fallback 注册、首页注入与
转换、流式响应体、请求取消和升级路由查找。`host` 固定为 loopback，`port` 使用
哨兵值 `0`；不会创建网络 socket。

此适配器是临时边界。当 `docs/architecture/transport-inventory.json` 中所有内置
JSON、资源、SSE 和双工路由都有载体无关的 owner，且对应行为契约可以在没有
`webServer` 服务的情况下通过时，即可删除此适配器。
