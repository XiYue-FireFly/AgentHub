/**
 * MCP Server Entry Point - 独立构建入口
 *
 * 可独立运行，无 Electron 依赖
 * 通过 stdio 与 ACP 子进程通信
 */

import { createMcpServer } from './server'

// 环境变量获取工作目录
const cwd = process.env.AGENTHUB_MCP_CWD || process.cwd()

// 创建并启动 MCP 服务器
const server = createMcpServer({ cwd })

// 处理 stdin/stdout 通信
process.stdin.setEncoding('utf-8')
process.stdout.setEncoding('utf-8')

let buffer = ''

process.stdin.on('data', async (chunk: string) => {
  buffer += chunk

  // 处理完整的 JSON-RPC 消息
  const lines = buffer.split('\n')
  buffer = lines.pop() || ''

  for (const line of lines) {
    if (!line.trim()) continue

    try {
      const request = JSON.parse(line)
      const response = await server.handleRequest(request)
      process.stdout.write(JSON.stringify(response) + '\n')
    } catch (error: any) {
      const errorResponse = {
        jsonrpc: '2.0',
        error: {
          code: -32700,
          message: 'Parse error',
          data: error.message
        },
        id: null
      }
      process.stdout.write(JSON.stringify(errorResponse) + '\n')
    }
  }
})

process.stdin.on('end', () => {
  process.exit(0)
})

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
  process.exit(1)
})
