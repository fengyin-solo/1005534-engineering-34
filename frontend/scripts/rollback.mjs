#!/usr/bin/env node
/**
 * 回退旧版入口：
 *   npm run rollback                回退到上一个发布版本
 *   npm run rollback -- 20261003120000   回退到指定版本
 *   npm run rollback -- list        列出可回退的版本
 * 回退只动 releases/current 指针和 dist，不重新构建，保证退回去的就是当时发布的产物。
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const root = join(scriptsDir, '..')
const releasesDir = join(root, 'releases')
const arg = process.argv[2]

function versions() {
  if (!existsSync(releasesDir)) return []
  return readdirSync(releasesDir)
    .filter((name) => /^\d{14}$/.test(name))
    .sort()
    .reverse()
}

function currentVersion() {
  const link = join(releasesDir, 'current')
  if (!existsSync(link)) return null
  try {
    if (lstatSync(link).isSymbolicLink()) {
      return readFileSync(link, 'utf8').trim()
    }
  } catch {
    // 退化环境下 current 是复制目录，读 RELEASE.json
  }
  const meta = join(link, 'RELEASE.json')
  if (existsSync(meta)) {
    return JSON.parse(readFileSync(meta, 'utf8')).version
  }
  return null
}

const all = versions()
if (arg === 'list' || (arg && arg !== 'list' && !all.includes(arg))) {
  if (all.length === 0) {
    console.log('还没有任何发布版本（releases/ 为空），无法回退。')
    process.exit(arg === 'list' ? 0 : 1)
  }
  if (arg && arg !== 'list') {
    console.error(`版本 ${arg} 不存在。可回退版本：`)
  } else {
    console.log('可回退的发布版本（最新在前）：')
  }
  const cur = currentVersion()
  for (const v of all) console.log(`  ${v}${v === cur ? '  ← 当前' : ''}`)
  process.exit(arg === 'list' ? 0 : 1)
}

if (all.length === 0) {
  console.error('还没有任何发布版本，无法回退。请先执行 npm run release。')
  process.exit(1)
}

const cur = currentVersion()
const target = arg || (all.find((v) => v !== cur) ?? all[0])
if (!existsSync(join(releasesDir, target))) {
  console.error(`回退目标版本 ${target} 的发布产物已不存在。`)
  process.exit(1)
}

// dist 同步回退版本：本地构建产物与发布指针保持一致
const distDir = join(root, 'dist')
rmSync(distDir, { recursive: true, force: true })
cpSync(join(releasesDir, target), distDir, { recursive: true })

const currentLink = join(releasesDir, 'current')
try {
  unlinkSync(currentLink)
} catch {
  rmSync(currentLink, { recursive: true, force: true })
}
try {
  symlinkSync(target, currentLink, 'dir')
} catch {
  // 不支持符号链接的环境退化为复制目录
  mkdirSync(currentLink, { recursive: true })
  cpSync(join(releasesDir, target), currentLink, { recursive: true })
}

console.log(`已回退到旧版：${target}`)
console.log(`发布产物在 releases/${target}/，dist/ 已同步为该版本；重新部署该目录即可完成回退。`)
