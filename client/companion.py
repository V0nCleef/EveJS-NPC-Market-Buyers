# -*- coding: utf-8 -*-
"""Deferred login bootstrap. One manager, a fresh UI generation per character."""
import __builtin__ as _nmb_builtins
import blue as _nmb_blue
import uthread as _nmb_uthread


class _NmbCompanion(object):
    __notifyevents__ = ['OnSessionChanged', 'OnDisconnect', 'OnConnectionClosed', 'OnUIRefresh']

    def __init__(self):
        self.characterID = None
        self.active = True
        self.ready = False
        self.generation = 0
        self.sm = None
        self.session = None
        self.advisor = None
        self.walletSummary = None
        self.registration = None
        self.windowClass = None
        self.registered = []

    def current(self):
        return self.active and getattr(_nmb_builtins, '_evejs_npc_market_buyers_v1', None) is self

    def usable(self):
        return (self.current() and self.ready and bool(self.characterID)
                and getattr(self.session, 'charid', None) == self.characterID)

    def spawn(self, function, *args):
        generation = self.generation
        def guarded():
            if self.usable() and generation == self.generation:
                return function(*args)
        if self.usable():
            return _nmb_uthread.new(guarded)

    def sleep(self, milliseconds):
        _nmb_blue.pyos.synchro.SleepWallclock(milliseconds)

    def diagnostic(self, message):
        try:
            import log
            log.LogException(message)
        except Exception:
            pass

    def request(self, method, *args):
        if not self.usable():
            raise _NmbUiError(_nmb_tr('session_not_ready'))
        generation = self.generation
        result = getattr(self.sm.RemoteSvc('marketProxy'), method)(*args)
        if not self.usable() or generation != self.generation:
            raise _NmbUiError(_nmb_tr('stale_session'))
        response = _nmb_json.loads(result)
        if not isinstance(response, dict) or not response.get('success'):
            raise _NmbUiError(_nmb_response_error(response) if isinstance(response, dict) else _nmb_tr('invalid_response'))
        return response

    def register_menu(self):
        try:
            import evejs_mod_menu as mods
            self.registration = mods.register('npc-market-buyers', self.menu_labels(),
                                             self.open_window, is_available=self.usable, api_version=1)
            return True
        except ImportError:
            return False

    def menu_retry(self, generation):
        for attempt in range(20):
            if not self.usable() or generation != self.generation or self.registration is not None:
                return
            if self.register_menu():
                return
            self.sleep(500)

    def menu_labels(self):
        return _nmb_menu_labels()

    def start(self):
        try:
            # Signed login delivery precedes character selection and sometimes sm/session.
            for attempt in range(240):
                self.sleep(500)
                if not self.current():
                    return
                context = globals().get('_nmb_context') or {}
                self.sm = context.get('sm') or getattr(_nmb_builtins, 'sm', None)
                self.session = context.get('session') or getattr(_nmb_builtins, 'session', None)
                if self.sm is not None and self.session is not None:
                    break
            else:
                self.close()
                return
            for event in self.__notifyevents__:
                self.sm.RegisterForNotifyEvent(self, event)
                self.registered.append(event)
            self.changed()
        except Exception:
            self.close()
            self.diagnostic('NPC market login bootstrap failed')

    def changed(self):
        if not self.current():
            return
        character = getattr(self.session, 'charid', None)
        if character == self.characterID and self.ready:
            return
        self.release_character()
        self.characterID = character
        if character:
            _nmb_uthread.new(self.connect, self.generation)

    def connect(self, generation):
        self.sleep(500)
        if (not self.current() or generation != self.generation or not self.characterID
                or getattr(self.session, 'charid', None) != self.characterID):
            return
        self.ready = True
        try:
            self.walletSummary = _nmb_install_wallet_summaries(self)
        except Exception:
            self.diagnostic('NPC market Wallet summary attachment unavailable')
        try:
            self.advisor = _nmb_install_sell_advisor(self)
        except Exception:
            self.diagnostic('NPC market Sell Items attachment unavailable')
        if not self.register_menu():
            self.spawn(self.menu_retry, generation)

    def open_window(self, *args):
        if not self.usable():
            return
        try:
            if self.windowClass is None:
                self.windowClass = _nmb_make_window(self)
            self.windowClass.Open()
        except Exception:
            self.diagnostic('NPC Market Buyers could not open its window')
            try:
                from player_messaging.client.ui_message import message_player
                message_player(_nmb_tr('open_error'))
            except Exception:
                pass

    def OnSessionChanged(self, *args):
        if self.current():
            if len(args) > 1 and hasattr(args[1], 'charid'):
                self.session = args[1]
            self.changed()

    def OnDisconnect(self, *args):
        self.release_character()

    def OnConnectionClosed(self, *args):
        self.release_character()

    def OnUIRefresh(self, *args):
        if self.current():
            self.release_character()
            self.changed()

    def release_character(self):
        self.ready = False
        self.generation += 1
        self.characterID = None
        if self.walletSummary is not None:
            try:
                self.walletSummary.close()
            except Exception:
                self.diagnostic('NPC market Wallet summary cleanup failed')
            self.walletSummary = None
        if self.advisor is not None:
            try:
                self.advisor.close()
            except Exception:
                self.diagnostic('NPC market Sell Items cleanup failed')
            self.advisor = None
        if self.registration is not None:
            try:
                self.registration.close()
            except Exception:
                self.diagnostic('NPC market menu cleanup failed')
            self.registration = None
        if self.windowClass is not None:
            try:
                self.windowClass.CloseIfOpen()
            except Exception:
                self.diagnostic('NPC market window cleanup failed')
            self.windowClass = None

    def close(self):
        if not self.active:
            return
        self.active = False
        self.release_character()
        for event in self.registered:
            try:
                self.sm.UnregisterForNotifyEvent(self, event)
            except Exception:
                pass
        self.registered = []
        if getattr(_nmb_builtins, '_evejs_npc_market_buyers_v1', None) is self:
            delattr(_nmb_builtins, '_evejs_npc_market_buyers_v1')


def _nmb_start():
    previous = getattr(_nmb_builtins, '_evejs_npc_market_buyers_v1', None)
    if previous is not None:
        previous.close()
    owner = _NmbCompanion()
    setattr(_nmb_builtins, '_evejs_npc_market_buyers_v1', owner)
    _nmb_uthread.new(owner.start)
    return owner


if not globals().get('_NMB_TESTING', False):
    _nmb_owner = _nmb_start()
