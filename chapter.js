import { JSDOM } from 'jsdom'
import processBookmark from './bookmark.js'

export default async function * processChapter (zip, chapter) {
  const html = zip.readFile(chapter.path)

  const jsdom = new JSDOM(html, {
    // Important to specify XHTML because HTML parser
    // would mess up with nodes indexes.
    contentType: 'application/xhtml+xml'
  })

  for (const bookmark of chapter.bookmarks) {
    const annotation = processBookmark(jsdom.window.document, bookmark)

    if (annotation) {
      yield annotation
    }
  }
}
