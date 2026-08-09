import { describe, expect, it } from 'vitest'
import { csvCell, safeHttpUrl } from './security'

describe('frontend security helpers', () => {
  it('normalizes web links and rejects active or local schemes', () => {
    expect(safeHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/')
    expect(safeHttpUrl('javascript:alert(1)')).toBe('')
    expect(safeHttpUrl('data:text/html,test')).toBe('')
  })

  it('neutralizes spreadsheet formulas while preserving CSV quoting', () => {
    expect(csvCell('=HYPERLINK("https://example.com")')).toBe('"\'=HYPERLINK(""https://example.com"")"')
    expect(csvCell('  @SUM(1,2)')).toBe('"\'  @SUM(1,2)"')
    expect(csvCell('normal "text"')).toBe('"normal ""text"""')
  })
})
