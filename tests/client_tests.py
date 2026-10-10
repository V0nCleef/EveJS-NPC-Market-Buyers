"""Focused native-client contract tests with isolated CarbonUI/RPC stubs.

These exercise real mod code, not a launched EVE client or a mocked sale server.
"""
import os
import builtins
import ast
import json
from pathlib import Path
import sys
import subprocess
import types
import unittest
import string
import unicodedata
import math

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CLIENT_REFERENCE = Path(os.environ.get('EVEJS_CLIENT_REFERENCE_DIR', str(ROOT/'tests/private/client-reference')))


def module(name, **values):
    parts = name.split('.')
    for index in range(1, len(parts) + 1):
        path = '.'.join(parts[:index])
        if path not in sys.modules:
            item = types.ModuleType(path)
            item.__path__ = []
            sys.modules[path] = item
    sys.modules[name].__dict__.update(values)
    return sys.modules[name]


class Widget:
    def __init__(self, **kwargs):
        self._attrs = dict(kwargs)
        self.children = []
        self.destroyed = False
        self.height = 40
        self.width = 0
        self.display = True
        self.displayWidth = self.displayHeight = 0
        self.text = ''
        self.__dict__.update(kwargs)
        if getattr(self, 'parent', None) is not None:
            self.parent.children.append(self)
        self.value = kwargs.get('setvalue', kwargs.get('select'))

    def Close(self, *args):
        self.destroyed = True

    def Flush(self):
        for child in self.children:
            child.Close()
        self.children = []

    def GetValue(self):
        return self.value

    def SetValue(self, value):
        self.value = value

    def LoadOptions(self, options, select=None):
        self.options = options
        self.value = select

    def AddPoint(self, point, **kwargs):
        self.points = getattr(self, 'points', []) + [(point, kwargs)]

    def StopAnimations(self):
        self.stoppedAnimations = True

    def SetFocus(self):
        self.focused = True

    def ScrollToRevealChildVertical(self, child):
        self.revealed = child

    def UpdateAlignment(self):
        self.displayWidth = NATIVE_FLOW_DPI * self.width
        self.displayHeight = NATIVE_FLOW_DPI * self.height

    @property
    def textwidth(self):
        return sum(15 if unicodedata.east_asian_width(c) in ('W','F') else 8 for c in str(self.text))


class Window(Widget):
    def ApplyAttributes(self, attributes):
        self.content = Widget()

    def Close(self, setClosed=False, *args, **kwargs):
        self.setClosed = setClosed
        return Widget.Close(self, *args)

    def CloseByUser(self, *args):
        # Exact native client call contract (build 3396210, window.py:1472).
        self.Close(setClosed=True)

    @classmethod
    def Open(cls):
        cls.opened = cls()
        cls.opened.ApplyAttributes(types.SimpleNamespace())
        return cls.opened

    @classmethod
    def CloseIfOpen(cls):
        if getattr(cls, 'opened', None):
            cls.opened.Close()


C = types.SimpleNamespace(**{key: key for key in (
    'TOTOP', 'TOBOTTOM', 'TOPLEFT', 'TOPRIGHT', 'BOTTOMLEFT', 'BOTTOMRIGHT', 'TOBOTTOM_NOPUSH', 'TOALL',
    'TOLEFT_PROP', 'TOLEFT', 'TORIGHT', 'CENTER', 'UI_HIDDEN', 'ANIM_REPEAT',
    'ANIM_WAVE', 'UI_DISABLED', 'UI_NORMAL', 'SCOPE_INGAME')})
C.ALIGNMENTS_WITH_INCLUDED_HORIZONTAL_PADDING = (C.TOLEFT, C.TORIGHT)
C.ALIGNMENTS_WITH_INCLUDED_VERTICAL_PADDING = (C.TOTOP, C.TOBOTTOM)


NUMERIC_FORMAT_CALLS = []
def numeric_display(number, useGrouping=True, decimalPlaces=0, leadingZeroes=0):
    NUMERIC_FORMAT_CALLS.append({'value':number,'useGrouping':useGrouping,'decimalPlaces':decimalPlaces})
    return format(number, (',' if useGrouping else '') + '.' + str(decimalPlaces) + 'f')


class NativeMoney(Widget):
    """Exact native text/format/value methods; rendering/localization isolated."""
    def __init__(self, **kwargs):
        Widget.__init__(self, **kwargs)
        self.decimalPlaces = kwargs['decimalPlaces']
        self.minValue = kwargs['minValue']
        self.dataType = float
        self.DECIMAL = '.'
        self.HYPHEN = '-'
        self.textLabel = types.SimpleNamespace(SetText=lambda value: setattr(self, 'displayText', value))
        self.SetText(kwargs.get('setvalue', 0))

    def SetValue(self, value):
        if isinstance(value, str):
            value = self.PrepareFloatString(value)
        self.SetText(value)

    def SanitizeText(self, text):
        return text

    def StripLeadingZeroesIfNecessary(self, text):
        return text

    def GetLocalizedDecimal(self):
        return '.'


def native_method(filename, method):
    # Select only the method: other decompiled functions can contain Python 2
    # syntax or decoder artifacts unrelated to the contract under test.
    lines = (CLIENT_REFERENCE / filename).read_text(encoding='utf-8').splitlines(True)
    start = next(i for i,line in enumerate(lines) if line.startswith('    def ' + method + '('))
    end = start + 1
    while end < len(lines) and (not lines[end].strip() or lines[end].startswith('        ')):
        end += 1
    source = ''.join(line[4:] if line.startswith('    ') else line for line in lines[start:end])
    ns = {'FormatNumeric':numeric_display, 'basestring':str, 'unicode':str, 'StripTags':lambda text, **kw:text,
          'filter':lambda function,text:''.join(builtins.filter(function,text))}
    exec(compile(source, method, 'exec'), ns)
    function = ns[method]
    if method == 'FormatNumeric':
        ns['FormatNumeric'] = numeric_display  # Native module-level formatter.
    return function


for method in ('SetText', 'PrepareFloatString'):
    function = native_method('carbonui/control/singlelineedits/singleLineEditFloat.py', method)
    setattr(NativeMoney, method, staticmethod(function) if method == 'PrepareFloatString' else function)
for method in ('FormatNumeric', 'GetValue'):
    setattr(NativeMoney, method, native_method('carbonui/control/singlelineedits/baseSingleLineEditNumber.py', method))


class NativeScroll(Widget):
    OnMouseWheel = native_method('carbonui/control/scrollContainer.py', 'OnMouseWheel')

    def _scroll_by_pixels(self, pixels):
        self.wheelPixels = getattr(self, 'wheelPixels', []) + [pixels]
        return True


class NativeButton(Widget):
    """Native size methods below, with only rendering/font dependencies stubbed."""
    def __init__(self, **kwargs):
        Widget.__init__(self, **kwargs)
        self._icon = None
        self._label = types.SimpleNamespace(textwidth=sum(15 if unicodedata.east_asian_width(c) in ('W','F') else 8 for c in kwargs.get('label','')))
        self.density = 'normal'
        self.padLeft = kwargs.get('padLeft',0);self.padRight = kwargs.get('padRight',0)
        self.padTop = kwargs.get('padTop',0);self.padBottom = kwargs.get('padBottom',0)
        self._Button__ready = True
        self.Update_Size_()

    def _UpdateContentPosition(self):
        pass

    def Update_Size_(self):
        self.width = self.get_intrinsic_width();self.height = self.get_intrinsic_height()

    def get_intrinsic_width(self):
        return max(80, self._label.textwidth+20+self.padLeft+self.padRight)

    def get_intrinsic_height(self):
        return 32


# Exercise the exact shipped Button.Update_Size_/intrinsic sizing contract.
# No proprietary source is included in the release ZIP.
native_file = CLIENT_REFERENCE / 'carbonui/control/button.py'
NATIVE_BUTTON_CONTRACT = native_file.exists()
if NATIVE_BUTTON_CONTRACT:
    button_tree = ast.parse(native_file.read_text(encoding='utf-8'))
    native_class = next(n for n in button_tree.body if isinstance(n,ast.ClassDef) and n.name=='Button')
    methods = [n for n in native_class.body if isinstance(n,ast.FunctionDef) and n.name in ('Update_Size_','get_intrinsic_width','get_intrinsic_height')]
    for method in methods:
        method.decorator_list = []
    contract = ast.Module(body=[ast.ClassDef(name='Button',bases=[],keywords=[],body=methods,decorator_list=[])],type_ignores=[])
    ns_contract={'uiconst':C,'styling':types.SimpleNamespace(get_side_padding=lambda _:10,get_min_width=lambda _:80,get_height=lambda _:32)}
    exec(compile(ast.fix_missing_locations(contract),str(native_file),'exec'),ns_contract)
    for method in methods:
        setattr(NativeButton,method.name,getattr(ns_contract['Button'],method.name))
    base_file=CLIENT_REFERENCE / 'carbonui/primitives/base.py'
    base_tree=ast.parse(base_file.read_text(encoding='utf-8'))
    native_base=next(n for n in base_tree.body if isinstance(n,ast.ClassDef) and n.name=='Base')
    alignment_methods=[n for n in native_base.body if isinstance(n,ast.FunctionDef) and n.name in
                       ('UpdateToAllAlignment','UpdateToLeftAlignment','UpdateToRightAlignment')]
    for method in alignment_methods:
        method.decorator_list=[]
    contract=ast.Module(body=[ast.ClassDef(name='Base',bases=[],keywords=[],body=alignment_methods,decorator_list=[])],type_ignores=[])
    ns_contract={'ScaleDpiF':lambda value:float(value)}
    exec(compile(ast.fix_missing_locations(contract),str(base_file),'exec'),ns_contract)
    NativeAlignment=ns_contract['Base']


def footer_rectangles(buttons, width, height):
    budget=(0,0,width,height)
    boxes=[]
    for b in buttons:
        if getattr(b,'state',C.UI_NORMAL)==C.UI_HIDDEN:
            continue
        item=types.SimpleNamespace(padding=(b.padLeft,b.padTop,b.padRight,b.padBottom),pos=(0,0,b.width,b.height))
        method=NativeAlignment.UpdateToLeftAlignment if b.align==C.TOLEFT else NativeAlignment.UpdateToRightAlignment
        budget=method(item,False,*budget)
        boxes.append(item.displayRect)
    return boxes
module('__builtin__', **builtins.__dict__)
module('blue', pyos=types.SimpleNamespace(synchro=types.SimpleNamespace(SleepWallclock=lambda _: None)))
module('uthread', new=lambda function, *args: None)
module('carbonui', uiconst=C, const=C)
for path, name in [
    ('carbonui.control.window', 'Window'), ('carbonui.control.button', 'Button'),
    ('carbonui.control.combo', 'Combo'), ('carbonui.primitives.container', 'Container'),
    ('carbonui.primitives.fill', 'Fill'), ('carbonui.primitives.frame', 'Frame'),
    ('carbonui.primitives.vectorlinetrace', 'VectorLineTrace'),
    ('eve.client.script.ui.control.eveIcon', 'Icon'),
    ('carbonui.control.scrollContainer', 'ScrollContainer'),
    ('carbonui.control.singlelineedits.singleLineEditInteger', 'SingleLineEditInteger'),
    ('carbonui.control.singlelineedits.singleLineEditFloat', 'SingleLineEditFloat'),
    ('carbonui.control.singlelineedits.singleLineEditText', 'SingleLineEditText'),
    ('eve.client.script.ui.control.eveLabel', 'Label')]:
    module(path, **{name: Window if name == 'Window' else NativeButton if name == 'Button' else NativeMoney if name == 'SingleLineEditFloat' else NativeScroll if name == 'ScrollContainer' else Widget})
module('evetypes', GetName=lambda typeID: 'Type %s' % typeID)
module('eveicon', grid_view='grid_view', details_view='details_view', list_view='list_view')


class NativeMenuButton(Widget):
    GetMenu = native_method('carbonui/button/menu.py', 'GetMenu')


