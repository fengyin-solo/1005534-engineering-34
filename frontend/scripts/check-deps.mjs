#!/usr/bin/env node
/**
 * 上线卡口之一：依赖校验。
 * 1) package.json 里声明的依赖没装（node_modules 缺包 / 装的版本不在声明范围内）——逐个列清；
 * 2) 源码里 import 了外部包，却没在 package.json 里声明（换台机器 npm ci 后必炸）——按文件列出。
 * 任何一项不过：非零退出，拦住发布。全部使用相对仓库根的路径，不写绝对路径。
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }

// 扫描范围：src 下源码 + 根目录构建配置。目录相对仓库根，换任何机器都成立。
const SOURCE_DIRS = ['src']
const CONFIG_FILES = ['vite.config.ts']
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.vue'])

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      out.push(...walk(full))
    } else if (CODE_EXT.has(name.slice(name.lastIndexOf('.')))) {
      out.push(full)
    }
  }
  return out
}

const files = [
  ...SOURCE_DIRS.flatMap((d) => walk(join(root, d))),
  ...CONFIG_FILES.map((f) => join(root, f)).filter(existsSync),
]

// 从 import 语句里取出外部包名（支持 bare import、子路径 import、动态 import、export-from）
const IMPORT_RE =
  /(?:import\s+[^'"]*?\s+from\s*|import\s*|export\s+[^'"]*?\s+from\s*)['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function externalSpecifier(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('node:')) {
    return null
  }
  // @scope/name 或 name，去掉子路径
  if (spec.startsWith('@')) {
    const parts = spec.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
  }
  return spec.split('/')[0]
}

const problemsMissing = [] // 声明了但没装/版本不符
const problemsUndeclared = [] // 用了但没声明，按文件列
const undeclaredSeen = new Set()

// 1) 校验声明依赖是否已安装且版本满足声明范围
// 通过包入口解析安装位置，再沿目录向上找 package.json：
// 现代包普遍用 exports 屏蔽 ./package.json 子路径，不能直接 require.resolve('x/package.json')。
function resolveInstalledMeta(name) {
  // @types/* 这类纯类型包没有 JS 入口，直接按 node_modules 目录读 package.json
  const scopedDir = name.startsWith('@') ? join(root, 'node_modules', name) : null
  if (scopedDir && existsSync(join(scopedDir, 'package.json'))) {
    return {
      path: join(scopedDir, 'package.json'),
      pkg: JSON.parse(readFileSync(join(scopedDir, 'package.json'), 'utf8')),
    }
  }
  let entry
  try {
    entry = require.resolve(name)
  } catch {
    return null
  }
  let dir = dirname(entry)
  for (let depth = 0; depth < 8; depth++) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      try {
        return { path: manifest, pkg: JSON.parse(readFileSync(manifest, 'utf8')) }
      } catch {
        return null
      }
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

for (const [name, range] of Object.entries(deps)) {
  const installed = resolveInstalledMeta(name)
  if (!installed) {
    problemsMissing.push(`缺失依赖：${name}@${range}（package.json 已声明，但 node_modules 里没装；换机器请先 npm install）`)
    continue
  }
  const installedPkg = installed.pkg
  const cleanRange = String(range).replace(/^[\^~>=<\s]*/, '')
  if (range.startsWith('workspace:') || range.includes('*') || range === 'latest') {
    continue
  }
  // ^/~ 范围内只比对主版本.次版本，避免再引第三方 semver（本脚本自身也要过依赖校验）
  const [instMajor, instMinor] = installedPkg.version.split('.').map(Number)
  const [declMajor, declMinor] = cleanRange.split('.').map(Number)
  const rangeStart = String(range).trimStart()
  if (rangeStart.startsWith('^')) {
    if (instMajor !== declMajor) {
      problemsMissing.push(
        `版本不符：${name} 声明 ${range}，实际安装 ${installedPkg.version}（请重新 npm install 对齐依赖）`,
      )
    }
  } else if (rangeStart.startsWith('~')) {
    if (instMajor !== declMajor || instMinor !== declMinor) {
      problemsMissing.push(
        `版本不符：${name} 声明 ${range}，实际安装 ${installedPkg.version}（请重新 npm install 对齐依赖）`,
      )
    }
  } else if (instMajor !== declMajor || instMinor !== declMinor) {
    problemsMissing.push(
      `版本不符：${name} 声明 ${range}，实际安装 ${installedPkg.version}（请重新 npm install 对齐依赖）`,
    )
  }
}

// 2) 扫描源码外部 import 是否都已声明
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  let match
  IMPORT_RE.lastIndex = 0
  while ((match = IMPORT_RE.exec(text)) !== null) {
    const spec = match[1] ?? match[2]
    if (!spec) continue
    const name = externalSpecifier(spec)
    if (!name) continue
    if (deps[name]) continue
    const rel = relative(root, file).split('\\').join('/')
    const key = `${rel}::${name}::${spec}`
    if (undeclaredSeen.has(key)) continue
    undeclaredSeen.add(key)
    problemsUndeclared.push(`出错文件 ${rel}：引用了未声明依赖「${spec}」（package.json 里没有 ${name}，换机器构建会直接失败）`)
  }
}

let failed = false
if (problemsMissing.length > 0) {
  failed = true
  console.error('── 缺失 / 版本不符的依赖（' + problemsMissing.length + ' 项）──')
  for (const line of problemsMissing) console.error('  ' + line)
  console.error('')
}
if (problemsUndeclared.length > 0) {
  failed = true
  console.error('── 源码引用但未声明的依赖（' + problemsUndeclared.length + ' 处）──')
  for (const line of problemsUndeclared) console.error('  ' + line)
  console.error('')
}

if (failed) {
  console.error('依赖校验不通过，发布已拦截。修复后重新执行 npm run preflight。')
  process.exit(1)
}
console.log(`依赖校验通过：${Object.keys(deps).length} 个声明依赖均已安装，扫描 ${files.length} 个源码/配置文件未发现未声明引用。`)
