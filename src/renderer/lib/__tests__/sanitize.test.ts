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

  it('neutralizes CSS expression() in inline style', () => {
    expect(sanitizeHtml('<div style="width:expression(alert(1))">x</div>')).toBe('<div style="width:">x</div>')
  })

  it('neutralizes CSS @import in inline style', () => {
    expect(sanitizeHtml('<div style="@import url(evil.css)">x</div>')).toBe('<div style="">x</div>')
  })

  it('neutralizes CSS url(javascript:) in inline style', () => {
    expect(sanitizeHtml('<div style="background:url(javascript:alert(1))">x</div>')).toBe('<div style="background:">x</div>')
  })

  it('neutralizes CSS expression with nested parens (1 level)', () => {
    expect(sanitizeHtml('<div style="x:expression(alert(1))">x</div>')).toBe('<div style="x:">x</div>')
  })

  it('neutralizes deeply nested url/expression in style attributes', () => {
    const html = '<div style="background:url(a(b(c(javascript:alert(1)))))">x</div>'
    const out = sanitizeHtml(html)
    expect(out.toLowerCase()).not.toContain('javascript')
    expect(out.toLowerCase()).not.toContain('expression(')
  })

  it('preserves safe inline styles', () => {
    expect(sanitizeHtml('<div style="color:red;font-size:12px">x</div>')).toBe('<div style="color:red;font-size:12px">x</div>')
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