class Entry:
    def __init__(self, text, **kwargs):
        self.text = text
        self.__dict__.update(kwargs)


class CharacterPreferences:
    def __init__(self):
        self.values = {}
        self.character = 42

    def Get(self, key, default):
        return self.values.get((self.character, key), default)

    def Set(self, key, value):
        self.values[self.character, key] = value


VIEW_PREFS = CharacterPreferences()
native_settings_ns = {'settings':types.SimpleNamespace(char=types.SimpleNamespace(ui=VIEW_PREFS)),
    'Signal':lambda *args: lambda *args: None}
tree = ast.parse((CLIENT_REFERENCE / 'clientsettings/setting.py').read_text(encoding='utf-8'))
classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and
    node.name in ('_BaseSetting', '_CharSettingMixin', '_BaseSettingEnum', 'CharSettingEnum')]
exec(compile(ast.Module(body=classes, type_ignores=[]), 'native_settings_contract', 'exec'), native_settings_ns)
module('clientsettings.setting', CharSettingEnum=native_settings_ns['CharSettingEnum'])
native_menu_ns = {'MenuEntryData':Entry}
tree = ast.parse((CLIENT_REFERENCE / 'carbonui/control/contextMenu/menuData.py').read_text(encoding='utf-8'))
classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name in ('BaseMenuData', 'MenuData')]
exec(compile(ast.Module(body=classes, type_ignores=[]), 'native_menu_contract', 'exec'), native_menu_ns)
module('carbonui.control.contextMenu.menuData', MenuData=native_menu_ns['MenuData'])
module('carbonui.button.menu', MenuButtonIcon=NativeMenuButton)
NATIVE_FLOW_DPI = 1


class FlowBase:
    @staticmethod
    def UpdateAlignment(widget, left, top, width, height):
        widget.displayWidth = width
        widget.displayHeight = widget.height * NATIVE_FLOW_DPI
        return left, top + widget.displayHeight, width, height - widget.displayHeight, True


class FlowChildren(list):
    def append(self, child):
        child.align = 'NOALIGN'  # Exact native FlowContainer._AppendChildRO contract.
        super().append(child)


class NativeFlow(Widget):
    UpdateAlignment = native_method('carbonui/primitives/flowcontainer.py', 'UpdateAlignment')

    def __init__(self, **kwargs):
        Widget.__init__(self, **kwargs)
        self.children = FlowChildren()
        self._forceUpdateAlignment = False
        self._childrenAlignmentDirty = True
        self.contentAlignment = self.crossAxisAlignment = 'START'


NativeFlow.UpdateAlignment.__globals__.update(Base=FlowBase,
    AxisAlignment=types.SimpleNamespace(START='START',CENTER='CENTER',END='END'),
    uiconst=types.SimpleNamespace(NOALIGN='NOALIGN'), ALLOWED_AUTO_HEIGHT_ALIGNMENTS=(C.TOTOP,),
    uicore=types.SimpleNamespace(ScaleDpi=lambda value:value*NATIVE_FLOW_DPI,
                               ReverseScaleDpi=lambda value:value/NATIVE_FLOW_DPI))
module('carbonui.primitives.flowcontainer', FlowContainer=NativeFlow)
# Run the shipped wallet readable-number/currency/tooltip functions, with
# localization and math dependencies isolated from EVE's rendering engine.
native_money_ns = {'mathext': types.SimpleNamespace(
    round_to_significant=lambda value, significant_digits=3: float(format(value, '.%dg' % significant_digits)),
    pow=pow, floor=math.floor, log=math.log, is_close=math.isclose),
    'localization': types.SimpleNamespace(
        format_numeric=lambda value, use_grouping=True, decimal_places=0: numeric_display(value, useGrouping=use_grouping, decimalPlaces=decimal_places),
        get_by_label=lambda key: {'UI/Common/ISK':'ISK','UI/Util/UnitPrefixThousand':'thousand',
            'UI/Util/UnitPrefixMillion':'million','UI/Util/UnitPrefixBillion':'billion',
            'UI/Util/UnitPrefixTrillion':'trillion'}[key])}
for filename in ('eveformat/number.py', 'eveformat/currency.py'):
    tree = ast.parse((CLIENT_REFERENCE / filename).read_text(encoding='utf-8'))
    selected = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.Assign))]
    exec(compile(ast.Module(body=selected, type_ignores=[]), filename, 'exec'), native_money_ns)
native_eveformat = module('eveformat', **{key:value for key,value in native_money_ns.items() if callable(value)})
native_money_ns['eveformat'] = native_eveformat
native_money_ns['qtyConst'] = module('qtyTooltip.qtyConst', EDIT_INPUT_TYPE_ISK='ISK',
    MIN_AMOUNT_TO_DISPLAY_FULL_TEXT=10000, ABOUT_CHAR='≈')
tree = ast.parse((CLIENT_REFERENCE / 'qtyTooltip/tooltip.py').read_text(encoding='utf-8'))
selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name=='GetQtyText']
exec(compile(ast.Module(body=selected, type_ignores=[]), 'GetQtyText', 'exec'), native_money_ns)
module('qtyTooltip.tooltip', GetQtyText=native_money_ns['GetQtyText'])
ANIMATIONS = []
module('carbonui.uianimations', animations=types.SimpleNamespace(
    FadeTo=lambda widget, **kwargs: ANIMATIONS.append((widget, kwargs))))
TOOLTIPS = []

def popup(owner, showInstant=False):
    texts=[]
    panel=types.SimpleNamespace(LoadGeneric1ColumnTemplate=lambda:None,AddLabelLarge=lambda **kw:texts.append(kw['text']))
    owner.LoadTooltipPanel(panel)
    TOOLTIPS.append({'owner':owner,'texts':texts,'instant':showInstant})

module('carbonui.uicore',uicore=types.SimpleNamespace(uilib=types.SimpleNamespace(
    tooltipHandler=types.SimpleNamespace(_LoadTooltipPanel=popup))))

NS = {'unicode': str, 'long': int, '_NMB_TESTING': True}
for filename in ('i18n.py', 'sell_advisor.py', 'hud.py', 'wallet_summary.py', 'companion.py'):
    exec(compile((ROOT / 'client' / filename).read_text(encoding='utf-8'), filename, 'exec'), NS)


class Owner:
    def __init__(self):
        self.active = True
        self.jobs = []
        self.requests = []
        self.sleepHook = None
        self.requestHook = None
        self.advisor = True
        self.response = {'success': True, 'preview': {
            'referencePrice': 100, 'pricePercent': 110, 'chancePercent': 20,
            'eligible': True, 'message': 'Fair enough', 'warning': None}}

    def usable(self):
        return self.active

    def diagnostic(self, *args):
        pass

    def spawn(self, function, *args):
        self.jobs.append((function, args))

    def run(self):
        function, args = self.jobs.pop(0)
        function(*args)

    def sleep(self, milliseconds):
        if self.sleepHook:
            function, self.sleepHook = self.sleepHook, None
            function()

    def request(self, method, *args):
        self.requests.append((method, args))
        if self.requestHook:
            function, self.requestHook = self.requestHook, None
            function()
        return self.response


class ClientRows(unittest.TestCase):
    def setUp(self):
        class Row(Widget):
            def ApplyAttributes(self, attributes):
                self.height = 40
                self.typeID = 34
                self.stationID = 60003760
                self.price = 110
                self.quantity = 12
                self.duration = 90
                self.nativeChanges = 0

            def OnChange(self, *args):
                self.nativeChanges += 1
                return 'native'

            def MakeSingle(self):
                self.height = 80

            def RemoveSingle(self):
                self.height = 40

            def GetPrice(self):
                return self.price

            def GetQty(self):
                return self.quantity

            def GetDuration(self):
                return self.duration

        self.Row = Row
        self.owner = Owner()
        self.window = types.SimpleNamespace(GetIfOpen=lambda: None)
        self.advisor = NS['_NmbSellAdvisor'](self.owner, Row, self.window, Widget, Widget, C)
        self.originalChange = Row.OnChange
        self.advisor.install()
        self.row = Row()
        self.row.ApplyAttributes(None)

    def tearDown(self):
        self.advisor.close()

    def test_native_edit_return_and_sale_values_preserved(self):
        result = self.row.OnChange()
        self.owner.run()
        self.assertEqual(result, 'native')
        self.assertEqual(self.row.nativeChanges, 1)
        self.assertEqual((self.row.GetPrice(), self.row.GetQty()), (110, 12))
        self.assertIn('20.0%', self.advisor.rows[self.row]['title'].text)

    def test_rapid_price_and_quantity_edits_coalesce(self):
        for index in range(20):
            self.row.price = 120 + index
            self.row.quantity = 50 + index
            self.row.OnChange()
        self.assertEqual(len(self.owner.jobs), 1)
        self.owner.run()
        request = json.loads(self.owner.requests[0][1][0])
        self.assertEqual((request['price'], request['quantity']), (139, 69))
        self.assertEqual(len(self.owner.requests), 1)

    def test_debounce_waits_for_latest_edit(self):
        self.owner.sleepHook = lambda: self.row.OnChange()
        self.owner.run()
        self.assertEqual(len(self.owner.requests), 1)

    def test_edit_during_inflight_reply_requotes_latest_values(self):
        def edit():
            self.row.price = 150
            self.row.OnChange()
        self.owner.requestHook = edit
        self.owner.run()
        self.assertEqual(len(self.owner.requests), 2)
        self.assertEqual(json.loads(self.owner.requests[-1][1][0])['price'], 150)

    def test_immediate_duration_has_no_scheduled_buyer_preview(self):
        self.row.duration = 0
        self.row.OnChange()
        self.owner.run()
        self.assertEqual(self.owner.requests, [])
        self.assertIn('not applicable', self.advisor.rows[self.row]['title'].text)

    def test_single_multi_layout_and_cleanup_preserve_native_heights(self):
        self.assertEqual(self.row.height, 40 + self.advisor.stripHeight)
        self.row.MakeSingle()
        self.assertEqual(self.row.height, 80 + self.advisor.stripHeight)
        self.row.RemoveSingle()
        self.assertEqual(self.row.height, 40 + self.advisor.stripHeight)
        self.advisor.close()
        self.assertEqual(self.row.height, 40)
        self.assertIs(self.Row.OnChange, self.originalChange)

    def test_closed_row_reply_does_not_update_detached_widgets(self):
        state = self.advisor.rows[self.row]
        self.owner.requestHook = self.row.Close
        self.owner.run()
        self.assertNotIn(self.row, self.advisor.rows)
        self.assertTrue(state['strip'].destroyed)
        self.assertNotIn('20.0%', state['title'].text)

    def test_character_loss_during_rpc_does_not_paint_stale_advice(self):
        self.owner.requestHook = lambda: setattr(self.owner, 'active', False)
        self.owner.run()
        self.assertNotIn('20.0%', self.advisor.rows[self.row]['title'].text)

    def test_rpc_failure_leaves_native_sale_available(self):
        def fail():
            raise RuntimeError('offline')
        self.owner.requestHook = fail
        self.owner.run()
        self.assertEqual(self.advisor.rows[self.row]['title'].text, NS['_nmb_tr']('preview_unavailable'))
        self.assertEqual((self.row.price, self.row.quantity), (110, 12))

    def test_sell_advice_is_larger_and_expands_for_wrapped_translations(self):
        state = self.advisor.rows[self.row]
        self.assertEqual(state['title'].fontsize, 14)
        self.assertEqual(state['message'].fontsize, 14)
        state['title'].textheight = 88
        state['message'].textheight = 72
        self.advisor.layout(self.row)
        self.assertGreaterEqual(state['strip'].height, 172)
        self.assertEqual(self.row.height, 40 + state['strip'].height)
        self.advisor.detach(self.row)
        self.assertEqual(self.row.height, 40)

    def test_another_mod_wrapper_not_overwritten_during_cleanup(self):
        ours = self.Row.OnChange
        def later(row, *args):
            return ours(row, *args)
        self.Row.OnChange = later
        self.advisor.close()
        self.assertIs(self.Row.OnChange, later)
        self.assertEqual(self.row.OnChange(), 'native')


