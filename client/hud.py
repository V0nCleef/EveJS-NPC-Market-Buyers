# -*- coding: utf-8 -*-
"""Native single-player market dashboard; persistence stays server-side."""

_NMB_HELP_KEYS = dict((key, 'help_' + key) for key in (
    'enabled', 'ironMode', 'offlinePurchases', 'useEveAveragePrices', 'randomBatch', 'minimumBatchPercent', 'batchPercent',
    'chanceAtReference', 'maxPricePercent', 'warnAbovePercent', 'warnBelowPercent',
    'dailyBudgetISK', 'sellerDailyBudgetISK', 'cycleBudgetISK', 'tqDailyVolumePercent',
    'referenceRegionID', 'referenceStationID', 'maxQuoteAgeSeconds',
    'historyLookbackDays'))

# Curated public NPC trade hubs. Station -> system -> region pairs are verified
# against CCP SDE build 3396210; no lookup/network call is needed to open the UI.
_NMB_TRADE_HUBS = (
    (10000002, 'region_forge', ((60003760, 'hub_jita', 'station_jita'),)),
    (10000043, 'region_domain', ((60008494, 'hub_amarr', 'station_amarr'),)),
    (10000032, 'region_sinq_laison', ((60011866, 'hub_dodixie', 'station_dodixie'),)),
    (10000030, 'region_heimatar', ((60004588, 'hub_rens', 'station_rens'),)),
    (10000042, 'region_metropolis', ((60005686, 'hub_hek', 'station_hek'),)))


def _nmb_region_choices(config):
    choices = [(u'{} / {}'.format(_nmb_tr(name), _nmb_tr(stations[0][1])), region)
               for region, name, stations in _NMB_TRADE_HUBS]
    current = config.get('referenceRegionID')
    if current not in [value for text, value in choices]:
        choices.append((_nmb_tr('saved_region', region=current), current))
    return choices


def _nmb_station_choices(regionID, config):
    stations = next((stations for region, name, stations in _NMB_TRADE_HUBS if region == regionID), ())
    choices = [(_nmb_tr(name), station) for station, hub, name in stations]
    saved = config.get('referenceStationID') if regionID == config.get('referenceRegionID') else None
    if saved is not None and saved not in [value for text, value in choices]:
        choices.append((_nmb_tr('saved_station', station=saved), saved))
    selected = saved if saved is not None else choices[0][1]
    return choices, selected


def _nmb_reference_name(config):
    for region, name, stations in _NMB_TRADE_HUBS:
        if region == config.get('referenceRegionID'):
            for station, hub, stationName in stations:
                if station == config.get('referenceStationID'):
                    return u'{} / {}'.format(_nmb_tr(hub), _nmb_tr(name))
            return u'{} / {}'.format(_nmb_tr('saved_station', station=config.get('referenceStationID')), _nmb_tr(name))
    return _nmb_tr('saved_region', region=config.get('referenceRegionID', '?'))


