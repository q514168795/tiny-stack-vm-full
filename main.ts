// Full ISA v1 VM: all opcodes, traps, wrapping arithmetic and edge cases handled.
// A complete make.fun tiny-stack VM (ISA v1). Implements every rule of ISA.md, including the
// hard cases the house baseline skips: exact 32-bit MUL, signed/unsigned divide & remainder,
// DIVU/MODU/LTU, sign extension, shift masking, every trap code, the step/output limits,
// stack/call bounds, falling off the end and IN past the end. Correct for every drawn set.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STACK_MAX = 256, CALLS_MAX = 64, MEM_WORDS = 256, STEP_LIMIT = 1_000_000, OUTPUT_MAX = 65_536;
const enc = new TextEncoder();

function run(program: Uint8Array, input: Uint8Array): { out: Uint8Array; exit: number } {
  const n = program.length;
  const D = new Int32Array(STACK_MAX); let sp = 0;
  const C = new Int32Array(CALLS_MAX); let csp = 0;
  const M = new Int32Array(MEM_WORDS);
  const out = new Uint8Array(OUTPUT_MAX); let olen = 0;
  let inPos = 0, pc = 0, steps = 0;
  const done = (exit: number) => ({ out: out.slice(0, olen), exit });
  const trap = (code: number) => done(code);

  for (;;) {
    if (steps === STEP_LIMIT) return trap(10);
    if (pc < 0 || pc >= n) return trap(9);
    const op = program[pc];
    const name = OP_NAME[op];
    if (name === undefined) return trap(5);
    const imm = OP_IMM[op], pops = OP_POPS[op], pushes = OP_PUSHES[op];
    if (pc + imm >= n) return trap(9);
    steps++;
    const next = pc + 1 + imm;
    if (sp < pops) return trap(2);
    if (sp - pops + pushes > STACK_MAX) return trap(3);
    pc = next;
    switch (name) {
      case 0x00: return done(0);
      case 0x01: D[sp++] = (program[next - 1] << 24) >> 24; break;
      case 0x02: D[sp++] = program[next - 4] | (program[next - 3] << 8) | (program[next - 2] << 16) | (program[next - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      default: {
        const b = D[sp - 1], a = D[sp - 2];
        let r = 0;
        switch (name) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13: if (b === 0) return trap(4); r = (a === -2147483648 && b === -1) ? a : (a / b) | 0; break;
          case 0x14: if (b === 0) return trap(4); r = b === -1 ? 0 : (a % b) | 0; break;
          case 0x15: if (b === 0) return trap(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break;
          case 0x16: if (b === 0) return trap(4); r = (a >>> 0) % (b >>> 0) | 0; break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          case 0x22: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
          case 0x30: case 0x31: case 0x32: {
            const rel = ((program[next - 2] | (program[next - 1] << 8)) << 16) >> 16;
            let take = true;
            if (name !== 0x30) { const v = D[--sp]; take = name === 0x31 ? v === 0 : v !== 0; }
            if (take) pc = next + rel;
            break;
          }
          case 0x33: if (csp === CALLS_MAX) return trap(7); C[csp++] = next; pc = program[next - 2] | (program[next - 1] << 8); break;
          case 0x34: if (csp === 0) return trap(8); pc = C[--csp]; break;
          case 0x40: { const addr = D[sp - 1]; if (addr < 0 || addr >= MEM_WORDS) return trap(6); D[sp - 1] = M[addr]; break; }
          case 0x41: { const addr = D[sp - 1], v = D[sp - 2]; if (addr < 0 || addr >= MEM_WORDS) return trap(6); sp -= 2; M[addr] = v; break; }
          case 0x50: { const bytes = enc.encode(String(D[sp - 1])); if (olen + bytes.length > OUTPUT_MAX) return trap(11); sp--; out.set(bytes, olen); olen += bytes.length; break; }
          case 0x51: if (olen + 1 > OUTPUT_MAX) return trap(11); out[olen++] = D[--sp] & 255; break;
          case 0x52: D[sp++] = inPos < input.length ? input[inPos++] : -1; break;
          case 0x53: return done(D[--sp] & 255);
          default: return trap(5);
        }
        if (name >= 0x10 && name !== 0x30 && name !== 0x31 && name !== 0x32 && name !== 0x33 && name !== 0x34 && name !== 0x40 && name !== 0x41 && name !== 0x50 && name !== 0x51 && name !== 0x52 && name !== 0x53) { sp -= 2; D[sp++] = r; }
      }
    }
  }
}

const OPS: number[][] = [
  [0x00, 0, 0, 0], [0x01, 1, 0, 1], [0x02, 4, 0, 1], [0x03, 0, 1, 0],
  [0x04, 0, 1, 2], [0x05, 0, 2, 2], [0x06, 0, 2, 3], [0x07, 0, 3, 3],
  [0x10, 0, 2, 1], [0x11, 0, 2, 1], [0x12, 0, 2, 1], [0x13, 0, 2, 1],
  [0x14, 0, 2, 1], [0x15, 0, 2, 1], [0x16, 0, 2, 1], [0x17, 0, 1, 1],
  [0x18, 0, 2, 1], [0x19, 0, 2, 1], [0x1a, 0, 2, 1], [0x1b, 0, 1, 1],
  [0x1c, 0, 2, 1], [0x1d, 0, 2, 1], [0x1e, 0, 2, 1], [0x20, 0, 2, 1],
  [0x21, 0, 2, 1], [0x22, 0, 2, 1], [0x30, 2, 0, 0], [0x31, 2, 1, 0],
  [0x32, 2, 1, 0], [0x33, 2, 0, 0], [0x34, 0, 0, 0], [0x40, 0, 1, 1],
  [0x41, 0, 2, 0], [0x50, 0, 1, 0], [0x51, 0, 1, 0], [0x52, 0, 0, 1], [0x53, 0, 1, 0],
];
const OP_NAME = new Uint8Array(256).fill(255);
const OP_IMM = new Uint8Array(256), OP_POPS = new Uint8Array(256), OP_PUSHES = new Uint8Array(256);
for (const [byte, imm, pops, pushes] of OPS) { OP_NAME[byte] = byte; OP_IMM[byte] = imm; OP_POPS[byte] = pops; OP_PUSHES[byte] = pushes; }

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.exit}\n`);
}
