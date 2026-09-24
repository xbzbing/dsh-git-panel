/**
 * git output parsers: porcelain status, log, branch, numstat, name-status.
 * Pure functions over raw stdout, no I/O.
 */
import type { GitBranch, GitChange, GitFileStat, GraphCommit, GitRef } from './types.ts';
/**
 * Parse `git status --porcelain=v1 -z`. A mixed XY (both non-space, e.g. MM)
 * is split into a staged side (X) and an unstaged side (Y). Untracked (??) is
 * a single unstaged entry. Real conflicts (UU/AA/DD…) stay one entry.
 */
export declare function parseStatus(stdout: string): GitChange[];
/**
 * Parse a graph log emitted with the record format:
 *   %H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e
 * (unit sep 0x1f between fields, record sep 0x1e between commits.)
 */
export declare function parseGraphLog(stdout: string): GraphCommit[];
/** Parse the `%D` decoration into structured refs. */
export declare function parseRefs(decoration: string): GitRef[];
/** Parse `git for-each-ref` local/remote branch lines: `name\0shortHash\0track`. */
export declare function parseBranches(stdout: string): GitBranch[];
/** Parse `git show --name-status -z` file lines into stats. */
export declare function parseNameStatus(stdout: string): GitFileStat[];
/** Sum `git diff --numstat` output: { insertions, deletions }. Binary rows ("-") skipped. */
export declare function sumNumstat(stdout: string): {
    insertions: number;
    deletions: number;
};
