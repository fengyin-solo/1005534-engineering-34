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

## 上线卡口（不过不发）

发布前先跑卡口，**依赖校验**和**类型检查**任意一项不过就拦住发布：

- `npm run check:deps`：核对 `package.json` 声明的依赖是否都已安装、版本是否对齐；
  扫描 `src/` 与构建配置里的外部 import，把「引用了但没声明」的依赖按**出错文件**逐个列出
  （这类问题换台机器 `npm ci` 后必炸）。
- `npm run typecheck`：`vue-tsc --noEmit`，类型错误连同出错文件与行号列出。
- `npm run preflight`：上面两项一起跑，两项都独立跑完、一次列全所有问题；任一不过非零退出。

发布与回退（产物只使用仓库内相对路径，不写绝对路径）：

```bash
npm run release     # 先过 preflight，再干净构建，产物收进 releases/<时间戳版本号>/
npm run rollback            # 回退到上一个发布版本
npm run rollback -- list    # 查看可回退的版本
npm run rollback -- 20261003120000   # 回退到指定版本
```

`releases/current` 指向当前版本，回退时把指针和 `dist/` 一起切到旧版，重新部署该目录即可。
`frontend/releases/` 不入库（见 `.gitignore`）。Docker 镜像在构建阶段同样执行
`npm run preflight && npm run build`，卡口不过镜像直接构建失败。

换机验证标准：克隆到空目录 → `npm install`（或有 lockfile 时 `npm ci`）→ `npm run build`，
必须一次通过。

## 年度质量回顾业务规则

- **逐级状态机**：`待回顾 → 回顾中 → 已批准`，被退回时 `回顾中 → 已退回 → 回顾中`。
  越级、逆序的动作一律拒收（页面不给出入口，服务层也会拦）。
- **审批人签署**：批准前必须由审批人完成「签署回顾结论」（审批人 + 结论都不能为空），
  已批准后结论、偏差总数不可再改。
- **偏差总数由质量部统计**：「质量部统计偏差」动作按「涉及产品」从偏差台账计数回填，
  页面提供「按涉及产品汇总」（报告数、批次合计、偏差总数、已批准数）。
- **同一份回顾重复导出只算一次**：首次导出全量计数，之后重复导出跳过已导出的回顾，
  只计新增部分，并在页脚提示新导出/跳过数量。
- **状态同步到供应商审计台账**：年度回顾每次状态或签署字段变化，都以回顾编号为唯一键
  全量同步到供应商审计页面的「年度回顾同步台账」。
- **涉及产品同一套取数口径**：所有模块的涉及产品都以 `src/data/products.ts` 的产品目录为准；
  任何超出目录范围的值一律按「无效产品」处理（页面标红、不能批准、不参与偏差统计、
  台账同步保留并标红）。
- **存量数据迁移**：浏览器里的旧 `localStorage` 数据按结构版本号（当前 v2）迁移，
  回填缺失的涉及产品/回顾年度/批次数/偏差总数，旧占位的审批人与结论留空（不伪造签名），
  迁移幂等且只执行一次；代码见 `src/data/migrate.ts`。

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
