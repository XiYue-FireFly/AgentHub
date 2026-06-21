/**
 * Release Workspace: pre-release checklist and changelog generation.
 *
 * Aggregates version info, git log, build status, and diagnostics
 * into a release readiness report.
 */

export interface ReleaseCheck {
  id: string
  name: string
  nameZh: string
  status: 'pass' | 'fail' | 'warn' | 'skip'
  message: string
  autoFixable?: boolean
}

export interface ReleaseReport {
  version: string
  timestamp: string
  checks: ReleaseCheck[]
  summary: { pass: number; fail: number; warn: number; skip: number }
  ready: boolean
}

/**
 * Run pre-release checks.
 */
export async function runReleaseChecks(context: {
  appVersion: string
  typecheckPass: boolean
  testPass: boolean
  buildPass: boolean
  hasChangelog: boolean
  hasGitTag: boolean
  gitClean: boolean
}): Promise<ReleaseReport> {
  const checks: ReleaseCheck[] = []

  checks.push({
    id: 'version',
    name: 'Version',
    nameZh: '版本号',
    status: context.appVersion && context.appVersion !== '0.0.0' ? 'pass' : 'fail',
    message: `v${context.appVersion}`
  })

  // R7 fix: support null/undefined for "not run" status
  checks.push({
    id: 'typecheck',
    name: 'TypeScript',
    nameZh: '类型检查',
    status: context.typecheckPass === null || context.typecheckPass === undefined ? 'skip' : context.typecheckPass ? 'pass' : 'fail',
    message: context.typecheckPass === null || context.typecheckPass === undefined ? 'Not run — click to verify' : context.typecheckPass ? 'Clean' : 'Type errors found'
  })

  checks.push({
    id: 'tests',
    name: 'Tests',
    nameZh: '测试',
    status: context.testPass === null || context.testPass === undefined ? 'skip' : context.testPass ? 'pass' : 'fail',
    message: context.testPass === null || context.testPass === undefined ? 'Not run — click to verify' : context.testPass ? 'All passing' : 'Test failures detected'
  })

  checks.push({
    id: 'build',
    name: 'Build',
    nameZh: '构建',
    status: context.buildPass === null || context.buildPass === undefined ? 'skip' : context.buildPass ? 'pass' : 'fail',
    message: context.buildPass === null || context.buildPass === undefined ? 'Not run — click to verify' : context.buildPass ? 'Build succeeded' : 'Build failed'
  })

  checks.push({
    id: 'changelog',
    name: 'Changelog',
    nameZh: '变更日志',
    status: context.hasChangelog ? 'pass' : 'warn',
    message: context.hasChangelog ? 'CHANGELOG.md exists' : 'No CHANGELOG.md found'
  })

  checks.push({
    id: 'tag',
    name: 'Git Tag',
    nameZh: 'Git 标签',
    status: context.hasGitTag ? 'pass' : 'warn',
    message: context.hasGitTag ? `Tag v${context.appVersion} exists` : `No tag for v${context.appVersion}`
  })

  checks.push({
    id: 'clean-tree',
    name: 'Clean Tree',
    nameZh: '工作区干净',
    status: context.gitClean ? 'pass' : 'warn',
    message: context.gitClean ? 'No uncommitted changes' : 'Uncommitted changes detected'
  })

  const summary = {
    pass: checks.filter(c => c.status === 'pass').length,
    fail: checks.filter(c => c.status === 'fail').length,
    warn: checks.filter(c => c.status === 'warn').length,
    skip: checks.filter(c => c.status === 'skip').length
  }

  return {
    version: context.appVersion,
    timestamp: new Date().toISOString(),
    checks,
    summary,
    ready: summary.fail === 0
  }
}
