import CFI from 'epub-cfi-resolver'

/**
 * For the given Kobo CFI expression with byte-based offset, e.g.:
 *
 *     /1/4/78/1:586
 *
 * Translate it to Calibre's UTF-8 string offset:
 *
 *     /2/4/78/1:584
 */
function translateCfi (document, expression, __bookmark) {
  const [koboPath, byteOffset = 0] = expression.split(':')

  /**
   * Kobo CFI path always starts with `/1/` which doesn't make sense because an
   * odd number means a text node and the tree can't start off a text node.
   *
   * So we need to replace it with `/2/` but we do that later because for
   * a weird reason, epub-cfi-resolver doesn't like the initial `/2/` either
   * and only works when it's stripped (despite `CFI.generate` for the matched
   * node returning a CFI starting with `/2/`)...
   */
  // const cfiPath = koboPath.replace('/1/', '/2/')
  const cfiPath = koboPath.slice(2)

  const cfi = new CFI(`epubcfi(${cfiPath}:${byteOffset})`)
  const { node } = cfi.resolveLast(document)

  if (!node) {
    return
  }

  const text = node.textContent

  /**
   * We need to do this because Kobo offsets are in bytes whereas every other
   * CFI parser expects the offsets in characters (where a character can be
   * multibyte).
   *
   * This is not bulletproof, because it doesn't take into account the fact
   * that adjacent text and CDADA nodes should be merged together.
   */
  const unicodeOffset = Buffer.from(text).slice(0, byteOffset).toString().length

  const translated = `/2${cfiPath}:${unicodeOffset}`

  /**
   * More work should be done there, in some cases Kobo targets empty text
   * nodes between paragraphs instead of the beginning or end of a paragraph
   * text node and this confuses Calibre.
   *
   * There's other weird quirks with the way Calibre handles CFI that I can't
   * make sense of, where instead of targetting e.g. `/.../3:20` they'll target
   * `/.../1:150`. I have no idea how to fix this.
   */
  return translated
}

/**
 * From a Kobo bookmark path:
 *
 *     text/part0013.html#point(/1/4/78/1:586)
 *
 * Get the translated Calibre-compatible CFI expression, e.g.:
 *
 *     /2/4/78/1:584
 */
function translatePathToCfi (document, path, __isFirst) {
  const expression = path.split('(')[1].split(')')[0]

  return translateCfi(document, expression, __isFirst)
}

/**
 * From a given content (chapter) ID, e.g.:
 *
 *     file:///mnt/onboard/path/to/book.epub#(54)OEBPS/cha42.xhtml
 *
 * Get the spine index (54) and name (`OEBPS/cha42.xhtml`).
 */
function getSpineFromContentId (id) {
  const spine = id.split('#(')[1]
  const [index, name] = spine.split(')')
  return { index: Number(index), name }
}

export default function processBookmark (document, bookmark) {
  const spine = getSpineFromContentId(bookmark.ContentID)
  const start = translatePathToCfi(document, bookmark.StartContainerPath, bookmark)
  const end = translatePathToCfi(document, bookmark.EndContainerPath)

  return {
    timestamp: new Date(bookmark.DateCreated).valueOf() / 1000,
    annot_id: bookmark.BookmarkID,
    annot_type: 'highlight',
    annot_data: {
      highlighted_text: bookmark.Text,
      spine_index: spine.index,
      spine_name: spine.name,
      start_cfi: start,
      end_cfi: end,
      style: {
        kind: 'color',
        type: 'builtin',
        which: 'green'
        // which: 'yellow'
      },
      timestamp: bookmark.DateCreated + 'Z',
      type: 'highlight',
      uuid: bookmark.BookmarkID
    },
    searchable_text: bookmark.Text
  }
}
