import fs from 'node:fs/promises'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import processBookmark from './bookmark.js'

export default async function * processChapter (epubDirectory, chapter) {
  const html = await fs.readFile(path.join(epubDirectory, chapter.path))

  const jsdom = new JSDOM(html, {
    // Important to specify XHTML because HTML parser
    // would mess up with nodes indexes.
    contentType: 'application/xhtml+xml'
  })

  for (const bookmark of chapter.bookmarks) {
    yield processBookmark(jsdom.window.document, bookmark)
  }
}
