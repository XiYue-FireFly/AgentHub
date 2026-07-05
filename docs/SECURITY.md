# Security Notes

## Workspace Path Trust

Any IPC handler that accepts a `workspaceRoot`, `rootPath`, or equivalent file
system root must restrict file access to trusted roots.

Trusted roots are:

- A workspace registered in `WorkspaceManager`.
- A worktree derived from a registered workspace.
- Electron `userData` for application-owned state.
- A path explicitly selected by the user through a native file/folder picker.

Path checks must resolve the requested path and compare it with the trusted base
using normalized absolute paths. String checks such as `includes('..')` are not
sufficient and must not be used as the primary guard because they reject legal
file names while missing other trust questions.

Handlers should prefer shared guards such as `resolveWorkspaceRelativePath`,
`isPathInsideBase`, and `resolvePathWithinAllowedBases` so read, write, preview,
and image operations enforce the same boundary.

## Sensitive File Reads

Generic text preview/read helpers must deny common secret-bearing files,
including `.env`, `.npmrc`, `.netrc`, private key files, and similar credential
material, unless the feature is explicitly designed as a secrets editor with a
separate confirmation flow.
