"""Portable source/catalogue/payload checks; never reads a live EveJS install."""
from pathlib import Path
import ast, hashlib, json, string, subprocess, warnings
warnings.filterwarnings('ignore',category=DeprecationWarning)
from lib2to3 import pygram, pytree
from lib2to3.pgen2 import driver

root=Path(__file__).resolve().parents[1]
package=json.loads((root/'package.json').read_text(encoding='utf-8'))
manifest=json.loads((root/'evejs-launcher.mod.json').read_text(encoding='utf-8'))
assert package['version']==manifest['version']
assert package['license']=='AGPL-3.0-only'
assert manifest['supportedBackends']==['native']
catalogue=json.loads((root/'client/locales.json').read_text(encoding='utf-8'))
assert catalogue['languages']==['en','de','fr','es','ru','zh','ja','ko']
formatter=string.Formatter()
def fields(text):
    return sorted((name,spec,conversion) for _,name,spec,conversion in formatter.parse(text) if name is not None)
tree=ast.parse((root/'client/i18n.py').read_text(encoding='utf-8'))
embedded=next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='_NMB_TRANSLATIONS' for target in node.targets))
for key,translations in catalogue['strings'].items():
    assert len(translations)==8,key
    for language,text in zip(catalogue['languages'],translations):
        assert text.strip() and fields(text)==fields(translations[0]),(key,language)
        assert embedded[language][key]==text,(key,language)
grammar=driver.Driver(pygram.python_grammar,convert=pytree.convert)
clients=list((root/'client').glob('*.py'))
for file in clients:
    source=file.read_text(encoding='utf-8')
    grammar.parse_string(source.rstrip()+'\n');compile(source,str(file),'exec')
    for node in ast.walk(ast.parse(source)):
        if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='_nmb_tr' and node.args and isinstance(node.args[0],ast.Constant):
            assert node.args[0].value in catalogue['strings'],(file.name,node.args[0].value)
javascript=list((root/'lib').glob('*.js'))+[root/'helper.js',root/'loader.js.disabled',root/'build-payload.cjs']
for file in javascript:
    subprocess.run(['node','-e','new (require("node:vm").Script)(require("node:fs").readFileSync(process.argv[1],"utf8"),{filename:process.argv[1]})',str(file)],check=True)
payload=json.loads((root/'payload/native.json').read_text())
for entry in payload['files']:
    file=root/'payload'/entry['payload']
    assert hashlib.sha256(file.read_bytes()).hexdigest()==entry['installedSHA'],entry['target']
    relative=entry['target'].removeprefix('externalservices/market-server/')
    if relative.endswith('.exe'):
        assert file.read_bytes()[:2]==b'MZ'
    else:
        assert (root/'native/market-server'/relative).read_bytes()==file.read_bytes(),relative
assert (root/'LICENSE').is_file()
print(json.dumps({'version':package['version'],'catalogueStrings':len(catalogue['strings']),
    'languages':8,'pythonFiles':len(clients),'javascriptFiles':len(javascript),
    'reviewedNativePayloadFiles':len(payload['files']),'liveRuntimeAccessed':False}))
