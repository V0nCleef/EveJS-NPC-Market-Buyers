# -*- coding: utf-8 -*-
"""Launcher shared Mods menu API 1 adapter. Gameplay companion owns the window."""
import evejs_mod_menu as _nmb_mods
import __builtin__ as _nmb_builtins


def _nmb_menu_owner():
    return getattr(_nmb_builtins, '_evejs_npc_market_buyers_v1', None)


def available():
    owner = _nmb_menu_owner()
    return owner is not None and owner.usable()


def open_window():
    owner = _nmb_menu_owner()
    if owner is not None and owner.usable():
        owner.open_window()


_nmb_names = {
    'en': u'NPC Market Buyers', 'de': u'NPC-Marktkäufer', 'fr': u'Acheteurs PNJ',
    'es': u'Compradores NPC', 'ru': u'Покупатели NPC', 'zh': u'NPC市场买家',
    'zh_CN': u'NPC市场买家', 'ja': u'NPC市場購入者', 'ko': u'NPC 시장 구매자'
}
_nmb_owner = _nmb_menu_owner()
if _nmb_owner is not None:
    _nmb_names = _nmb_owner.menu_labels()
registration = _nmb_mods.register('npc-market-buyers', _nmb_names, open_window,
                                 is_available=available, api_version=1)


def cleanup():
    registration.close()
