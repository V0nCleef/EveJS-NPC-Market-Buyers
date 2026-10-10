"""Native Wallet formatter and popup contracts; no launched EVE client."""
import ast, json, os, sys, types, unittest
from pathlib import Path
from collections import defaultdict, namedtuple
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(os.environ.get('EVEJS_WALLET_REFERENCE_DIR',str(ROOT/'tests/private/wallet-reference')))

def module(name):
    if name not in sys.modules:
        value=types.ModuleType(name);value.__path__=[];sys.modules[name]=value
        if '.' in name:
            parent,child=name.rsplit('.',1);setattr(module(parent),child,value)
    return sys.modules[name]

class WalletTests(unittest.TestCase):
    def test_actual_native_transaction_class_displays_only_our_summary_and_restores_formatter(self):
        panel=module('eve.client.script.ui.shared.neocom.wallet.panels.transactionsPanel')
        panel.FmtWalletEntry=lambda *args,**kwargs:'native market description'
        original=panel.FmtWalletEntry
        panel.FmtWalletCurrency=lambda value,currency:str(value)
        panel.GetByLabel=lambda *args,**kwargs:'native date or hint'
        panel.GetTransactionHint=lambda data:None
        panel.sm=types.SimpleNamespace(GetService=lambda name:types.SimpleNamespace(GetRefTypeKeyByID=lambda ID:types.SimpleNamespace(entryTypeName='Market Transaction')))
        class BaseTransaction:
            def __init__(self,data):self.data=data
        panel.BaseTransaction=BaseTransaction
        tree=ast.parse((SOURCE/'eve/client/script/ui/shared/neocom/wallet/panels/transactionsPanel.py').read_text())
        nodes=[n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Transaction']
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'native.Transaction','exec'),panel.__dict__)
        ns={};exec(compile((ROOT/'client/wallet_summary.py').read_text(),'wallet_summary.py','exec'),ns)
        owner=types.SimpleNamespace(usable=lambda:True)
        attachment=ns['_nmb_install_wallet_summaries'](owner)
        module('evetypes').GetName=lambda type_id:'Infrared S' if type_id==241 else '<test & item>'
        for text in ['NPC offline sales: 60 purchases. Gross 6,000.00 ISK; tax 480.00 ISK.',
                     'オフライン中のNPCへの売却：60件。','离线NPC销售：60笔。','Продажи NPC: 60 покупок.']:
            reason=json.dumps({'npcMarketBuyersOfflineSummary':{'version':1,'text':text}},separators=(',',':'),ensure_ascii=False)
            row=types.SimpleNamespace(amount=5520,balance=6520,entryTypeID=2,currency=1,transactionDate=1,ownerID1=1,ownerID2=2,referenceID=1,description=reason)
            transaction=panel.Transaction(row)
            self.assertEqual(transaction.descriptionString,text)
            self.assertEqual(transaction.amount,5520)
            self.assertEqual(panel.FmtWalletEntry(2,1,2,1,1,5520,reason),text)
        for text in ['NPC sale: 156 × {item} at 9.00 ISK each. Gross 1,404.00 ISK; tax 112.32 ISK; net 1,291.68 ISK.',
                     'NPC sales tax: 156 × {item}. Tax 112.32 ISK.',
                     'NPCへの売却：156 × {item}。','售予NPC：156 × {item}。']:
            reason=json.dumps({'npcMarketBuyersSale':{'version':1,'typeID':241,'text':text}},separators=(',',':'),ensure_ascii=False)
            row.description=reason;row.amount=1404;row.entryTypeID=54 if text.startswith('NPC sales tax') else 2
            self.assertEqual(panel.Transaction(row).descriptionString,text.replace('{item}','Infrared S'))
            self.assertEqual(panel.Transaction(row).amount,1404)
        reason=json.dumps({'npcMarketBuyersSale':{'version':1,'typeID':34,'text':'NPC sale: {item}.'}},separators=(',',':'))
        self.assertEqual(panel.FmtWalletEntry(2,1,2,1,reason=reason),'NPC sale: &lt;test &amp; item&gt;.')
        for reason in ['normal native description','{"npcMarketBuyersOfflineSummary":broken',
                       '{"npcMarketBuyersSale":{"version":1,"typeID":0,"text":"{item}"}}',
                       '{"npcMarketBuyersSale":{"version":2,"typeID":241,"text":"{item}"}}',
                       '{"npcMarketBuyersSale":{"version":1,"typeID":241,"text":"missing item token"}}',
                       '{"npcMarketBuyersOfflineSummary":{"version":2,"text":"unsupported"}}']:
            self.assertEqual(panel.FmtWalletEntry(2,1,2,1,reason=reason),'native market description')
        owner.usable=lambda:False
        self.assertEqual(panel.FmtWalletEntry(2,1,2,1,reason=row.description),'native market description')
        attachment.close();self.assertIs(panel.FmtWalletEntry,original)

    def test_actual_native_wallet_signal_and_popup_manager_make_one_net_credit(self):
        shown=[]
        class Popup:
            def __init__(self,transactions,finishedCallBack):self.transactions=transactions
            def ShowBalanceChange(self,neocom):shown.extend(self.transactions)
        transaction=namedtuple('IskTransaction','new_balance transaction')
        ns={'defaultdict':defaultdict,'IskTransaction':transaction,'LpTransaction':transaction,'PlexTransaction':transaction}
        # Python 2's iteritems spelling is the only host compatibility change.
        tree=ast.parse((SOURCE/'neocom2/walletPopupManager.py').read_text().replace('.iteritems()', '.items()'))
        nodes=[n for n in tree.body if isinstance(n,ast.ClassDef)]
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'native.WalletPopupManager','exec'),ns)
        manager=ns['WalletPopupManager'](types.SimpleNamespace(Get=lambda name,default:default),types.SimpleNamespace(display=True),Popup)
        tree=ast.parse((SOURCE/'eve/client/script/ui/shared/neocom/wallet/walletSvc.py').read_text())
        methods=[method for node in tree.body if isinstance(node,ast.ClassDef) for method in node.body if isinstance(method,ast.FunctionDef) and method.name=='_OnCharAccountChange']
        self.assertEqual(len(methods),1)
        ns.update(GetSettingValue=lambda key:False,sm=types.SimpleNamespace(ScatterEvent=lambda *args:None),
          walletSignals=types.SimpleNamespace(on_personal_isk_balance_changed=manager.OnPersonalAccountChangedClient))
        exec(compile(ast.Module(body=methods,type_ignores=[]),'native.WalletService','exec'),ns)
        class Wallet:
            _wealth=1000
            wealth=property(lambda self:self._wealth)
        wallet=Wallet();ns['_OnCharAccountChange'](wallet,6520)
        manager.ProcessWaitingTransactions()
        self.assertEqual(len(shown),1);self.assertEqual(shown[0].transaction,5520);self.assertEqual(shown[0].new_balance,6520)

if __name__=='__main__':unittest.main(verbosity=2)
