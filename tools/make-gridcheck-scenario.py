"""Visual regression scenario for the isolated, already populated test world."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
steps = []
def check(code, note):
    steps.append({'clientEval':code, 'user':'nmbstats', 'note':note})
def shot(name):
    steps.append({'clientScreenshot':name, 'user':'nmbstats'})

steps.append({'clientLaunch':{'user':'nmbstats','name':'NPC Buyers Test'}})
check('''import __builtin__, blue, time
assert session.charid == 140000006
assert getattr(sm.GetService('viewState').GetCurrentView(),'name',None) == 'hangar'
assert not uicore.layer.loading.display, 'Wait for the station loading screen before visual checks'
assert not any(x.name == 'loadingindicator' and x.display for x in uicore.desktop.children), 'Wait for the client loading indicator before visual checks'
o = __builtin__._evejs_npc_market_buyers_v1
assert o.usable()
o.open_window()
w = o.windowClass.GetIfOpen()
assert w is not None
w.SetSize(1600,1100)
w.left,w.top = 200,70
w.SelectPage('orders')
blue.pyos.synchro.SleepWallclock(2200)
assert not w._busy
assert w._orderSummary == {'activeCount':10,'soldISK':266136500,'remainingISK':714462500,'totalISK':980599000}
assert len(w._orderData) == 10
w.SetViewMode('orders','icons')
blue.pyos.synchro.SleepWallclock(1200)
{'check':'normal mod window opens; active-order totals match actual native receipts','summary':w._orderSummary}''',
    'Open the normal native mod window, not a mockup; validate ten real sell orders.')
shot('orders-icons')
for mode in ('details','list'):
    check("w.SetViewMode('orders','%s'); blue.pyos.synchro.SleepWallclock(800); assert len(w._orderQuantities)==10" % mode,
          'Orders remain complete in '+mode+' view, with readable ISK captions.')
    shot('orders-'+mode)
check('''started=time.time()
samples=[]
for days in (None,17,36500):
    t=time.time()
    response=o.request('NpcMarketStatistics',__import__('json').dumps({'days':days}))
    assert response.get('success',True)
    data=response['statistics']
    assert len(data['buckets'])<=61
    if days is None:
        assert data['totals']=={'purchases':12010,'units':52727269,'grossISK':56897756880,'taxISK':4551820548,'netISK':52345936332,'unknownTax':0}
    samples.append({'days':days,'milliseconds':round((time.time()-t)*1000,1),'purchases':data['totals']['purchases']})
w.SelectPage('statistics')
blue.pyos.synchro.SleepWallclock(1800)
assert not w._busy
{'check':'all-history and custom-range accounting; bounded graphs','rpcSamples':samples}''',
    'Read persisted 12,010-sale totals through the real client RPC path; measure three ranges.')
shot('statistics-all-history')
check("w.SelectStatisticsPeriod(None,'','custom'); w._statisticsDayEdit.SetValue(17); w.ApplyStatisticsDays(); blue.pyos.synchro.SleepWallclock(1800); assert w._statisticsDays==17; assert not w._dirty; assert w._statisticsDayEdit.GetValue()==17",
    'Apply an arbitrary 17-day range without marking configuration dirty.')
shot('statistics-17-days')
check("w.SelectPage('activity'); blue.pyos.synchro.SleepWallclock(1800); assert len(w._activityData)==100; assert w._activityMeta['recentCount']==500; assert w._activityMeta['archiveCount']==11510; w.SetViewMode('activity','list'); blue.pyos.synchro.SleepWallclock(1200)",
    'Recent Activity stays bounded and keeps icons in List view.')
shot('activity-recent-list')
check("w.SelectActivityScope(None,'','archive'); blue.pyos.synchro.SleepWallclock(1800); assert len(w._activityData)==100; first=set(x['id'] for x in w._activityData); w.ActivityNext(); blue.pyos.synchro.SleepWallclock(1800); assert w._activityPage==1; assert not first.intersection(x['id'] for x in w._activityData); w.ActivityPrevious(); blue.pyos.synchro.SleepWallclock(1800); assert first==set(x['id'] for x in w._activityData)",
    'Archive Next/Previous paging has no overlapping or missing entries at the boundary.')
shot('activity-archive-list')
for mode in ('details','icons'):
    check("w.SetViewMode('activity','%s'); blue.pyos.synchro.SleepWallclock(1000); assert len(w._activityData)==100" % mode,
          'Archived payment amounts and readable captions remain visible in '+mode+' view.')
    shot('activity-archive-'+mode)
check("w.SetSize(1120,860); w.SelectPage('statistics'); blue.pyos.synchro.SleepWallclock(1800); assert not w._busy; assert not w._dirty; {'check':'minimum window size remains usable'}",
    'Check the minimum supported window size with four tabs and custom-range controls.')
shot('statistics-minimum-size')
check("w.SetSize(1600,1100); w.SelectPage('orders'); blue.pyos.synchro.SleepWallclock(1200); w.SetViewMode('orders','icons')",
    'Leave the ordinary Orders screen ready for review.')
scenario={'name':'npc-market-statistics','description':'Candidate 0.1.16 native HUD, receipts, archive and statistics visual checks. Run only in the isolated populated fixture world; never in the live play tree.',
    'world':'starter','setup':steps,'until':{'timeout':1,'from':'start'},
    'expect':['no CLIENT_EXCEPTION']}
destination=root/'tests/gridcheck/statistics.json'
destination.parent.mkdir(parents=True,exist_ok=True)
destination.write_text(json.dumps(scenario,indent=2)+'\n',encoding='utf-8',newline='\n')
print(destination)
