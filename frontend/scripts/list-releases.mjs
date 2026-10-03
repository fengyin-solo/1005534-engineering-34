#!/usr/bin/env node
/** 列出本地归档的发布版本：npm run releases，用于 rollback 时选择归档名。 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'releases')

function pointer(name) {
  const file = join(RELEASES, name)
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
}

if (!existsSync(RELEASES)) {
  console.log('尚无发布归档。先执行 npm run release。')
  process.exit(0)
}

const latest = pointer('latest')
const previous = pointer('previous')
const list = readdirSync(RELEASES)
  .filter((name) => name.startsWith('release-'))
  .filter((name) => existsSync(join(RELEASES, name, 'index.html')))
  .sort()
  .reverse()

if (list.length === 0) {
  console.log('尚无发布归档。先执行 npm run release。')
} else {
  console.log('本地发布归档（新→旧）：')
  for (const name of list) {
    const tags = []
    if (name === latest) tags.push('latest 当前')
    if (name === previous) tags.push('previous 上一版')
    console.log(`  ${name}${tags.length ? `  [${tags.join(' / ')}]` : ''}`)
  }
}