class ClientLifecycle(unittest.TestCase):
    def setUp(self):
        self.session = types.SimpleNamespace(charid=42)
        self.notifications = []
        NS['session'] = self.session
        self.sm = types.SimpleNamespace(RegisterForNotifyEvent=lambda obj, event: self.notifications.append((obj, event)),
                                        UnregisterForNotifyEvent=lambda obj, event: self.notifications.remove((obj, event)))
        NS['_nmb_context'] = {'sm': self.sm, 'session': self.session}
        self.tasks = []
        NS['_nmb_uthread'].new = lambda function, *args: self.tasks.append((function, args))
        self.install = NS['_nmb_install_sell_advisor']
        NS['_nmb_install_sell_advisor'] = lambda owner: types.SimpleNamespace(close=lambda: None)
        self.menu = module('evejs_mod_menu', register=lambda *args, **kwargs: types.SimpleNamespace(close=lambda: None))

    def owner(self):
        owner = NS['_NmbCompanion']()
        setattr(NS['_nmb_builtins'], '_evejs_npc_market_buyers_v1', owner)
        owner.sm, owner.session = self.sm, self.session
        return owner

    def run_task(self):
        function, args = self.tasks.pop(0)
        function(*args)

    def tearDown(self):
        previous = getattr(NS['_nmb_builtins'], '_evejs_npc_market_buyers_v1', None)
        if previous is not None:
            previous.close()
        NS['_nmb_install_sell_advisor'] = self.install

    def test_character_change_closes_advisor_menu_and_window(self):
        owner = self.owner()
        owner.ready = True
        owner.characterID = 42
        closed = []
        owner.advisor = types.SimpleNamespace(close=lambda: closed.append('advisor'))
        owner.registration = types.SimpleNamespace(close=lambda: closed.append('menu'))
        owner.windowClass = types.SimpleNamespace(CloseIfOpen=lambda: closed.append('window'))
        owner.registered = list(owner.__notifyevents__)
        self.notifications.extend((owner, event) for event in owner.registered)
        owner.OnSessionChanged(False, self.session, {'charid': (42, 43)})
        owner.close()
        self.assertEqual(closed, ['advisor', 'menu', 'window'])
        self.assertFalse(owner.usable())
        self.assertEqual(self.notifications, [])

    def test_reply_after_character_change_is_rejected(self):
        owner = self.owner()
        owner.ready = True
        owner.characterID = 42
        def rpc():
            self.session.charid = 43
            return '{"success":true}'
        self.sm.RemoteSvc = lambda service: types.SimpleNamespace(NpcMarketGetState=rpc)
        with self.assertRaisesRegex(RuntimeError, '[Ss]tale'):
            owner.request('NpcMarketGetState')

    def test_prelogin_delivery_waits_then_binds_after_character_selection(self):
        self.session.charid = None
        owner = NS['_nmb_start']()
        self.assertTrue(owner.active)
        self.assertFalse(owner.usable())
        self.run_task()  # Bootstrap discovers sm/session and subscribes without a character.
        self.assertEqual(len(self.notifications), 4)
        self.assertFalse(owner.usable())
        self.session.charid = 42
        owner.OnSessionChanged(False, self.session, {'charid': (None, 42)})
        self.run_task()
        self.assertTrue(owner.usable())
        self.assertIsNotNone(owner.advisor)
        self.assertIsNotNone(owner.registration)

    def test_logout_then_new_character_gets_fresh_generation(self):
        owner = self.owner()
        owner.start()
        self.run_task()
        old = owner.generation
        self.session.charid = None
        owner.OnSessionChanged(False, self.session, {'charid': (42, None)})
        self.assertTrue(owner.active)
        self.assertFalse(owner.usable())
        self.session.charid = 43
        owner.OnSessionChanged(False, self.session, {'charid': (None, 43)})
        self.run_task()
        self.assertTrue(owner.usable())
        self.assertEqual(owner.characterID, 43)
        self.assertGreater(owner.generation, old)

    def test_pending_work_from_previous_character_is_not_run_after_rebind(self):
        owner = self.owner()
        owner.start()
        self.run_task()
        called = []
        owner.spawn(lambda: called.append('old'))
        self.session.charid = 43
        owner.OnSessionChanged(False, self.session, {'charid': (42, 43)})
        self.run_task()  # Old guarded job.
        self.run_task()  # New character connection.
        self.assertEqual(called, [])
        self.assertTrue(owner.usable())

    def test_missing_initial_context_waits_for_context_without_rpc(self):
        owner = self.owner()
        NS['_nmb_context'] = {}
        def sleep(_):
            NS['_nmb_context'] = {'sm': self.sm, 'session': self.session}
        owner.sleep = sleep
        owner.start()
        self.run_task()
        self.assertTrue(owner.usable())

    def test_handshake_replacement_disposes_previous_owner(self):
        previous = self.owner()
        previous.start()
        self.run_task()
        current = NS['_nmb_start']()
        self.assertFalse(previous.active)
        self.assertIs(getattr(NS['_nmb_builtins'], '_evejs_npc_market_buyers_v1'), current)


