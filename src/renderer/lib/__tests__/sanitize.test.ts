import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from '../sanitize'

describe('sanitizeHtml', () => {
  it('removes script tags', () => {
    expect(sanitizeHtml('<script>alert(1)</script>')).toBe('')
    expect(sanitizeHtml('<script src="evil.js"></script>')).toBe('')
  })

  it('removes event handlers with whitespace', () => {
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).toBe('<img src=x>')
    expect(sanitizeHtml('<div onclick="alert(1)">text</div>')).toBe('<div>text</div>')
  })

  it('removes event handlers with slash separator (img/onerror)', () => {
    expect(sanitizeHtml('<img/src=x onerror=alert(1)>')).toBe('<img/src=x>')
  })

  it('removes javascript: protocol in href', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">click</a>')).toBe('<a>click</a>')
  })

  it('removes javascript: protocol in formaction', () => {
    expect(sanitizeHtml('<button formaction="javascript:alert(1)">Click</button>')).toBe('<button>Click</button>')
  })

  it('removes javascript: protocol in xlink:href', () => {
    expect(sanitizeHtml('<svg><a xlink:href="javascript:alert(1)">click</a></svg>')).toBe('<svg><a>click</a></svg>')
  })

  it('preserves safe HTML', () => {
    const safeHtml = '<p>Hello <strong>world</strong></p>'
    expect(sanitizeHtml(safeHtml)).toBe(safeHtml)
  })

  it('preserves safe links', () => {
    const safeLink = '<a href="https://example.com">link</a>'
    expect(sanitizeHtml(safeLink)).toBe(safeLink)
  })
})
