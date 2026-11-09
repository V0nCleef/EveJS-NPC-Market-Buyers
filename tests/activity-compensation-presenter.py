"""Run the actual pure Activity presenter on the actual service wire row."""
import ast
import json
import math
from pathlib import Path
import sys
import time

root = Path(__file__).resolve().parents[1]
tree = ast.parse((root / 'client/hud.py').read_text(encoding='utf-8'))
presenter = next(node for node in ast.walk(tree)
                 if isinstance(node, ast.FunctionDef) and node.name == 'ActivityPresentation')
namespace = dict(unicode=str, long=int, time=time, _nmb_math=math,
                 amber='amber', teal='teal', type_name=str, units=str,
                 field=lambda data, names, default='': next((data[n] for n in names if n in data), default),
                 _nmb_activity_title=lambda data, name: data.get('message', name),
                 _nmb_tr=lambda key, **kwargs: key, _nmb_number=lambda value: value or 0,
                 _nmb_isk=str, _nmb_isk_explained=str, _nmb_readable_isk=str)
exec(compile(ast.Module(body=[presenter], type_ignores=[]), str(root / 'client/hud.py'), 'exec'), namespace)
row = json.load(sys.stdin)
info = namespace['ActivityPresentation'](None, row)
assert info['kind'] == 'recovery_compensated'
assert info['details']['compensated'] is True
assert info['rejected'] is True and info['purchase'] is False and info['resolved'] is False
assert info['status'] == 'rejected_badge' and info['message'] == 'rejected_detail'
assert info['net'] == '\u2014' and 'pending' not in info['helpText']
print(json.dumps(dict(status=info['status'], purchase=info['purchase'], net=info['net'])))
