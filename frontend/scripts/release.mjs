#!/usr/bin/env node
/**
 * 发布脚本：卡口不过绝不产出发布物。
 *   1) preflight（依赖校验 + 类型检查）；
 *   2) vite build 干净构建；
 *   3) 构建产物收进 releases/<时间戳版本号>/，并刷新 releases/current 指针。
 * 回退旧版：npm run rollback -- <版本号>（不传则回退上一个版本）。
 * 全部相对路径，不依赖机器环境。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const root = join(scriptsDir, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(label, args) {
  console.log(`\n========== ${label} ==========`)
  const res = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: false })
  if ((res.status ?? 1) !== 0) {
    console.error(`\n发布已停止：${label}失败。`)
    process.exit(res.status ?? 1)
  }
}

run('上线卡口（依赖校验 + 类型检查，任一不过即拦截）', ['run', 'preflight'])

// 干净构建：本地设置和构建产物必须对得上，不带着旧 dist 发
const distDir = join(root, 'dist')
if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true })
run('生产构建（vite build）', ['exec', 'vite', 'build'])
if (!existsSync(distDir)) {
  console.error('构建结束但未找到 dist 目录，发布已停止。')
  process.exit(1)
}

const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const releasesDir = join(root, 'releases')
const targetDir = join(releasesDir, version)
mkdirSync(targetDir, { recursive: true })
cpSync(distDir, targetDir, { recursive: true })

writeFileSync(
  join(targetDir, 'RELEASE.json'),
  JSON.stringify({ version, builtAt: new Date().toISOString(), source: 'vite build dist' }, null, 2),
)

// 刷新 current 指针（符号链接；不支持符号链接的环境退化为复制目录）
const currentLink = join(releasesDir, 'current')
try {
  if (existsSync(currentLink)) unlinkSync(currentLink)
  symlinkSync(version, currentLink, 'dir')
} catch {
  rmSync(currentLink, { recursive: true, force: true })
  cpSync(targetDir, currentLink, { recursive: true })
}

// 只保留最近 5 个版本，更老的随发布自然淘汰
const versions = readdirSync(releasesDir)
  .filter((name) => /^\d{14}$/.test(name))
  .sort()
  .reverse()
for (const old of versions.slice(5)) {
  rmSync(join(releasesDir, old), { recursive: true, force: true })
}

console.log(`\n发布完成：版本 ${version}`)
console.log(`发布产物：releases/${version}/（当前指针 releases/current）`)
console.log('回退旧版：npm run rollback            # 回退到上一个版本')
console.log(`         npm run rollback -- ${version}  # 回退到指定版本`)
