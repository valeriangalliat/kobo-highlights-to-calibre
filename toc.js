import { JSDOM } from 'jsdom'

function recurseTree (nav, prefix = '', parent = null, tree = {}) {
  for (const child of nav.children) {
    if (child.nodeName !== 'navPoint') {
      continue
    }

    const title = child.querySelector('navLabel text').textContent
    const path = child.querySelector('content').getAttribute('src').split('#')[0]

    tree[`${prefix}${path}`] = {
      title,
      parent
    }

    recurseTree(child, prefix, tree[`${prefix}${path}`], tree)
  }

  return tree
}

export default async function getToc (zip) {
  let prefix = ''

  let entry = zip.getEntry('toc.ncx')

  if (!entry) {
    entry = zip.getEntry('OEBPS/toc.ncx')
    prefix = 'OEBPS/'
  }

  if (!entry) {
    console.error('Could not find ToC')
    return {}
  }

  const xml = await entry.getData()

  const jsdom = new JSDOM(xml, {
    contentType: 'application/xml'
  })

  const nav = jsdom.window.document.querySelector('navMap')

  const toc = recurseTree(nav, prefix)

  return toc
}
