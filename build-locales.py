"""Validate the complete authored catalogue and embed it for offline login delivery."""
import json
from pathlib import Path
import re
import string

root = Path(__file__).resolve().parent
catalogue = json.loads((root / 'client/locales.json').read_text(encoding='utf-8'))
languages = catalogue['languages']
assert languages == ['en', 'de', 'fr', 'es', 'ru', 'zh', 'ja', 'ko']
formatter = string.Formatter()
def fields(text):
    return sorted((name, spec, conversion) for _, name, spec, conversion in formatter.parse(text) if name is not None)
translations = {language:{} for language in languages}
for key, row in catalogue['strings'].items():
    assert len(row) == len(languages), key
    expected = fields(row[0])
    for language, text in zip(languages, row):
        assert isinstance(text, str) and text.strip(), (language, key)
        assert fields(text) == expected, (language, key, 'placeholder mismatch')
        translations[language][key] = text
lines = ['# BEGIN GENERATED CATALOGUE', '_NMB_TRANSLATIONS = {']
for language, entries in translations.items():
    lines.append('    ' + repr(language) + ': {')
    for key, text in entries.items():
        lines.append('        ' + repr(key) + ': u' + repr(text) + ',')
    lines.append('    },')
lines.extend(['}', '# END GENERATED CATALOGUE'])
file = root / 'client/i18n.py'
source = file.read_text(encoding='utf-8')
source, count = re.subn(r'# BEGIN GENERATED CATALOGUE.*?# END GENERATED CATALOGUE', lambda _: '\n'.join(lines), source, flags=re.S)
assert count == 1
file.write_text(source, encoding='utf-8')
print('Validated and embedded', len(catalogue['strings']), 'strings in', len(languages), 'languages.')
