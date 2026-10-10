"""Authored translations for the statistics and history controls."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
rows = {
'statistics_tab': ['Statistics','Statistik','Statistiques','Estadísticas','Статистика','统计','統計','통계'],
'value_sold': ['SOLD','VERKAUFT','VENDU','VENDIDO','ПРОДАНО','已售','販売済み','판매 완료'],
'value_remaining': ['REMAINING','VERBLEIBEND','RESTANT','RESTANTE','ОСТАЛОСЬ','剩余','残り','남은 금액'],
'value_total': ['TOTAL VALUE','GESAMTWERT','VALEUR TOTALE','VALOR TOTAL','ОБЩАЯ СТОИМОСТЬ','总价值','合計額','총 가치'],
'orders_value_help': [
 'These active orders only. Sold: completed NPC sales at their actual sale prices. Remaining: unsold quantity at the current asking price. Total: sold plus remaining. These values are before sales tax; Statistics shows net earnings.',
 'Nur diese aktiven Aufträge. Verkauft: abgeschlossene NPC-Käufe zu den tatsächlichen Preisen. Verbleibend: Restmenge zum aktuellen Angebotspreis. Gesamt: verkauft plus verbleibend. Werte vor Verkaufssteuer; Statistik zeigt den Nettoerlös.',
 'Uniquement ces ordres actifs. Vendu : ventes aux PNJ aux prix réels. Restant : quantité invendue au prix demandé actuel. Total : vendu plus restant. Valeurs avant taxe ; les statistiques montrent le revenu net.',
 'Solo estas órdenes activas. Vendido: ventas a PNJ a sus precios reales. Restante: unidades sin vender al precio actual. Total: vendido más restante. Importes antes de impuestos; Estadísticas muestra los ingresos netos.',
 'Только активные ордера. Продано: завершённые продажи NPC по фактическим ценам. Осталось: непроданное количество по текущей цене. Итого: продано плюс остаток. Суммы до налога; чистый доход указан в статистике.',
 '仅统计这些有效订单。已售：按实际成交价计算的NPC销售额。剩余：未售数量乘以当前售价。总价值：已售加剩余。以上为税前金额；统计页面显示净收入。',
 '現在有効な注文のみ。販売済み：実際の価格で成立したNPCへの売上。残り：未販売数量と現在の出品価格から算出。合計：販売済み＋残り。税引き前の金額です。純利益は統計に表示されます。',
 '현재 활성 주문만 계산합니다. 판매 완료: 실제 거래 가격으로 완료된 NPC 판매액. 남은 금액: 미판매 수량에 현재 가격을 곱한 값. 총 가치: 판매액과 남은 금액의 합계. 세전 금액이며 통계에서 순수익을 확인할 수 있습니다.'],
'activity_recent': ['Recent activity','Neueste Aktivität','Activité récente','Actividad reciente','Недавние события','近期活动','最近の履歴','최근 활동'],
'activity_archive': ['Archive','Archiv','Archives','Archivo','Архив','归档','アーカイブ','보관함'],
'archive_help': [
 'Recent shows up to 500 entries from the last 30 days. Older entries stay in Archive. Each page holds 100 entries. Nothing is deleted, and all sales still count in Statistics. Recent: {recent}. Archived: {archived}.',
 'Neueste Aktivität zeigt bis zu 500 Einträge der letzten 30 Tage. Ältere bleiben im Archiv. Jede Seite enthält 100 Einträge. Nichts wird gelöscht; alle Verkäufe zählen weiterhin in der Statistik. Neu: {recent}. Archiviert: {archived}.',
 'L’activité récente affiche jusqu’à 500 entrées des 30 derniers jours. Les autres restent dans les archives. Chaque page contient 100 entrées. Rien n’est supprimé et toutes les ventes comptent dans les statistiques. Récentes : {recent}. Archivées : {archived}.',
 'Actividad reciente muestra hasta 500 entradas de los últimos 30 días. Las anteriores quedan en Archivo. Cada página contiene 100 entradas. No se borra nada y todas las ventas cuentan en Estadísticas. Recientes: {recent}. Archivadas: {archived}.',
 'Недавние события: до 500 записей за последние 30 дней. Более старые записи остаются в архиве. На странице 100 записей. Ничего не удаляется, все продажи учитываются в статистике. Недавние: {recent}. В архиве: {archived}.',
 '近期活动最多显示最近30天内的500条记录，其余保留在归档中。每页100条。不会删除记录，所有销售仍计入统计。近期：{recent}。已归档：{archived}。',
 '最近30日間の履歴を最大500件表示します。古い履歴はアーカイブに残ります。1ページ100件。履歴は削除されず、すべての売上が統計に含まれます。最近：{recent}件。保管済み：{archived}件。',
 '최근 30일의 기록을 최대 500개 표시합니다. 나머지는 보관함에 남습니다. 페이지당 100개이며 삭제하지 않습니다. 모든 판매는 계속 통계에 포함됩니다. 최근: {recent}개. 보관됨: {archived}개.'],
'previous_page': ['Previous','Zurück','Précédent','Anterior','Назад','上一页','前へ','이전'],
'next_page': ['Next','Weiter','Suivant','Siguiente','Далее','下一页','次へ','다음'],
'page_number': ['Page {page}','Seite {page}','Page {page}','Página {page}','Стр. {page}','第{page}页','{page}ページ','{page}페이지'],
'statistics_period': ['Time period','Zeitraum','Période','Periodo','Период','时间范围','期間','기간'],
'all_history': ['All history','Gesamter Verlauf','Tout l’historique','Todo el historial','За всё время','全部历史','全期間','전체 기록'],
'last_days': ['Last {days} days','Letzte {days} Tage','{days} derniers jours','Últimos {days} días','Последние {days} дн.','最近{days}天','過去{days}日間','최근 {days}일'],
'custom_days': ['Choose number of days','Anzahl Tage wählen','Choisir le nombre de jours','Elegir número de días','Выбрать число дней','自定义天数','日数を指定','일수 직접 선택'],
'apply_days': ['Apply','Anwenden','Appliquer','Aplicar','Применить','应用','適用','적용'],
'statistics_help': [
 'Only completed NPC purchases count here. Sales are the full amount before sales tax. Net earned is what remains after that tax. Broker fees are not included. Choose all history or 1 to 36,500 days. Offline sales use their simulated purchase dates. The chart combines days for long periods; hover over a bar for amounts. Archived sales always count.',
 'Hier zählen nur abgeschlossene NPC-Käufe. Umsatz ist der Betrag vor Verkaufssteuer. Nettoerlös ist der Betrag danach. Maklergebühren sind nicht enthalten. Wähle den gesamten Verlauf oder 1 bis 36.500 Tage. Offline-Verkäufe nutzen ihre simulierten Kaufdaten. Bei langen Zeiträumen fasst das Diagramm Tage zusammen; fahre über einen Balken für Beträge. Archivierte Verkäufe zählen immer.',
 'Seuls les achats PNJ terminés comptent. Les ventes sont avant taxe ; le revenu net est après taxe. Les frais de courtage sont exclus. Choisissez tout l’historique ou 1 à 36 500 jours. Les ventes hors ligne utilisent leurs dates simulées. Le graphique regroupe les jours sur les longues périodes ; survolez une barre pour les montants. Les ventes archivées comptent toujours.',
 'Solo cuentan las compras de PNJ completadas. Ventas es el importe antes de impuestos; ingresos netos es lo que queda después. No incluye comisiones de intermediación. Elige todo el historial o de 1 a 36.500 días. Las ventas sin conexión usan sus fechas simuladas. El gráfico agrupa días en periodos largos; pasa el cursor por una barra para ver importes. Las ventas archivadas siempre cuentan.',
 'Учитываются только завершённые покупки NPC. Продажи — сумма до налога, чистый доход — после налога. Брокерские сборы не включены. Выберите всё время или от 1 до 36 500 дней. Для офлайн-продаж используются смоделированные даты. При большом периоде дни объединяются; наведите курсор на столбец для сумм. Архивные продажи всегда учитываются.',
 '仅计入已完成的NPC购买。销售额为税前金额，净收入为扣除销售税后的金额，不含经纪费。可选择全部历史或1至36500天。离线销售使用模拟成交日期。时间较长时，图表会合并日期；悬停柱形可查看金额。归档销售始终计入统计。',
 '成立したNPCの購入のみを集計します。売上は販売税控除前、純利益は控除後の金額です。仲介手数料は含みません。全期間または1～36,500日を選べます。オフライン販売はシミュレーション上の購入日を使用します。長期間では日をまとめて表示します。棒にカーソルを重ねると金額を確認できます。保管済みの売上も集計されます。',
 '완료된 NPC 구매만 계산합니다. 매출은 판매세 공제 전, 순수익은 공제 후 금액입니다. 중개 수수료는 제외됩니다. 전체 기록 또는 1~36,500일을 선택하세요. 오프라인 판매는 시뮬레이션 날짜를 사용합니다. 기간이 길면 날짜를 묶어 표시하며 막대에 마우스를 올리면 금액을 볼 수 있습니다. 보관된 판매도 항상 포함됩니다.'],
'net_earned': ['Net earned','Nettoerlös','Revenu net','Ingresos netos','Чистый доход','净收入','純利益','순수익'],
'gross_sales': ['Sales before tax','Umsatz vor Steuer','Ventes avant taxe','Ventas antes de impuestos','Продажи до налога','税前销售额','税引き前売上','세전 매출'],
'tax_paid': ['Sales tax paid','Verkaufssteuer','Taxe payée','Impuestos pagados','Уплаченный налог','已付销售税','支払った販売税','납부한 판매세'],
'purchase_batches': ['Purchase batches','Kaufchargen','Lots achetés','Lotes comprados','Партий куплено','购买批次','購入回数','구매 묶음'],
'units_sold': ['{units} units sold','{units} Einheiten verkauft','{units} unités vendues','{units} unidades vendidas','Продано единиц: {units}','已售{units}件','販売数量：{units}','{units}개 판매'],
'earnings_over_time': ['EARNINGS OVER TIME','ERLÖS IM ZEITVERLAUF','REVENUS AU FIL DU TEMPS','INGRESOS A LO LARGO DEL TIEMPO','ДОХОД ЗА ПЕРИОД','收入趋势','収益の推移','기간별 수익'],
'chart_caption': ['Teal: net earned  /  Amber: sales tax  /  {days} day(s) per bar  /  Hover for details',
 'Türkis: Nettoerlös  /  Gelb: Steuer  /  {days} Tag(e) pro Balken  /  Details beim Überfahren',
 'Turquoise : revenu net  /  Ambre : taxe  /  {days} jour(s) par barre  /  Survolez pour les détails',
 'Turquesa: neto  /  Ámbar: impuestos  /  {days} día(s) por barra  /  Pasa el cursor para ver detalles',
 'Бирюзовый: доход  /  Жёлтый: налог  /  Дней на столбец: {days}  /  Наведите для подробностей',
 '青色：净收入 / 琥珀色：销售税 / 每柱{days}天 / 悬停查看详情',
 '青緑：純利益 / 黄：販売税 / 1本あたり{days}日 / カーソルを重ねて詳細表示',
 '청록색: 순수익 / 황색: 판매세 / 막대당 {days}일 / 마우스를 올려 상세 확인'],
'top_sellers': ['TOP SELLING ITEMS','MEISTVERKAUFTE ARTIKEL','MEILLEURES VENTES','ARTÍCULOS MÁS VENDIDOS','ЛУЧШИЕ ТОВАРЫ ПО ВЫРУЧКЕ','畅销商品','売上上位アイテム','매출 상위 아이템'],
'sales_breakdown': ['SALES BREAKDOWN','VERKAUFSÜBERSICHT','RÉPARTITION DES VENTES','DESGLOSE DE VENTAS','СТРУКТУРА ПРОДАЖ','销售明细','売上の内訳','판매 내역'],
'offline_sales': ['Earned while offline','Offline verdient','Gagné hors ligne','Ganado sin conexión','Заработано офлайн','离线收入','オフライン中の収益','오프라인 수익'],
'online_sales': ['Earned while online','Online verdient','Gagné en ligne','Ganado en línea','Заработано онлайн','在线收入','オンライン中の収益','온라인 수익'],
'daily_net_average': ['Average net earnings per day','Durchschnittlicher Nettoerlös pro Tag','Revenu net moyen par jour','Ingreso neto medio por día','Средний чистый доход за день','日均净收入','1日あたりの平均純利益','일평균 순수익'],
'no_statistics': ['No completed sales in this period yet.','Noch keine abgeschlossenen Verkäufe in diesem Zeitraum.','Aucune vente terminée sur cette période.','Aún no hay ventas completadas en este periodo.','За этот период ещё нет завершённых продаж.','此期间尚无已完成的销售。','この期間の販売実績はまだありません。','이 기간에 완료된 판매가 없습니다.'],
'unknown_historical_tax': ['Some old receipts have no tax amount. Net earnings may be overstated.','Einige alte Belege haben keinen Steuerbetrag. Der Nettoerlös kann zu hoch sein.','Certains anciens reçus n’indiquent pas la taxe. Le revenu net peut être surestimé.','Algunos recibos antiguos no indican impuestos. Los ingresos netos pueden estar sobrestimados.','В некоторых старых квитанциях нет суммы налога. Чистый доход может быть завышен.','部分旧凭证缺少税额，净收入可能偏高。','古い記録の一部に税額がなく、純利益が多く表示される場合があります。','일부 이전 영수증에 세액이 없어 순수익이 실제보다 높을 수 있습니다.']
}
file = root/'client/locales.json'
rows['order'] = ['Order ID {order}', 'Auftrags-ID {order}', 'ID de l’ordre {order}', 'ID de orden {order}', 'ID ордера {order}', '订单ID {order}', '注文ID {order}', '주문 ID {order}']
catalogue = json.loads(file.read_text(encoding='utf-8'))
catalogue['strings'].update(rows)
file.write_text(json.dumps(catalogue, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
