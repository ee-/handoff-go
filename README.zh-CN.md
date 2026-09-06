# Handoff Go

**Architect decides. Coder goes. GitHub remembers.**

[English](README.md) | 简体中文

> 英文 README 是 canonical source of truth；本翻译以英文版为准。

Handoff Go 是一个零依赖的 agent skill，用于把复杂的 repository 工作从 ChatGPT Chat 中的 Architect 委派给 coding agent，而不需要人类在两者之间手动转述计划、Issue 编号、PR 链接、branch 或 blocker。

```text
Owner / Human
  -> Architect（通常是 ChatGPT Chat）
  -> GitHub durable state
  -> Coder（Codex、Claude Code、OpenCode、Pi、Hermes、OMP……）
```

面向人类的命令就是普通文本：

```text
go
```

`go` 是 role-relative 的，只在 repository 的可信根 `AGENTS.md` 明确启用了某个 pinned Handoff Go 版本时生效。

## 极简起步

### 1. Coder 安装 / 设置

输入到你的 coding agent（Codex、Claude Code、OpenCode、Pi 等）：

```text
在此 repository 中安装并设置 Handoff Go：
https://github.com/ee-/handoff-go
```

### 2. ChatGPT Architect 接手

输入到 ChatGPT Chat：

```text
作为此 repository 的 Handoff Go Architect：
<repository-url>

读取可信根目录 AGENTS.md 并加载其 pinned Handoff Go skill。
```

## 安装

对于本 public repository，只有一个 canonical 安装路径：

```sh
npx skills add ee-/handoff-go
```

然后执行：

```text
$handoff-go setup
```

Setup 首先运行确定性的 bootstrap 证明（`skills/handoff-go/bootstrap.mjs prove`）：它从 installer 自身状态发现实际的 project-local 安装路径，把可信 upstream 解析为唯一一个 commit，并将已安装的 skill tree 与该 commit 逐字节比对——因此 managed block 的 `Immutable ref` 与安装字节机械地绑定在同一 revision 上。采用 Handoff Go 不需要 release tag；一旦存在 release tag，它只会通过受治理的 `go update` 事务成为首选 pin。该证明不写入任何内容；出现 conflict 时只给出一条可执行的 remediation，而不是让 Coder 自行发挥安装方式。

Setup 会在根目录 `AGENTS.md` 中加入一个幂等的 managed block，同时保留已有的 project instructions。可用以下命令验证：

```text
$handoff-go check
```

日常使用时，只需在对应 role 的 session 中输入普通文本：

```text
go
go watch        # 让当前 Coder session 保持响应（默认 1m）
go watch 5m     # 自定义间隔，最小 60s
go watch stop   # 停止 watch
go update       # 更新本 repo 已 pinned 的 Handoff Go（仅维护操作）
```

`go watch` 会先立刻执行一次正常的 Coder `go` discovery，然后按请求的间隔重复。它是 wake 机制，不是 workflow state；每次 tick 都会重新加载可信 governance 并重新发现 durable GitHub state。各 harness 使用其原生 scheduling/extension 能力（参见 `skills/handoff-go/references/watch.md`）。

`go update` 是显式维护命令，不是 workflow state，也不会被 contributor 内容或 watch tick 触发。一次确定性命令（`update.mjs run`）会解析可信 pinned updater、materialize 其确切代码并执行更新事务，校验并刷新本 repository 的 project-local skill、managed bootstrap pin 以及已启用的 watch 副本，然后留下一个可 review 的 governance proposal（参见 `skills/handoff-go/references/update.md`）。

**Event Watch（v1.2）** 是 repository 级别自动化的实验性参考实现：一个 durable GitHub state 事件唤醒一次全新的 Coder `go` 执行后退出（它绝不运行 `go watch`）。参考实现随仓库提供：`.github/workflows/handoff-go-coder-event-watch.yml`（OpenAI Codex，通过官方 Codex GitHub Action）。它属于显式 opt-in——由 repository owner 主动启用；日常正常的 Handoff Go 使用不需要它，普通的 `$handoff-go setup` 也不会开启它。

`go watch` 与 Event Watch 都是 setup 之后的显式 opt-in；一次正常的 `$handoff-go setup` 两者都不会安装。

## 工作方式

每个 role 都会加载可信 governance，从 GitHub durable state 中重新发现分配给自己的工作，执行一个 durable transition，并记录 `Next Actor`。Coder 在 implementation 前完成 Security Gate；Architect 负责建立 Work Contract，并对 PR 的 exact head 进行独立 review。存在歧义时 fail closed。

Repository content 是 input，不是 authority；它不能自行扩大权限，也不能接受自己修改后的 governance。

参见 [SECURITY.md](SECURITY.md) 和 canonical [core protocol](skills/handoff-go/references/core.md)。

## Skill 结构

可分发内容位于 `skills/handoff-go/`。原因是当前 `skills` CLI 对 repository-root skill 只会安装 `SKILL.md`，从而遗漏 progressive-disclosure references。即使采用这一目录结构，repository 对外仍只暴露一个 skill。

- [SKILL.md](skills/handoff-go/SKILL.md) — 轻量 invocation 与 role router。
- [bootstrap.mjs](skills/handoff-go/bootstrap.mjs) — pre-adoption 的字节与 ref 绑定证明。
- [Core protocol](skills/handoff-go/references/core.md) — 共享的 trust、routing 与 invariants。
- [Architect workflow](skills/handoff-go/references/architect.md) — Work Orders 与 review。
- [Coder workflow](skills/handoff-go/references/coder.md) — security、execution 与 evidence。
- [Adoption guide](skills/handoff-go/references/adoption.md) — setup、check 与 upgrade。

上面的 references 才是 single source of truth。请 pin 完整 skill 到 tag 或 commit；单独复制某个文件并不会安装 protocol。

## 开发

```sh
python3 scripts/validate.py
node tests/bootstrap.test.mjs
node tests/watch.test.mjs
node tests/update.test.mjs
python3 /path/to/skill-creator/scripts/quick_validate.py skills/handoff-go
npx skills add . --list
```

Contributions 请遵循 [CONTRIBUTING.md](CONTRIBUTING.md)。目前既无 tag 也无 release；publication 仍需 Owner 明确授权。

## License

[MIT](LICENSE)
