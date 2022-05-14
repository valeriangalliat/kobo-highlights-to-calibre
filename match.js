/**
 * Match Kobo volumes to calibre books.
 *
 * Takes two lists, both with objects with a `title` property, and returns
 * merged objects with `kobo` and `calibre` properties.
 *
 * Currently matching is done on the title alone, because we don't have the
 * author name as metadata on the Kobo side, only possibly as part of the
 * filename (but not necessarily).
 *
 * Then rules for filename matching can be tricky because it's configurable
 * on the calibre side (defaulting as `{author_sort}/{title} - {authors}` for
 * me, and the local calibre EPUB name isn't the same as the one on the
 * Kobo side. There's somewhat complex data pulling and sorting to do from the
 * Kobo database to match paths properly and I didn't want to bother with that.
 *
 * I think the easiest to handle different books with the same name would be
 * to differentiate them on the EPUB file size.
 */
export default function matchKoboWithCalibre (volumes, books) {
  const volumesByTitle = {}

  for (const volume of volumes) {
    volumesByTitle[volume.title] ||= []
    volumesByTitle[volume.title].push(volume)
  }

  const matched = []

  for (const book of books) {
    const candidates = volumesByTitle[book.title]

    if (candidates.length === 1) {
      matched.push({ kobo: candidates[0], calibre: book })
      continue
    }

    console.error('Error: could not match book on just the title, deduplication not yet implemented')
    console.error(`Skipping: ${book.title}`)
  }

  return matched
}
