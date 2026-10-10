# -*- coding: utf-8 -*-
"""Native Wallet descriptions for receipted NPC sales and offline summaries."""
import json as _nmb_wallet_json
try:
    _nmb_wallet_string_types = (basestring,)
except NameError:
    _nmb_wallet_string_types = (str,)


def _nmb_wallet_summary_text(reason):
    if not isinstance(reason, _nmb_wallet_string_types):
        return None
    offline = reason.startswith('{"npcMarketBuyersOfflineSummary":')
    sale = reason.startswith('{"npcMarketBuyersSale":')
    if not offline and not sale:
        return None
    try:
        data = _nmb_wallet_json.loads(reason).get('npcMarketBuyersOfflineSummary' if offline else 'npcMarketBuyersSale')
        if isinstance(data, dict) and data.get('version') == 1:
            text = data.get('text')
            if isinstance(text, _nmb_wallet_string_types) and text:
                if sale:
                    type_id = int(data.get('typeID', 0))
                    if type_id <= 0 or '{item}' not in text:
                        return None
                    import evetypes
                    name = evetypes.GetName(type_id)
                    if not isinstance(name, _nmb_wallet_string_types) or not name:
                        return None
                    name = name.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                    return text.replace('{item}', name)
                return text
    except (ValueError, TypeError, AttributeError, KeyError, ImportError):
        pass
    return None


def _nmb_install_wallet_summaries(owner):
    from eve.client.script.ui.shared.neocom.wallet.panels import transactionsPanel
    original = transactionsPanel.FmtWalletEntry
    def formatted(*args, **kwargs):
        if owner.usable():
            reason = kwargs.get('reason', args[6] if len(args) > 6 else None)
            text = _nmb_wallet_summary_text(reason)
            if text is not None:
                return text
        return original(*args, **kwargs)
    transactionsPanel.FmtWalletEntry = formatted
    class Attachment(object):
        def close(self):
            if transactionsPanel.FmtWalletEntry is formatted:
                transactionsPanel.FmtWalletEntry = original
    return Attachment()
