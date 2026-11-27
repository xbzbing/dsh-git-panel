/** Packaged detail pages disclose the same prompt capability and data boundary. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../../', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const terms = {
  zh: [/自定义提交规范/, /默认提示词/, /最终指令/, /diff 与自定义规范/, /查看提示词不调用模型/],
  en: [/Customize commit guidelines/, /default prompt/, /final instructions/, /diff and custom guidelines/, /viewing prompts does not call the model/],
  ja: [/規約をカスタマイズ/, /既定プロンプト/, /最終指示/, /diff とカスタム規約/, /モデルを呼び出しません/],
  es: [/personalizar las reglas/, /prompt predeterminado/, /instrucciones finales/, /diff y las reglas personalizadas/, /consultar los prompts no llama al modelo/],
  fr: [/personnaliser les règles/, /prompt intégré par défaut/, /instructions finales/, /diff et les règles personnalisées/, /consulter les prompts ne fait pas appel au modèle/],
  de: [/Commit-Regeln lassen sich anpassen/, /Standard-Prompt/, /endgültigen Anweisungen/, /Diff und die eigenen Commit-Regeln/, /beim Anzeigen der Prompts wird das Modell nicht aufgerufen/],
  ru: [/настроить правила коммитов/, /промпт по умолчанию/, /итоговые инструкции/, /diff и пользовательские правила/, /при просмотре промптов модель не вызывается/],
  pt: [/personalizar as regras/, /prompt padrão/, /instruções finais/, /diff e as regras personalizadas/, /visualizar prompts não chama o modelo/],
}

for (const [language, patterns] of Object.entries(terms)) {
  test(`packaged ${language} detail discloses custom rules, both previews and model transmission`, () => {
    const name = `docs/details/DETAIL.${language}.md`
    assert.ok(pkg.files.includes(name), 'the verified detail page must be packaged')
    const locale = JSON.parse(readFileSync(new URL(`locale/${language}.json`, root), 'utf8'))
    assert.equal(locale.meta.detail, name, 'the plugin manager must display this detail page')
    const text = readFileSync(new URL(name, root), 'utf8')
    const line = text.split('\n').find(value => value.startsWith('- **') && /AI|IA|KI|ИИ/.test(value.split('**')[1] ?? ''))
    assert.ok(line, 'AI generation disclosure is missing')
    for (const pattern of patterns) assert.match(line, pattern)
    assert.ok(text.includes('https://github.com/xbzbing/dsh-git-panel'))
  })
}
