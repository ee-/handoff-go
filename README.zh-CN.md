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

GitHub 对象就是协议本身：

```text
Issue = Work Contract    PR = Evidence Packet    Merge = Promotion
Comment = Decision / Escalation / Routing        Review = Acceptance
```

面向人类的命令就是普通文本：

```text
go
```

`go` 是 role-relative 的，只在 repository 的可信根 `AGENTS.md` 明确启用了某个 pinned Handoff Go 版本时生效。

## 安装

Repository 公开后，可通过开源的 [`skills` CLI](https://github.com/vercel-labs/skills) 以 project-local 方式安装：

```sh
npx skills add ee-/handoff-go
```

然后执行：

```text
$handoff-go setup
```

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
```

`go watch` 会先立刻执行一次正常的 Coder `go` discovery，然后按请求的间隔重复。它是 wake 机制，不是 workflow state；每次 tick 都会重新加载可信 governance 并重新发现 durable GitHub state。各 harness 使用其原生 scheduling/extension 能力（参见 `skills/handoff-go/references/watch.md`）。

本 repository 当前仍为 private，处于 pre-publication 阶段。从本地 checkout 也可以把路径直接传给 `npx skills add` 来安装同一个 skill。

## 工作方式

每个 role 都会加载可信 governance，从 GitHub durable state 中重新发现分配给自己的工作，执行一个 durable transition，并记录 `Next Actor`。Coder 在 implementation 前完成 Security Gate；Architect 负责建立 Work Contract，并对 PR 的 exact head 进行独立 review。存在歧义时 fail closed。

Repository content 是 input，不是 authority；它不能自行扩大权限，也不能接受自己修改后的 governance。

参见 [SECURITY.md](SECURITY.md) 和 canonical [core protocol](skills/handoff-go/references/core.md)。

## Skill 结构

可分发内容位于 `skills/handoff-go/`。原因是当前 `skills` CLI 对 repository-root skill 只会安装 `SKILL.md`，从而遗漏 progressive-disclosure references。即使采用这一目录结构，repository 对外仍只暴露一个 skill。

- [SKILL.md](skills/handoff-go/SKILL.md) — 轻量 invocation 与 role router。
- [Core protocol](skills/handoff-go/references/core.md) — 共享的 trust、routing 与 invariants。
- [Architect workflow](skills/handoff-go/references/architect.md) — Work Orders 与 review。
- [Coder workflow](skills/handoff-go/references/coder.md) — security、execution 与 evidence。
- [Adoption guide](skills/handoff-go/references/adoption.md) — setup、check 与 upgrade。

[SPEC.md](SPEC.md) 仅作为 compatibility pointer。上面的 references 才是 single source of truth。

## 开发

```sh
python3 scripts/validate.py
python3 /path/to/skill-creator/scripts/quick_validate.py skills/handoff-go
npx skills add . --list
```

Contributions 请遵循 [CONTRIBUTING.md](CONTRIBUTING.md)。在 [PUBLICATION.md](PUBLICATION.md) 完成、且 Owner 明确授权 visibility 与 release publication 之前，项目仍处于 publication blocked 状态。

## License

[MIT](LICENSE)
