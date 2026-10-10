# -*- coding: utf-8 -*-
"""Advisory-only attachment to build 3396210's real native Sell Items rows."""
import json as _nmb_json
import math as _nmb_math


def _nmb_text(value):
    return unicode(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _nmb_number(value, fallback=0.0):
    try:
        number = float(value)
        return number if not (_nmb_math.isnan(number) or _nmb_math.isinf(number)) else fallback
    except (ValueError, TypeError, OverflowError):
        return fallback


def _nmb_isk(value):
    return u'{:,.2f} ISK'.format(_nmb_number(value))


def _nmb_readable_isk(value):
    """Use the client's localized wallet units, including thousand and trillion."""
    amount = _nmb_number(value)
    from qtyTooltip.tooltip import GetQtyText
    from qtyTooltip.qtyConst import EDIT_INPUT_TYPE_ISK
    import eveformat
    text = GetQtyText(abs(amount), EDIT_INPUT_TYPE_ISK) or eveformat.isk_readable(abs(amount))
    return (u'-' if amount < 0 else u'') + unicode(text)


def _nmb_isk_explained(value):
    return u'{} ({})'.format(_nmb_isk(value), _nmb_readable_isk(value))


def _nmb_advice_text(response):
    preview = response.get('preview') or {}
    reference = preview.get('referencePrice')
    percent = preview.get('pricePercent')
    chance = _nmb_number(preview.get('chancePercent'))
    if reference is None or percent is None:
        title = _nmb_tr('no_reference_title')
    else:
        titleKey = {'eve_average': 'advice_average_title', 'local_buy_order': 'advice_local_title'}.get(preview.get('referenceKind'), 'advice_title')
        title = _nmb_tr(titleKey, reference=_nmb_isk_explained(reference), percent=_nmb_number(percent),
                        chance=chance, minimum=preview.get('minQuantity', '?'),
                        maximum=preview.get('maxQuantity', '?'))
    message = _nmb_preview_message(preview, response.get('config'))
    warning = preview.get('warning')
    color = (1.0, 0.67, 0.31, 1.0) if warning in ('high', 'low', 'unavailable') or not preview.get('eligible') else (0.39, 0.86, 0.79, 1.0)
    return title, unicode(message), color


class _NmbSellAdvisor(object):
    """Composable method wrappers, per-row debounce, stale reply exclusion."""
    stripHeight = 112

    def __init__(self, owner, rowClass, windowClass, containerFactory, labelFactory, constants):
        self.owner = owner
        self.generation = getattr(owner, 'generation', 0)
        self.rowClass = rowClass
        self.windowClass = windowClass
        self.containerFactory = containerFactory
        self.labelFactory = labelFactory
        self.constants = constants
        self.rows = {}
        self.hooks = []
        self.active = True

    def install(self):
        required = ('ApplyAttributes', 'OnChange', 'MakeSingle', 'RemoveSingle', 'Close',
                    'GetPrice', 'GetQty', 'GetDuration')
        if any(not callable(getattr(self.rowClass, name, None)) for name in required):
            raise RuntimeError('Unsupported Sell Items row API; native sales remain available.')
        advisor = self
        for name in ('ApplyAttributes', 'OnChange', 'MakeSingle', 'RemoveSingle', 'Close'):
            original = getattr(self.rowClass, name)

            def build(method, native):
                def wrapper(row, *args, **kwargs):
                    if method == 'Close':
                        advisor.safe(advisor.detach, row)
                    result = native(row, *args, **kwargs)
                    if advisor.active and advisor.owner.usable():
                        if method == 'ApplyAttributes':
                            advisor.safe(advisor.attach, row)
                        elif method == 'OnChange':
                            advisor.safe(advisor.queue, row)
                        elif method in ('MakeSingle', 'RemoveSingle'):
                            advisor.safe(advisor.layout, row, True)
                    return result
                return wrapper

            wrapper = build(name, original)
            setattr(self.rowClass, name, wrapper)
            self.hooks.append((name, original, wrapper))
        wnd = self.windowClass.GetIfOpen()
        if wnd and not getattr(wnd, 'destroyed', False):
            for row in tuple(getattr(wnd, 'itemList', ())):
                self.safe(self.attach, row)
        return self

    def safe(self, function, *args):
        try:
            return function(*args)
        except Exception:
            self.owner.diagnostic('NPC market advisory UI failed; native sale preserved')

    def attach(self, row):
        if row in self.rows or getattr(row, 'destroyed', False):
            return
        C = self.constants
        strip = self.containerFactory(parent=row, name='npcMarketAdvice', align=C.TOBOTTOM,
                                      height=self.stripHeight, idx=0, padLeft=8, padRight=8)
        title = self.labelFactory(parent=strip, align=C.TOTOP, text=_nmb_tr('checking_reference'),
                                  fontsize=14, bold=True, state=C.UI_DISABLED, maxLines=3)
        message = self.labelFactory(parent=strip, align=C.TOTOP, text='', fontsize=14,
                                    state=C.UI_DISABLED, maxLines=3, padTop=4)
        self.rows[row] = {'strip': strip, 'title': title, 'message': message,
                          'baseHeight': row.height, 'token': 0, 'working': False}
        self.layout(row)
        self.queue(row)

    def layout(self, row, nativeReset=False):
        state = self.rows.get(row)
        if state is None:
            return
        if nativeReset:
            state['baseHeight'] = row.height
        measured = sum(max(0, _nmb_number(getattr(state[key], 'textheight', 0))) for key in ('title', 'message')) + 12
        state['height'] = max(self.stripHeight, int(_nmb_math.ceil(measured)))
        state['strip'].height = state['height']
        row.height = state['baseHeight'] + state['height']

    def valid(self, row, state, token=None):
        return (self.active and self.owner.usable() and self.generation == getattr(self.owner, 'generation', 0)
                and not getattr(row, 'destroyed', False)
                and self.rows.get(row) is state
                and (token is None or state['token'] == token))

    def snapshot(self, row):
        return {'typeID': int(row.typeID), 'price': float(row.GetPrice()),
                'quantity': int(row.GetQty()), 'stationID': int(row.stationID),
                'duration': int(row.GetDuration() or 0)}

    def queue(self, row):
        state = self.rows.get(row)
        if state is None or not self.valid(row, state):
            return
        state['token'] += 1
        state['title'].text = _nmb_tr('checking_updated')
        state['message'].text = ''
        self.layout(row)
        if not state['working']:
            state['working'] = True
            self.owner.spawn(self.work, row, state)

    def work(self, row, state):
        try:
            while self.valid(row, state):
                token = state['token']
                self.owner.sleep(350)
                if not self.valid(row, state):
                    return
                if state['token'] != token:
                    continue
                try:
                    snapshot = self.snapshot(row)
                    if snapshot['duration'] == 0:
                        if self.valid(row, state, token):
                            state['title'].text = _nmb_tr('immediate_title')
                            state['message'].text = _nmb_tr('choose_duration')
                            self.layout(row)
                        return
                    if snapshot['price'] <= 0 or snapshot['quantity'] <= 0:
                        raise _NmbUiError(_nmb_tr('invalid_order'))
                    response = self.owner.request('NpcMarketQuote', _nmb_json.dumps(snapshot))
                    if self.valid(row, state, token) and self.snapshot(row) == snapshot:
                        title, message, color = _nmb_advice_text(response)
                        state['title'].text = _nmb_text(title)
                        state['message'].text = _nmb_text(message)
                        state['message'].color = color
                        state['strip'].hint = _nmb_text(message)
                        self.layout(row)
                        return
                except Exception as error:
                    if self.valid(row, state, token):
                        state['title'].text = _nmb_tr('preview_unavailable')
                        state['message'].text = _nmb_text(_nmb_error_text(error))
                        self.layout(row)
                        return
        finally:
            state['working'] = False

    def detach(self, row):
        state = self.rows.pop(row, None)
        if state is None:
            return
        state['token'] += 1
        if not getattr(row, 'destroyed', False):
            if row.height == state['baseHeight'] + state.get('height', self.stripHeight):
                row.height = state['baseHeight']
            if not getattr(state['strip'], 'destroyed', False):
                state['strip'].Close()

    def close(self):
        if not self.active:
            return
        self.active = False
        for row in tuple(self.rows):
            self.safe(self.detach, row)
        for name, original, wrapper in reversed(self.hooks):
            if getattr(self.rowClass, name, None) is wrapper:
                setattr(self.rowClass, name, original)
        self.hooks = []


def _nmb_install_sell_advisor(owner):
    from eve.client.script.ui.shared.market.sellItemEntry import SellItemContainer
    from eve.client.script.ui.shared.market.sellMulti import SellItems
    from carbonui.primitives.container import Container
    from eve.client.script.ui.control.eveLabel import Label
    from carbonui import const as C
    advisor = _NmbSellAdvisor(owner, SellItemContainer, SellItems, Container, Label, C)
    try:
        return advisor.install()
    except Exception:
        advisor.close()
        raise
