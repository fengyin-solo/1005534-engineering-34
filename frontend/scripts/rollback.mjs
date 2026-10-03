#!/usr/bin/env node
/**
 * 回退旧版：把 releases/ 里归档的旧构建拷回 dist/。
 *   npm run rollback              回退到上一次发布（previous 指针；没有则回退到倒数第二份归档）
 *   npm run rollback -- <归档名>   回退到指定归档（可用 npm run releases 查看清单）
 * 回退只替换构建产物，不动源码与依赖，回退后 dist 与当时的发布完全一致。
 */
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DIST = join(ROOT, 'dist')
const RELEASES = join(ROOT, 'releases')

function readPointer(name) {
  const file = join(RELEASES, name)
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
}

function writePointer(name, value) {
  writeFileSync(join(RELEASES, name), `${value}\n`, 'utf8')
}

function archives() {
  if (!existsSync(RELEASES)) return []
  return readdirSync(RELEASES)
    .filter((name) => name.startsWith('release-'))
    .filter((name) => existsSync(join(RELEASES, name, 'index.html')))
    .sort()
    .reverse()
}

function resolveTarget() {
  const wanted = process.argv[2]
  if (wanted) {
    const dir = join(RELEASES, wanted)
    if (!existsSync(join(dir, 'index.html'))) {
      throw new Error(`找不到归档 ${wanted}（releases/ 下没有对应有效构建）`)
    }
    return wanted
  }
  const previous = readPointer('previous')
  if (previous && existsSync(join(RELEASES, previous, 'index.html'))) {
    return previous
  }
  // 没有 previous 指针时，取倒数第二份（最新一份即当前版本）。
  const list = archives()
  if (list.length < 2) {
    throw new Error('没有可回退的旧版归档（至少需要 releases/ 下保留两份发布）')
  }
  return list[1]
}

function main() {
  const target = resolveTarget()
  console.log(`[rollback] 准备回退到：${target}`)

  const current = readPointer('latest')
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true })
  mkdirSync(DIST, { recursive: true })
  const copy = spawnSync('cp', ['-R', join(RELEASES, target) + '/.', DIST], { stdio: 'inherit' })
  if (copy.status !== 0) {
    throw new Error('归档拷贝失败，请检查 releases 目录权限')
  }

  // 交换指针：回退的目标成为 latest，被回退的版本留作 previous，随时可以再切回去。
  if (current) writePointer('previous', current)
  writePointer('latest', target)
  rmSync(join(DIST, 'RELEASE.json'), { force: true })

  console.log(`[rollback] 已回退：dist/ 现为 ${target} 的构建产物`)
  if (current) console.log(`[rollback] 如需再切回，执行：npm run rollback -- ${current}`)
}

try {
  main()
} catch (error) {
  console.error(`\n[rollback] 回退失败：${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
