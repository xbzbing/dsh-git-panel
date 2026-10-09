/**
 * git output parsers: porcelain status, log, branch, numstat, name-status.
 * Pure functions over raw stdout, no I/O.
 */
import type { GitBranch, GitChange, GitCommit, GitFileStat, GraphCommit, GitRef, StashEntry } from './types.ts';
/**
 * Build a GitCommit from a `%H\x1f%h\x1f%s\x1f%an\x1f%aI`-ordered field array
 * (the body, when present, is the caller's `parts.slice(5)`). Null when the
 * record is too short or carries no hash.
 */
export declare function commitFromFields(parts: readonly string[]): GitCommit | null;
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
/** Parse `git for-each-ref` tag lines: `name\0shortHash` per line. */
export declare function parseTags(stdout: string): GitBranch[];
/**
 * Parse `git stash list -z --format=%gd%x1f%gs%x1f%cr` into stash entries.
 * Each NUL-separated record is: selector (`stash@{N}`), reflog subject, and a
 * relative time. The subject is either auto ("WIP on <branch>: <sha> <subj>")
 * or custom ("On <branch>: <message>"); the branch is the text between "on "
 * and the first ": ", and the message is everything after that colon.
 */
export declare function parseStashList(stdout: string): StashEntry[];
/**
 * Parse `git show --name-status -z` into stats with an explicit state machine:
 * read a status token, then consume exactly the paths it owns (2 for R/C, 1
 * otherwise). A malformed token stops the scan rather than silently shifting
 * every later field, so one bad entry can't corrupt the whole list.
 */
export declare function parseNameStatus(stdout: string): GitFileStat[];
/** Sum `git diff --numstat` output: { insertions, deletions }. Binary rows ("-") skipped. */
export declare function sumNumstat(stdout: string): {
    insertions: number;
    deletions: number;
};
