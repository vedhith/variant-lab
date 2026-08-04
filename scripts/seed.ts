/**
 * `npm run seed` — fill a local database with the demo experiments.
 *
 * Everything interesting about Variant Lab is a function of traffic, and a
 * fresh clone has none. This gives a stranger four experiments with real
 * numbers to open, without an API key, an account, or a page to test.
 *
 *   npm run seed              # create the demo experiments
 *   npm run seed -- --reset   # delete and rebuild them
 *   npm run seed -- --db=:memory:
 */

import { openDatabase } from '../src/lib/db'
import { DEMO_EXPERIMENT_IDS, existingDemoIds, resetDemo, seedDemo } from '../src/lib/demo'

const DEFAULT_DB = process.env.VARIANT_LAB_DB ?? '.data/variant-lab.db'
const BASE_URL = process.env.VARIANT_LAB_URL ?? 'http://localhost:3000'

interface Options {
  db: string
  reset: boolean
  clear: boolean
  help: boolean
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { db: DEFAULT_DB, reset: false, clear: false, help: false }

  for (const arg of argv) {
    if (arg === '--reset') options.reset = true
    else if (arg === '--clear') options.clear = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--db=')) options.db = arg.slice('--db='.length)
    else throw new Error(`unknown argument "${arg}" — try --help`)
  }

  return options
}

const USAGE = `Usage: npm run seed [-- <options>]

  --reset        replace the demo experiments if they already exist
  --clear        delete the demo experiments and stop
  --db=<path>    database file (default ${DEFAULT_DB}, or :memory:)
  -h, --help     show this message
`

function main(): number {
  let options: Options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`)
    return 2
  }

  if (options.help) {
    process.stdout.write(USAGE)
    return 0
  }

  const db = openDatabase(options.db)

  try {
    if (options.clear) {
      const removed = resetDemo(db)
      process.stdout.write(
        removed === 0
          ? `No demo experiments in ${options.db}.\n`
          : `Removed ${removed} demo experiment${removed === 1 ? '' : 's'} from ${options.db}.\n`,
      )
      return 0
    }

    const already = existingDemoIds(db)
    if (already.length > 0 && !options.reset) {
      process.stderr.write(
        `${options.db} already holds ${already.length} of ${DEMO_EXPERIMENT_IDS.length} demo ` +
          `experiments (${already.join(', ')}).\n` +
          `Re-run with --reset to rebuild them, or --clear to remove them.\n`,
      )
      return 1
    }

    const seeded = seedDemo(db, { reset: options.reset })
    const width = Math.max(...seeded.map((s) => s.name.length))

    process.stdout.write(
      `Seeded ${seeded.length} demo experiment${seeded.length === 1 ? '' : 's'} into ${options.db}\n\n`,
    )
    for (const experiment of seeded) {
      process.stdout.write(
        `  ${experiment.name.padEnd(width)}  ${experiment.visitors} visitors · ` +
          `${experiment.conversions} conversions\n` +
          `  ${' '.repeat(width)}  ${experiment.shows}\n` +
          `  ${' '.repeat(width)}  ${BASE_URL}/experiments/${experiment.id}/results\n\n`,
      )
    }
    process.stdout.write(
      `Run \`npm run dev\` and open one of those results pages.\n` +
        `The numbers are identical on every seed — the split and the conversions\n` +
        `are hashed, not random.\n`,
    )
    return 0
  } finally {
    db.close()
  }
}

process.exit(main())
