import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * vitest 配置：把 `electron` 别名到测试 stub（test/electron-stub.ts）。
 * 主进程单测经 store.ts 间接 import electron，而 CI 上 electron 二进制偶发下载失败会导致
 * require('electron') 崩、套件加载失败。单测不需要真实 electron，故测试期用 stub 解耦、确定性通过。
 * 仅影响 import 'electron' 的文件；其余测试不受影响。test 发现规则保持 vitest 默认。
 */
export default defineConfig({
  resolve: {
    alias: {
      electron: resolve(process.cwd(), 'test/electron-stub.ts')
    }
  },
  test: {
    exclude: ['**/node_modules/**', '**/test/e2e/**', '**/.cc-switch-src/**', '**/output/**']
  }
})
