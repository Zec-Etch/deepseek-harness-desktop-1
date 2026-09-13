# Desktop pipe WebRoute adapter

English | [中文](README.zh.md)

This private package preserves the reviewed `WebRoute` registration subset for
the Desktop local carrier without opening a TCP listener. It is not a Web
deployment server and is never selected for Remote Gateway mode.

Supported and tested APIs are exact and longest-prefix route registration,
fallback registration, index injections and taps, streaming response bodies,
request cancellation, and upgrade-route lookup. `host` is fixed to loopback
and `port` is the sentinel `0`; no network socket is created.

The adapter is temporary. It can be removed after every built-in JSON, asset,
SSE, and duplex route in `docs/architecture/transport-inventory.json` has a
carrier-neutral owner and the corresponding behavior contract passes without
the `webServer` service.
