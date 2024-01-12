import CFI from 'epub-cfi-resolver'

function initContext (node) {
  const context = {
    startNode: node,
    nodes: [node],
    text: node.nodeValue
  }

  return context
}

// 3 is text and 4 CDATA, see <https://developer.mozilla.org/en-US/docs/Web/API/Node/nodeType>
const isText = node => node.nodeType === 3 || node.nodeType === 4

const getFirst = array => array[0]
const getLast = array => array[array.length - 1]
const concatLeft = (text, value) => `${value}${text}`
const concatRight = (text, value) => `${text}${value}`

function getClosestTextNode (direction, node) {
  let getFirstItem = getFirst
  let nextSiblingProp = 'nextSibling'

  if (direction === 'left') {
    getFirstItem = getLast
    nextSiblingProp = 'previousSibling'
  }

  while (node && !node[nextSiblingProp]) {
    node = node.parentNode
  }

  // Reach the root node without ever finding a next sibling, done
  if (!node) {
    return
  }

  node = node[nextSiblingProp]

  // Get the first child until we find a text node or there's no more children
  while (!isText(node) && node.childNodes.length) {
    node = getFirstItem(node.childNodes)
  }

  if (isText(node)) {
    return node
  }

  // Depeest first child was an element, look at siblings
  return getClosestTextNode(direction, node)
}

function expandSide (direction, context) {
  let concat = concatRight
  let getLastItem = getLast
  let pushProp = 'push'

  if (direction === 'left') {
    concat = concatLeft
    getLastItem = getFirst
    pushProp = 'unshift'
  }

  const node = getLastItem(context.nodes)
  const next = getClosestTextNode(direction, node)

  if (!next) {
    context[`${direction}Ended`] = true
    return
  }

  context.nodes[pushProp](next)
  context.text = concat(context.text, next.nodeValue)
}

function expandContext (context) {
  if (!context.leftEnded) {
    expandSide('left', context)
  }

  if (!context.rightEnded) {
    expandSide('right', context)
  }

  context.fullyExpanded = context.leftEnded && context.rightEnded
}

function getNodeByCfi (document, expression) {
  // Ignore offset, causes issues in some weird cases
  expression = expression.split(':')[0]

  /**
   * Kobo CFI path always starts with `/1/` which doesn't make sense because an
   * odd number means a text node and the tree can't start off a text node.
   *
   * So we need to replace it with `/2/` but we do that later because for
   * a weird reason, epub-cfi-resolver doesn't like the initial `/2/` either
   * and only works when it's stripped (despite `CFI.generate` for the matched
   * node returning a CFI starting with `/2/`)...
   */
  const cfiPath = expression.slice(2)

  const cfi = new CFI(`epubcfi(${cfiPath})`)
  const { node } = cfi.resolveLast(document)

  return node
}

/**
 * For the given Kobo CFI expression with byte-based offset, e.g.:
 *
 *     /1/4/78/1:586
 *
 * Translate it to calibre's UTF-8 string offset:
 *
 *     /2/4/78/1:584
 *
 * Also regenerates the CFI which fixes a number of issues, like text nodes
 * being in-between element nodes?
 */
function koboCfiFix (document, expression) {
  const node = getNodeByCfi(document, expression)

  if (!node) {
    return
  }

  const byteOffset = expression.split(':')[1] || 0
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

  /**
   * There's another quirk with the way calibre handles CFI - it merges all
   * sibling text nodes when counting offsets, where instead of targetting e.g.
   * `/.../3:20` they'll target `/.../1:150`. To fix this we need to add the
   * lengths of previous sibling text nodes to the offset.
   */
  let length = 0
  let prev = node.previousSibling
  let first = node
  while (prev) {
    if (prev.nodeType === 3 || prev.nodeType === 4) {
      length += node.nodeValue.length
      first = prev
    }
    prev = node.previousSibling
  }

  /**
   * More work should be done there, in some cases Kobo targets empty text
   * nodes between paragraphs instead of the beginning or end of a paragraph
   * text node and this confuses calibre.
   */
  return CFI.generate(first, length + unicodeOffset).slice('epubcfi('.length, -1)
}

