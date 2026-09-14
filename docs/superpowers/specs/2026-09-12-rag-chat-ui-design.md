# rag-chat-ui 独立项目设计

日期：2026-09-12  
状态：已确认（用户批准设计方案 A）

## 1. 目标

把 rag-project 的前端抽取为独立可维护的通用 RAG 聊天前端项目 `rag-chat-ui`：

- 后端无关：通过固定 API 契约对接任意兼容后端，不绑定特定知识库。
- 元数据驱动：应用名、标语、支持的模式、示例问题、面试引导全部由后端 `/api/meta` 提供，前端零硬编码。
- 独立可演示：内置零依赖 mock server，无后端也能完整演示全部功能。
- 简历级文档：README + 设计文档 + 组件文档，可直接作为作品集项目。

## 2. 范围

### 包含

- 从 `rag-project/web` 复制并泛化全部前端代码（QA、模拟面试、错题本、会话、双主题、移动端、引用锚点、降级展示）。
- 定义并实现 `/api/meta` 契约（TypeScript 类型 + 前端消费）。
- mock server 实现全部四个端点与 SSE 协议。
- rag-project 后端新增 `/api/meta` 作为首个兼容后端（含 kbId、面试元数据）。
- 独立项目的 README.md、docs/design.md、docs/components.md，附双主题与移动端截图。

### 不包含

- 组件库/npm 包发布、文档站。
- 后端泛化（rag-project 只加 /api/meta，不引入配置系统）。
- 知识库上传。

## 3. API 契约

### `GET /api/meta`

```typescript
interface InterviewGuide {
  title: string
  desc: string
  topic: string
}

interface KnowledgeMeta {
  /** 知识库唯一标识；用于 localStorage 数据隔离（会话、错题本） */
  kbId: string
  appName: string        // 产品名
  tagline: string        // 副标题/说明
  modes: Array<'qa' | 'interview'>  // 支持的模式
  examples: string[]                  // 空状态示例问题
  interviewGuides: InterviewGuide[]   // 面试引导卡（modes 含 interview 时）
}
```

前端启动并发请求 `/api/meta`、`/api/stats`、`/api/health`。meta 请求失败时降级为中性默认：`{ kbId: 'default', appName: '知识库问答', tagline: '', modes: ['qa'], examples: [], interviewGuides: [] }`，页面可正常提问，只是无品牌化与示例卡。

其余三个端点沿用 rag-project 已稳定的契约（/api/stats、/api/health、/api/chat SSE 状态机）。

### 配置

- `VITE_API_TARGET`：Vite 代理目标，默认 `http://localhost:8000`。
- `npm run dev`：连真实后端；`npm run dev:mock`：连内置 mock（端口 8787）。

## 4. 前端泛化改造点

| 现状（rag-project/web） | 泛化后 |
|---|---|
| 「面试题库问答」硬编码（index.html title、TopBar、空态标题） | meta.appName；index.html 静态 title 为「知识库问答」，启动后 document.title 同步 |
| QA_EXAMPLES 写死 4 条 | meta.examples 驱动；空数组时不渲染示例区 |
| INTERVIEW_GUIDES 写死 03-rag-system 等 | meta.interviewGuides 驱动 |
| 模式 Tabs / 错题本入口 / 面试引导恒显示 | modes 不含 interview 时全部隐藏；mode 状态强制为 qa |
| localStorage key `rag-qa:*` | `rag-chat-ui:{kbId}:*`（sessions、active、mistakes、theme 不随 kbId，主题全局共享） |
| vite proxy 固定 localhost:8000 | `VITE_API_TARGET` 环境变量 |
| 面试引导卡图标 Database/Layers 写死 | meta 不带图标字段，前端按序号轮换一组通用图标 |

## 5. mock server

`mock/server.mjs`：Node 原生 `node:http`，零依赖，实现：

- `/api/meta`：演示知识库（kbId `demo`，appName「知识库问答 Demo」，modes 全量，3 个示例问题，2 张面试引导卡，主题：`产品手册`、`技术文档`、`常见问题`）。
- `/api/stats`：与 meta 一致的主题计数。
- `/api/health`：默认 `ready`；`MOCK_LLM=off` 时 `degraded`，/api/chat 走降级流。
- `/api/chat`：完整 SSE 状态机（retrieving → sources → generating|fallback → token* → done）；qa 返回罐头回答（含 [1] 引用标记）+ 3 条假来源；interview 首问出题、追问输出「### 正确答案」小节以触发错题自动收录；topic 过滤；未知 topic 返回 UNKNOWN_TOPIC；支持 `MOCK_DELAY` 控制 token 间隔便于演示流式。
- `MOCK_ERROR=1` 时返回 LLM_STREAM_FAILED 用于演示重试。

## 6. 文档

- `README.md`：定位一句话、能力表、30 秒快速开始（dev:mock）、截图（桌面暗/浅、移动、面试模式）、架构图、设计亮点（SSE 状态机、Ollama 降级、引用锚点、请求所有权、双主题 token、测试规模）、如何接入新后端（实现四个端点 + 契约链接）、License。
- `docs/design.md`：API 契约全文、SSE 状态机图、请求所有权/竞态模型、降级决策树、双主题 token 设计、localStorage 数据模型与 kbId 隔离。
- `docs/components.md`：组件树（Home → TopBar/SidePanel/ChatArea/MessageItem/SourceCard/MistakesPanel）、每个组件职责与 props 契约、关键 hooks/lib（theme、sse、sessions、mistakes、citations）。

## 7. rag-project 后端兼容

`server.py` 新增 `GET /api/meta`，返回面试题库的真实元数据（kbId `interview-guide`，appName「面试题库问答」，modes 双模式，examples 取现 QA_EXAMPLES，interviewGuides 取现 INTERVIEW_GUIDES 的 title/desc/topic）。加一条后端测试。

## 8. 验证

1. 独立项目 `npm test` + `tsc -b` + `lint` 全绿（测试随代码迁移并更新）。
2. `npm run dev:mock` 浏览器全流程：QA 问答（引用锚点跳转）、模拟面试（出题→作答→点评→错题自动收录→错题本查看→再考一次）、双主题切换并刷新保持、375px 移动端抽屉与输入、MOCK_LLM=off 降级横幅、MOCK_ERROR=1 重试。
3. 对接真实后端：启动 rag-project 后端（含新 /api/meta），`VITE_API_TARGET=http://localhost:8000 npm run dev`，确认品牌/示例/引导卡变为面试题库内容、错题本与原项目 localStorage 隔离互不干扰。
4. 截图存档进独立项目 docs/screenshots/ 并在 README 引用。

## 9. 完成标准

- `rag-chat-ui` 目录可独立 `npm install && npm run dev:mock` 跑通全部功能。
- 元数据驱动的品牌化在真实后端与 mock 下均验证。
- 文档完整到「读者不看代码能讲清架构」。
- 全部自动化测试通过。
