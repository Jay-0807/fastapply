import { describe, expect, it } from 'vitest';
import { classifyFileKind, decodeXmlEntities, collectTagText } from './index';

describe('classifyFileKind', () => {
  it('routes text-bearing formats to text', () => {
    for (const f of ['a.pdf', 'a.docx', 'a.pptx', 'a.xlsx', 'a.csv', 'a.md', 'a.txt', 'A.PDF']) {
      expect(classifyFileKind(f)).toBe('text');
    }
  });
  it('routes images to image', () => {
    for (const f of ['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'photo.GIF']) {
      expect(classifyFileKind(f)).toBe('image');
    }
  });
  it('marks unknown formats unsupported', () => {
    expect(classifyFileKind('a.mp4')).toBe('unsupported');
    expect(classifyFileKind('a.zip')).toBe('unsupported');
  });
});

describe('decodeXmlEntities', () => {
  it('decodes the 5 predefined entities without double-decoding amp', () => {
    expect(decodeXmlEntities('A &amp; B &lt;x&gt; &quot;q&quot; &apos;a&apos;')).toBe('A & B <x> "q" \'a\'');
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;'); // amp decoded last → stays literal, not <
  });
});

describe('collectTagText', () => {
  it('extracts inner text of every occurrence, trimmed + decoded, skipping empties', () => {
    const xml = '<a:t>Hello</a:t><a:t></a:t><a:t> AI &amp; Agent </a:t>';
    expect(collectTagText(xml, 'a:t')).toEqual(['Hello', 'AI & Agent']);
  });
  it('handles tags with attributes (xlsx <t xml:space="preserve">)', () => {
    const xml = '<t xml:space="preserve">Firefly</t><t>萤火虫</t>';
    expect(collectTagText(xml, 't')).toEqual(['Firefly', '萤火虫']);
  });
});