/**
 * From a Kobo bookmark path:
 *
 *     text/part0013.html#point(/1/4/78/1:586)
 *
 * Return the CFI expression:
 *
 *     /2/4/78/1:586
 */
function extractCfiFromPath (path) {
  return path.split('(')[1].split(')')[0]
}

/**
 * From a context object, get the actual node and character offset
 * inside that node that corresponds to the given character index in
 * the full context text.
 */
function getNodeAndOffsetAtIndex (context, index) {
  let offset = index

  for (const node of context.nodes) {
    if (offset < node.nodeValue.length) {
      return [node, offset]
    }

    offset -= node.nodeValue.length
  }
}

/**
 * From the start CFI and the actual bookmark text, try to recompute
 * start and end CFI.
 *
 * Sometimes this is necessary because the Kobo path doesn't resolve to a node
 * where we find the actual bookmark text and then our bytes to characters
 * fix can't work.
 */
function recomputeCfi (document, bookmark) {
  const startCfi = extractCfiFromPath(bookmark.StartContainerPath)
  let node = getNodeByCfi(document, startCfi)

  if (!isText(node)) {
    node = getClosestTextNode('right', node)
  }

  const bookmarkText = bookmark.Text.trim()
  const context = initContext(node)

  while (!context.fullyExpanded && !context.text.includes(bookmarkText)) {
    expandContext(context)
  }

  const index = context.text.indexOf(bookmarkText)

  if (index < 0) {
    return []
  }

  const [startNode, startOffset] = getNodeAndOffsetAtIndex(context, index)
  const [endNode, endOffset] = getNodeAndOffsetAtIndex(context, index + bookmarkText.length - 1)

  return [
    CFI.generate(startNode, startOffset),
    CFI.generate(endNode, endOffset)
  ].map(cfi => cfi.slice('epubcfi('.length, -1))
}

/**
 * From a given content (chapter) ID, e.g.:
 *
 *     file:///mnt/onboard/path/to/book.epub#(54)OEBPS/cha42.xhtml
 *     OR
 *     file:///mnt/onboard/path/to/book.epub#(54)OEBPS/cha42.xhtml#heading_id
 *
 * Get the spine index (54) and name (`OEBPS/cha42.xhtml`).
 */
function getSpineFromContentId (id) {
  const spine = id.split('#(')[1].split('#')[0]
  const [index, name] = spine.split(')')
  return { index: Number(index), name }
}

function getTocEntryPathFromContentId (id) {
  const tocEntryPath = id.split('#(')[1].split(')')[1]
  return tocEntryPath
}

export default function processBookmark (document, bookmark) {
  const spine = getSpineFromContentId(bookmark.ContentID)

  let [start, end] = recomputeCfi(document, bookmark)
  let highlightedText = bookmark.Text

  if (!start || !end) {
    console.error(`Could not use precise highlight targeting for bookmark ${bookmark.BookmarkID}`)
    start = koboCfiFix(document, extractCfiFromPath(bookmark.StartContainerPath))
    end = koboCfiFix(document, extractCfiFromPath(bookmark.EndContainerPath))
  } else {
    // Precise targeting trims the text so reflect that
    highlightedText = highlightedText.trim()
  }

  if (!start) {
    console.error(`Could not identify start path: ${bookmark.StartContainerPath} in bookmark ${bookmark.BookmarkID}`)
    return
  }

  if (!end) {
    console.error(`Could not identify end path: ${bookmark.EndContainerPath} in bookmark ${bookmark.BookmarkID}`)
    return
  }

  return {
    timestamp: new Date(bookmark.DateCreated).valueOf() / 1000,
    annot_id: bookmark.BookmarkID,
    annot_type: 'highlight',
    annot_data: {
      highlighted_text: highlightedText,
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
    searchable_text: bookmark.Text,
    toc_entry_path: getTocEntryPathFromContentId(bookmark.ContentID)
  }
}
