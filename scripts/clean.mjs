import { rmSync } from 'node:fs'

// 只清理可重建的产物；路径相对于项目，避免受调用目录影响。
for (const directory of ['build', 'dist']) {
  rmSync(new URL(`../${directory}/`, import.meta.url), {
    recursive: true,
    force: true,
  })
}
