import fs from 'node:fs/promises'
import path from 'node:path'
import Zip from 'adm-zip'
import getToc from './toc.js'
import processChapter from './chapter.js'

async function findEpub (bookDirectory) {
  const files = await fs.readdir(bookDirectory)

  return path.join(
    bookDirectory,
    files.find(file => file.endsWith('.epub'))
  )
}

function groupBookmarksByChapter (bookmarks) {
  const bookmarksByChapter = {}

  for (const bookmark of bookmarks) {
    bookmarksByChapter[bookmark.ContentID] ||= []
    bookmarksByChapter[bookmark.ContentID].push(bookmark)
  }

  return Object.entries(bookmarksByChapter).map(([id, bookmarks]) => ({
    id,
    title: bookmarks[0].Title,
    path: bookmarks[0].StartContainerPath.split('#')[0],
    bookmarks
  }))
}

export default async function * processBook (calibreLibraryPath, koboVolume, calibreBook) {
  const epubPath = await findEpub(path.join(calibreLibraryPath, calibreBook.path))

  if (!epubPath) {
    console.error(`Could not find book EPUB file for: ${calibreBook.title}`)
    return
  }

  const zip = new Zip(epubPath)

  const toc = await getToc(zip)

  const chapters = groupBookmarksByChapter(koboVolume.bookmarks)

  for (const chapter of chapters) {
    for await (const annotation of processChapter(zip, chapter)) {
      const tree = []
      let nav = toc[chapter.path]

      while (nav) {
        tree.unshift(nav.title)
        nav = nav.parent
      }

      yield {
        book: calibreBook.id,
        format: 'EPUB',
        user_type: 'local',
        user: 'viewer',
        ...annotation,
        annot_data: JSON.stringify({
          ...annotation.annot_data,
          toc_family_titles: tree
        })
      }
    }
  }
}
