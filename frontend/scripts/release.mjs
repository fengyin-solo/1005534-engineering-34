#!/usr/bin/env node
/**
 * 发布脚本：先跑卡口（依赖校验 + 绝对路径扫描 + 类型检查），卡口不过直接退出，绝不产出发布物。
 * 卡口通过后执行生产构建，构建成功后把 dist 归档到 frontend/releases/（保留最近 5 份），
 * 作为回退旧版的途径；同时维护 latest -> 当前发布、previous -> 上一发布两个指针。
 *
 * 用法：npm run release   构建并归档，自动刷新 latest / previous 指针
 */
import { existsSync, mkdirSync, rmSync, readdirSync, renameSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { runPreflight } from './preflight.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DIST = join(ROOT, 'dist')
const RELEASES = join(ROOT, 'releases')
const KEEP_COUNT = 5

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 退出码 ${result.status ?? '未知'}`)
  }
}

function copyDir(src, dest) {
  spawnSync('cp', ['-R', src, dest], { stdio: 'inherit' })
}

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function readPointer(name) {
  const file = join(RELEASES, name)
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
}

function writePointer(name, value) {
  writeFileSync(join(RELEASES, name), `${value}\n`, 'utf8')
}

async function main() {
  // 卡口先行：任何一项不过，直接拦住发布。
  const passed = await runPreflight()
  if (!passed) {
    console.error('\n发布被卡口拦截，未执行构建。')
    process.exitCode = 1
    return
  }

  console.log('\n[release] 卡口通过，开始生产构建……')
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true })
  run('npm', ['run', 'build'])
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('构建结束但未找到 dist/index.html，疑似构建产物不完整，拒绝发布')
  }

  // 归档当前构建，给回退留路。旧的 latest 顺延为 previous。
  mkdirSync(RELEASES, { recursive: true })
  const releaseName = `release-${timestamp()}`
  copyDir(DIST, join(RELEASES, releaseName))
  const previousLatest = readPointer('latest')
  if (previousLatest && existsSync(join(RELEASES, previousLatest))) {
    writePointer('previous', previousLatest)
  }
  writePointer('latest', releaseName)

  // 只保留最近 KEEP_COUNT 份归档，指针指向的无论如何不删。
  const pinned = new Set(
    ['latest', 'previous'].map(readPointer).filter(Boolean),
  )
  const archives = readdirSync(RELEASES)
    .filter((name) => name.startsWith('release-') && existsSync(join(RELEASES, name, 'index.html')))
    .sort()
    .reverse()
  archives.slice(KEEP_COUNT).forEach((name) => {
    if (pinned.has(name)) return
    rmSync(join(RELEASES, name), { recursive: true, force: true })
    console.log(`[release] 已清理过期归档：${name}`)
  })

  const manifest = {
    release: releaseName,
    builtAt: new Date().toISOString(),
    previous: previousLatest || null,
  }
  writeFileSync(join(RELEASES, releaseName, 'RELEASE.json'), JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`\n[release] 发布完成：${releaseName}`)
  console.log('[release] 如需回退旧版：npm run rollback            （回退到上一发布）')
  console.log('[release]                   npm run rollback -- <归档名> （回退到指定发布）')
}

main().catch((error) => {
  console.error(`\n[release] 发布失败：${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
