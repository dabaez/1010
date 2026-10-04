// The jobs as commands, for an external scheduler or a human with a shell.
//
//   pnpm rite status                 where things stand
//   pnpm rite open                   open the Day if it has begun; reveal the Number
//   pnpm rite close [year]           close the Day if it has ended; make the move
//   pnpm rite tick                   whatever is pending (open, close, export)
//   pnpm rite commitments [year]     the drand rounds that will decide a year
//   pnpm rite ledger <year>          print ledger/<year>.json
//   pnpm rite export <year>          push ledger/<year>.json (+ RULES.md, solver) to LEDGER_REPO
//   pnpm rite backup <dir>           copy the database into <dir>, keeping the newest 30
//
// In production: node build/server/cli.mjs <command>, with the same
// environment as the server (see deploy/systemd/rite.service).

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { currentOrNextWindow } from '../shared/calendar';
import { distanceToGoal } from '../shared/tower';
import { loadConfig } from './config';
import { createContext } from './context';
import { ledgerJson } from './ledger';
import { ledgerFor } from './records';
import { closeRite, commitments, getYear, latestYear, markExported, movesMade, openRite, tick, towerState } from './rite';

const [cmd, arg] = process.argv.slice(2);
const cfg = loadConfig();
const ctx = createContext(cfg);

function yearArg(): number {
  const y = Number(arg);
  if (!Number.isInteger(y)) throw new Error('give a year, e.g. 2026');
  return y;
}

async function main(): Promise<number> {
  switch (cmd) {
    case 'status': {
      const now = ctx.now();
      const state = towerState(ctx);
      console.log(
        JSON.stringify(
          {
            now: now.toISOString(),
            next: commitments(currentOrNextWindow(now).year),
            latest: latestYear(ctx.db) ?? null,
            tower: { state, movesMade: movesMade(ctx.db), optimalRemaining: distanceToGoal(state) },
          },
          null,
          2,
        ),
      );
      return 0;
    }
    case 'open': {
      await openRite(ctx);
      const y = latestYear(ctx.db);
      console.log(y ? `${y.year}: opened, Number ${y.number_u64 ?? 'not yet revealed (beacon pending)'}` : 'nothing has opened yet');
      return 0;
    }
    case 'close': {
      const r = await closeRite(ctx, arg ? yearArg() : undefined);
      console.log(r);
      return r === 'closed' || r === 'already-closed' ? 0 : 1;
    }
    case 'tick':
      await tick(ctx);
      return 0;
    case 'commitments':
      console.log(JSON.stringify(commitments(arg ? yearArg() : currentOrNextWindow(ctx.now()).year), null, 2));
      return 0;
    case 'ledger': {
      const ledger = ledgerFor(ctx.db, yearArg(), cfg.siteUrl);
      if (!ledger) throw new Error(`no record for ${arg}`);
      process.stdout.write(ledgerJson(ledger));
      return 0;
    }
    case 'export': {
      const year = yearArg();
      if (!ctx.exportLedger) throw new Error('set LEDGER_REPO and LEDGER_TOKEN');
      if (!getYear(ctx.db, year)?.closed_at) throw new Error(`${year} is not closed`);
      await ctx.exportLedger(year);
      markExported(ctx, year);
      console.log(`exported ledger/${year}.json to ${cfg.ledger!.repo}`);
      return 0;
    }
    case 'backup': {
      if (!arg) throw new Error('give a directory');
      mkdirSync(arg, { recursive: true });
      const file = join(arg, `rite-${new Date().toISOString().replace(/[:.]/g, '')}.sqlite`);
      await ctx.db.$client.backup(file);
      const old = readdirSync(arg).filter((f) => /^rite-.*\.sqlite$/.test(f)).sort().slice(0, -30);
      for (const f of old) rmSync(join(arg, f));
      console.log(`backed up to ${file}`);
      return 0;
    }
    default:
      console.error('usage: rite status | open | close [year] | tick | commitments [year] | ledger <year> | export <year> | backup <dir>');
      return 2;
  }
}

main()
  .then((code) => {
    ctx.db.$client.close();
    process.exit(code);
  })
  .catch((e) => {
    console.error(`rite: ${(e as Error).message}`);
    process.exit(1);
  });
