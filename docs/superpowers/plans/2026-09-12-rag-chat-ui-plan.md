# rag-chat-ui 独立项目实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 把 rag-project 前端抽成独立的通用 RAG 聊天前端项目 rag-chat-ui：元数据驱动、mock 可独立演示、简历级文档。

**Architecture:** 从 `/Users/ryan/workspace/ai-learning/rag-project/.worktrees/rag-hardening-ui/web`（已加固版本，分支 rag-hardening-ui）复制前端到 `/Users/ryan/workspace/ai-learning/rag-chat-ui`，泛化硬编码；新增 `GET /api/meta` 契约；Node 零依赖 mock server 实现全部端点。

**Tech Stack:** React 19 + Vite 7 + TS + Tailwind 3 + Vitest；mock 用 node:http。

**规格:** `docs/superpowers/specs/2026-09-12-rag-chat-ui-design.md`（同仓库，含完整契约）。

---

## Task 1: 项目骨架迁移

**Files:** 全部从源复制；修改 package.json。

- [ ] **Step 1: 复制**

源：`/Users/ryan/workspace/ai-learning/rag-project/.worktrees/rag-hardening-ui/web/`（HEAD = 3b85e03，含全部加固改动）。
目标：`/Users/ryan/workspace/ai-learning/rag-chat-ui/`。

复制以下路径（不复制 node_modules、dist、scripts/dev-full.mjs、scripts/mock-backend.mjs）：
`src/`、`index.html`、`package.json`、`vite.config.ts`、`vitest.config.ts`、`tsconfig*.json`、`tailwind.config.js`、`postcss.config.js`、`eslint.config.js`、`components.json`、`.gitignore`（与根 .gitignore 合并去重）。

- [ ] **Step 2: package.json 调整**

- `name`: `rag-chat-ui`，`description`: "Backend-agnostic RAG chat workbench UI"
- scripts 保留 `dev/build/lint/preview/test/test:watch`，删除 `dev:full`，新增 `"dev:mock": "VITE_API_TARGET=http://localhost:8787 concurrently -k \"node mock/server.mjs\" \"vite\""`（mock 在 Task 4 创建；本步先不加 dev:mock，避免引用不存在的文件——Task 4 再加）。本步 scripts 只保留 dev/build/lint/preview/test/test:watch。
- 依赖不变。

- [ ] **Step 3: 安装与基线**

`npm install`（生成独立 package-lock.json），`npm test && npx tsc -b && npm run lint` 全绿（144 测试原样通过；如有 jsdom 路径问题修复）。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: 从 rag-project 迁移前端基线"
```

---

## Task 2: /api/meta 契约与后端实现

**Files:**
- Modify: `src/types/index.ts`、`src/lib/api.ts`、`src/lib/api.test.ts`
- Modify: `/Users/ryan/workspace/ai-learning/rag-project/.worktrees/rag-hardening-ui/server.py` 与 `tests/test_server.py`（rag-project 侧）

- [ ] **Step 1: 前端类型与 fetchMeta（TDD）**

types/index.ts 新增（按规格 §3）：

```typescript
export interface InterviewGuide {
  title: string
  desc: string
  topic: string
}

export interface KnowledgeMeta {
  kbId: string
  appName: string
  tagline: string
  modes: Array<'qa' | 'interview'>
  examples: string[]
  interviewGuides: InterviewGuide[]
}
```

api.ts 新增：

```typescript
export async function fetchMeta(): Promise<KnowledgeMeta> {
  const res = await fetch(`${API_BASE}/api/meta`)
  if (!res.ok) throw new Error(`GET /api/meta 失败：HTTP ${res.status}`)
  const data = (await res.json()) as KnowledgeMeta
  if (typeof data.kbId !== 'string' || typeof data.appName !== 'string' || !Array.isArray(data.modes)) {
    throw new Error('GET /api/meta 返回格式异常')
  }
  return data
}
```

api.test.ts 加用例：成功解析、非 2xx 抛错、格式异常抛错。

- [ ] **Step 2: rag-project 后端 /api/meta**

server.py 新增（沿用现有风格，含常量集中定义）：

```python
@app.get("/api/meta")
def get_meta():
    return {
        "kbId": "interview-guide",
        "appName": "面试题库问答",
        "tagline": "基于本地知识库的检索增强问答，回答附引用来源与相关度评分。",
        "modes": ["qa", "interview"],
        "examples": [
            "什么是 RAG？它解决了什么问题？",
            "Temperature、Top-P、Top-K 怎么调？",
            "什么是 Prompt Injection？如何防御？",
            "Transformer 的自注意力机制是怎么工作的？",
        ],
        "interviewGuides": [
            {"title": "RAG 专题面试", "desc": "限定 03-rag-system 主题出题", "topic": "03-rag-system"},
            {"title": "Transformer 专题面试", "desc": "限定 04-transformer-architecture 主题", "topic": "04-transformer-architecture"},
        ],
    }
