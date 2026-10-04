// Wires config into a RiteContext. Shared by the server and the CLI.

import { fakeBeacon, liveBeacon } from './beacon';
import { getNow } from './clock';
import type { Config } from './config';
import { openDb } from './db/client';
import { carriedFiles, ledgerJson, publishToLedger } from './ledger';
import { ledgerFor } from './records';
import type { RiteContext } from './rite';

export function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

export function createContext(cfg: Config): RiteContext {
  const db = openDb(cfg.dbPath, cfg.migrationsDir);
  const ctx: RiteContext = {
    db,
    beacon: cfg.beacon === 'fake' ? fakeBeacon() : liveBeacon(),
    now: getNow,
    log,
    fakeState: cfg.fakeState,
    exportLedger: null,
  };
  if (cfg.ledger) {
    const target = cfg.ledger;
    ctx.exportLedger = async (year) => {
      const ledger = ledgerFor(db, year, cfg.siteUrl);
      if (!ledger) throw new Error(`no record for ${year}`);
      await publishToLedger(
        target,
        [{ path: `ledger/${year}.json`, content: ledgerJson(ledger) }, ...carriedFiles()],
        `The Rite of ${year}: ${ledger.tower?.move ?? 'no move'}`,
      );
    };
  }
  return ctx;
}
