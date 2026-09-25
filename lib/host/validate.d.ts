/** A repository-relative path is safe when it stays inside the work tree. */
export declare function isSafePath(path: string): boolean;
/**
 * A ref (branch / tag / commit-ish) is safe as a bare argv element: no leading
 * `-` (would be parsed as a git option — the `--output=` file-write vector),
 * no whitespace/control chars, no glob or rev-range metacharacters.
 */
export declare function isSafeRev(input: string): boolean;
/** A branch name for `git checkout`: the ref rules plus no leading slash. */
export declare function isSafeBranchName(name: string): boolean;
