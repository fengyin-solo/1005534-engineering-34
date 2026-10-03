#!/usr/bin/env node
/**
 * 上线前卡口：依赖校验、未声明依赖扫描、绝对路径扫描、类型检查。
 * 任何一项不过：列出缺的依赖 / 出错文件，进程以非零码退出，由 release 拦截发布。
 * 纯 Node 实现，不引入任何额外依赖；所有路径均相对脚本位置解析，可在任意机器的空克隆目录运行。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')

const SCAN_DIRS = [join(ROOT, 'src')]
const SCAN_FILES = [join(ROOT, 'vite.config.ts')]
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.vue'])
const SKIP_DIRS = new Set(['node_modules', 'dist', 'releases', '.git'])

// 硬编码的本机绝对路径：换台机器克隆就会失效，卡口直接拦下。
const ABSOLUTE_PATH_PATTERNS = [
  { label: '/workspace 之类的本机绝对路径', re: /['"`](\/workspace\/|\/Users\/|\/home\/|\/root\/|\/tmp\/)[^'"`\n]*/g },
  { label: 'Windows 盘符绝对路径', re: /['"`]([A-Za-z]:\\\\)[^'"`\n]*/g },
  { label: 'file:// 绝对地址', re: /file:\/\/\/[^'"`\n]*/g },
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (SOURCE_EXT.has(name.slice(name.lastIndexOf('.')))) out.push(full)
  }
  return out
}

function collectSourceFiles() {
  const files = []
  for (const dir of SCAN_DIRS) {
    if (existsSync(dir)) files.push(...walk(dir))
  }
  for (const file of SCAN_FILES) {
    if (existsSync(file)) files.push(file)
  }
  return files
}

function parseVersion(value) {
  return String(value).split('.').map((part) => Number.parseInt(part, 10) || 0)
}

function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// 只处理本项目实际用到的 range 形态：^ ~ >= > <= = x-range * 以及空格 AND / ||。
function satisfiesOne(version, range) {
  range = range.trim().replace(/^v/, '')
  if (range === '' || range === '*' || range === 'x' || range === 'latest' || range.startsWith('workspace:')) {
    return true
  }
  return range.split('||').some((alt) => {
    const clauses = alt.trim().split(/\s+/).filter(Boolean)
    return clauses.every((clause) => {
      const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(.+)$/.exec(clause)
      if (!match) return true
      const [, op, rawVersion] = match
      if (rawVersion === '' || rawVersion === '*' || rawIdentifierIsX(rawVersion)) return true
      const versionDigits = rawVersion.replace(/\.[xX*]$/, '')
      const cmp = compareVersions(version, versionDigits)
      switch (op) {
        case '^':
          return cmp >= 0 && sameMajorRange(version, rawVersion)
        case '~':
          return cmp >= 0 && sameMinorRange(version, rawVersion)
        case '>=':
          return cmp >= 0
        case '<=':
          return cmp <= 0
        case '>':
          return cmp > 0
        case '<':
          return cmp < 0
        case '=':
        case undefined:
          return cmp === 0
        default:
          return true
      }
    })
  })
}

function rawIdentifierIsX(version) {
  return /^\d*(\.[xX*])+$/.test(version) || /^[xX*]$/.test(version)
}

function sameMajorRange(version, rangeVersion) {
  const v = parseVersion(version)
  const r = parseVersion(rangeVersion)
  return v[0] === r[0]
}

function sameMinorRange(version, rangeVersion) {
  const v = parseVersion(version)
  const r = parseVersion(rangeVersion)
  return v[0] === r[0] && v[1] === r[1]
}

function packageSpecifier(spec) {
  if (spec.startsWith('@')) {
    const parts = spec.split('/')
    return `${parts[0]}/${parts[1]}`
  }
  return spec.split('/')[0]
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function checkDependencies(pkg) {
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  const problems = []
  const installed = []
  const nodeModules = join(ROOT, 'node_modules')
  if (!existsSync(nodeModules)) {
    return { problems: ['node_modules 不存在：请先在 frontend 目录执行 npm ci（或 npm install）'], installed }
  }
  for (const [name, range] of Object.entries(declared)) {
    const manifestFile = join(nodeModules, name, 'package.json')
    if (!existsSync(manifestFile)) {
      problems.push(`缺少依赖：${name}（package.json 声明 ${range}，node_modules 中未安装）`)
      continue
    }
    const installedVersion = readJson(manifestFile).version ?? '0.0.0'
    if (!satisfiesOne(installedVersion, range)) {
      problems.push(`依赖版本不符：${name} 声明 ${range}，实际安装 ${installedVersion}`)
    } else {
      installed.push(`${name}@${installedVersion}`)
    }
  }
  return { problems, installed }
}

const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\( ?|\brequire\s*\( ?|\bexport\s+[^'"]*from\s*|^\s*import\s*)['"]([^'"]+)['"]/gm

function checkUndeclaredImports(files, pkg) {
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])
  const undeclared = new Map()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1]
      if (
        spec.startsWith('.') ||
        spec.startsWith('/') ||
        spec.startsWith('@/') ||
        spec.startsWith('node:') ||
        spec.startsWith('virtual:') ||
        spec.startsWith('~') ||
        spec.startsWith('#')
      ) {
        continue
      }
      const pkgName = packageSpecifier(spec)
      if (!declared.has(pkgName)) {
        const key = `${pkgName} <- ${spec}`
        if (!undeclared.has(key)) undeclared.set(key, new Set())
        undeclared.get(key).add(file)
      }
    }
  }
  return [...undeclared.entries()].map(([spec, paths]) => ({
    spec,
    files: [...paths].map((p) => relative(p)),
  }))
}

