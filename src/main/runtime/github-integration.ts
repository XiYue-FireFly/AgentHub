/**
 * GitHub Integration: PR/Issue listing and PR description generation.
 *
 * Uses gh CLI for GitHub operations. Falls back gracefully when gh is
 * not installed or not authenticated.
 */

import { execFile } from 'node:child_process'

export interface GitHubPr {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  author: string
  url: string
  branch: string
  createdAt: string
  labels: string[]
}

export interface GitHubIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  author: string
  url: string
  labels: string[]
  createdAt: string
}

/**
 * Check if gh CLI is available and authenticated.
 */
export async function checkGhCli(): Promise<{ available: boolean; authenticated: boolean; version?: string; error?: string }> {
  try {
    const version = await execGh(['--version'])
    try {
      await execGh(['auth', 'status'])
      return { available: true, authenticated: true, version: version.split('\n')[0] }
    } catch {
      return { available: true, authenticated: false, version: version.split('\n')[0], error: 'Not authenticated' }
    }
  } catch (e: any) {
    return { available: false, authenticated: false, error: e?.message || 'gh CLI not found' }
  }
}

/**
 * List PRs for the current repository.
 */
export async function listPullRequests(state: 'open' | 'closed' | 'all' = 'open', limit = 20, cwd?: string): Promise<GitHubPr[]> {
  try {
    const output = await execGh(['pr', 'list', '--state', state, '--limit', String(limit), '--json', 'number,title,state,author,url,headRefName,createdAt,labels'], cwd)
    const raw = JSON.parse(output)
    return (Array.isArray(raw) ? raw : []).map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state?.toLowerCase() === 'merged' ? 'merged' : pr.state?.toLowerCase() === 'closed' ? 'closed' : 'open',
      author: pr.author?.login || 'unknown',
      url: pr.url,
      branch: pr.headRefName || '',
      createdAt: pr.createdAt || '',
      labels: (pr.labels || []).map((l: any) => typeof l === 'string' ? l : l.name || '')
    }))
  } catch { return [] }
}

/**
 * List Issues for the current repository.
 */
export async function listIssues(state: 'open' | 'closed' | 'all' = 'open', limit = 20, cwd?: string): Promise<GitHubIssue[]> {
  try {
    const output = await execGh(['issue', 'list', '--state', state, '--limit', String(limit), '--json', 'number,title,state,author,url,labels,createdAt'], cwd)
    const raw = JSON.parse(output)
    return (Array.isArray(raw) ? raw : []).map((issue: any) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state?.toLowerCase() === 'closed' ? 'closed' : 'open',
      author: issue.author?.login || 'unknown',
      url: issue.url,
      labels: (issue.labels || []).map((l: any) => typeof l === 'string' ? l : l.name || ''),
      createdAt: issue.createdAt || ''
    }))
  } catch { return [] }
}

/**
 * Get the current branch and check for an associated PR.
 * @param cwd optional workspace root so git/gh run in the project repo (not Electron process.cwd)
 */
export async function getCurrentBranchPr(cwd?: string): Promise<{ branch: string; pr?: GitHubPr }> {
  try {
    // Use git directly instead of gh (gh doesn't have a 'git' subcommand)
    const branch = await new Promise<string>((resolve, reject) => {
      execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        timeout: 10000,
        encoding: 'utf-8',
        windowsHide: true,
        ...(cwd ? { cwd } : {})
      }, (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout.trim())
      })
    })
    try {
      const output = await execGh(['pr', 'view', '--json', 'number,title,state,author,url,headRefName,createdAt,labels'], cwd)
      const pr = JSON.parse(output)
      return {
        branch,
        pr: {
          number: pr.number,
          title: pr.title,
          state: pr.state?.toLowerCase() === 'merged' ? 'merged' : pr.state?.toLowerCase() === 'closed' ? 'closed' : 'open',
          author: pr.author?.login || 'unknown',
          url: pr.url,
          branch: pr.headRefName || branch,
          createdAt: pr.createdAt || '',
          labels: (pr.labels || []).map((l: any) => typeof l === 'string' ? l : l.name || '')
        }
      }
    } catch { return { branch } }
  } catch { return { branch: '' } }
}

function execGh(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, {
      timeout: 15000,
      encoding: 'utf-8',
      windowsHide: true,
      ...(cwd ? { cwd } : {})
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message))
      else resolve(stdout)
    })
  })
}
