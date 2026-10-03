/**
 * 运行业务规则验证：esbuild 随 vite 一并安装，这里用它把 verify-rules.mts
 * （含 @ 路径别名与 TS 语法）打包成临时 ESM 后执行。
 * 用法：npm run verify:rules
 */
import { build } from 'esbuild'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

const root = dirname(fileURLToPath(import.meta.url))
const outfile = join(root, '.verify-bundle.mjs')

try {
  await build({
    entryPoints: [join(root, 'verify-rules.mts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    alias: { '@': join(root, '..', 'src') },
    logLevel: 'silent',
  })
  await import(pathToFileURL(outfile).href)
} finally {
  rmSync(outfile, { force: true })
}