function checkAbsolutePaths(files) {
  const hits = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      for (const { label, re } of ABSOLUTE_PATH_PATTERNS) {
        for (const m of line.matchAll(re)) {
          hits.push({ file: relative(file), line: index + 1, label, text: m[0].slice(0, 120) })
        }
      }
    })
  }
  return hits
}

function relative(file) {
  return file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file
}

function runTypeCheck() {
  const bin = join(ROOT, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js')
  const command = existsSync(bin)
    ? process.execPath
    : 'npx'
  const args = existsSync(bin)
    ? [bin, '--noEmit', '--pretty', 'false']
    : ['vue-tsc', '--noEmit', '--pretty', 'false']
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status === 0) {
    return { failed: false, files: [], raw: '' }
  }
  // vue-tsc --pretty false 的输出形如：src/x.ts(12,7): error TS2322: ...
  const errorFiles = new Map()
  const errorLineRe = /^(.+\.[a-z]+)(?:\((\d+),(\d+)\))?:\s+error\s+(TS\d+):\s*(.*)$/gm
  for (const m of output.matchAll(errorLineRe)) {
    const [, file, line, col, code, message] = m
    if (!errorFiles.has(file)) errorFiles.set(file, [])
    errorFiles.get(file).push({ line: line ?? '?', col: col ?? '?', code, message: message.trim() })
  }
  return { failed: true, files: [...errorFiles.entries()], raw: output, missingBin: !existsSync(bin) }
}

export async function runPreflight() {
  const pkg = readJson(join(ROOT, 'package.json'))
  const files = collectSourceFiles()
  let failed = false

  console.log('== 上线前卡口开始 ==')
  console.log(`项目根目录：${ROOT}`)
  console.log(`待扫描源文件：${files.length} 个`)

  // 1. 依赖校验：缺包 / 版本不符，列出缺的依赖。
  process.stdout.write('\n[1/4] 依赖校验……\n')
  const dep = checkDependencies(pkg)
  if (dep.problems.length > 0) {
    failed = true
    console.log('  未通过：')
    for (const p of dep.problems) console.log(`   - ${p}`)
  } else {
    console.log(`  通过：已安装 ${dep.installed.length} 个声明依赖，版本均符合 package.json`)
  }

  // 2. 未声明依赖扫描：import 了但没写进 package.json，换台机器 npm ci 必挂。
  process.stdout.write('\n[2/4] 未声明依赖扫描……\n')
  const undeclared = checkUndeclaredImports(files, pkg)
  if (undeclared.length > 0) {
    failed = true
    console.log('  未通过：以下裸包导入没有登记进 package.json：')
    for (const item of undeclared) {
      console.log(`   - ${item.spec}`)
      for (const f of item.files) console.log(`       出错文件：${f}`)
    }
  } else {
    console.log('  通过：所有裸包导入均已在 package.json 中声明')
  }

  // 3. 绝对路径扫描：禁止把某台机器上的路径写死进仓库。
  process.stdout.write('\n[3/4] 绝对路径扫描……\n')
  const absoluteHits = checkAbsolutePaths(files)
  if (absoluteHits.length > 0) {
    failed = true
    console.log('  未通过：发现硬编码绝对路径（请改为相对路径或构建期配置）：')
    for (const hit of absoluteHits) {
      console.log(`   - 出错文件：${hit.file}:${hit.line}（${hit.label}）${hit.text}`)
    }
  } else {
    console.log('  通过：未发现硬编码绝对路径')
  }

  // 4. 类型检查：列出每个出错文件、行列号与错误信息。
  process.stdout.write('\n[4/4] 类型检查（vue-tsc --noEmit）……\n')
  const tc = runTypeCheck()
  if (tc.failed) {
    failed = true
    if (tc.missingBin) {
      console.log('  未通过：本地缺少 vue-tsc（devDependency 未安装），请先 npm ci')
    }
    if (tc.files.length === 0) {
      console.log('  未通过：类型检查失败，原始输出如下：')
      console.log(tc.raw.trim())
    } else {
      console.log(`  未通过：共 ${tc.files.length} 个出错文件：`)
      for (const [file, errors] of tc.files) {
        console.log(`   - 出错文件：${file}（${errors.length} 处）`)
        for (const e of errors) {
          console.log(`       ${file}(${e.line},${e.col}) ${e.code}: ${e.message}`)
        }
      }
      const cannotFindModule = [...tc.raw.matchAll(/Cannot find module '([^']+)'/g)].map((m) => m[1])
      if (cannotFindModule.length > 0) {
        console.log(`  疑似缺失依赖：${[...new Set(cannotFindModule)].join('、')}`)
      }
    }
  } else {
    console.log('  通过：类型检查无错误')
  }

  console.log('')
  if (failed) {
    console.log('== 卡口结果：未通过，发布已被拦截。请修复以上问题后重跑 npm run preflight ==')
    return false
  }
  console.log('== 卡口结果：全部通过，允许继续构建发布 ==')
  return true
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  runPreflight().then((ok) => {
    process.exitCode = ok ? 0 : 1
  })
}