```

tests/test_server.py 加用例：200、字段齐全、modes 含 qa/interview。

- [ ] **Step 3: 验证与提交**

rag-project 侧：`cd /Users/ryan/workspace/ai-learning/rag-project/.worktrees/rag-hardening-ui && venv/bin/pytest tests/ -q` 全绿后 `git commit -m "feat: /api/meta 知识库元数据端点"`。
本仓库侧：npm test 全绿后 `git commit -m "feat: /api/meta 契约类型与获取"`。

---

## Task 3: 前端元数据驱动泛化

**Files:** `src/pages/Home.tsx`、`src/components/{TopBar,ChatArea,SidePanel,MessageItem}.tsx`、`src/lib/{sessions,mistakes}.ts`、`index.html`、`vite.config.ts`、相关测试。

- [ ] **Step 1: 失败测试先行**

Home.test.tsx 新用例：
1. meta 返回 appName「产品文档助手」+ modes ['qa'] → 顶栏与空态标题显示该名称；不渲染模式 Tabs、错题本入口、面试引导。
2. modes 含 interview → Tabs/错题本/引导卡渲染，引导卡来自 meta.interviewGuides。
3. meta 请求失败 → 显示默认名「知识库问答」，可正常发送（qa）。
4. 两个不同 kbId 的会话存储互不可见（直接测 sessions.ts 的 key 生成）。
5. document.title 随 appName 更新。

- [ ] **Step 2: 存储命名空间**

sessions.ts / mistakes.ts：KEY 从常量改为函数 `storageKey(kind, kbId)` = `rag-chat-ui:${kbId}:${kind}`（kind ∈ sessions/active/mistakes）。所有 load/save 函数签名加 kbId 参数；theme 保持全局 `rag-chat-ui:theme` 不随 kbId。调用方（Home、MistakesPanel、MessageItem）传当前 kbId。更新全部相关测试。

注意：mistakes 的 MISTAKES_CHANGED 事件机制保留，key 变化即可。

- [ ] **Step 3: Home 接入 meta**

- `const [meta, setMeta] = useState<KnowledgeMeta | null>(null)`；启动 `fetchMeta().then(setMeta).catch(() => setMeta(DEFAULT_META))`（DEFAULT_META 按规格 §3）。
- `kbId = meta?.kbId ?? 'default'`；meta 加载完成前不加载 localStorage 会话/错题（避免 default 误读他人数据）。
- modes 不含 interview 且当前 mode==='interview' 时强制 qa。
- mode/topic/messages 初始化与持久化都带 kbId。
- `useEffect(() => { document.title = meta?.appName ?? '知识库问答' }, [meta])`。
- 把 meta 透传给 TopBar/ChatArea/SidePanel。

- [ ] **Step 4: 组件泛化**

- `index.html`：静态 title 改「知识库问答」。
- TopBar：标题显示 meta.appName（加载中显示骨架）。
- ChatArea：删除 QA_EXAMPLES/INTERVIEW_GUIDES 常量；空态标题 = appName、副标题 = tagline；示例卡 = meta.examples（图标按 index 轮换 MessageSquare/Database/Sparkles/Network 等 lucide 图标）；面试引导卡 = meta.interviewGuides；modes 无 interview 时不渲染面试区块与「开始面试」按钮。
- SidePanel：modes 无 interview 时隐藏模式 Tabs 与错题本按钮。
- MessageItem：错题收藏按钮仅在 modes 含 interview 时显示（错题本是面试领域功能）。

- [ ] **Step 5: vite.config.ts 代理可配置**

`target: process.env.VITE_API_TARGET ?? 'http://localhost:8000'`。

- [ ] **Step 6: 全量验证与提交**

`npm test && npx tsc -b && npm run lint` 全绿；`git commit -m "feat: 元数据驱动的知识库适配与存储隔离"`。

---

## Task 4: mock server 与独立演示

**Files:** 创建 `mock/server.mjs`、`mock/server.test.mjs`（node:test）；修改 package.json 加 dev:mock。

- [ ] **Step 1: mock/server.mjs（TDD：先写 node:test 用例）**

Node 原生 `node:http`，零依赖，端口 8787（`MOCK_PORT` 可改）。实现规格 §5 全部端点与行为：
- 演示数据：kbId `demo`、appName「知识库问答 Demo」、tagline、modes 双模式、3 条 examples、2 条 interviewGuides（topic: `产品手册`/`技术文档`）、topics 三个各带 count。
- `/api/chat` SSE：status(retrieving) → sources（3 条，topic 过滤；未知 topic → UNKNOWN_TOPIC error）→ status(generating|fallback) → 逐字 token（`MOCK_DELAY` ms 间隔，默认 30）→ done。qa 罐头回答必须含 `[1]`、`[2]` 引用标记以便验证锚点。interview 首问出题；追问输出含「### 正确答案」「### 解析」「下一题：」小节以触发错题收录。
- `MOCK_LLM=off` → health degraded + chat 走 fallback 相位。
- `MOCK_ERROR=1` → chat 在 sources 后返回 LLM_STREAM_FAILED error 事件。
- CORS：`Access-Control-Allow-Origin: *`（dev 直连场景）。

- [ ] **Step 2: mock 测试（node:test）**

起 server 随机端口，fetch 验证：meta 字段、stats、health 两态、chat 事件序（用 Response.body 流读取）、UNKNOWN_TOPIC、MOCK_ERROR 路径。

- [ ] **Step 3: package.json**

加 `"dev:mock": "node mock/server.mjs & vite"` 的跨平台等价——用 Node 脚本 `scripts/dev-mock.mjs`（仿照 rag-project 的 dev-full.mjs 进程组管理模式， spawn mock + vite，VITE_API_TARGET=http://localhost:8787），scripts 加 `"dev:mock": "node scripts/dev-mock.mjs"` 与 `"test:mock": "node --test mock/"`。

- [ ] **Step 4: 浏览器验证**

`npm run dev:mock` 后用 browser 工具：QA 问答看到流式回答+[1] 引用可跳转；面试模式出题→作答→错题自动收录 toast→错题本可见→再考一次；MOCK_LLM=off 降级横幅；375px 移动抽屉；双主题切换刷新保持。截图存 `docs/screenshots/`（desktop-dark.webp、desktop-light.webp、mobile-375.webp、interview.webp）。

- [ ] **Step 5: 提交**

`git commit -m "feat: 零依赖 mock server 与独立演示模式"`。

---

## Task 5: 简历级文档

**Files:** 创建 `README.md`、`docs/design.md`、`docs/components.md`。

- [ ] **Step 1: README.md**（按规格 §6 结构：定位、能力表、快速开始、截图引用、架构图 mermaid、设计亮点、接入新后端指南、测试数字、License MIT）

- [ ] **Step 2: docs/design.md**（API 契约全文、SSE 状态机、请求所有权模型、降级决策树、主题 token、存储模型）

- [ ] **Step 3: docs/components.md**（组件树 + 每组件职责/props + lib 模块说明）

- [ ] **Step 4: 校对**：文档中每个命令在干净环境可执行的逻辑推演；数字与测试实际一致（npm test 实际数量）。

- [ ] **Step 5: 提交** `git commit -m "docs: 简历级 README 与设计/组件文档"`。

---

## Task 6: 端到端双后端终验

- [ ] rag-project 后端启动（含 /api/meta），`VITE_API_TARGET=http://localhost:8000 npm run dev`：确认品牌变为「面试题库问答」、示例/引导卡来自 meta、错题本与原项目 localStorage 互不干扰、真实问答与降级路径工作。
- [ ] `npm run dev:mock` 全流程复验。
- [ ] `npm test && npm run test:mock && npx tsc -b && npm run build && npm run lint` 全绿。
- [ ] `git commit -m "chore: 端到端终验"`（如有改动）。

## Self-Review 记录

- 规格 §3 契约 → Task 2；§4 泛化表 → Task 3；§5 mock → Task 4；§6 文档 → Task 5；§7 后端兼容 → Task 2 Step 2；§8 验证 → Task 4/6。
- 接口一致性：KnowledgeMeta/InterviewGuide（Task 2）→ Home/组件（Task 3）→ mock（Task 4）同名同构；storageKey(kind, kbId) 为 sessions/mistakes 共同约定。
