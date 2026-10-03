# 制药企业洁净区与批生产记录管理平台

面向洁净区环境监测、批生产记录编录、物料放行、偏差与变更控制、灭菌与清洁验证、成品检验与年度质量回顾的一体化药品生产质量管理工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 上线卡口（不过不发布）

发布前必须先过卡口，任何一项不过都会拦住发布，并列出**出错文件**与**缺的依赖**：

```bash
cd frontend
npm run preflight      # 或在仓库根目录 make preflight
```

卡口依次执行：

1. **依赖校验**：`package.json` 声明的依赖必须已安装、版本符合 range，缺包/版本不符直接列出（如 `缺少依赖：pinia（…）`）。
2. **未声明依赖扫描**：源码里 import 的裸包必须登记进 `package.json`，否则换台机器 `npm ci` 装不上；命中时列出包名与出错文件。
3. **绝对路径扫描**：源码（`src/**` 与 `vite.config.ts`）里禁止出现 `/workspace/...`、`/Users/...`、Windows 盘符、`file:///` 等本机绝对路径，命中时列出文件与行号。
4. **类型检查**：`vue-tsc --noEmit`，按文件列出 `file(line,col) TSxxxx: 信息`，并从输出里汇总疑似缺失依赖。

### 发布与回退旧版

```bash
npm run release        # 卡口通过 -> 生产构建 -> 归档到 frontend/releases/（保留最近 5 份）
npm run releases       # 查看归档与 latest / previous 指针
npm run rollback       # 回退到上一发布（旧版途径）
npm run rollback -- release-YYYYMMDD-HHMMSS   # 回退到指定归档
```

`npm run release` 卡口不过时**不会执行构建**；构建成功后把 `dist/` 归档，并维护
`releases/latest`（当前）与 `releases/previous`（上一版）两个指针，回退时交换指针，
随时可再切回。归档目录已被 `.gitignore` 忽略，不进版本库。

### 换台机器克隆到空目录

仓库提交了 `package-lock.json`，新机器空目录里严格按 lockfile 安装，一次过：

```bash
git clone <repo> <空目录>
cd <空目录>/frontend
npm ci
npm run preflight      # 卡口通过
npm run build          # 构建通过
```

Docker 镜像同样基于 `npm ci` + lockfile（见 `frontend/Dockerfile`）。

### 业务规则自验

```bash
npm run verify:rules
```

用内存数据装载「上线前旧记录」跑一遍规则断言（存量迁移回填、越级拒收、审批签署、
按产品汇总、导出去重、供应商台账同步），共 29 项。

## 年度质量回顾业务规则

- **状态顺着推进，越级拒收**：`待回顾 → 回顾中 → 已批准`，`回顾中` 可 `退回修改 → 已退回`，
  已退回只能重新提交到回顾中，已批准为终态。越级动作（如待回顾直接批准）直接拒收并提示正确顺序；
  页面只展示当前状态可执行的动作。
- **回顾结论经审批人签署**：批准时校验回顾年度有效、涉及产品在册、回顾结论已填写、
  汇总口径与台账一致，并写入审批人（取会话中的审批人身份）与批准日期；任一条不满足都拒签。
- **按产品汇总**：涉及产品按产品主数据（`src/data/products.ts`）归一，多个产品逐行汇总；
  批次数取自批生产记录，**偏差总数由质量部统计**（偏差台账中非「待处理」草稿、年度匹配的条数）。
- **涉及产品同一套**：批生产记录、年度回顾等多处取到的产品名按主数据/别名归一；
  **超出在册范围的产品一律按「无效值」**，无效产品行高亮，且不允许批准。
- **导出去重**：单份导出按「回顾编号 + 内容指纹」登记台账，**同一份回顾重复导出只算一次**
  （重复导出仍给文件，台账只记首次并累加下载次数），页面底部展示去重台账。
- **供应商审计台账**：年度回顾每次状态流转及应用启动迁移后，都按回顾编号 upsert
  同步到供应商审计页的「年度回顾同步台账」。
- **存量迁移**：localStorage 数据带结构版本号（`pharma-cleanroom:schema-version`），
  启动时对旧版数据执行迁移——按旧批生产记录回填批次数、按旧偏差台账回填质量部口径的偏差总数、
  归一产品名（超范围按无效值）、回填项标注「存量迁移回填 / 质量部」。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 批生产记录 | `batchrecord` | 批生产记录 | 批号、产品名称、生产工序 |
| 洁净区环境监测 | `cleanroom` | 环境监测记录 | 监测点位、洁净级别、悬浮粒子数 |
| 物料放行 | `materialrelease` | 物料放行单 | 物料批号、物料名称、供应商 |
| 偏差处理 | `deviation` | 偏差记录 | 偏差编号、偏差类型、发生工序 |
| 变更控制 | `changecontrol` | 变更申请 | 变更编号、变更类别、涉及工序 |
| 清洁验证 | `cleanvalidate` | 清洁验证记录 | 验证编号、设备名称、清洁规程 |
| 灭菌验证 | `sterilize` | 灭菌验证记录 | 验证编号、灭菌设备、灭菌程序 |
| 培养基模拟灌装 | `mediafill` | 模拟灌装记录 | 灌装编号、灌装规格、灌装批量 |
| 工艺用水监测 | `watermonitor` | 水质监测记录 | 取样点、水系统类别、电导率 |
| 更衣确认 | `gowning` | 更衣确认记录 | 确认编号、洁净级别、更衣步骤 |
| 成品检验 | `finishedqc` | 成品检验报告 | 检验编号、产品批号、检验项目 |
| 留样管理 | `retainsample` | 留样记录 | 留样编号、对应批号、留样数量 |
| 稳定性考察 | `stability` | 稳定性考察记录 | 考察编号、考察批号、考察条件 |
| 产品召回 | `recall` | 召回记录 | 召回编号、涉及批号、召回级别 |
| 供应商审计 | `supplieraudit` | 供应商审计记录 | 审计编号、供应商名称、物料类别 |
| 人员培训 | `training` | 培训记录 | 培训编号、培训主题、受训岗位 |
| 年度质量回顾 | `annualreview` | 年度回顾报告 | 回顾编号、回顾年度、涉及产品 |
| 质量投诉 | `complaint` | 投诉记录 | 投诉编号、投诉来源、涉及产品 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `pharma-cleanroom:entries` 这一项，或调用 `resetModule(模块)`。
