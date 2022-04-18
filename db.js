import sqlite3 from 'sqlite3'

function call (object, method, ...args) {
  return new Promise((resolve, reject) => {
    object[method](...args, (err, value) => {
      if (err) {
        return reject(err)
      }

      resolve(value)
    })
  })
}

export default function db (path) {
  const db = new sqlite3.Database(path)

  return {
    all: (...args) => call(db, 'all', ...args),
    get: (...args) => call(db, 'get', ...args),
    run: (...args) => call(db, 'run', ...args)
  }
}