class ClientHud(unittest.TestCase):
    def setUp(self):
        VIEW_PREFS.values.clear(); VIEW_PREFS.character = 42
        self.owner = Owner()
        self.Hud = NS['_nmb_make_window'](self.owner)
        self.hud = self.Hud()
        self.hud.ApplyAttributes(types.SimpleNamespace())
        self.owner.jobs = []  # Run only the operation under test, never the polling loop.
        self.hud._busy = False
        self.hud._state = {'canConfigure': True, 'status': {'running': True}}
        self.hud._config = {'enabled': True, 'ironMode': True, 'offlinePurchases': False, 'useEveAveragePrices': False, 'randomBatch': True, 'minimumBatchPercent': 0.01, 'intervalSeconds': 900, 'chanceAtReference': 35,
            'maxPricePercent': 125, 'warnAbovePercent': 110, 'warnBelowPercent': 80,
            'dailyBudgetISK': 250000000, 'sellerDailyBudgetISK': 50000000,
            'cycleBudgetISK': 25000000, 'batchPercent': 10, 'tqDailyVolumePercent': 0.1,
            'referenceRegionID': 10000002, 'referenceStationID': 60003760,
            'maxQuoteAgeSeconds': 3600, 'historyLookbackDays': 7}
        self.hud._state['defaultConfig'] = dict(self.hud._config)
        self.hud._revision = 7

    def test_wheel_over_every_field_and_reset_scrolls_without_editing(self):
        self.hud._config['ironMode'] = False  # Expose the money/limits inputs too.
        self.hud.RenderConfigure()
        before = self.hud.ReadPolicy()
        for key, (control, kind) in self.hud._editors.items():
            for widget in (control, self.hud._resetButtons[key]):
                self.assertTrue(widget.OnMouseWheel(120))
                self.assertTrue(widget.OnMouseWheel(-120))
        self.assertEqual(self.hud.ReadPolicy(), before)
        self.assertFalse(self.hud._dirty)
        self.assertEqual(self.owner.requests, [])
        self.assertEqual(self.hud._configScroll.wheelPixels,
            [-50.4, 50.4] * (2 * len(self.hud._editors)))

    def test_small_reset_icons_align_beside_every_editor_and_use_server_defaults(self):
        self.hud._config.update(ironMode=False, chanceAtReference=77)
        self.hud._state['defaultConfig']['chanceAtReference'] = 42
        self.hud.RenderConfigure()
        self.assertEqual(set(self.hud._resetButtons), set(self.hud._editors))
        for key, reset in self.hud._resetButtons.items():
            reset.Update_Size_()  # Native Button must not expand it to its 80px minimum.
            self.assertEqual((reset.width, reset.height), (32, 32))
            self.assertEqual(reset.label, '')
            self.assertEqual(self.hud._editors[key][0].left, 40)
            self.assertEqual(reset.top, self.hud._editors[key][0].top)
            self.assertEqual([len(child.points) for child in reset.children], [17, 3, 17, 3])
            self.assertIn(NS['_nmb_tr']('reset_field'), reset.hint)
        before = dict(self.hud._config)
        self.hud._resetButtons['chanceAtReference'].func()
        self.assertEqual(self.hud.ReadPolicy(), dict(before, chanceAtReference=42))
        self.assertTrue(self.hud._dirty)
        self.assertEqual(self.owner.requests, [])

    def test_reset_already_default_or_reverted_draft_is_clean(self):
        self.hud._page = 'configure'
        self.hud.RenderConfigure()
        self.hud.ResetSetting('chanceAtReference')
        self.assertFalse(self.hud._dirty)
        self.hud._editors['chanceAtReference'][0].SetValue('77')
        self.hud.Changed()
        self.assertTrue(self.hud._dirty)
        self.hud.ResetSetting('chanceAtReference')
        self.assertFalse(self.hud._dirty)
        self.hud.SelectPage('orders')
        self.assertEqual(self.hud._page, 'orders')
        self.assertEqual(self.owner.requests, [])

    def test_money_reset_updates_native_grouping_and_readable_caption(self):
        self.hud._config.update(ironMode=False, dailyBudgetISK=9999999)
        self.hud.RenderConfigure()
        self.hud.ResetSetting('dailyBudgetISK')
        editor = self.hud._editors['dailyBudgetISK'][0]
        self.assertEqual(editor.GetValue(), 250000000)
        self.assertEqual(editor.displayText, '250,000,000.00')
        self.assertIn('250 million ISK', self.hud._moneyCaptions['dailyBudgetISK'].text)
        self.assertTrue(self.hud._dirty)

    def test_reference_resets_keep_main_station_in_selected_region(self):
        self.hud._config.update(referenceRegionID=10000043, referenceStationID=60002173)
        self.hud.RenderConfigure()
        self.hud.ResetSetting('referenceStationID')
        self.assertEqual(self.hud.ReadPolicy()['referenceRegionID'], 10000043)
        self.assertEqual(self.hud.ReadPolicy()['referenceStationID'], 60008494)
        self.hud.ResetSetting('referenceRegionID')
        self.assertEqual(self.hud.ReadPolicy()['referenceRegionID'], 10000002)
        self.assertEqual(self.hud.ReadPolicy()['referenceStationID'], 60003760)
        self.assertEqual(self.owner.requests, [])
        self.hud._config.update(referenceRegionID=10000099, referenceStationID=60009999)
        self.hud.RenderConfigure()
        self.assertEqual(self.hud._resetButtons['referenceStationID'].state, C.UI_DISABLED)
        self.hud.ResetSetting('referenceStationID')
        self.assertEqual(self.hud.ReadPolicy()['referenceStationID'], 60009999)

    def test_readonly_hidden_and_unavailable_default_resets_cannot_change_draft(self):
        self.hud._config['dailyBudgetISK'] = 5
        self.hud.RenderConfigure()  # Unlimited hides limits.
        self.hud.ResetSetting('dailyBudgetISK')
        self.assertEqual(self.hud.ReadPolicy()['dailyBudgetISK'], 5)
        self.hud._state['canConfigure'] = False
        self.hud.RenderConfigure()
        self.assertTrue(all(button.state == C.UI_DISABLED for button in self.hud._resetButtons.values()))
        self.hud.ResetSetting('ironMode')
        self.assertFalse(self.hud._dirty)
        self.hud._state.update(canConfigure=True, defaultConfig={})
        self.hud.RenderConfigure()
        self.assertTrue(all(button.state == C.UI_DISABLED for button in self.hud._resetButtons.values()))

    def widgets(self, root=None):
        root = root or self.hud.body
        return [root] + [item for child in root.children for item in self.widgets(child)]

    def texts(self):
        return [w.text for w in self.widgets() if w.text]

    def sample_orders(self):
        return [{'orderID':9,'typeID':34,'price':900,'quantity':600000,'originalQuantity':1000000,
            'preview':{'referencePrice':856.39,'referenceKind':'eve_average','pricePercent':105.1,
                'chancePercent':27.4,'minQuantity':60,'maxQuantity':60000,'reason':'eligible','warning':'fair'}}]

    def test_inventory_menu_uses_native_controls_and_switches_without_rpc_or_dirty_policy(self):
        self.hud.RenderOrders(self.sample_orders())
        self.assertIsInstance(self.hud._viewButton, NativeMenuButton)
        self.assertEqual(self.hud.ViewMode('orders'), 'details')
        menu = self.hud._viewButton.GetMenu()
        self.assertEqual([entry.text for entry in menu], [NS['_nmb_tr']('view_'+mode) for mode in ('icons','details','list')])
        self.assertEqual([entry.texturePath for entry in menu], ['grid_view','details_view','list_view'])
        menu.GetEntries()[2].func()
        self.assertEqual(self.hud.ViewMode('orders'),'list')
        self.assertEqual(self.hud._viewButton.texturePath,'list_view')
        self.assertIn(NS['_nmb_tr']('view_list'), self.hud._viewButton.hint)
        self.assertFalse(self.hud._dirty)
        self.assertEqual(self.hud._revision,7)
        self.assertEqual(self.owner.requests,[])
        children=list(self.hud.body.children)
        self.hud.SetViewMode('orders','list')
        self.assertEqual(children,self.hud.body.children)

    def test_view_preferences_survive_reopen_are_separate_per_tab_and_per_character(self):
        VIEW_PREFS.Set('inventoryViewMode','icons')
        self.hud.RenderOrders(self.sample_orders())
        self.hud.SetViewMode('orders','list')
        self.hud._page='activity'; self.hud.RenderActivity([])
        self.hud.SetViewMode('activity','icons')
        reopened=self.Hud();reopened.ApplyAttributes(types.SimpleNamespace())
        self.assertEqual(reopened.ViewMode('orders'),'list')
        self.assertEqual(reopened.ViewMode('activity'),'icons')
        self.assertEqual(VIEW_PREFS.Get('inventoryViewMode',None),'icons')
        VIEW_PREFS.character=43
        self.assertEqual(reopened.ViewMode('orders'),'details')
        self.assertEqual(reopened.ViewMode('activity'),'details')
        VIEW_PREFS.Set('evejsNpcMarketBuyersView_orders','broken')
        self.assertEqual(reopened.ViewMode('orders'),'details')
        VIEW_PREFS.character=42
        self.assertEqual(reopened.ViewMode('orders'),'list')

    def test_stale_view_menu_callbacks_cannot_change_configuration_or_closed_window(self):
        self.hud.RenderOrders(self.sample_orders())
        menu=self.hud.ViewMenu('orders')
        self.hud._page='configure';self.hud.RenderConfigure()
        menu.GetEntries()[2].func()
        self.assertEqual(self.hud.ViewMode('orders'),'details')
        self.assertFalse(self.hud._dirty)
        self.hud._page='orders';self.hud.Close()
        menu.GetEntries()[0].func()
        self.assertEqual(self.hud.ViewMode('orders'),'details')

    def test_every_order_view_keeps_quantity_prices_fallback_and_warning_information(self):
        rows=self.sample_orders()
        for mode in ('details','icons','list'):
            self.hud._viewSettings['orders'].set(mode)
            self.hud.RenderOrders(rows)
            text='\n'.join(self.texts())
            self.assertIn('600,000',text);self.assertIn('1,000,000',text)
            self.assertIn('900.00 ISK',text);self.assertIn('856.39 ISK',text)
            self.assertIn('27.4%',text);self.assertIn(NS['_nmb_tr']('eve_average'),text)
            self.assertEqual(self.hud._orderQuantities,{'9':600000})
            self.hud._helpIcons[-1].OnClick()
            detail='\n'.join(TOOLTIPS[-1]['texts'])
            self.assertIn('600,000',detail)
            if mode != 'details':
                self.assertIn('400,000',detail);self.assertIn('60,000',detail)
                self.assertIn(NS['_nmb_tr']('fair_price'),detail)
            children=list(self.hud.body.children)
            self.hud.RenderOrders(rows);self.assertEqual(children,self.hud.body.children)
        unknown=[dict(rows[0],originalQuantity=None,preview={'reason':'missing_quote','chancePercent':0})]
        self.hud.RenderOrders(unknown)
        self.hud._helpIcons[-1].OnClick()
        self.assertIn(NS['_nmb_tr']('help_original_unknown'),'\n'.join(TOOLTIPS[-1]['texts']))
        self.assertIn(NS['_nmb_tr']('missing_quote'),'\n'.join(TOOLTIPS[-1]['texts']))

    def test_compact_activity_views_preserve_offline_tax_dates_and_recovery_without_double_payment(self):
        self.hud._page='activity'
        rows=[{'kind':'purchase','timestamp':1791583200000,'quantity':100,'typeID':34,'grossISK':90000,
            'taxISK':7200,'orderID':9,'offlinePurchase':True},
            {'kind':'purchase','timestamp':1791496800000,'quantity':1,'typeID':241,'grossISK':900,'orderID':10},
            {'kind':'recovery','timestamp':1791496799000,'resolution':'settled','grossISK':90000,'taxISK':7200},
            {'kind':'recovery','timestamp':1791496798000}, {'kind':'configuration','timestamp':1791496797000}]
        for mode in ('icons','list'):
            self.hud._viewSettings['activity'].set(mode)
            self.hud.RenderActivity(rows)
            text='\n'.join(self.texts())
            self.assertEqual(text.count('+82,800.00 ISK'),1)
            self.assertIn(NS['_nmb_tr']('net_unknown'),text)
            self.assertIn(NS['_nmb_tr']('offline_purchase'),text)
            self.assertIn(NS['_nmb_tr']('confirmed'),text)
            self.assertIn(NS['_nmb_tr']('pending'),text)
            self.assertIn('2026-10-09',text);self.assertIn('2026-10-08',text)
            if mode == 'list':
                icons=[w for w in self.widgets() if getattr(w,'typeID',None)]
                self.assertEqual([w.typeID for w in icons],[34,241])
                for icon in icons:
                    thumbnail=icon.parent
                    self.assertEqual((thumbnail.width,thumbnail.height,thumbnail.top),(36,36,15))
                    content=next(w for w in thumbnail.parent.children if getattr(w,'padding',None)==(100,9,8,0))
                    self.assertEqual(content.padding[0],100)
            self.hud._helpIcons[2].OnClick()  # Archive and Net received explanations precede the first sale.
            helpText='\n'.join(TOOLTIPS[-1]['texts'])
            self.assertIn('7,200.00 ISK',helpText)
            self.assertIn(NS['_nmb_tr']('offline_time_hint'),helpText)
            self.assertEqual(self.hud.ActivityPresentation(rows[2])['net'],'—')
        for mode in ('icons','details','list'):
            self.hud._viewSettings['activity'].set(mode);self.hud.RenderActivity([])
            self.assertIn(NS['_nmb_tr']('no_activity'),self.texts())
            self.assertEqual(len(self.hud.ViewMenu('activity')),3)

    def test_latest_poll_result_keeps_view_selected_while_rpc_was_inflight(self):
        rows=self.sample_orders();self.hud.RenderOrders(rows)
        changed=[dict(rows[0],quantity=500000)]
        responses={'NpcMarketGetState':{'success':True,'config':self.hud._config,'revision':7,
            'status':{'running':True}},'NpcMarketGetOrders':{'success':True,'orders':changed}}
        def request(method,*args):
            self.owner.requests.append((method,args))
            self.hud.SetViewMode('orders','list')
            return responses[method]
        self.owner.request=request
        self.hud.Refresh();self.owner.run()
        self.assertEqual(self.hud.ViewMode('orders'),'list')
        self.assertEqual(self.hud._orderQuantities,{'9':500000})
        self.assertIn('500,000',self.texts())
        self.assertFalse(self.hud._dirty)

    def test_native_icon_flow_wraps_on_resize_at_minimum_default_width_and_client_scaling(self):
        global NATIVE_FLOW_DPI
        try:
            for page,cardWidth,cardHeight in (('orders',252,278),('activity',304,340)):
                self.hud._viewSettings[page].set('icons')
                if page == 'orders':
                    self.hud.RenderOrders([dict(self.sample_orders()[0],orderID=index) for index in range(15)])
                else:
                    self.hud.RenderActivity([{'kind':'configuration','timestamp':1791583200000} for index in range(15)])
                grid=next(w for w in self.widgets() if isinstance(w,NativeFlow))
                self.assertEqual(len(grid.children),15)
                for scale in (1,1.25,1.5):
                    NATIVE_FLOW_DPI=scale
                    for width in (1072,1312,1700,1072):
                        grid._childrenAlignmentDirty=True
                        grid.UpdateAlignment(0,0,width*scale,1000*scale)
                        perRow=int((width+10)//(cardWidth+10))
                        self.assertEqual(grid.height,math.ceil(15/perRow)*(cardHeight+10)-10)
                        for card in grid.children:
                            self.assertGreaterEqual(card.displayX,0)
                            self.assertLessEqual(card.displayX+card.displayWidth,width*scale)
                            self.assertLessEqual(card.displayY+card.displayHeight,grid.height*scale)
        finally:
            NATIVE_FLOW_DPI=1

    def test_compact_views_handle_two_hundred_orders_without_dropping_rows_or_payment_data(self):
        rows=[dict(self.sample_orders()[0],orderID=index) for index in range(200)]
        for mode in ('icons','list'):
            self.hud._viewSettings['orders'].set(mode);self.hud.RenderOrders(rows)
            self.assertEqual(len(self.hud._orderQuantities),200)
            self.assertEqual(len(self.hud._helpIcons),200)
            self.assertIn(NS['_nmb_tr']('first_orders'),self.texts())
            self.assertEqual(self.owner.requests,[])

    def test_order_original_remaining_progress_and_unknown_original_are_honest(self):
        preview = {'referencePrice': 10, 'pricePercent':100, 'chancePercent':35, 'reason':'eligible'}
        orders = [{'orderID':9,'typeID':34,'price':10,'quantity':42,'originalQuantity':100,'preview':preview}]
        self.hud.RenderOrders(orders)
        self.assertIn('100', self.texts());self.assertIn('42', self.texts())
        self.assertIn(NS['_nmb_tr']('remaining_progress',remaining='42',original='100'),self.texts())
        icon = self.hud._helpIcons[0]
        panel = types.SimpleNamespace(LoadGeneric1ColumnTemplate=lambda:None, AddLabelLarge=lambda **kw:help_text.append(kw['text']))
        help_text=[];icon._nmb_load_help(panel)
        self.assertIn('42', ''.join(help_text));self.assertIn('58', ''.join(help_text))
        previous=list(self.hud.body.children)
        self.hud.RenderOrders(orders);self.assertEqual(self.hud.body.children,previous)
        orders[0]['quantity']=40;self.hud.RenderOrders(orders)
        self.assertIn(NS['_nmb_tr']('remaining_progress',remaining='40',original='100'),self.texts())
        self.assertTrue(any(options.get('endVal')==0 for _,options in ANIMATIONS))
        orders[0].pop('originalQuantity');self.hud.RenderOrders(orders)
        self.assertIn(NS['_nmb_tr']('original_unknown'),self.texts())

    def test_offline_status_animates_only_on_state_change_and_shortcut_focuses_without_toggling(self):
        self.hud.RenderSummary()
        self.hud._config['offlinePurchases']=True;self.hud.RenderSummary()
        self.assertIn(NS['_nmb_tr']('on'),self.hud.offlineLabel.text)
        self.assertIs(ANIMATIONS[-1][0],self.hud.offlineDot)
        self.assertEqual(ANIMATIONS[-1][1]['loops'],C.ANIM_REPEAT)
        count=len(ANIMATIONS);self.hud.RenderSummary();self.assertEqual(len(ANIMATIONS),count)
        self.hud._state['status']['catchingUp']=True;self.hud.RenderSummary()
        self.assertIn(NS['_nmb_tr']('catching_up'),self.hud.offlineLabel.text)
        self.owner.response={**self.hud._state,'config':dict(self.hud._config),'revision':7}
        self.hud.offlineStatus.OnClick();self.owner.run()
        self.assertEqual(self.hud._page,'configure')
        control=self.hud._editors['offlinePurchases'][0]
        self.assertTrue(control.focused);self.assertTrue(control.GetValue())
        self.assertIs(self.hud._configScroll.revealed,self.hud._configRows['offlinePurchases'])
        self.assertIs(TOOLTIPS[-1]['owner'],self.hud._configHelpIcons['offlinePurchases'])
        self.assertIn(NS['_nmb_tr']('help_offlinePurchases'),TOOLTIPS[-1]['texts'])
        self.assertFalse(self.hud._dirty)
        self.assertNotIn('NpcMarketConfigure',[method for method,args in self.owner.requests])
        self.hud._editors['chanceAtReference'][0].SetValue('55');self.hud.Changed()
        self.hud.OpenOfflineSettings()
        self.assertEqual(self.hud._editors['chanceAtReference'][0].GetValue(),'55')
        self.assertTrue(self.hud._dirty)
        self.hud.CloseByUser();self.assertTrue(self.hud.offlineDot.stoppedAnimations)

    def test_offline_shortcut_during_orders_rpc_discards_stale_page_and_finishes_navigation(self):
        def state():
            self.owner.requestHook = self.hud.OpenOfflineSettings
        self.owner.response={'config':dict(self.hud._config),'status':{'running':True},'canConfigure':True,'revision':7}
        self.owner.requestHook=state
        self.hud.Refresh();self.owner.run()
        self.assertEqual(self.hud._page,'configure');self.assertEqual(len(self.owner.jobs),1)
        self.owner.run()
        self.assertTrue(self.hud._editors['offlinePurchases'][0].focused)
        self.assertFalse(self.hud._busy)

    def test_all_controls_have_help_and_all_action_buttons_are_in_footer(self):
        self.hud._page='configure';self.hud.RenderConfigure()
        self.assertEqual(set(self.hud._editors),set(NS['_NMB_HELP_KEYS']))
        self.assertEqual(len(self.hud._helpIcons),len(self.hud._editors))
        for icon in self.hud._helpIcons:
            icon.OnClick()
            self.assertIs(TOOLTIPS[-1]['owner'],icon)
            self.assertTrue(TOOLTIPS[-1]['instant'])
            self.assertTrue(all(text and '{' not in text for text in TOOLTIPS[-1]['texts']))
            self.assertTrue(callable(icon.LoadTooltipPanel))
        for widget in list(self.hud.tabs.values()) + [self.hud.closeButton,self.hud.saveButton,self.hud.reloadButton,self.hud.refreshButton]:
            ancestor=widget
            while ancestor is not self.hud.footer:
                ancestor=ancestor.parent
        self.assertNotIn('intervalSeconds',self.hud._editors)
        self.assertFalse(hasattr(self.hud,'_helpPane'))
        self.assertTrue(all(control.width==330 for control,kind in self.hud._editors.values()))

    def test_native_button_intrinsics_keep_one_footer_row_sized_for_every_page(self):
        self.assertTrue(NATIVE_BUTTON_CONTRACT,'Extract the shipped native button evidence first')
        buttons=list(self.hud.tabs.values())+[self.hud.closeButton,self.hud.saveButton,self.hud.reloadButton,self.hud.refreshButton]
        for page in ('orders','configure','activity'):
            self.hud._page=page;self.hud.ClearBody()
            for b in buttons:
                b.Update_Size_()  # Exact shipped native method, not Widget dimensions.
                self.assertIs(b.parent,self.hud.buttonRow)
                self.assertIn(b.align,(C.TOLEFT,C.TORIGHT))
                self.assertEqual(b.height,40);self.assertGreaterEqual(b.width,120)
            visible=[b for b in buttons if getattr(b,'state',C.UI_NORMAL)!=C.UI_HIDDEN]
            self.assertLessEqual(sum(b.width for b in visible),self.Hud.default_minSize[0]-48)
            boxes=footer_rectangles(buttons,self.Hud.default_minSize[0]-48,self.hud.buttonRow.height)
            for x,y,w,h in boxes:
                self.assertEqual(h,40);self.assertGreaterEqual(x,0);self.assertLessEqual(x+w,self.Hud.default_minSize[0]-48)
            for index,(x,y,w,h) in enumerate(boxes):
                self.assertTrue(all(x+w<=x2 or x2+w2<=x for x2,y2,w2,h2 in boxes[index+1:]))
            self.assertEqual(self.hud.tabLines[page].state,C.UI_DISABLED)
        old=types.SimpleNamespace(padding=(0,0,0,0),pos=(0,0,80,32))
        NativeAlignment.UpdateToAllAlignment(old,False,0,0,144,40)
        self.assertEqual(old.displayRect[3],8)  # Reproduce the exact old thin strip.

    def test_offline_indicators_align_match_when_on_and_are_red_when_off(self):
        self.hud.RenderSummary()
        self.assertIs(self.hud.engineStatus.parent,self.hud.offlineStatus.parent)
        self.assertEqual((self.hud.engineDot.top,self.hud.engineDot.width,self.hud.engineDot.height),
                         (self.hud.offlineDot.top,self.hud.offlineDot.width,self.hud.offlineDot.height))
        self.assertEqual((self.hud.statusLabel.left,self.hud.statusLabel.top,self.hud.statusLabel.fontsize),
                         (self.hud.offlineLabel.left,self.hud.offlineLabel.top,self.hud.offlineLabel.fontsize))
        red=self.hud.offlineLabel.color
        self.assertGreater(red[0],red[1]);self.assertEqual(self.hud.offlineDot.children[1].text,'•')
        self.hud._config['offlinePurchases']=True;self.hud.RenderSummary()
        self.assertEqual(self.hud.offlineDot.children[0].points,self.hud.engineDot.children[0].points)
        self.assertEqual(self.hud.offlineDot.children[1].color,self.hud.engineDot.children[1].color)
        self.assertEqual(self.hud.offlineLabel.color,self.hud.statusLabel.color)
        self.assertEqual(ANIMATIONS[-1][1],ANIMATIONS[-2][1])
        self.assertEqual(ANIMATIONS[-1][1]['loops'],C.ANIM_REPEAT)
        self.assertEqual(self.hud.modeBadge.left,self.hud.referenceLabel.textwidth+24)

    def test_activity_shows_net_once_and_does_not_invent_payment_for_pending_or_missing_tax(self):
        self.hud._page='activity'
        rows=[{'kind':'purchase','quantity':10,'typeID':34,'grossISK':100,'taxISK':8,'orderID':9,'timestamp':0},
              {'kind':'recovery','resolution':'pending','timestamp':1},
              {'kind':'recovery','resolution':'settled','timestamp':2},
              {'kind':'purchase','quantity':1,'typeID':34,'grossISK':10,'timestamp':3}]
        self.hud.RenderActivity(rows)
        texts=self.texts()
        self.assertEqual(texts.count('+'+NS['_nmb_isk'](92)),1)
        self.assertEqual(sum(t.startswith('+') for t in texts),1)
        self.assertIn(NS['_nmb_tr']('net_unknown'),texts)
        self.assertIn(NS['_nmb_tr']('pending_detail'),texts)
        self.assertIn(NS['_nmb_tr']('confirmed_detail'),texts)

    def test_price_status_aligns_and_opens_setting_without_toggling_or_dirtying(self):
        self.hud.RenderSummary()
        self.assertIn(NS['_nmb_tr']('tq_trade_hub'),self.hud.priceLabel.text)
        self.assertEqual((self.hud.priceLabel.left,self.hud.priceLabel.top,self.hud.priceLabel.fontsize),
            (self.hud.statusLabel.left,self.hud.statusLabel.top,self.hud.statusLabel.fontsize))
        self.assertEqual(self.hud.priceStatus.top-self.hud.offlineStatus.top,34)
        self.assertLessEqual(self.hud.priceStatus.top+self.hud.priceStatus.height,self.hud.statusRail.height)
        self.hud._page='configure';self.hud.RenderConfigure()
        self.hud.priceStatus.OnClick()
        control=self.hud._editors['useEveAveragePrices'][0]
        self.assertFalse(control.GetValue());self.assertTrue(control.focused)
        self.assertIs(self.hud._configScroll.revealed,self.hud._configRows['useEveAveragePrices'])
        self.assertIn(NS['_nmb_tr']('help_useEveAveragePrices'),TOOLTIPS[-1]['texts'])
        self.assertFalse(self.hud._dirty)

    def test_price_source_preserves_hub_choices_and_status_updates_only_after_save(self):
        self.hud._page='configure';self.hud.RenderConfigure();self.hud.RenderSummary()
        control=self.hud._editors['useEveAveragePrices'][0]
        self.assertEqual(control.options,[('TQ trade hub',False),('EVE average',True)])
        control.SetValue(True);self.hud.Changed()
        self.assertTrue(self.hud._dirty)
        for key in ('referenceRegionID','referenceStationID','historyLookbackDays'):
            self.assertEqual(self.hud._editors[key][0].state,C.UI_DISABLED)
        self.hud.RenderSummary();self.assertIn('TQ trade hub',self.hud.priceLabel.text)
        self.hud._editors['ironMode'][0].SetValue(False);self.hud.Changed()
        self.assertEqual(self.hud._editors['historyLookbackDays'][0].state,C.UI_NORMAL)
        self.owner.response={'success':True,'revision':8}
        self.hud.SavePolicy();self.owner.run()
        saved=json.loads(self.owner.requests[-1][1][0])['config']
        self.assertTrue(saved['useEveAveragePrices']);self.assertEqual(saved['referenceStationID'],60003760)
        self.assertIn('EVE average',self.hud.priceLabel.text)
        self.assertEqual(self.hud.referenceLabel.text,NS['_nmb_tr']('average_reference_inline'))
        control=self.hud._editors['useEveAveragePrices'][0]
        control.SetValue(False);self.hud.Changed();control.SetValue(True);self.hud.Changed()
        self.assertFalse(self.hud._dirty)

    def test_native_close_button_accepts_setClosed_and_invalidates_queued_refresh(self):
        self.hud.Refresh()
        self.hud.CloseByUser()
        self.assertTrue(self.hud.destroyed)
        self.assertTrue(self.hud.setClosed)
        self.owner.run()
        self.assertFalse(self.hud.Valid())
        self.assertNotIn('config', self.hud._state)
        reopened = self.Hud.Open()
        self.assertFalse(reopened.destroyed)
        reopened.Close(setClosed=True)
        self.assertTrue(reopened.destroyed)

    def test_close_during_save_discards_reply_and_does_not_reopen_window(self):
        self.hud.RenderConfigure()
        self.hud._editors['chanceAtReference'][0].SetValue('40')
        self.hud.Changed()
        self.owner.response = {'success': True, 'revision': 8}
        self.owner.requestHook = self.hud.CloseByUser
        self.hud.SavePolicy()
        self.owner.run()
        self.assertTrue(self.hud.destroyed)
        self.assertEqual(self.hud._revision, 7)

    def test_iron_mode_hides_optional_limits_and_reveals_them_immediately_when_switched(self):
        self.hud.RenderConfigure()
        keys = ('dailyBudgetISK', 'sellerDailyBudgetISK', 'cycleBudgetISK', 'tqDailyVolumePercent')
        self.assertTrue(all(self.hud._editors[key][0].state == C.UI_DISABLED for key in keys))
        self.assertEqual(self.hud._configSections['limits_group'].state,C.UI_HIDDEN)
        self.assertTrue(all(self.hud._configRows[key].state == C.UI_HIDDEN for key in keys))
        self.hud._editors['ironMode'][0].SetValue(False)
        self.hud.Changed()
        self.assertTrue(all(self.hud._editors[key][0].state == C.UI_NORMAL for key in keys))
        self.assertEqual(self.hud._configSections['limits_group'].state,C.UI_NORMAL)
        self.assertTrue(all(self.hud._configRows[key].state == C.UI_NORMAL for key in keys))
        self.hud.SavePolicy()
        self.owner.run()
        self.assertFalse(json.loads(self.owner.requests[0][1][0])['config']['ironMode'])

    def test_dynamic_settings_cover_mode_source_and_batch_without_rebuilding_drafts(self):
        self.hud.RenderConfigure()
        originals={key:control for key,(control,kind) in self.hud._editors.items()}
        for iron in (False,True):
            for average in (False,True):
                for random in (False,True):
                    for key,value in (('ironMode',iron),('useEveAveragePrices',average),('randomBatch',random)):
                        self.hud._editors[key][0].SetValue(value)
                    self.hud.Changed()
                    hidden={key for key,row in self.hud._configRows.items() if row.state==C.UI_HIDDEN}
                    expected=set()
                    if iron:expected.update(('dailyBudgetISK','sellerDailyBudgetISK','cycleBudgetISK','tqDailyVolumePercent'))
                    if not random:expected.add('minimumBatchPercent')
                    if average:
                        expected.add('referenceStationID')
                        if iron:expected.update(('referenceRegionID','historyLookbackDays'))
                    self.assertEqual(hidden,expected,(iron,average,random))
                    self.assertTrue(all(self.hud._editors[key][0] is control for key,control in originals.items()))
        # Fields retain unfinished drafts when hidden/revealed without a save.
        self.hud._editors['ironMode'][0].SetValue(False);self.hud.Changed()
        budget=self.hud._editors['dailyBudgetISK'][0];budget.SetValue(123456789.5)
        self.hud._editors['ironMode'][0].SetValue(True);self.hud.Changed()
        self.assertEqual(self.hud.ReadPolicy()['dailyBudgetISK'],250000000)
        self.hud._editors['ironMode'][0].SetValue(False);self.hud.Changed()
        self.assertEqual(budget.GetValue(),123456789.5)
        self.assertEqual(self.hud.ReadPolicy()['dailyBudgetISK'],123456789.5)

    def test_hidden_invalid_limit_does_not_block_saving_iron_mode_or_reset_saved_values(self):
        self.hud._config['ironMode']=False;self.hud.RenderConfigure()
        self.hud._editors['tqDailyVolumePercent'][0].SetValue('unfinished')
        self.hud.Changed();self.assertTrue(self.hud._dirty)
        self.hud._editors['ironMode'][0].SetValue(True)
        # No callback needed: saving/navigating must use the current selection.
        self.hud.SavePolicy();self.owner.run()
        saved=json.loads(self.owner.requests[-1][1][0])['config']
        self.assertTrue(saved['ironMode']);self.assertEqual(saved['tqDailyVolumePercent'],0.1)
        self.assertEqual(saved['dailyBudgetISK'],250000000)

    def test_limited_average_shows_quota_region_and_keeps_its_station_pair_consistent(self):
        self.hud._config.update(ironMode=False,useEveAveragePrices=True);self.hud.RenderConfigure()
        self.hud._editors['referenceRegionID'][0].SetValue(10000043)
        config=self.hud.ReadPolicy()
        self.assertEqual(config['referenceRegionID'],10000043);self.assertEqual(config['referenceStationID'],60008494)
        self.assertEqual(self.hud._configRows['referenceStationID'].state,C.UI_HIDDEN)
        self.assertEqual(self.hud._configLabels['referenceRegionID'].text,NS['_nmb_tr']('demand_region_setting'))
        self.assertIn(NS['_nmb_tr']('help_demand_region'),self.hud.ConfigHelp('referenceRegionID'))
        self.hud._state['canConfigure']=False;self.hud.Changed()
        self.assertEqual(self.hud._configRows['dailyBudgetISK'].state,C.UI_NORMAL)
        self.assertEqual(self.hud._editors['dailyBudgetISK'][0].state,C.UI_DISABLED)

    def test_policy_save_preserves_permission_and_uses_revision(self):
        self.hud.RenderConfigure()
        self.hud._editors['chanceAtReference'][0].SetValue('42.5')
        self.hud.Changed()
        self.owner.response = {'success': True, 'revision': 8}
        self.hud.SavePolicy()
        self.owner.run()
        method, args = self.owner.requests[0]
        request = json.loads(args[0])
        self.assertEqual(method, 'NpcMarketConfigure')
        self.assertEqual(request['revision'], 7)
        self.assertEqual(request['config']['chanceAtReference'], 42.5)
        self.assertEqual(request['config']['tqDailyVolumePercent'], 0.1)
        self.assertTrue(self.hud._state['canConfigure'])
        self.assertFalse(self.hud._dirty)

    def test_large_reference_station_is_not_clamped_by_native_int_control(self):
        self.hud._config['referenceStationID'] = 1030000000001
        self.hud.RenderConfigure()
        control = self.hud._editors['referenceStationID'][0]
        self.assertEqual(control.GetValue(), 1030000000001)
        self.assertIn(1030000000001, [value for label, value in control.options])
        self.hud.Changed()
        self.assertFalse(self.hud._dirty)

    def test_player_cannot_submit_policy_from_readonly_hud(self):
        self.hud._state['canConfigure'] = False
        self.hud.RenderConfigure()
        self.hud.SavePolicy()
        self.assertEqual(self.owner.jobs, [])
        self.assertTrue(all(control.state == C.UI_DISABLED for control, kind in self.hud._editors.values()))

    def test_failed_save_preserves_dirty_draft(self):
        self.hud.RenderConfigure()
        self.hud._editors['chanceAtReference'][0].SetValue('40')
        self.hud.Changed()
        def fail():
            raise RuntimeError('Policy changed in another window')
        self.owner.requestHook = fail
        self.hud.SavePolicy()
        self.owner.run()
        self.assertTrue(self.hud._dirty)
        self.assertIn('another window', self.hud.notice.text)

    def test_edit_during_successful_save_preserves_newer_draft_and_revision(self):
        self.hud.RenderConfigure()
        editor = self.hud._editors['chanceAtReference'][0]
        editor.SetValue('40')
        self.hud.Changed()
        self.owner.response = {'success': True, 'revision': 8}
        def edit():
            editor.SetValue('50')
            self.hud.Changed()
        self.owner.requestHook = edit
        self.hud.SavePolicy()
        self.owner.run()
        self.assertEqual(self.hud._revision, 8)
        self.assertTrue(self.hud._dirty)
        self.assertEqual(editor.GetValue(), '50')
        self.assertEqual(self.hud._config['chanceAtReference'], 40)

    def test_selecting_current_options_does_not_block_navigation(self):
        self.hud._page = 'configure'
        self.hud.RenderConfigure()
        for key in ('enabled', 'ironMode', 'offlinePurchases', 'randomBatch'):
            control = self.hud._editors[key][0]
            control.callback(control, 'same selection', control.GetValue())
            self.assertFalse(self.hud._dirty, key)
        self.hud.SelectPage('orders')
        self.assertEqual(self.hud._page, 'orders')
        self.assertNotIn('NpcMarketConfigure', [method for method, args in self.owner.requests])

    def test_changed_then_reverted_option_unblocks_navigation(self):
        self.hud._page = 'configure'
        self.hud.RenderConfigure()
        control = self.hud._editors['offlinePurchases'][0]
        control.SetValue(True)
        self.hud.Changed()
        self.hud.SelectPage('activity')
        self.assertEqual(self.hud._page, 'configure')
        self.assertTrue(self.hud._dirty)
        control.SetValue(False)
        self.hud.Changed()
        self.assertFalse(self.hud._dirty)
        self.assertNotEqual(self.hud.notice.text, NS['_nmb_tr']('unsaved_draft'))
        self.hud.SelectPage('activity')
        self.assertEqual(self.hud._page, 'activity')

    def test_equivalent_number_formats_are_clean_in_every_language(self):
        previous = sys.modules.get('localization')
        try:
            for language in NS['_NMB_LANGUAGES']:
                module('localization', GetLanguageID=lambda: language)
                self.hud.RenderConfigure()
                self.hud._editors['chanceAtReference'][0].SetValue(
                    ' 35,000 ' if language in ('de', 'fr', 'es', 'ru') else ' 35.000 ')
                self.hud._editors['maxQuoteAgeSeconds'][0].SetValue('003600')
                self.hud.Changed()
                self.assertFalse(self.hud._dirty, language)
        finally:
            if previous is None:
                sys.modules.pop('localization', None)
            else:
                sys.modules['localization'] = previous

    def test_unchanged_save_does_not_submit_or_bump_revision(self):
        self.hud.RenderConfigure()
        self.hud.Changed()
        self.hud.SavePolicy()
        self.assertEqual(self.owner.jobs, [])
        self.assertEqual(self.owner.requests, [])
        self.assertEqual(self.hud._revision, 7)

    def test_invalid_numeric_draft_stays_guarded_until_restored(self):
        self.hud._page = 'configure'
        self.hud.RenderConfigure()
        control = self.hud._editors['chanceAtReference'][0]
        for value in ('', 'nan', 'inf', 'not a number'):
            control.SetValue(value)
            self.hud.Changed()
            self.assertTrue(self.hud._dirty)
            self.hud.SelectPage('activity')
            self.assertEqual(self.hud._page, 'configure')
            self.hud.SavePolicy()
            self.assertEqual(self.owner.jobs, [])
        control.SetValue('35')
        self.hud.Changed()
        self.assertFalse(self.hud._dirty)
        self.hud.SelectPage('activity')
        self.assertEqual(self.hud._page, 'activity')

    def test_same_selection_or_reverted_edits_during_save_leave_no_false_draft(self):
        for revert in (False, True):
            self.hud.RenderConfigure()
            editor = self.hud._editors['chanceAtReference'][0]
            editor.SetValue('40')
            self.hud.Changed()
            self.owner.response = {'success': True, 'config': dict(self.hud._config, chanceAtReference=40), 'revision': 8}
            def edit():
                if revert:
                    editor.SetValue('50')
                    self.hud.Changed()
                    editor.SetValue('40.0')
                self.hud.Changed()
            self.owner.requestHook = edit
            self.hud.SavePolicy()
            self.owner.run()
            self.assertFalse(self.hud._dirty)
            self.assertEqual(self.hud._revision, 8)
            self.hud._config['chanceAtReference'] = 35

    def test_navigation_waits_for_pending_save_then_allows_reverted_draft(self):
        self.hud._page = 'configure'
        self.hud.RenderConfigure()
        editor = self.hud._editors['chanceAtReference'][0]
        editor.SetValue('40')
        self.hud.Changed()
        self.owner.response = {'success': True, 'revision': 8}
        def edit():
            editor.SetValue('35')
            self.hud.Changed()
            self.hud.SelectPage('orders')
            self.assertEqual(self.hud._page, 'configure')
            self.assertEqual(self.hud.notice.text, NS['_nmb_tr']('saving_policy'))
        self.owner.requestHook = edit
        self.hud.SavePolicy()
        self.owner.run()
        self.assertFalse(self.hud._saving)
        self.assertTrue(self.hud._dirty)  # 40 was saved while the draft reverted to 35.
        editor.SetValue('40')
        self.hud.Changed()
        self.hud.SelectPage('orders')
        self.assertEqual(self.hud._page, 'orders')

    def test_trade_regions_filter_stations_and_choose_each_major_hub(self):
        self.hud.RenderConfigure()
        region = self.hud._editors['referenceRegionID'][0]
        station = self.hud._editors['referenceStationID'][0]
        self.assertEqual({value for label,value in region.options}, {10000002,10000043,10000032,10000030,10000042})
        self.assertEqual(station.GetValue(), 60003760)
        for regionID, stationID in ((10000043,60008494), (10000032,60011866), (10000030,60004588), (10000042,60005686)):
            region.SetValue(regionID)
            region.callback(region, 'region', regionID)
            self.assertEqual(station.GetValue(), stationID)
            self.assertEqual([value for label,value in station.options], [stationID])
            draft = self.hud.ReadPolicy()
            self.assertEqual((draft['referenceRegionID'],draft['referenceStationID']), (regionID,stationID))
            self.assertTrue(self.hud._dirty)
        region.SetValue(10000002)
        region.callback(region, 'region', 10000002)
        self.assertEqual(station.GetValue(), 60003760)
        self.assertFalse(self.hud._dirty)

    def test_reselecting_region_preserves_existing_station_and_saved_custom_region(self):
        self.hud._config.update(referenceRegionID=10000001, referenceStationID=1030000000001)
        self.hud.RenderConfigure()
        region = self.hud._editors['referenceRegionID'][0]
        station = self.hud._editors['referenceStationID'][0]
        region.callback(region, 'same', region.GetValue())
        self.assertEqual(station.GetValue(),1030000000001)
        self.assertFalse(self.hud._dirty)
        region.SetValue(10000043);region.callback(region, 'Amarr',10000043)
        self.assertEqual(station.GetValue(),60008494)
        region.SetValue(10000001);region.callback(region,'saved',10000001)
        self.assertEqual(station.GetValue(),1030000000001)
        self.assertFalse(self.hud._dirty)

    def test_save_before_queued_region_callback_still_sends_matching_station(self):
        self.hud.RenderConfigure()
        self.hud._editors['referenceRegionID'][0].SetValue(10000043)
        # Native Combo dispatches its callback in a separate tasklet.
        self.hud.SavePolicy()
        self.owner.run()
        request = json.loads(self.owner.requests[0][1][0])
        self.assertEqual(request['config']['referenceRegionID'],10000043)
        self.assertEqual(request['config']['referenceStationID'],60008494)

    def test_reference_popup_names_and_summary_follow_selected_hub(self):
        self.hud._config.update(referenceRegionID=10000043,referenceStationID=60008494)
        self.hud.RenderConfigure()
        self.hud.RenderSummary()
        self.assertIn('Amarr / Domain',self.hud.referenceLabel.text)
        self.assertIn('60008494',self.hud.ConfigHelp('referenceStationID'))
        self.assertEqual(self.hud._editors['referenceStationID'][0].options[0][0],'Amarr VIII (Oris)')

    def test_wallet_budget_controls_group_digits_and_return_numeric_cents(self):
        self.hud._config['ironMode']=False
        self.hud.RenderConfigure()
        for key, value in (('dailyBudgetISK',250000000),('sellerDailyBudgetISK',50000000),('cycleBudgetISK',25000000)):
            control, kind = self.hud._editors[key]
            self.assertIsInstance(control,NativeMoney)
            self.assertEqual(kind,'money')
            self.assertEqual(control.displayText,format(value,',.2f'))
            self.assertEqual(control.GetValue(),value)
        control.SetValue('9,999,999.75')
        self.assertTrue(NUMERIC_FORMAT_CALLS[-1]['useGrouping'])
        self.assertEqual(NUMERIC_FORMAT_CALLS[-1]['decimalPlaces'],2)
        self.hud.Changed()
        self.assertEqual(control.displayText,'9,999,999.75')
        self.assertEqual(self.hud.ReadPolicy()['cycleBudgetISK'],9999999.75)
        control.SetValue(25000000)
        self.hud.Changed()
        self.assertFalse(self.hud._dirty)
        self.assertNotIsInstance(self.hud._editors['tqDailyVolumePercent'][0],NativeMoney)

    def test_wallet_readable_captions_show_below_fields_and_follow_edits(self):
        self.hud._config['ironMode']=False
        self.hud.RenderConfigure()
        self.assertNotIn('minimumOrders',self.hud._editors)
        for key, text in (('dailyBudgetISK','250 million ISK'),('sellerDailyBudgetISK','50 million ISK'),('cycleBudgetISK','25 million ISK')):
            caption = self.hud._moneyCaptions[key]
            self.assertEqual(caption.text,text)
            self.assertEqual((caption.align,caption.width,caption.top),(C.TOPRIGHT,330,48))
            self.assertGreaterEqual(caption.parent.height,82)
        control = self.hud._editors['dailyBudgetISK'][0]
        for value, expected in ((1000,'1 thousand ISK'),(9999999,'≈ 10 million ISK'),(10000,'10 thousand ISK'),(1000000000,'1 billion ISK'),(0,'0.00 ISK')):
            control.SetValue(value);self.hud.Changed()
            self.assertEqual(self.hud._moneyCaptions['dailyBudgetISK'].text,expected)
            self.assertEqual(self.hud.ReadPolicy()['dailyBudgetISK'],value)
        control.SetValue(250000000);self.hud.Changed()
        self.assertFalse(self.hud._dirty)

    def test_average_fallback_is_labelled_in_orders_and_changes_render_signature(self):
        preview={'referencePrice':10,'pricePercent':100,'chancePercent':35,'reason':'eligible','eligible':True}
        row={'typeID':34,'orderID':9,'quantity':1,'price':10,'preview':preview}
        self.hud.RenderOrders([row]);self.assertNotIn(NS['_nmb_tr']('eve_average'),self.texts())
        preview['referenceKind']='eve_average'
        self.hud.RenderOrders([row]);self.assertIn(NS['_nmb_tr']('eve_average'),self.texts())
        preview['referenceKind']='local_buy_order'
        self.hud.RenderOrders([row]);self.assertIn(NS['_nmb_tr']('local_buy_offer'),self.texts())
        title,message,color=NS['_nmb_advice_text']({'preview':preview,'config':self.hud._config})
        self.assertIn(NS['_nmb_tr']('local_buy_offer'),title)

    def test_unlimited_mode_badge_and_dropdown_are_renamed_in_every_language(self):
        previous=NS['_nmb_language']
        try:
            for language in NS['_NMB_LANGUAGES']:
                NS['_nmb_language']=lambda value=None,code=language:code
                self.hud.RenderSummary()
                self.assertEqual(self.hud.modeLabel.text,NS['_nmb_tr']('iron_mode_badge'))
                self.hud.RenderConfigure()
                option=self.hud._editors['ironMode'][0]
                self.assertIn(NS['_nmb_tr']('iron_mode'),[text for text,value in option.options])
        finally:
            NS['_nmb_language']=previous

    def test_actual_server_rpc_contract_renders_order_and_activity_and_saves(self):
        self.hud.RenderConfigure()
        self.hud._editors['chanceAtReference'][0].SetValue('42.5')
        self.hud.SavePolicy()
        self.owner.run()
        configureInput = self.owner.requests[0][1][0]
        request = {'quoteInput': json.dumps({'typeID':34,'price':100,'quantity':12,
                    'stationID':60003760,'duration':90}), 'configureInput':configureInput}
        raw = subprocess.check_output(['node', str(ROOT / 'tests' / 'client_rpc_fixture.cjs')],
                                      input=json.dumps(request).encode('utf-8'))
        result = json.loads(raw)
        self.assertTrue(result['quote']['success'])
        self.assertEqual(result['orders']['orders'][0]['volRemaining'], 12)
        self.assertEqual(len(result['orders']['orders']), 1)
        self.assertEqual(result['activity']['activity'][0]['totalISK'], 220)
        self.assertTrue(result['configure']['success'])
        self.assertEqual(result['configure']['config']['chanceAtReference'], 42.5)
        self.assertEqual(result['state']['defaultConfig']['chanceAtReference'], 35)
        self.assertEqual(result['state']['defaultConfig']['intervalSeconds'], 900)
        self.hud._state = result['state']
        self.hud._config = result['state']['config']
        self.hud.RenderConfigure()
        self.assertEqual(self.hud.DefaultValue('chanceAtReference'), 35)
        self.hud.RenderSummary()
        self.hud.RenderOrders(result['orders']['orders'])
        self.hud.RenderActivity(result['activity']['activity'])
        title, message, color = NS['_nmb_advice_text'](result['quote'])
        self.assertNotIn(' min', title)
        self.assertIn('NPC 35.0%', title)
        self.assertIn('Batch 1', title)
        self.assertEqual(color, (0.39, 0.86, 0.79, 1.0))

    def test_actual_settlement_unavailable_rpc_is_zero_chance_and_hud_unavailable(self):
        request = {'quoteInput': json.dumps({'typeID':34,'price':110,'quantity':12,
                    'stationID':60003760,'duration':90}), 'blocked':True}
        raw = subprocess.check_output(['node', str(ROOT / 'tests' / 'client_rpc_fixture.cjs')],
                                      input=json.dumps(request).encode('utf-8'))
        result = json.loads(raw)
        self.assertEqual(result['quote']['preview']['chancePercent'], 0)
        self.hud._state = result['state']
        self.hud._config = result['state']['config']
        self.hud.RenderSummary()
        self.assertEqual(self.hud.statusLabel.text, 'UNAVAILABLE')
        self.assertEqual(self.hud.notice.text, NS['_nmb_tr']('settlement_unavailable'))

    def test_top_chance_card_and_purchase_timer_are_removed_and_interval_has_no_editor(self):
        self.hud._state['referenceChancePercent'] = 35
        self.hud.RenderSummary()
        self.assertFalse(hasattr(self.hud, 'chanceLabel'))
        self.assertFalse(hasattr(self.hud, 'cycleLabel'))
        self.assertEqual(self.hud.offlineLabel.text, NS['_nmb_tr']('offline_status', state=NS['_nmb_tr']('off')))
        self.hud.RenderConfigure()
        self.assertNotIn('intervalSeconds', self.hud._editors)


    def test_statistics_renders_financial_values_and_custom_days_without_dirty_policy(self):
        self.hud._page = 'statistics'
        self.hud.RenderStatistics({'days':None,'until':1791648000000,'bucketDays':1,
            'totals':{'grossISK':1000,'taxISK':80,'netISK':920,'purchases':3,'units':50},
            'buckets':[{'at':1791561600000,'grossISK':1000,'taxISK':80,'netISK':920,'purchases':3}],
            'topItems':[{'typeID':34,'grossISK':1000}],
            'sources':[{'offline':True,'netISK':920}],'averageDailyNetISK':920})
        for amount in ('1,000.00 ISK','80.00 ISK','920.00 ISK'):
            self.assertIn(amount,self.texts())
        self.hud.SelectStatisticsPeriod(None,'','custom')
        self.assertEqual(self.hud._statisticsDayEdit.state,C.UI_NORMAL)
        self.hud._statisticsDayEdit.SetValue(17)
        self.hud.ApplyStatisticsDays()
        self.assertEqual(self.hud._statisticsDays,17)
        self.assertFalse(self.hud._dirty)

    def test_wallet_units_cover_thousand_million_billion_trillion_in_every_order_view(self):
        for value, word in ((1850,'thousand'),(250000000,'million'),(1250000000,'billion'),(1000000000000,'trillion')):
            self.assertIn(word,NS['_nmb_readable_isk'](value))
            row=dict(self.sample_orders()[0],price=value)
            self.hud._orderSummary={'activeCount':1,'soldISK':value,'remainingISK':value,'totalISK':value*2}
            for mode in ('icons','details','list'):
                self.hud._viewSettings['orders'].set(mode)
                self.hud.RenderOrders([row])
                self.assertIn(NS['_nmb_readable_isk'](value),self.texts())
        self.assertTrue(NS['_nmb_readable_isk'](-1850).startswith('-'))

    def test_activity_money_descriptions_survive_all_three_views(self):
        row={'kind':'purchase','typeID':34,'orderID':9,'timestamp':1791583200000,
            'quantity':1,'grossISK':1000000000,'taxISK':80000000}
        for mode in ('icons','details','list'):
            self.hud._viewSettings['activity'].set(mode)
            self.hud.RenderActivity([row])
            self.assertIn('1 billion ISK','\n'.join(self.texts()))
            self.assertIn('920 million ISK',self.texts())

    def test_our_wallet_descriptions_add_native_units_without_changing_the_receipt(self):
        text='Gross 1.000.000.000,00 ISK; tax 80.000.000,00 ISK.'
        reason=json.dumps({'npcMarketBuyersOfflineSummary':{'version':1,'text':text,
            'amounts':{'1.000.000.000,00':1000000000,'80.000.000,00':80000000}}},separators=(',',':'))
        result=NS['_nmb_wallet_summary_text'](reason)
        self.assertIn('1.000.000.000,00 ISK (1 billion ISK)',result)
        self.assertIn('80.000.000,00 ISK (80 million ISK)',result)

    def test_statistics_poll_does_not_reset_custom_choice_or_rebuild_identical_totals(self):
        self.hud._page='statistics'
        data={'since':1791561600000,'until':1791648000000,'totals':{},'buckets':[]}
        self.hud.RenderStatistics(data)
        self.hud.SelectStatisticsPeriod(None,'','custom')
        original=self.hud._statisticsDayEdit
        original.SetValue(17)
        self.hud.RenderStatistics(dict(data,since=data['since']+20000,until=data['until']+20000))
        self.assertIs(original,self.hud._statisticsDayEdit)
        self.assertEqual(original.GetValue(),17)
        self.hud._renderSignature=None
        self.hud.RenderStatistics(data)
        self.assertEqual(self.hud._statisticsDayEdit.state,C.UI_NORMAL)
        self.assertEqual(self.hud._statisticsDayEdit.GetValue(),17)

    def test_archive_navigation_is_bounded_reversible_and_scope_change_resets_cursor(self):
        self.hud._page = 'activity'
        self.hud._activityMeta = {'recentCount':500,'archiveCount':10500,'nextCursor':{'at':99,'id':8}}
        self.hud.RenderActivity([])
        self.hud.ActivityNext()
        self.assertEqual(self.hud._activityPage,1)
        self.assertEqual(self.hud._activityCursors,[None,{'at':99,'id':8}])
        self.hud._busy=False
        self.hud.ActivityPrevious()
        self.assertEqual(self.hud._activityPage,0)
        self.hud.SelectActivityScope(None,'','archive')
        self.assertEqual(self.hud._activityCursors,[None])
        self.assertFalse(self.hud._dirty)

class ClientLanguages(unittest.TestCase):
    def setUp(self):
        VIEW_PREFS.values.clear(); VIEW_PREFS.character = 42
        self.previous = sys.modules.get('localization')
        self.language = 'en'
        module('localization', GetLanguageID=lambda: self.language)

    def tearDown(self):
        if self.previous is None:
            sys.modules.pop('localization', None)
        else:
            sys.modules['localization'] = self.previous

    def test_all_eight_catalogues_have_complete_matching_placeholders_and_embedded_text(self):
        catalogue = json.loads((ROOT / 'client/locales.json').read_text(encoding='utf-8'))
        self.assertEqual(catalogue['languages'], ['en', 'de', 'fr', 'es', 'ru', 'zh', 'ja', 'ko'])
        formatter = string.Formatter()
        def fields(text):
            return sorted((name, spec, conversion) for _, name, spec, conversion in formatter.parse(text) if name is not None)
        for key, row in catalogue['strings'].items():
            self.assertEqual(len(row), 8, key)
            for code, translated in zip(catalogue['languages'], row):
                self.assertTrue(translated.strip(), (code, key))
                self.assertEqual(fields(translated), fields(row[0]), (code, key))
                self.assertEqual(NS['_NMB_TRANSLATIONS'][code][key], translated)
        for filename in ('i18n.py', 'sell_advisor.py', 'hud.py', 'wallet_summary.py', 'companion.py'):
            tree = ast.parse((ROOT / 'client' / filename).read_text(encoding='utf-8'))
            for call in (node for node in ast.walk(tree) if isinstance(node, ast.Call)):
                if isinstance(call.func, ast.Name) and call.func.id == '_nmb_tr' and call.args and isinstance(call.args[0], ast.Constant):
                    self.assertIn(call.args[0].value, catalogue['strings'], filename)

    def test_language_ids_normalize_to_every_client_language_with_english_fallback(self):
        for raw, expected in [('EN', 'en'), ('en-us', 'en'), ('DE', 'de'), ('fr-FR', 'fr'),
                              ('ES', 'es'), ('RU', 'ru'), ('ZH_CN', 'zh'), ('cn', 'zh'),
                              ('JA', 'ja'), ('jp', 'ja'), ('KO', 'ko'), ('unknown', 'en')]:
            self.assertEqual(NS['_nmb_language'](raw), expected)

    def test_all_languages_render_advice_warnings_activity_settings_and_errors(self):
        config = {'enabled':True,'ironMode':True,'offlinePurchases':False,'useEveAveragePrices':False,'randomBatch':True,'intervalSeconds':900,
            'chanceAtReference':35,'maxPricePercent':125,'warnAbovePercent':110,'warnBelowPercent':80,
            'dailyBudgetISK':250000000,'sellerDailyBudgetISK':50000000,'cycleBudgetISK':25000000,
            'batchPercent':10,'minimumBatchPercent':0.01,'tqDailyVolumePercent':0.1,
            'referenceRegionID':10000002,'referenceStationID':60003760,'maxQuoteAgeSeconds':3600,
            'historyLookbackDays':7}
        preview = {'referencePrice':10,'pricePercent':100,'chancePercent':35,'minQuantity':100,
                   'maxQuantity':100000,'eligible':True,'reason':'eligible','warning':'fair'}
        for code in NS['_NMB_LANGUAGES']:
            with self.subTest(language=code):
                VIEW_PREFS.values.clear()
                self.language = code
                names = NS['_nmb_menu_labels']()
                self.assertEqual(names[code], NS['_nmb_tr']('app_name'))
                owner = Owner()
                Hud = NS['_nmb_make_window'](owner)
                self.assertEqual(Hud.default_caption, names[code])
                hud = Hud();hud.ApplyAttributes(types.SimpleNamespace());owner.jobs=[];hud._busy=False
                hud._state = {'canConfigure':True,'status':{'running':True},'referenceChancePercent':35,'defaultConfig':dict(config)}
                hud._config = config;hud._revision=7
                hud.RenderSummary();self.assertEqual(hud.statusLabel.text, NS['_nmb_tr']('active'))
                hud.RenderOrders([{'typeID':34,'orderID':9,'quantity':1000000,'price':10,'preview':preview}])
                hud.RenderActivity([{'kind':'purchase','quantity':100,'typeID':34,'timestamp':0,'orderID':9,'grossISK':1000}])
                hud.RenderStatistics({'until':1791648000000,'totals':{'grossISK':1000000000,'netISK':920000000,'taxISK':80000000},
                    'buckets':[{'at':1791561600000,'netISK':920000000,'taxISK':80000000}],
                    'topItems':[{'typeID':34,'grossISK':1000000000}],'sources':[{'offline':True,'netISK':920000000}]})
                for mode in ('icons','details','list'):
                    hud._viewSettings['orders'].set(mode)
                    hud.RenderOrders([{'typeID':34,'orderID':9,'quantity':1000000,'price':10,'preview':preview}])
                    self.assertIn(NS['_nmb_tr']('view_' + mode),hud._viewButton.hint)
                    self.assertEqual([entry.text for entry in hud._viewButton.GetMenu()],
                        [NS['_nmb_tr']('view_' + option) for option in ('icons','details','list')])
                    hud._viewSettings['activity'].set(mode)
                    hud.RenderActivity([{'kind':'purchase','quantity':100,'typeID':34,'timestamp':0,'orderID':9,'grossISK':1000}])
                    self.assertIn(NS['_nmb_tr']('view_' + mode),hud._viewButton.hint)
                hud._page='configure';hud.RenderConfigure()
                self.assertEqual(set(hud._editors),set(NS['_NMB_HELP_KEYS']))
                for key, reset in hud._resetButtons.items():
                    self.assertEqual((reset.width, reset.height), (32, 32))
                    self.assertEqual(reset.state, C.UI_NORMAL)
                    self.assertIn(NS['_nmb_tr']('reset_field'), reset.hint)
                    self.assertNotIn('{', reset.hint)
                hud._editors['chanceAtReference'][0].SetValue('42,5')
                hud.Changed()
                hud.ResetSetting('chanceAtReference')
                self.assertEqual(hud.ReadPolicy()['chanceAtReference'],35)
                self.assertFalse(hud._dirty)
                for icon in hud._helpIcons:
                    icon.OnClick()
                    self.assertTrue(all(text and '{' not in text for text in TOOLTIPS[-1]['texts']))
                hud.OpenOfflineSettings()
                self.assertIn(NS['_nmb_tr']('help_offlinePurchases'),TOOLTIPS[-1]['texts'])
                self.assertLessEqual(sum(b.width for b in list(hud.tabs.values())+[hud.closeButton,hud.saveButton,hud.reloadButton]),Hud.default_minSize[0]-48)
                boxes=footer_rectangles(list(hud.tabs.values())+[hud.closeButton,hud.saveButton,hud.reloadButton],Hud.default_minSize[0]-48,hud.buttonRow.height)
                self.assertTrue(all(x>=0 and x+w<=Hud.default_minSize[0]-48 and h==40 for x,y,w,h in boxes))
                self.assertNotIn('15',NS['_nmb_tr']('chance_setting'))
                self.assertEqual(hud._editors['randomBatch'][0].options[0][0], NS['_nmb_tr']('random_batches'))
                hud.OpenPriceSourceSettings()
                self.assertIn(NS['_nmb_tr']('help_useEveAveragePrices'),TOOLTIPS[-1]['texts'])
                hud._config=dict(config,useEveAveragePrices=True);hud.RenderSummary()
                self.assertIn(NS['_nmb_tr']('eve_average'),hud.priceLabel.text)
                for reason in ('missing_quote','missing_average','invalid_order','stale_quote','thin_market','disabled',
                               'price_cap','demand_limit','budget_limit','settlement_unavailable','immediate_sale','zero_chance'):
                    message=NS['_nmb_preview_message']({**preview,'reason':reason},config)
                    self.assertTrue(message and '{' not in message, (code,reason,message))
                for warning in ('fair','high','low'):
                    title,message,color=NS['_nmb_advice_text']({'preview':{**preview,'warning':warning},'config':config})
                    self.assertIn('100–100000',title)
                    self.assertTrue(message and '{' not in message)
                title,message,color=NS['_nmb_advice_text']({'preview':{**preview,'referenceKind':'eve_average'},'config':config})
                self.assertIn(NS['_nmb_tr']('eve_average'),title)
                self.assertIn('100–100000',title)
                for kind in ('configuration','rejected','recovery','other'):
                    self.assertTrue(NS['_nmb_activity_title']({'kind':kind},'Type 34'))
                error=NS['_nmb_response_error']({'errorKey':'setting_range',
                    'errorParams':{'setting':'batchPercent','minimum':0.01,'maximum':100}})
                self.assertIn(NS['_nmb_tr']('batch_max_setting'),error)
                hud.CloseByUser();self.assertTrue(hud.destroyed)

    def test_european_decimal_input_saves_as_numeric_wire_values(self):
        for code in ('de','fr','es','ru'):
            self.language=code
            self.assertEqual(NS['_nmb_numeric_text'](0.01),'0,01')
            self.assertEqual(NS['_nmb_parse_number']('0,01'),0.01)
            self.assertEqual(NS['_nmb_parse_number']('0.01'),0.01)

    def test_language_refresh_rebinds_the_companion_and_discards_old_window(self):
        owner=NS['_NmbCompanion']()
        setattr(NS['_nmb_builtins'],'_evejs_npc_market_buyers_v1',owner)
        owner.session=types.SimpleNamespace(charid=42)
        owner.characterID=42;owner.ready=True
        old=owner.generation
        owner.OnUIRefresh()
        self.assertGreater(owner.generation,old)
        self.assertFalse(owner.ready)
        owner.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
