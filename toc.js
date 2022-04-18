import fs from 'node:fs/promises'
import path from 'node:path'
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

export default async function getToc (epubDirectory) {
  let prefix = ''
  let xml

  try {
    xml = await fs.readFile(path.join(epubDirectory, 'toc.ncx'))
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e
    }

    xml = await fs.readFile(path.join(epubDirectory, 'OEBPS/toc.ncx'))
    prefix = 'OEBPS/'
  }

  const jsdom = new JSDOM(xml, {
    contentType: 'application/xml'
  })

  const nav = jsdom.window.document.querySelector('navMap')

  const toc = recurseTree(nav, prefix)

  return toc
}
