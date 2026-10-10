import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_CHARS,
  base64ToBytes,
  bigToBytes,
  decryptWithB,
  modPow,
  open,
  seal,
  squareChain,
} from '../src/shared/timelock';

const SOLVER = join(import.meta.dirname, '..', 'solver', 'target', 'release', 'rite-solver');
const work = mkdtempSync(join(tmpdir(), 'rite-timelock-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('modPow', () => {
  it('matches small cases', () => {
    expect(modPow(2n, 10n, 1000n)).toBe(24n);
    expect(modPow(3n, 0n, 7n)).toBe(1n);
    expect(modPow(5n, 117n, 19n)).toBe(1n);
  });
  it('takes the sealer shortcut: 2^(2^T mod φ) = 2^(2^T) mod N', () => {
    const p = 1009n;
    const q = 1013n;
    const n = p * q;
    const phi = (p - 1n) * (q - 1n);
    const t = 1000n;
    expect(modPow(2n, modPow(2n, t, phi), n)).toBe(squareChain(n, t));
  });
});

describe('bigToBytes', () => {
  it('is big-endian and left-padded', () => {
    expect([...bigToBytes(0x0102n, 4)]).toEqual([0, 0, 1, 2]);
    expect(() => bigToBytes(0x010203n, 2)).toThrow();
  });
});

describe('seal and open', () => {
  it('round-trips with a tiny T in TypeScript', async () => {
    const message = 'In 6121 the tower will stand on C. — ✶ 1010';
    const p = await seal(message, 1000n);
    expect(p.n_hex).toMatch(/^[0-9a-f]{512}$/);
    expect(p.t).toBe('1000');
    expect(base64ToBytes(p.iv_b64)).toHaveLength(12);
    expect(await open(p)).toBe(message);
  });

  it('does not open with the wrong number of squarings', async () => {
    const p = await seal('patience', 1000n);
    const n = BigInt('0x' + p.n_hex);
    await expect(decryptWithB(p, squareChain(n, 999n))).rejects.toThrow();
  });

  it('enforces the message limits', async () => {
    await expect(seal('', 10n)).rejects.toThrow();
    await expect(seal('x'.repeat(MAX_MESSAGE_CHARS + 1), 10n)).rejects.toThrow();
    // 1,000 characters, counted as code points, even when each is 4 bytes.
    const p = await seal('𓂀'.repeat(MAX_MESSAGE_CHARS), 10n);
    expect(await open(p)).toHaveLength(MAX_MESSAGE_CHARS * 2); // UTF-16 length
  });

  it.skipIf(!existsSync(SOLVER))('round-trips through the Rust solver, with a checkpoint and resume', async () => {
    const message = 'Sealed in the browser, opened by the solver.';
    const p = await seal(message, 1000n);
    const file = join(work, 'entry.json');
    writeFileSync(file, JSON.stringify({ id: 1, year: 2026, seal: 'short', ...p }));
    const out = execFileSync(SOLVER, ['open', '--file', file, '--dir', join(work, 'cp'), '--yes', '--quiet'], {
      encoding: 'utf8',
    });
    expect(out).toContain(message);
    expect(existsSync(join(work, 'cp', 'entry-1.json'))).toBe(true);
    // A finished checkpoint resumes straight to the answer.
    const again = execFileSync(SOLVER, ['open', '--file', file, '--dir', join(work, 'cp'), '--yes', '--quiet'], {
      encoding: 'utf8',
    });
    expect(again).toContain(message);
  });

  it.skipIf(!existsSync(SOLVER))('the solver refuses a tampered ciphertext', async () => {
    const p = await seal('do not touch', 500n);
    const bytes = base64ToBytes(p.ciphertext_b64);
    bytes[0]! ^= 1;
    const file = join(work, 'bad.json');
    writeFileSync(file, JSON.stringify({ ...p, ciphertext_b64: Buffer.from(bytes).toString('base64') }));
    const r = spawnSync(SOLVER, ['open', '--file', file, '--dir', join(work, 'cp2'), '--yes', '--quiet'], {
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('falló el descifrado');
  });
});
