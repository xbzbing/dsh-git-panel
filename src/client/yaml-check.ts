/**
 * Pre-save YAML check, shipped inside the lazy editor chunk (the `yaml`
 * parser must not enter the main bundle). Its own module so the unit tests can
 * bundle it without CodeMirror.
 */
import { parseAllDocuments } from 'yaml'
import type { SyntaxIssue } from './edit-buffer.js'

/**
 * YAML 1.2 check over every document in the buffer. Only `errors` count:
 * custom tags such as CloudFormation `!Ref` or GitLab `!reference` are
 * `warnings` (an unresolved tag), not syntax errors.
 */
export function validateYaml(text: string): SyntaxIssue | null {
  const errors = parseAllDocuments(text).flatMap((doc) => ('errors' in doc ? doc.errors : []))
  const first = errors[0]
  if (first === undefined) return null
  const at = first.linePos?.[0]
  return { line: at?.line ?? 0, column: at?.col ?? 0, message: first.message.split('\n')[0] ?? first.code, count: errors.length }
}