def _nmb_make_window(owner):
    from carbonui import uiconst as C
    from carbonui.control.window import Window
    from carbonui.control.button import Button
    from carbonui.control.combo import Combo
    from carbonui.button.menu import MenuButtonIcon
    from carbonui.control.contextMenu.menuData import MenuData
    from carbonui.primitives.flowcontainer import FlowContainer
    from clientsettings.setting import CharSettingEnum
    from carbonui.control.singlelineedits.singleLineEditInteger import SingleLineEditInteger
    from carbonui.control.singlelineedits.singleLineEditFloat import SingleLineEditFloat
    from carbonui.control.singlelineedits.singleLineEditText import SingleLineEditText
    from carbonui.primitives.container import Container
    from carbonui.primitives.fill import Fill
    from carbonui.primitives.frame import Frame
    from carbonui.primitives.vectorlinetrace import VectorLineTrace
    from carbonui.control.scrollContainer import ScrollContainer
    from eve.client.script.ui.control.eveLabel import Label
    from eve.client.script.ui.control.eveIcon import Icon
    from qtyTooltip.tooltip import GetQtyText
    from qtyTooltip.qtyConst import EDIT_INPUT_TYPE_ISK
    import eveformat
    import evetypes
    import eveicon
    import functools
    import math
    import time

    teal = (0.32, 0.88, 0.86, 1.0)
    white = (0.88, 0.93, 0.95, 1.0)
    muted = (0.58, 0.68, 0.73, 1.0)
    amber = (1.0, 0.68, 0.31, 1.0)
    green = (0.35, 0.95, 0.66, 1.0)
    red = (1.0, 0.32, 0.36, 1.0)
    border = (0.24, 0.39, 0.43, 0.5)

    class FooterButton(Button):
        # Native Button.Update_Size_ replaces width/height with its intrinsic
        # size. Give it a real size contract rather than stretching TOALL.
        def __init__(self, **kwargs):
            self._nmb_min_width = kwargs.pop('minimumWidth', 120)
            Button.__init__(self, **kwargs)

        def get_intrinsic_width(self):
            return max(self._nmb_min_width, Button.get_intrinsic_width(self))

        def get_intrinsic_height(self):
            return 40

        def PrepareLabel(self):
            Button.PrepareLabel(self)
            self._label.fontsize = 15

    class SettingResetButton(Button):
        def __init__(self, **kwargs):
            Button.__init__(self, **kwargs)
            # Two counterclockwise arrows, drawn rather than relying on a
            # Unicode glyph that may be missing from a client's font.
            for start in (30, 210):
                points = []
                for index in range(17):
                    angle = math.radians(start - index * 140.0 / 16)
                    points.append((10 + 7 * math.cos(angle), 10 + 7 * math.sin(angle)))
                line = VectorLineTrace(parent=self, align=C.CENTER, width=20, height=20,
                    lineWidth=1.5, state=C.UI_DISABLED)
                for point in points:
                    line.AddPoint(point, color=teal)
                tip, previous = points[-1], points[-2]
                dx, dy = tip[0] - previous[0], tip[1] - previous[1]
                length = math.sqrt(dx * dx + dy * dy)
                dx, dy = dx / length, dy / length
                head = VectorLineTrace(parent=self, align=C.CENTER, width=20, height=20,
                    lineWidth=1.5, state=C.UI_DISABLED)
                for point in ((tip[0] - dx * 3 - dy * 2, tip[1] - dy * 3 + dx * 2), tip,
                              (tip[0] - dx * 3 + dy * 2, tip[1] - dy * 3 - dx * 2)):
                    head.AddPoint(point, color=teal)

        def get_intrinsic_width(self):
            return 32

        def get_intrinsic_height(self):
            return 32

    def label(parent, text, **kwargs):
        kwargs.setdefault('align', C.TOTOP)
        kwargs.setdefault('fontsize', 15)
        kwargs.setdefault('state', C.UI_DISABLED)
        kwargs.setdefault('color', white)
        return Label(parent=parent, text=_nmb_text(_nmb_tr(text) if text in _NMB_TRANSLATIONS['en'] else text), **kwargs)

    def button(**kwargs):
        kwargs['label'] = _nmb_tr(kwargs['label'])
        kwargs.setdefault('fontsize', 15)
        return FooterButton(**kwargs)

    def field(row, names, default=None):
        for name in names:
            if row.get(name) is not None:
                return row[name]
        return default

    def type_name(typeID):
        try:
            return evetypes.GetName(int(typeID))
        except Exception:
            return _nmb_tr('type', type=typeID)

    def units(value):
        return u'{:,}'.format(int(value))

    def ring(parent, color=teal, size=22):
        trace = VectorLineTrace(parent=parent, align=C.TOPLEFT, width=size, height=size,
                                lineWidth=1.3, isLoop=True, state=C.UI_DISABLED)
        radius = size / 2.0 - 1.5
        for index in range(32):
            angle = 2 * math.pi * index / 32
            trace.AddPoint((size / 2.0 + radius * math.cos(angle), size / 2.0 + radius * math.sin(angle)), color=color)
        return trace

    def motion(widget, start, end, pulse=False):
        widget.opacity = end
        try:
            widget.StopAnimations()
            from carbonui.uianimations import animations
            options = {'duration': 3.2 if pulse else 0.32}
            if pulse:
                options.update(loops=C.ANIM_REPEAT, curveType=C.ANIM_WAVE)
            animations.FadeTo(widget, startVal=start, endVal=end, **options)
        except Exception:
            widget.opacity = end

    def item_icon(parent, typeID, size=64):
        box = Container(parent=parent, align=C.TOPLEFT, left=8, top=10, width=size, height=size)
        Frame(bgParent=box, color=border)
        Fill(bgParent=box, color=(0.06, 0.09, 0.11, 0.9))
        try:
            Icon(parent=box, typeID=int(typeID), ignoreSize=True, align=C.TOALL, state=C.UI_DISABLED)
        except Exception:
            label(box, '?', align=C.CENTER, color=muted)
        return box

    def event_icon(parent, kind, resolved, rejected, color):
        box = Container(parent=parent, align=C.TOPLEFT, left=8, top=12, width=52, height=52)
        Frame(bgParent=box, color=border)
        def stroke(points):
            line = VectorLineTrace(parent=box, align=C.TOPLEFT, width=52, height=52,
                                   lineWidth=1.8, state=C.UI_DISABLED)
            for point in points:
                line.AddPoint(point, color=color)
        if kind == 'configuration':
            for y, x in ((16, 22), (26, 32), (36, 18)):
                stroke(((12, y), (40, y)))
                Fill(parent=box, align=C.TOPLEFT, left=x, top=y-4, width=4, height=8, color=color, state=C.UI_DISABLED)
        elif resolved:
            stroke(((13, 26), (23, 35), (40, 17)))
        elif rejected:
            stroke(((17, 17), (35, 35)))
            stroke(((35, 17), (17, 35)))
        else:
            circle = Container(parent=box, align=C.TOPLEFT, left=10, top=10, width=32, height=32, state=C.UI_DISABLED)
            ring(circle, color=color, size=32)
            stroke(((26, 15), (26, 26), (34, 30)))
        return box

    class NpcMarketWindow(Window):
        default_windowID = 'EveJSNpcMarketBuyersV1'
        default_caption = _nmb_tr('app_name')
        default_width = 1360
        default_height = 920
        default_minSize = (1120, 760)
        default_isStackable = False
        default_scope = C.SCOPE_INGAME

        def ApplyAttributes(self, attributes):
            Window.ApplyAttributes(self, attributes)
            self.owner = owner
            self._generation = getattr(owner, 'generation', 0)
            self._busy = False
            self._saving = False
            self._refreshQueued = False
            self._serial = 0
            self._page = 'orders'
            self._state = {}
            self._config = {}
            self._revision = None
            self._editors = {}
            self._dirty = False
            self._loading = True
            self._rows = []
            self._orderData, self._activityData = [], []
            self._viewSettings = dict((page, CharSettingEnum('evejsNpcMarketBuyersView_' + page,
                'details', options=('icons', 'details', 'list'))) for page in ('orders', 'activity'))
            self._helpIcons = []
            self._orderQuantities = {}
            self._renderSignature = None
            self._statusKey = None
            self._sourceStatusKey = None
            self._focusOffline = False
            self._focusPriceSource = False
            Fill(bgParent=self.content, color=(0.025, 0.043, 0.055, 0.98))
            Frame(bgParent=self.content, color=border)
            self.head = Container(parent=self.content, align=C.TOTOP, height=138, padding=(24, 16, 24, 12))
            brand = Container(parent=self.head, align=C.TOPLEFT, top=3, width=48, height=50)
            Frame(bgParent=brand, color=border)
            for index, height in enumerate((25, 44, 33, 18)):
                Fill(parent=brand, align=C.BOTTOMLEFT, left=index * 12, width=9, height=height,
                     color=(0.6, 0.75, 0.79, 0.85), state=C.UI_DISABLED)
            title = Container(parent=self.head, align=C.TOTOP, height=72, padding=(68, 0, 360, 0))
            label(title, _nmb_tr('app_name').upper(), fontsize=27, bold=True, color=teal)
            label(title, 'dashboard_subtitle', fontsize=15, color=muted, padTop=5)
            self.statusRail = Container(parent=self.head, align=C.TOPRIGHT, width=340, height=102, top=5)
            self.engineStatus = Container(parent=self.statusRail, align=C.TOPLEFT, width=340, height=30)
            self.engineDot = Container(parent=self.engineStatus, align=C.TOPLEFT, top=3, width=22, height=22, state=C.UI_DISABLED)
            self.statusLabel = label(self.engineStatus, 'loading', align=C.TOPLEFT, left=36, top=4, width=304, fontsize=16)
            self.offlineStatus = Container(parent=self.statusRail, align=C.TOPLEFT, top=34, width=340, height=30, state=C.UI_NORMAL)
            self.offlineStatus.hint = _nmb_tr('offline_link_hint')
            self.offlineStatus.OnClick = self.OpenOfflineSettings
            self.offlineDot = Container(parent=self.offlineStatus, align=C.TOPLEFT, top=3, width=22, height=22, state=C.UI_DISABLED)
            self.offlineLabel = label(self.offlineStatus, '', align=C.TOPLEFT, left=36, top=4, width=304, fontsize=16)
            self.priceStatus = Container(parent=self.statusRail, align=C.TOPLEFT, top=68, width=340, height=30, state=C.UI_NORMAL)
            self.priceStatus.hint = _nmb_tr('price_source_link_hint')
            self.priceStatus.OnClick = self.OpenPriceSourceSettings
            self.priceDot = Container(parent=self.priceStatus, align=C.TOPLEFT, top=3, width=22, height=22, state=C.UI_DISABLED)
            self.priceLabel = label(self.priceStatus, '', align=C.TOPLEFT, left=36, top=4, width=304, fontsize=16)
            meta = Container(parent=self.head, align=C.TOTOP, height=30)
            self.referenceLabel = label(meta, 'loading', align=C.TOPLEFT, fontsize=15, color=muted)
            self.modeBadge = Container(parent=meta, align=C.TOPLEFT, top=-3, width=150, height=28)
            Frame(bgParent=self.modeBadge, color=border)
            Fill(bgParent=self.modeBadge, color=(0.07, 0.12, 0.15, 0.9))
            self.modeLabel = label(self.modeBadge, '', align=C.CENTER, fontsize=14, color=white)
            Fill(parent=self.head, align=C.TOBOTTOM, height=1, color=border, state=C.UI_DISABLED)
            self.footer = Container(parent=self.content, align=C.TOBOTTOM, height=70, padding=(24, 8, 24, 12))
            Fill(parent=self.footer, align=C.TOTOP, height=1, color=border, state=C.UI_DISABLED)
            self.buttonRow = Container(parent=self.footer, align=C.TOTOP, height=40, padTop=10)
            self.tabs, self.tabLines, self.tabBackgrounds = {}, {}, {}
            for key, text in (('orders', 'orders_tab'), ('configure', 'configure_tab'), ('activity', 'activity_tab')):
                tab = button(parent=self.buttonRow, align=C.TOLEFT, minimumWidth=144, padRight=10,
                             label=text, func=self.PageCallback(key))
                self.tabs[key] = tab
                self.tabBackgrounds[key] = Fill(bgParent=tab, color=(0.1, 0.65, 0.65, 0.15),
                                               state=C.UI_DISABLED if key == self._page else C.UI_HIDDEN)
                self.tabLines[key] = Fill(parent=tab, align=C.TOBOTTOM, height=2, color=teal,
                                           state=C.UI_DISABLED if key == self._page else C.UI_HIDDEN)
            self.closeButton = button(parent=self.buttonRow, align=C.TORIGHT,
                                      label='close', func=self.CloseByUser, padLeft=10)
            self.saveButton = button(parent=self.buttonRow, align=C.TORIGHT,
                                     label='save_policy', func=self.SavePolicy, padLeft=10, state=C.UI_HIDDEN)
            self.reloadButton = button(parent=self.buttonRow, align=C.TORIGHT,
                                       label='reload', func=self.ReloadPolicy, padLeft=10, state=C.UI_HIDDEN)
            self.refreshButton = button(parent=self.buttonRow, align=C.TORIGHT,
                                        label='refresh', func=self.Refresh, padLeft=10)
            self.notice = label(self.content, '', align=C.TOBOTTOM, height=36, padding=(24, 6, 24, 6), color=muted, fontsize=13)
            self.body = Container(parent=self.content, align=C.TOALL, padding=(24, 0, 24, 0))
            self._loading = False
            self.Refresh()
            owner.spawn(self.Poll)

        def PageCallback(self, key):
            return lambda *args: self.SelectPage(key)

        def Valid(self):
            return (not self.destroyed and self.owner.usable()
                    and self._generation == getattr(self.owner, 'generation', 0))

        def SetNotice(self, text, error=False):
            if self.Valid():
                self.notice.text = _nmb_text(_nmb_tr(text) if text in _NMB_TRANSLATIONS['en'] else text)
                self.notice.color = amber if error else muted

        def SelectPage(self, key):
            if key == self._page:
                return
            if self._saving:
                self.SetNotice('saving_policy')
                return
            if self._page == 'configure' and not self._loading:
                self._dirty = self.PolicyChanged()
            if self._dirty:
                self.SetNotice('save_before_tab', True)
                return
            self._page = key
            self._renderSignature = None
            if self._busy:
                self._serial += 1
                self._refreshQueued = True
            else:
                self.Refresh()

        def Refresh(self, *args):
            if self._busy or not self.Valid():
                return
            if self._dirty:
                self.SetNotice('draft_kept', True)
                return
            self._busy = True
            self._serial += 1
            owner.spawn(self.RefreshWork, self._serial)

        def RefreshWork(self, serial):
            try:
                state = owner.request('NpcMarketGetState')
                if not self.Valid() or serial != self._serial:
                    return
                self._state = state
                self._config = dict(state.get('config') or {})
                self._revision = state.get('revision')
                self.RenderSummary()
                if self._page == 'orders':
                    result = owner.request('NpcMarketGetOrders')
                    if self.Valid() and serial == self._serial:
                        self.RenderOrders(result.get('orders') or [])
                elif self._page == 'activity':
                    result = owner.request('NpcMarketActivity')
                    if self.Valid() and serial == self._serial:
                        self.RenderActivity(result.get('activity') or [])
                else:
                    self.RenderConfigure()
            except Exception as error:
                self.SetNotice(_nmb_error_text(error), True)
            finally:
                self._busy = False
                if self._refreshQueued and self.Valid():
                    self._refreshQueued = False
                    self.Refresh()

        def RenderSummary(self):
            config = self._config
            status = self._state.get('status') or {}
            reference = _nmb_reference_name(config)
            average = bool(config.get('useEveAveragePrices'))
            self.referenceLabel.text = _nmb_text(_nmb_tr('average_reference_inline') if average else _nmb_tr('reference_inline', reference=reference))
            self.priceLabel.text = _nmb_text(_nmb_tr('price_source_status', source=_nmb_tr('eve_average' if average else 'tq_trade_hub')))
            if average != self._sourceStatusKey:
                self.PaintIndicator(self.priceDot, teal, False)
                self._sourceStatusKey = average
            self.modeLabel.text = _nmb_tr('iron_mode_badge' if config.get('ironMode') else 'limited_mode_badge')
            self.modeBadge.left = self.referenceLabel.textwidth + 24
            self.modeBadge.width = self.modeLabel.textwidth + 28
            state = ('active' if status.get('running') else 'stopped') if config.get('enabled') else 'paused'
            if status.get('ready') is False:
                state = 'unavailable'
            self.statusLabel.text = _nmb_tr(state)
            offline = bool(config.get('offlinePurchases'))
            offlineState = ('catching_up' if status.get('catchingUp') else 'on') if offline else 'off'
            if offline and (not config.get('enabled') or status.get('ready') is False):
                offlineState = 'paused'
            self.offlineLabel.text = _nmb_text(_nmb_tr('offline_status', state=_nmb_tr(offlineState)))
            self.offlineLabel.color = red if offlineState == 'off' else (amber if offlineState in ('paused','catching_up') else white)
            self.statusLabel.color = white if state == 'active' else (amber if state == 'paused' else red)
            if (state, offlineState) != self._statusKey:
                self.PaintIndicator(self.engineDot, green if state == 'active' else (amber if state == 'paused' else red), state == 'active')
                self.PaintIndicator(self.offlineDot, green if offlineState == 'on' else (red if offlineState == 'off' else amber), offlineState in ('on','catching_up'))
                self._statusKey = (state, offlineState)
            if status.get('ready') is False:
                self.SetNotice('settlement_unavailable', True)
            else:
                self.SetNotice('dashboard_notice', owner.advisor is None)

        def PaintIndicator(self, dot, color, pulse):
            dot.Flush()
            ring(dot, color=color)
            label(dot, u'•', align=C.CENTER, color=color, fontsize=19)
            motion(dot, 0.35, 1.0, pulse=pulse)

        def ClearBody(self):
            self.body.Flush()
            self._editors = {}
            self._moneyCaptions = {}
            self._helpIcons = []
            configure = self._page == 'configure'
            self.saveButton.state = (C.UI_NORMAL if self._state.get('canConfigure') else C.UI_DISABLED) if configure else C.UI_HIDDEN
            self.reloadButton.state = C.UI_NORMAL if configure else C.UI_HIDDEN
            self.refreshButton.state = C.UI_HIDDEN if configure else C.UI_NORMAL
            for key, line in self.tabLines.items():
                line.state = C.UI_DISABLED if key == self._page else C.UI_HIDDEN
                self.tabBackgrounds[key].state = line.state

        def Help(self, parent, title, body, **kwargs):
            kwargs.setdefault('align', C.TOPLEFT)
            icon = Container(parent=parent, width=24, height=24, state=C.UI_NORMAL, **kwargs)
            ring(icon)
            label(icon, '!', align=C.CENTER, fontsize=16, bold=True, color=teal)
            def content():
                return body() if callable(body) else body
            def load(panel, *args):
                panel.LoadGeneric1ColumnTemplate()
                panel.cellPadding = (12, 7, 12, 7)
                heading = title() if callable(title) else title
                panel.AddLabelLarge(text=_nmb_text(_nmb_tr(heading) if heading in _NMB_TRANSLATIONS['en'] else heading), bold=True, wrapWidth=460)
                for paragraph in unicode(content()).split('\n'):
                    panel.AddLabelLarge(text=_nmb_text(paragraph), wrapWidth=460)
            icon.LoadTooltipPanel = load
            icon.OnClick = lambda *args: self.ShowHelp(icon)
            icon._nmb_load_help = load
            self._helpIcons.append(icon)
            return icon

        def ShowHelp(self, icon):
            if not self.Valid() or icon.destroyed:
                return
            try:
                from carbonui.uicore import uicore
                uicore.uilib.tooltipHandler._LoadTooltipPanel(icon, showInstant=True)
            except Exception:
                # Hover still uses the native tooltip path if immediate display
                # is unavailable during UI teardown or startup.
                owner.diagnostic('NPC market help popup unavailable')

        def Heading(self, key, count=None):
            strip = Container(parent=self.body, align=C.TOTOP, height=58, padBottom=10)
            title = label(strip, key, align=C.TOPLEFT, top=8, fontsize=20, bold=True)
            Fill(parent=strip, align=C.TOBOTTOM, height=1, color=border, state=C.UI_DISABLED)
            if count is not None:
                text = _nmb_tr('order_count' if key == 'my_sell_orders' else 'activity_count', count=count)
                badge = Container(parent=strip, align=C.TOPLEFT, left=title.textwidth+18, top=7, height=28, state=C.UI_DISABLED)
                Frame(bgParent=badge, color=border)
                Fill(bgParent=badge, color=(0.1, 0.65, 0.65, 0.08))
                badgeText = label(badge, text, align=C.CENTER, color=teal, fontsize=14)
                badge.width = badgeText.textwidth+20
            page = {'my_sell_orders': 'orders', 'market_activity': 'activity'}.get(key)
            if page:
                mode = self.ViewMode(page)
                self._viewButton = MenuButtonIcon(parent=strip, align=C.TOPRIGHT, top=7,
                    width=28, height=28, iconSize=16, texturePath=self.ViewIcon(mode),
                    get_menu_func=functools.partial(self.ViewMenu, page),
                    hint=_nmb_tr('view_mode_hint', mode=_nmb_tr('view_' + mode)))

        def ViewMode(self, page):
            mode = self._viewSettings[page].get()
            return mode if mode in ('icons', 'details', 'list') else 'details'

        def ViewIcon(self, mode):
            return {'icons': eveicon.grid_view, 'details': eveicon.details_view, 'list': eveicon.list_view}[mode]

        def ViewMenu(self, page):
            menu = MenuData()
            for mode in ('icons', 'details', 'list'):
                menu.AddEntry(text=_nmb_tr('view_' + mode), texturePath=self.ViewIcon(mode),
                    func=functools.partial(self.SetViewMode, page, mode))
            return menu

        def SetViewMode(self, page, mode, *args):
            if not self.Valid() or page != self._page or mode not in ('icons', 'details', 'list'):
                return
            if mode == self.ViewMode(page):
                return
            self._viewSettings[page].set(mode)
            if page == 'orders':
                self.RenderOrders(self._orderData)
            else:
                self.RenderActivity(self._activityData)

        def RenderOrders(self, rows):
            self._orderData = list(rows)
            mode = self.ViewMode('orders')
            signature = _nmb_json.dumps([(o.get('orderID'), o.get('quantity'), o.get('volRemaining'), o.get('volEntered'), o.get('originalQuantity'), o.get('price'),
                [(o.get('preview') or {}).get(k) for k in ('referencePrice','referenceKind','pricePercent','chancePercent','reason','warning','minQuantity','maxQuantity')]) for o in rows], sort_keys=True)
            if self._renderSignature == ('orders', mode, signature):
                return
            self._renderSignature = ('orders', mode, signature)
            previous = self._orderQuantities
            self._orderQuantities = {}
            self.ClearBody()
            self.Heading('my_sell_orders', len(rows))
            if mode != 'details':
                self.RenderCompactOrders(rows, mode, previous)
                return
            columns = [('item_order', .225), ('original', .11), ('remaining', .11),
                       ('unit_price', .165), ('tq_price', .165), ('your_price', .105), ('npc_chance', .12)]
            header = Container(parent=self.body, align=C.TOTOP, height=34)
            for key, fraction in columns:
                cell = Container(parent=header, align=C.TOLEFT_PROP, width=fraction)
                label(cell, key, fontsize=13, color=muted, padding=(8, 0, 6, 0))
            scroll = ScrollContainer(parent=self.body, align=C.TOALL)
            if not rows:
                label(scroll, 'no_orders', padding=18, color=muted)
            for order in rows[:200]:
                panel = Container(parent=scroll, align=C.TOTOP, height=138, padBottom=5)
                Fill(bgParent=panel, color=(0.045, 0.073, 0.089, 0.8))
                Fill(parent=panel, align=C.TOBOTTOM, height=1, color=border, state=C.UI_DISABLED)
                preview = order.get('preview') or order.get('evaluation') or {}
                orderID = field(order, ('orderID', 'id'), '?')
                remaining = int(field(order, ('volRemaining', 'volumeRemaining', 'quantity'), 0))
                original = field(order, ('volEntered', 'originalQuantity', 'vol_entered'))
                validOriginal = isinstance(original, (int, long)) and original >= remaining and original > 0
                sold = original - remaining if validOriginal else None
                self._orderQuantities[unicode(orderID)] = remaining
                if unicode(orderID) in previous and previous[unicode(orderID)] != remaining:
                    flash = Fill(bgParent=panel, color=(0.32, 0.88, 0.86, 0.16))
                    motion(flash, 1.0, 0.0)
                values = [None, units(original) if validOriginal else _nmb_tr('unknown'), units(remaining), _nmb_isk(order.get('price')),
                    _nmb_isk(preview['referencePrice']) if preview.get('referencePrice') else _nmb_tr('no_quote'),
                    '{:.1f}%'.format(_nmb_number(preview.get('pricePercent'))) if preview.get('pricePercent') is not None else '-',
                    _nmb_tr('chance', chance=_nmb_number(preview.get('chancePercent'))) if preview else _nmb_tr('not_quoted')]
                top = Container(parent=panel, align=C.TOTOP, height=80)
                for index, ((key, fraction), value) in enumerate(zip(columns, values)):
                    cell = Container(parent=top, align=C.TOLEFT_PROP, width=fraction)
                    if index == 0:
                        item_icon(cell, order.get('typeID'))
                        names = Container(parent=cell, align=C.TOALL, padding=(84, 10, 8, 0))
                        label(names, type_name(order.get('typeID')), bold=True, maxLines=2)
                        label(names, _nmb_tr('order', order=orderID), color=muted, fontsize=13, padTop=4)
                    else:
                        label(cell, value, padding=(8, 17, 6, 0), fontsize=16,
                              color=teal if index == 6 else white, bold=index in (2, 6), maxLines=2)
                        if index == 4 and preview.get('referencePrice') and preview.get('referenceKind') in ('eve_average', 'local_buy_order'):
                            label(cell, 'local_buy_offer' if preview.get('referenceKind') == 'local_buy_order' else 'eve_average', padding=(8, 3, 6, 0), fontsize=13, color=amber)
                progress = Container(parent=panel, align=C.TOTOP, height=48)
                Container(parent=progress, align=C.TOLEFT_PROP, width=columns[0][1])
                trackGroup = Container(parent=progress, align=C.TOLEFT_PROP, width=.275)
                explanation = _nmb_tr('help_sold', original=units(original), sold=units(sold), remaining=units(remaining)) if validOriginal else _nmb_tr('help_original_unknown')
                self.Help(trackGroup, 'help_sold_title', explanation, left=6, top=1)
                trackParent = Container(parent=trackGroup, align=C.TOTOP, height=14, padding=(38, 5, 12, 0))
                Frame(bgParent=trackParent, color=border)
                Fill(bgParent=trackParent, color=(0.09, 0.14, 0.17, 1.0))
                fraction = float(remaining) / original if validOriginal else 0.0
                Fill(parent=trackParent, align=C.TOLEFT_PROP, width=fraction, color=teal,
                     state=C.UI_DISABLED if fraction > 0 else C.UI_HIDDEN)
                detail = _nmb_tr('remaining_progress', remaining=units(remaining), original=units(original)) if validOriginal else _nmb_tr('original_unknown')
                detailCell = Container(parent=progress, align=C.TOLEFT_PROP, width=.29, padding=(10, 3, 12, 0))
                label(detailCell, detail, fontsize=14, color=muted, maxLines=2)
                fairCell = Container(parent=progress, align=C.TOALL, padding=(12, 3, 12, 0))
                message = _nmb_preview_message(preview, self._config)
                if preview.get('reason') == 'eligible':
                    message = _nmb_tr({'high':'high_short','low':'low_short'}.get(preview.get('warning'), 'fair_short'))
                label(fairCell, message, fontsize=13, color=amber if preview.get('warning') in ('high', 'low', 'unavailable') else muted, maxLines=3)
            if len(rows) >= 200:
                label(scroll, 'first_orders', color=muted)

        def OrderPresentation(self, order):
            preview = order.get('preview') or order.get('evaluation') or {}
            orderID = field(order, ('orderID', 'id'), '?')
            remaining = int(field(order, ('volRemaining', 'volumeRemaining', 'quantity'), 0))
            original = field(order, ('volEntered', 'originalQuantity', 'vol_entered'))
            validOriginal = isinstance(original, (int, long)) and original >= remaining and original > 0
            source = {'eve_average': 'eve_average', 'local_buy_order': 'local_buy_offer'}.get(preview.get('referenceKind'), 'tq_trade_hub')
            reference = _nmb_isk(preview['referencePrice']) if preview.get('referencePrice') else _nmb_tr('no_quote')
            percent = '{:.1f}%'.format(_nmb_number(preview.get('pricePercent'))) if preview.get('pricePercent') is not None else '-'
            chance = _nmb_tr('chance', chance=_nmb_number(preview.get('chancePercent'))) if preview else _nmb_tr('not_quoted')
            progress = _nmb_tr('help_sold', original=units(original), sold=units(original-remaining), remaining=units(remaining)) if validOriginal else _nmb_tr('help_original_unknown')
            message = _nmb_preview_message(preview, self._config)
            values = [None, units(original) if validOriginal else _nmb_tr('unknown'), units(remaining),
                _nmb_isk(order.get('price')), reference, percent, chance]
            helpText = u'{}\n{}: {}\n{}: {} ({})\n{}: {}\n{}: {}\n{}\n{}'.format(
                _nmb_tr('order', order=orderID), _nmb_tr('unit_price'), values[3], _nmb_tr('tq_price'), reference,
                _nmb_tr(source), _nmb_tr('your_price'), percent, _nmb_tr('npc_chance'), chance, progress, message)
            if preview.get('minQuantity') is not None and preview.get('maxQuantity') is not None:
                helpText += u'\n' + _nmb_tr('batch_preview', minimum=units(preview['minQuantity']), maximum=units(preview['maxQuantity']))
            return dict(preview=preview, orderID=orderID, remaining=remaining, original=original,
                validOriginal=validOriginal, source=source, values=values, helpText=helpText, message=message)

        def RenderCompactOrders(self, rows, mode, previous):
            columns = [('item_order', .225), ('original', .11), ('remaining', .11),
                ('unit_price', .165), ('tq_price', .165), ('your_price', .105), ('npc_chance', .12)]
            if mode == 'list':
                header = Container(parent=self.body, align=C.TOTOP, height=34)
                for key, fraction in columns:
                    cell = Container(parent=header, align=C.TOLEFT_PROP, width=fraction)
                    label(cell, key, fontsize=13, color=muted, padding=(8, 0, 6, 0))
            scroll = ScrollContainer(parent=self.body, align=C.TOALL)
            grid = FlowContainer(parent=scroll, align=C.TOTOP, contentSpacing=(10, 10), autoHeight=True) if mode == 'icons' else None
            if not rows:
                label(scroll, 'no_orders', padding=18, color=muted)
            for order in rows[:200]:
                info = self.OrderPresentation(order)
                self._orderQuantities[unicode(info['orderID'])] = info['remaining']
                panel = Container(parent=grid if grid is not None else scroll, align=C.TOPLEFT if grid is not None else C.TOTOP,
                    width=252 if grid is not None else 0, height=238 if grid is not None else 62,
                    padBottom=0 if grid is not None else 4)
                Fill(bgParent=panel, color=(0.045, 0.073, 0.089, .85))
                Frame(bgParent=panel, color=border)
                if unicode(info['orderID']) in previous and previous[unicode(info['orderID'])] != info['remaining']:
                    motion(Fill(bgParent=panel, color=(.32, .88, .86, .16)), 1.0, 0.0)
                if grid is not None:
                    item_icon(panel, order.get('typeID'))
                    names = Container(parent=panel, align=C.TOPLEFT, left=84, top=12, width=156, height=62)
                    label(names, type_name(order.get('typeID')), bold=True, maxLines=2)
                    label(names, _nmb_tr('order', order=info['orderID']), fontsize=13, color=muted, padTop=4)
                    for index, key in ((1, 'original'), (2, 'remaining')):
                        cell = Container(parent=panel, align=C.TOPLEFT, left=12+(index-1)*120, top=82, width=108, height=43)
                        label(cell, key, fontsize=12, color=muted, maxLines=1)
                        label(cell, info['values'][index], fontsize=15, bold=index == 2, padTop=4, maxLines=1)
                    label(panel, info['values'][3], align=C.TOPLEFT, left=12, top=131, width=228, fontsize=16, bold=True, maxLines=1)
                    label(panel, u'{}: {} ({})'.format(_nmb_tr(info['source']), info['values'][4], info['values'][5]),
                        align=C.TOPLEFT, left=12, top=156, width=228, fontsize=12, color=muted, maxLines=2)
                    label(panel, u'{}: {}'.format(_nmb_tr('npc_chance'), info['values'][6]),
                        align=C.TOPLEFT, left=12, top=202, width=196, fontsize=14,
                        color=teal if info['preview'].get('reason') == 'eligible' else amber, bold=True, maxLines=1)
                    self.Help(panel, type_name(order.get('typeID')), info['helpText'], left=216, top=199)
                    fraction = float(info['remaining']) / info['original'] if info['validOriginal'] else 0.0
                    track = Container(parent=panel, align=C.TOBOTTOM, height=3, state=C.UI_DISABLED)
                    Fill(bgParent=track, color=border)
                    Fill(parent=track, align=C.TOLEFT_PROP, width=fraction, color=teal,
                        state=C.UI_DISABLED if fraction > 0 else C.UI_HIDDEN)
                    panel.hint = info['helpText']
                    panel.state = C.UI_NORMAL
                else:
                    for index, ((key, fraction), value) in enumerate(zip(columns, info['values'])):
                        cell = Container(parent=panel, align=C.TOLEFT_PROP, width=fraction)
                        if index == 0:
                            item_icon(cell, order.get('typeID'), size=36)
                            names = Container(parent=cell, align=C.TOALL, padding=(54, 8, 8, 0))
                            label(names, type_name(order.get('typeID')), bold=True, fontsize=14, maxLines=1)
                            label(names, _nmb_tr('order', order=info['orderID']), fontsize=12, color=muted, padTop=4)
                        elif index == 6:
                            self.Help(cell, type_name(order.get('typeID')), info['helpText'], left=6, top=12)
                            label(cell, value, padding=(36, 16, 4, 0), fontsize=14, bold=True,
                                color=teal if info['preview'].get('reason') == 'eligible' else amber, maxLines=1)
                        else:
                            label(cell, value, padding=(8, 12, 6, 0), fontsize=14, bold=index == 2, maxLines=1)
                            if index == 4 and info['preview'].get('referencePrice') and info['source'] != 'tq_trade_hub':
                                label(cell, info['source'], padding=(8, 4, 6, 0), fontsize=12, color=amber, maxLines=1)
            if len(rows) >= 200:
                label(scroll, 'first_orders', color=muted)

        def ActivityPresentation(self, activity):
            details = dict(activity.get('details') or {})
            details.update(activity)
            kind = details.get('kind')
            when = field(details, ('createdAt', 'at', 'timestamp'), '')
            date, clock = '', unicode(when)
            if isinstance(when, (int, long, float)):
                stamp = time.localtime(when / 1000.0)
                date, clock = time.strftime('%Y-%m-%d', stamp), time.strftime('%H:%M:%S', stamp)
            purchase = kind == 'purchase'
            resolved = kind == 'recovery' and details.get('resolution') == 'settled'
            rejected = kind == 'rejected' or details.get('resolution') == 'rejected'
            color = amber if (kind == 'recovery' and not resolved) or rejected else teal
            title = _nmb_activity_title(details, type_name(details.get('typeID', 0)))
            if resolved or rejected:
                title = _nmb_tr('confirmed_event' if resolved else 'rejected_event')
            status = ('offline_purchase' if details.get('offlinePurchase') else 'completed') if purchase else (
                'settings_badge' if kind == 'configuration' else ('confirmed' if resolved else ('rejected_badge' if rejected else 'pending')))
            message = _nmb_tr('configuration_detail' if kind == 'configuration' else ('confirmed_detail' if resolved else ('rejected_detail' if rejected else 'pending_detail')))
            quantity = _nmb_number(details.get('quantity'))
            gross, tax = details.get('grossISK'), details.get('taxISK')
            validGross = isinstance(gross, (int, long, float)) and not _nmb_math.isnan(gross) and not _nmb_math.isinf(gross) and gross >= 0
            validTax = isinstance(tax, (int, long, float)) and not _nmb_math.isnan(tax) and not _nmb_math.isinf(tax) and validGross and 0 <= tax <= gross
            unit = _nmb_isk(gross / quantity) if purchase and quantity > 0 and validGross else u'—'
            net = ('+' + _nmb_isk(round(gross-tax, 2)) if validTax else _nmb_tr('net_unknown')) if purchase else u'—'
            order = _nmb_tr('order', order=field(details, ('orderID', 'orderId'), '?'))
            breakdown = _nmb_tr('gross_tax', gross=_nmb_isk(gross) if validGross else _nmb_tr('unknown'),
                tax=_nmb_isk(tax) if validTax else _nmb_tr('unknown'))
            helpText = u'{} {}\n{}\n{}'.format(date, clock, title, _nmb_tr(status))
            if purchase:
                helpText += u'\n{}\n{}\n{}\n{}: {}'.format(order,
                    _nmb_tr('purchase_detail', quantity=units(quantity), price=unit), breakdown, _nmb_tr('net_received'), net)
                if details.get('offlinePurchase'):
                    helpText += u'\n' + _nmb_tr('offline_time_hint')
            else:
                helpText += u'\n' + message
            return dict(details=details, kind=kind, purchase=purchase, resolved=resolved, rejected=rejected,
                color=color, date=date, clock=clock, title=title, status=status, message=message, quantity=quantity,
                unit=unit, net=net, order=order, breakdown=breakdown, helpText=helpText)

        def RenderCompactActivity(self, rows, mode):
            columns = [('activity_time', .09), ('activity_event', .32), ('quantity', .09),
                ('unit_price', .17), ('net_received', .20), ('activity_state', .13)]
            if mode == 'list':
                header = Container(parent=self.body, align=C.TOTOP, height=32)
                for key, fraction in columns:
                    cell = Container(parent=header, align=C.TOLEFT_PROP, width=fraction)
                    label(cell, key, fontsize=13, color=muted, padding=(8, 0, 6, 0))
            scroll = ScrollContainer(parent=self.body, align=C.TOALL)
            if not rows:
                label(scroll, 'no_activity', padding=18, color=muted)
            lastDate, grid = None, None
            for activity in rows[:200]:
                info = self.ActivityPresentation(activity)
                if info['date'] != lastDate:
                    label(scroll, info['date'], fontsize=14, color=muted, padTop=12, padBottom=10)
                    lastDate = info['date']
                    if mode == 'icons':
                        grid = FlowContainer(parent=scroll, align=C.TOTOP, contentSpacing=(10, 10), autoHeight=True)
                panel = Container(parent=grid if grid is not None else scroll, align=C.TOPLEFT if grid is not None else C.TOTOP,
                    width=304 if grid is not None else 0, height=268 if grid is not None else 70,
                    padBottom=0 if grid is not None else 4, state=C.UI_NORMAL)
                Fill(bgParent=panel, color=(.045, .073, .089, .85))
                Frame(bgParent=panel, color=border)
                panel.hint = info['helpText']
                if grid is not None:
                    clock = label(panel, info['clock'], align=C.TOPLEFT, left=12, top=10, fontsize=13, color=muted)
                    if info['details'].get('offlinePurchase'):
                        clock.state = C.UI_NORMAL; clock.hint = _nmb_tr('offline_time_hint')
                    self.Help(panel, info['title'], info['helpText'], left=268, top=7)
                    image = Container(parent=panel, align=C.TOPLEFT, left=4, top=30, width=78, height=78)
                    if info['purchase']:
                        item_icon(image, info['details'].get('typeID'))
                    else:
                        event_icon(image, info['kind'], info['resolved'], info['rejected'], info['color'])
                    titleBox = Container(parent=panel, align=C.TOPLEFT, left=88, top=42, width=204, height=64)
                    label(titleBox, info['title'], fontsize=15, bold=True, maxLines=3)
                    if info['purchase']:
                        label(panel, _nmb_tr('purchase_detail', quantity=units(info['quantity']), price=info['unit']),
                            align=C.TOPLEFT, left=12, top=116, width=280, fontsize=14, maxLines=2)
                        label(panel, info['breakdown'], align=C.TOPLEFT, left=12, top=157, width=280, fontsize=12, color=muted, maxLines=2)
                        label(panel, info['order'], align=C.TOPLEFT, left=12, top=190, width=280, fontsize=12, color=muted, maxLines=1)
                        label(panel, info['net'], align=C.TOPLEFT, left=12, top=218, width=280, fontsize=17, color=teal, bold=True, maxLines=1)
                    else:
                        label(panel, info['message'], align=C.TOPLEFT, left=12, top=116, width=280, fontsize=14, color=muted, maxLines=4)
                    label(panel, info['status'], align=C.TOPLEFT, left=12, top=240 if info['purchase'] else 218,
                        width=280, fontsize=11, color=info['color'], maxLines=1)
                else:
                    values = [info['clock'], info['title'], units(info['quantity']) if info['purchase'] else u'—',
                        info['unit'], info['net'], _nmb_tr(info['status'])]
                    for index, ((key, fraction), value) in enumerate(zip(columns, values)):
                        cell = Container(parent=panel, align=C.TOLEFT_PROP, width=fraction)
                        if index == 1:
                            if info['purchase']:
                                thumbnail = item_icon(cell, info['details'].get('typeID'), size=36)
                                thumbnail.top = 15
                            else:
                                thumbnail = event_icon(cell, info['kind'], info['resolved'], info['rejected'], info['color'])
                                thumbnail.top = 7
                            self.Help(cell, info['title'], info['helpText'], left=68, top=21)
                            content = Container(parent=cell, align=C.TOALL, padding=(100, 9, 8, 0))
                            label(content, value, fontsize=14, bold=True, maxLines=2)
                            if info['purchase']:
                                label(content, info['order'], fontsize=12, color=muted, padTop=3, maxLines=1)
                        else:
                            text = label(cell, value, padding=(8, 15, 6, 0), fontsize=14,
                                color=info['color'] if index in (4, 5) else muted if index == 0 else white,
                                bold=index == 4, maxLines=2 if index == 5 else 1)
                            if index == 0 and info['details'].get('offlinePurchase'):
                                text.state = C.UI_NORMAL; text.hint = _nmb_tr('offline_time_hint')

        def RenderConfigure(self):
            self._renderSignature = None
            self.ClearBody()
            self.Heading('configure_tab')
            scroll = ScrollContainer(parent=self.body, align=C.TOALL)
            allowed = bool(self._state.get('canConfigure'))
            self._loading = True
            self._configScroll = scroll
            self._configRows = {}
            self._configSections = {}
            self._configLabels = {}
            self._configHelpIcons = {}
            self._resetButtons = {}
            self._defaultConfig = dict(self._state.get('defaultConfig') or {})
            self._moneyCaptions = {}
            self.Section(scroll, 'buying_group')
            self.Choice(scroll, 'enabled', [('paused', False), ('enabled', True)])
            self.Choice(scroll, 'ironMode', [('iron_mode', True), ('limited_mode', False)])
            self.Choice(scroll, 'offlinePurchases', [('off', False), ('on', True)])
            self.Section(scroll, 'batch_group')
            self.Choice(scroll, 'randomBatch', [('random_batches', True), ('fixed_batches', False)])
            groups = [('batch_fields', [('minimumBatchPercent', 'number'), ('batchPercent', 'number')]),
                ('pricing_group', [('chanceAtReference', 'number'), ('maxPricePercent', 'number'),
                    ('warnAbovePercent', 'number'), ('warnBelowPercent', 'number')]),
                ('quote_group', [('maxQuoteAgeSeconds', 'integer'), ('historyLookbackDays', 'integer')]),
                ('limits_group', [('dailyBudgetISK', 'money'), ('sellerDailyBudgetISK', 'money'),
                    ('cycleBudgetISK', 'money'), ('tqDailyVolumePercent', 'number')])]
            for title, fields in groups:
                if title != 'batch_fields':
                    self._configSections[title] = self.Section(scroll, title)
                if title == 'quote_group':
                    self.Choice(scroll, 'useEveAveragePrices', [('tq_trade_hub', False), ('eve_average', True)])
                    self.ReferenceChoices(scroll)
                for key, kind in fields:
                    row = self.ConfigRow(scroll, key)
                    if kind == 'integer':
                        control = SingleLineEditInteger(parent=row, align=C.TOPRIGHT, left=row._nmb_control_offset, width=330, top=8,
                            fontsize=15, setvalue=int(self._config.get(key) or 0), minValue=0,
                            maxValue=2147483647, OnChange=self.Changed)
                    elif kind == 'money':
                        # Same native control/precision as Wallet -> Transfer.
                        # GetValue returns a number; display separators never
                        # enter the policy payload or dirty-value comparison.
                        control = SingleLineEditFloat(parent=row, align=C.TOPRIGHT, left=row._nmb_control_offset, width=330, top=8,
                            fontsize=15, setvalue=self._config.get(key, 0), minValue=0.0,
                            maxValue=1e12, decimalPlaces=2, OnChange=self.Changed)
                        row.height = 82
                        self._moneyCaptions[key] = label(row, '', align=C.TOPRIGHT, left=row._nmb_control_offset, top=48,
                            width=330, fontsize=14, color=muted, maxLines=1)
                    else:
                        value = _nmb_numeric_text(self._config.get(key, 0)) if kind == 'number' else unicode(self._config.get(key, 0))
                        control = SingleLineEditText(parent=row, align=C.TOPRIGHT, left=row._nmb_control_offset, width=330, top=8,
                            fontsize=15, setvalue=value, OnChange=self.Changed)
                    self._editors[key] = (control, kind)
                    control.OnMouseWheel = self.ConfigMouseWheel
                    control.state = C.UI_NORMAL if allowed else C.UI_DISABLED
            self._loading = False
            self.UpdateLimitControls()
            self.UpdateReferenceControls()
            self.UpdateMoneyCaptions()
            self.UpdateResetButtons()
            if self._focusOffline:
                self.FocusOffline()
            if self._focusPriceSource:
                self.FocusPriceSource()

        def ReferenceChoices(self, parent):
            self._referenceRegion = self._config.get('referenceRegionID')
            choices, station = _nmb_station_choices(self._referenceRegion, self._config)
            for key, options, selected, callback in (
                ('referenceRegionID', _nmb_region_choices(self._config), self._referenceRegion, self.ReferenceRegionChanged),
                ('referenceStationID', choices, station, self.Changed)):
                row = self.ConfigRow(parent, key)
                control = Combo(parent=row, align=C.TOPRIGHT, left=row._nmb_control_offset, top=8, width=330, fontsize=15,
                                options=options, select=selected, callback=callback)
                self._editors[key] = (control, 'choice')
                control.OnMouseWheel = self.ConfigMouseWheel
                control.state = C.UI_NORMAL if self._state.get('canConfigure') else C.UI_DISABLED

        def ReferenceRegionChanged(self, *args):
            if self._loading:
                return
            self.SyncReferenceStation()
            self.Changed()

        def SyncReferenceStation(self):
            if 'referenceRegionID' not in self._editors or 'referenceStationID' not in self._editors:
                return
            region = self._editors['referenceRegionID'][0].GetValue()
            if region != self._referenceRegion:
                choices, station = _nmb_station_choices(region, self._config)
                self._editors['referenceStationID'][0].LoadOptions(choices, select=station)
                self._referenceRegion = region

        def OpenOfflineSettings(self, *args):
            self._focusOffline = True
            if self._page == 'configure' and 'offlinePurchases' in self._editors:
                self.FocusOffline()
            else:
                self.SelectPage('configure')

        def FocusOffline(self):
            self._focusOffline = False
            self.FocusSetting('offlinePurchases')

        def OpenPriceSourceSettings(self, *args):
            self._focusPriceSource = True
            if self._page == 'configure' and 'useEveAveragePrices' in self._editors:
                self.FocusPriceSource()
            else:
                self.SelectPage('configure')

        def FocusPriceSource(self):
            self._focusPriceSource = False
            self.FocusSetting('useEveAveragePrices')

        def FocusSetting(self, key):
            row = self._configRows.get(key)
            if row is None:
                return
            try:
                self._configScroll.ScrollToRevealChildVertical(row)
                self._editors[key][0].SetFocus()
            except Exception:
                pass
            flash = Fill(bgParent=row, color=(0.32, 0.88, 0.86, 0.22))
            motion(flash, 1.0, 0.0)
            self.ShowHelp(self._configHelpIcons[key])

        def Section(self, parent, text):
            row = Container(parent=parent, align=C.TOTOP, height=44, padTop=8)
            Fill(parent=row, align=C.TOTOP, height=1, color=border, state=C.UI_DISABLED)
            label(row, text, fontsize=15, color=teal, padTop=9)
            return row

        def Choice(self, parent, key, choices):
            row = self.ConfigRow(parent, key)
            control = Combo(parent=row, align=C.TOPRIGHT, left=row._nmb_control_offset, top=8, width=330, fontsize=15,
                options=[(_nmb_tr(text), value) for text, value in choices],
                select=self._config.get(key), callback=self.Changed)
            self._editors[key] = (control, 'choice')
            control.OnMouseWheel = self.ConfigMouseWheel
            control.state = C.UI_NORMAL if self._state.get('canConfigure') else C.UI_DISABLED

        def ConfigRow(self, parent, key):
            row = Container(parent=parent, align=C.TOTOP, height=60, padBottom=4, state=C.UI_NORMAL)
            self._configRows[key] = row
            self._configHelpIcons[key] = self.Help(row, lambda: self.ConfigTitle(key), lambda: self.ConfigHelp(key), top=10)
            reset = SettingResetButton(parent=row, align=C.TOPRIGHT, top=8,
                label='', func=lambda *args: self.ResetSetting(key))
            reset.OnMouseWheel = self.ConfigMouseWheel
            reset.hint = _nmb_tr('reset_field') + ': ' + _nmb_tr('reset_region_hint' if key == 'referenceRegionID' else
                ('reset_station_hint' if key == 'referenceStationID' else 'reset_field_hint'))
            reset.state = C.UI_NORMAL if self._state.get('canConfigure') and key in self._defaultConfig else C.UI_DISABLED
            self._resetButtons[key] = reset
            row._nmb_control_offset = reset.get_intrinsic_width() + 8
            names = Container(parent=row, align=C.TOALL, padding=(36, 10, 350 + row._nmb_control_offset, 0))
            self._configLabels[key] = label(names, _NMB_CONFIG_LABELS[key], fontsize=15, maxLines=3)
            return row

        def ConfigMouseWheel(self, *args):
            # Replace this instance's native value-changing wheel handler.
            # Arrow buttons/typing still edit; wheel movement scrolls the page.
            scroll = getattr(self, '_configScroll', None)
            if self.Valid() and scroll is not None and not getattr(scroll, 'destroyed', False):
                return scroll.OnMouseWheel(*args)
            return False

        def DefaultValue(self, key):
            if key not in self._defaultConfig:
                return None
            if key == 'referenceStationID':
                region = self._editors.get('referenceRegionID')
                regionID = region[0].GetValue() if region else self._config.get('referenceRegionID')
                stations = next((stations for region, name, stations in _NMB_TRADE_HUBS if region == regionID), ())
                return stations[0][0] if stations else None
            return self._defaultConfig.get(key)

        def UpdateResetButtons(self):
            for key, reset in getattr(self, '_resetButtons', {}).items():
                allowed = bool(self._state.get('canConfigure')) and self.DefaultValue(key) is not None
                reset.state = C.UI_NORMAL if allowed else C.UI_DISABLED

        def ResetSetting(self, key):
            if not self.Valid() or not self._state.get('canConfigure') or key not in self._editors:
                return
            row = self._configRows.get(key)
            if row is None or row.state == C.UI_HIDDEN:
                return
            value = self.DefaultValue(key)
            if value is None:
                return
            control, kind = self._editors[key]
            control.SetValue(_nmb_numeric_text(value) if kind == 'number' else value)
            if key == 'referenceRegionID':
                self.SyncReferenceStation()
                station = self.DefaultValue('referenceStationID')
                if station is not None:
                    self._editors['referenceStationID'][0].SetValue(station)
            self.Changed()

        def ConfigTitle(self, key):
            average = self._editors.get('useEveAveragePrices')
            iron = self._editors.get('ironMode')
            if key == 'referenceRegionID' and average and iron and average[0].GetValue() and not iron[0].GetValue():
                return 'demand_region_setting'
            return _NMB_CONFIG_LABELS[key]

        def ConfigHelp(self, key):
            text = _nmb_tr(_NMB_HELP_KEYS[key])
            average = self._editors.get('useEveAveragePrices')
            iron = self._editors.get('ironMode')
            if key == 'referenceRegionID' and average and iron and average[0].GetValue() and not iron[0].GetValue():
                text = _nmb_tr('help_demand_region')
            if key in ('referenceRegionID', 'referenceStationID'):
                region = self._editors.get('referenceRegionID')
                station = self._editors.get('referenceStationID')
                text += u'\n' + _nmb_tr('reference_ids',
                    region=region[0].GetValue() if region else self._config.get('referenceRegionID'),
                    station=station[0].GetValue() if station else self._config.get('referenceStationID'))
            return text

        def UpdateLimitControls(self):
            mode = self._editors.get('ironMode')
            ironMode = bool(mode[0].GetValue()) if mode else bool(self._config.get('ironMode'))
            enabled = bool(self._state.get('canConfigure')) and not ironMode
            section = getattr(self, '_configSections', {}).get('limits_group')
            if section is not None:
                section.state = C.UI_HIDDEN if ironMode else C.UI_NORMAL
            for key in ('dailyBudgetISK', 'sellerDailyBudgetISK', 'cycleBudgetISK', 'tqDailyVolumePercent'):
                if key in self._editors:
                    self.SetConfigVisible(key, not ironMode)
                    self._editors[key][0].state = C.UI_NORMAL if enabled else C.UI_DISABLED
            if 'minimumBatchPercent' in self._editors:
                random = self._editors.get('randomBatch')
                randomBatch = bool(random[0].GetValue() if random else self._config.get('randomBatch'))
                self.SetConfigVisible('minimumBatchPercent', randomBatch)
                canEdit = bool(self._state.get('canConfigure')) and randomBatch
                self._editors['minimumBatchPercent'][0].state = C.UI_NORMAL if canEdit else C.UI_DISABLED

        def SetConfigVisible(self, key, visible):
            # Hide the whole native row (label, help icon, editor and caption).
            # UI_HIDDEN also removes its space from CarbonUI's layout.
            row = getattr(self, '_configRows', {}).get(key)
            if row is not None:
                row.state = C.UI_NORMAL if visible else C.UI_HIDDEN

        def UpdateReferenceControls(self):
            mode = self._editors.get('useEveAveragePrices')
            average = bool(mode[0].GetValue()) if mode else bool(self._config.get('useEveAveragePrices'))
            allowed = bool(self._state.get('canConfigure'))
            iron = self._editors.get('ironMode')
            ironMode = bool(iron[0].GetValue()) if iron else bool(self._config.get('ironMode'))
            regionLabel = getattr(self, '_configLabels', {}).get('referenceRegionID')
            if regionLabel is not None:
                regionLabel.text = _nmb_text(_nmb_tr(self.ConfigTitle('referenceRegionID')))
            for key in ('referenceRegionID', 'referenceStationID'):
                if key in self._editors:
                    # Limited mode still uses regional history for its quota;
                    # the station has no role in average-price mode.
                    applicable = not average or (key == 'referenceRegionID' and not ironMode)
                    self.SetConfigVisible(key, applicable)
                    self._editors[key][0].state = C.UI_NORMAL if allowed and applicable else C.UI_DISABLED
            if 'historyLookbackDays' in self._editors:
                applicable = not average or not ironMode
                self.SetConfigVisible('historyLookbackDays', applicable)
                self._editors['historyLookbackDays'][0].state = C.UI_NORMAL if allowed and applicable else C.UI_DISABLED

        def UpdateMoneyCaptions(self):
            for key, caption in getattr(self, '_moneyCaptions', {}).items():
                try:
                    amount = float(self._editors[key][0].GetValue())
                    if math.isnan(amount) or math.isinf(amount) or amount < 0:
                        raise ValueError('Invalid amount')
                    caption.text = _nmb_text(GetQtyText(amount, EDIT_INPUT_TYPE_ISK)
                                             or eveformat.isk(amount, fraction=True))
                except (ValueError, TypeError):
                    caption.text = ''

        def Changed(self, *args):
            if not self._loading:
                self.UpdateLimitControls()
                self.UpdateReferenceControls()
                self.UpdateMoneyCaptions()
                self.UpdateResetButtons()
                self._dirty = self.PolicyChanged()
                self.SetNotice('unsaved_draft' if self._dirty else 'dashboard_notice')

        def ReadPolicy(self):
            # Use the same normalized values for comparisons and submissions:
            # focusing/reselecting or changing 35 to 35.0 is not a policy edit.
            # Combo callbacks are tasklets. Saving/navigating before one runs
            # must still use the newly selected region's matching station.
            # Combo callbacks can be queued: compute current visibility before
            # reading a draft or saving it. Hidden settings keep saved values,
            # so irrelevant/incomplete input cannot block the selected mode.
            self.UpdateLimitControls()
            self.UpdateReferenceControls()
            self.SyncReferenceStation()
            config = dict(self._config)
            for key, (control, kind) in self._editors.items():
                row = self._configRows.get(key)
                if row is not None and row.state == C.UI_HIDDEN:
                    region = self._configRows.get('referenceRegionID')
                    if key != 'referenceStationID' or region is None or region.state == C.UI_HIDDEN:
                        continue
                    # Keep a matching station when the visible quota-region
                    # changes; the hidden station itself is not an editor.
                value = control.GetValue()
                if kind in ('integer', 'bigint'):
                    value = int(value)
                elif kind == 'number':
                    value = _nmb_parse_number(value)
                    if _nmb_math.isnan(value) or _nmb_math.isinf(value):
                        raise _NmbUiError(_nmb_tr('numeric_values'))
                elif kind == 'money':
                    value = float(value)
                    if _nmb_math.isnan(value) or _nmb_math.isinf(value):
                        raise _NmbUiError(_nmb_tr('numeric_values'))
                config[key] = value
            return config

        def PolicyChanged(self):
            try:
                return self.ReadPolicy() != self._config
            except Exception:
                # Keep incomplete/invalid input as a draft until corrected.
                return True

        def ReloadPolicy(self, *args):
            self._dirty = False
            self.Refresh()

        def SavePolicy(self, *args):
            if self._busy or not self.Valid() or not self._state.get('canConfigure'):
                return
            try:
                config = self.ReadPolicy()
            except Exception as error:
                self.SetNotice('numeric_values', True)
                return
            if config == self._config:
                self._dirty = False
                self.SetNotice('dashboard_notice')
                return
            self._busy = True
            self._saving = True
            owner.spawn(self.SavePolicyWork, config, self._revision)

        def SavePolicyWork(self, config, revision):
            try:
                result = owner.request('NpcMarketConfigure', _nmb_json.dumps({'config': config, 'revision': revision}))
                if self.Valid():
                    self._state.update(result)
                    self._config = dict(result.get('config') or config)
                    self._revision = result.get('revision')
                    # Compare against what the server accepted, including edits
                    # made while awaiting the response and edits then reverted.
                    self._dirty = self.PolicyChanged()
                    self.RenderSummary()
                    if self._dirty:
                        self.SetNotice('saved_more_draft')
                    else:
                        self.RenderConfigure()
                        self.SetNotice('policy_saved')
            except Exception as error:
                self.SetNotice(_nmb_error_text(error), True)
            finally:
                self._saving = False
                self._busy = False

        def RenderActivity(self, rows):
            self._activityData = list(rows)
            mode = self.ViewMode('activity')
            signature = _nmb_json.dumps(rows, sort_keys=True)
            if self._renderSignature == ('activity', mode, signature):
                return
            self._renderSignature = ('activity', mode, signature)
            self.ClearBody()
            self.Heading('market_activity', len(rows))
            net = Container(parent=self.body, align=C.TOTOP, height=34)
            self.Help(net, 'net_received', _nmb_tr('help_net'), top=0)
            label(net, 'net_received', align=C.TOPLEFT, left=36, top=3, fontsize=13, color=muted)
            if mode != 'details':
                self.RenderCompactActivity(rows, mode)
                return
            scroll = ScrollContainer(parent=self.body, align=C.TOALL)
            if not rows:
                label(scroll, 'no_activity', padding=18, color=muted)
            lastDate = None
            for activity in rows[:200]:
                details = dict(activity.get('details') or {})
                details.update(activity)
                kind = details.get('kind')
                when = field(details, ('createdAt', 'at', 'timestamp'), '')
                date, clock = '', unicode(when)
                if isinstance(when, (int, long, float)):
                    stamp = time.localtime(when / 1000.0)
                    date, clock = time.strftime('%Y-%m-%d', stamp), time.strftime('%H:%M:%S', stamp)
                if date != lastDate:
                    label(scroll, date, fontsize=14, color=muted, padTop=12, padBottom=10)
                    lastDate = date
                purchase = kind == 'purchase'
                resolved = kind == 'recovery' and details.get('resolution') == 'settled'
                rejected = kind == 'rejected' or details.get('resolution') == 'rejected'
                color = amber if (kind == 'recovery' and not resolved) or rejected else teal
                panel = Container(parent=scroll, align=C.TOTOP, height=132 if purchase else 112, padBottom=5)
                Fill(bgParent=panel, color=(0.045, 0.073, 0.089, .85))
                Fill(parent=panel, align=C.TOBOTTOM, height=1, color=border, state=C.UI_DISABLED)
                timeCell = Container(parent=panel, align=C.TOLEFT, width=105, padding=(8, 18, 4, 0))
                timeLabel = label(timeCell, clock, fontsize=13, color=muted)
                if details.get('offlinePurchase'):
                    timeLabel.state = C.UI_NORMAL
                    timeLabel.hint = _nmb_tr('offline_time_hint')
                image = Container(parent=panel, align=C.TOLEFT, width=78)
                if purchase:
                    item_icon(image, details.get('typeID'))
                else:
                    event_icon(image, kind, resolved, rejected, color)
                payment = Container(parent=panel, align=C.TORIGHT, width=265, padding=(12, 14, 10, 0))
                content = Container(parent=panel, align=C.TOALL, padding=(6, 12, 12, 6))
                title = _nmb_activity_title(details, type_name(details.get('typeID', 0)))
                if resolved:
                    title = _nmb_tr('confirmed_event')
                elif rejected:
                    title = _nmb_tr('rejected_event')
                label(content, title, bold=True, fontsize=16, maxLines=2)
                if purchase:
                    quantity = _nmb_number(details.get('quantity'))
                    gross, tax = details.get('grossISK'), details.get('taxISK')
                    validGross = isinstance(gross, (int, long, float)) and not _nmb_math.isnan(gross) and not _nmb_math.isinf(gross) and gross >= 0
                    validTax = isinstance(tax, (int, long, float)) and not _nmb_math.isnan(tax) and not _nmb_math.isinf(tax) and validGross and 0 <= tax <= gross
                    if quantity > 0 and validGross:
                        label(content, _nmb_tr('purchase_detail', quantity=units(quantity), price=_nmb_isk(gross / quantity)), fontsize=14, padTop=5)
                    label(content, _nmb_tr('gross_tax', gross=_nmb_isk(gross) if validGross else _nmb_tr('unknown'),
                          tax=_nmb_isk(tax) if validTax else _nmb_tr('unknown')), fontsize=13, color=muted, padTop=5)
                    label(content, _nmb_tr('order', order=field(details, ('orderID', 'orderId'), '?')), fontsize=13, color=muted, padTop=3)
                    label(payment, 'offline_purchase' if details.get('offlinePurchase') else 'completed', fontsize=12, color=teal, padBottom=8)
                    label(payment, '+' + _nmb_isk(round(gross - tax, 2)) if validTax else _nmb_tr('net_unknown'), fontsize=18, color=teal, bold=True, maxLines=2)
                else:
                    message = 'configuration_detail' if kind == 'configuration' else ('confirmed_detail' if resolved else ('rejected_detail' if rejected else 'pending_detail'))
                    label(content, message, fontsize=14, color=muted, padTop=7, maxLines=3)
                    label(payment, 'settings_badge' if kind == 'configuration' else ('confirmed' if resolved else ('rejected_badge' if rejected else 'pending')),
                          fontsize=13, color=color)

        def Poll(self):
            while self.Valid():
                owner.sleep(20000)
                if self.Valid() and not self._dirty and self._page != 'configure':
                    self.Refresh()

        def Close(self, *args, **kwargs):
            self._serial = getattr(self, '_serial', 0) + 1
            try:
                self.engineDot.StopAnimations()
                self.offlineDot.StopAnimations()
            except Exception:
                pass
            return Window.Close(self, *args, **kwargs)

    return NpcMarketWindow
