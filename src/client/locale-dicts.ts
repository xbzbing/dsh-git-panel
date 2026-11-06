/**
 * Every dictionary the `dbGitPanel` namespace registers, by locale id. zh and en
 * are the platform's baseline pair; the rest match the languages DSH ships
 * (ja / es / fr / de / ru / pt). A locale outside this set — a language pack
 * added later — falls back to English through the platform's per-key fallback
 * chain, and so does any key a dictionary lacks; older hosts that only know
 * zh / en store the extra dictionaries and never consult them.
 */
import { en, zh } from './locales.js'
import type { GitKey } from './locales.js'
import { de } from './locales/de.js'
import { es } from './locales/es.js'
import { fr } from './locales/fr.js'
import { ja } from './locales/ja.js'
import { pt } from './locales/pt.js'
import { ru } from './locales/ru.js'

export const DICTIONARIES: Readonly<Record<string, Record<GitKey, string>>> = { zh, en, ja, es, fr, de, ru, pt }
