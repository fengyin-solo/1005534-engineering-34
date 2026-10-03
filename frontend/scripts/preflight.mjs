#!/usr/bin/env node
/**
 * 上线卡口：依赖校验与类型检查先跑，任何一项不过就拦住发布。
 * 两项都独立跑完，一次把「缺的依赖」和「类型出错文件」全列出来，避免挤牙膏式修一个跑一次。
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const root = join(scriptsDir, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(label, args) {
  console.log(`\n========== ${label} ==========`)
  const res = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: false })
  return res.status ?? 1
}

const depCode = run('卡口 1/2：依赖校验（缺的依赖 / 未声明引用）', ['run', 'check:deps'])
const typeCode = run('卡口 2/2：类型检查（vue-tsc --noEmit）', ['run', 'typecheck'])

const failures = []
if (depCode !== 0) failures.push('依赖校验')
if (typeCode !== 0) failures.push('类型检查')

if (failures.length > 0) {
  console.error(`\n发布已拦截：${failures.join('、')}未通过。请按上面列出的出错文件与缺失依赖修复后重跑 npm run preflight。`)
  process.exit(1)
}
console.log('\n卡口全部通过：依赖校验与类型检查均无问题，可以发布。')
