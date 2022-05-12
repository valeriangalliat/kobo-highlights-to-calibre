import path from 'node:path'
import fs from 'node:fs/promises'
import { docopt } from 'docopt'
import db from './db.js'
import matchKoboWithCalibre from './match.js'
import processBook from './book.js'

const doc = `
Usage: kobo-highlights-to-calibre [options] <kobo-volume> <calibre-library>

Options:
  --book=<name>       Process only a specific book (partial match).
  --bookmark-id=<id>  Process only a specific bookmark.
  -v, --verbose       Output more details.
  -h, --help          Show this screen.
`

function splitByVolume (bookmarks) {
  const index = {}

  for (const bookmark of bookmarks) {
    index[bookmark.VolumeID] ||= []
    index[bookmark.VolumeID].push(bookmark)
  }

  return Object.entries(index).map(([id, bookmarks]) => ({
    id,
    title: bookmarks[0].BookTitle,
    bookmarks
  }))
}

/**
 * Allows passing directly the database path instead of the Kobo or Calibre
 * directory. Useful for debugging with copies of databases.
 */
async function resolveDb (inputPath, dbPath) {
  const stat = await fs.lstat(inputPath)

  if (stat.isDirectory()) {
    return path.join(inputPath, dbPath)
  }

  return inputPath
}

const args = docopt(doc, { argv: process.argv.slice(2) })

const koboVolumePath = args['<kobo-volume>']
const calibreLibraryPath = args['<calibre-library>']
const bookmarkId = args['--bookmark-id']
const bookName = args['--book']

const queryParams = []
let filterSql = ''

if (bookmarkId) {
  filterSql = 'AND b.BookmarkID = $1'
  queryParams.push(bookmarkId)
} else if (bookName) {
  filterSql = 'AND b.VolumeID LIKE $1'
  queryParams.push(`%${bookName}%`)
}

const koboDb = db(await resolveDb(koboVolumePath, '.kobo/KoboReader.sqlite'))
const calibreDb = db(await resolveDb(calibreLibraryPath, 'metadata.db'))

/**
  * Get all bookmarks from the Kobo database including the content
  * details and book title.
  *
  * * `BookmarkID`: we use it as annotation ID on the Calibre side
  *                 to easily deduplicate the annotations we create.
  * * `VolumeID`: ID of the book (volume).
  * * `ContentID`: content ID of the chapter the bookmark is in.
  * * `StartContainerPath`: EPUB CFI path of the highlight start,
  *                         see <http://idpf.org/epub/linking/cfi/>.
  * * `EndContainerPath`: EPUB CFI path of the highlight end.
  * * `Text`: the highlighted text.
  * * `Annotation`: Custom annotation? Not currently used, not even sure how
  *                 to annotate highlights on Kobo!
  * * `DateCreated`: Date and time of the annotation.
  * * `BookTitle`: Title of the book, used to match with Calibre books.
  * * `Title`: Title of the chapter, used in the Calibre annotation.
  */
const bookmarks = await koboDb.all(`
  SELECT b.BookmarkID,
         b.VolumeID,
         b.ContentID,
         b.StartContainerPath,
         b.EndContainerPath,
         b.Text,
         b.Annotation,
         b.DateCreated,
         c.BookTitle,
         c.Title
    FROM Bookmark AS b
    JOIN Content AS c
      ON c.ContentID = b.ContentID
   WHERE b.type = 'highlight'
         ${filterSql}
`, queryParams)

const volumes = splitByVolume(bookmarks)

// Find matching books on Calibre by title
const books = await calibreDb.all(`
  SELECT id, title, path
    FROM books
   WHERE title IN (${volumes.map(() => '?')})
`, volumes.map(v => v.title))

const matched = matchKoboWithCalibre(volumes, books)

for (const { kobo, calibre } of matched) {
  console.log(`Fetching highlights for: ${kobo.title}`)

  let inserted = 0
  let updated = 0
  let unchanged = 0

  for await (const annotation of await processBook(calibreLibraryPath, kobo, calibre)) {
    const existing = await calibreDb.get('SELECT annot_data, searchable_text FROM annotations WHERE annot_id = $1', [annotation.annot_id])

    if (existing) {
      /**
       * Unformat JSON because Calibre sometimes reformats JSON without
       * otherwise changing its data.
       */
      if (JSON.stringify(JSON.parse(existing.annot_data)) === annotation.annot_data && existing.searchable_text === annotation.searchable_text) {
        unchanged += 1
        continue
      }

      if (args['--verbose']) {
        console.error('BEFORE: ', existing)
        console.error('AFTER: ', { annot_data: annotation.annot_data, searchable_text: annotation.searchable_text })
      }

      await calibreDb.run(
        'UPDATE annotations SET annot_data = $1, searchable_text = $2 WHERE annot_id = $3',
        [annotation.annot_data, annotation.searchable_text, annotation.annot_id]
      )

      updated += 1
      continue
    }

    await calibreDb.run(`
      INSERT INTO annotations (book, format, user_type, user, timestamp, annot_id, annot_type, annot_data, searchable_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      annotation.book,
      annotation.format,
      annotation.user_type,
      annotation.user,
      annotation.timestamp,
      annotation.annot_id,
      annotation.annot_type,
      annotation.annot_data,
      annotation.searchable_text
    ])

    inserted += 1
  }

  console.log(`Inserted ${inserted}`)
  console.log(`Updated ${updated}`)
  console.log(`Unchanged ${unchanged}`)
}
