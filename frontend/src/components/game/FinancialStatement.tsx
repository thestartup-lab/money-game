import type { Player } from '../../types/game';

interface Props { player: Player; }

const fmt = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const sign = (n: number) => (n >= 0 ? '+' : '') + fmt(n);
const cls = (n: number) => (n >= 0 ? 'positive' : 'negative');

export default function FinancialStatement({ player }: Props) {
  const netWorth =
    player.cash +
    player.assets.reduce((s, a) => s + (a.currentValue ?? a.cost), 0) -
    player.liabilities.reduce((s, l) => s + l.totalDebt, 0);

  return (
    <div className="space-y-3">
      {/* 頂部摘要 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card text-center">
          <p className="text-xs text-gray-400">月現金流</p>
          <p className={`text-2xl font-bold ${cls(player.monthlyCashflow)}`}>
            ${fmt(player.monthlyCashflow)}
          </p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-400">手頭現金</p>
          <p className="text-2xl font-bold text-yellow-300">${fmt(player.cash)}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-400">月總收入</p>
          <p className="text-xl font-semibold positive">${fmt(player.totalIncome)}</p>
          <p className="text-xs text-gray-500">薪資 ${fmt(player.salary)} + 被動 ${fmt(player.totalPassiveIncome)}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-400">月總支出</p>
          <p className="text-xl font-semibold negative">${fmt(player.totalExpenses)}</p>
        </div>
      </div>

      {/* 淨資產 */}
      <div className="card flex justify-between items-center">
        <span className="text-gray-400">淨資產</span>
        <span className={`font-bold text-lg ${cls(netWorth)}`}>${fmt(netWorth)}</span>
      </div>

      {/* 資產列表 */}
      {player.assets.length > 0 && (
        <div className="card">
          <p className="text-sm text-gray-400 mb-2">資產 ({player.assets.length})</p>
          <div className="space-y-1">
            {player.assets.map((a) => (
              <div key={a.id} className="flex justify-between text-sm">
                <span className="text-gray-300 truncate max-w-[60%]">{a.name}</span>
                <span className={cls(a.monthlyCashflow)}>{sign(a.monthlyCashflow)}/月</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 負債列表 */}
      {player.liabilities.length > 0 && (
        <div className="card">
          <p className="text-sm text-gray-400 mb-2">負債 ({player.liabilities.length})</p>
          <div className="space-y-1">
            {player.liabilities.map((l) => (
              <div key={l.id} className="flex justify-between text-sm">
                <span className="text-gray-300 truncate max-w-[60%]">{l.name}</span>
                <span className="negative">-${fmt(l.monthlyPayment)}/月</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 支出細項 */}
      <div className="card">
        <p className="text-sm text-gray-400 mb-2">支出細項</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {player.expenses.taxes > 0 && <><span className="text-gray-400">稅金</span><span className="negative text-right">{fmt(player.expenses.taxes)}</span></>}
          {player.expenses.homeMortgagePayment > 0 && <><span className="text-gray-400">房貸</span><span className="negative text-right">{fmt(player.expenses.homeMortgagePayment)}</span></>}
          {player.expenses.carLoanPayment > 0 && <><span className="text-gray-400">車貸</span><span className="negative text-right">{fmt(player.expenses.carLoanPayment)}</span></>}
          {player.expenses.childExpenses > 0 && <><span className="text-gray-400">子女</span><span className="negative text-right">{fmt(player.expenses.childExpenses)}</span></>}
          {player.expenses.insurancePremiums > 0 && <><span className="text-gray-400">保費</span><span className="negative text-right">{fmt(player.expenses.insurancePremiums)}</span></>}
          {player.expenses.otherExpenses > 0 && <><span className="text-gray-400">其他</span><span className="negative text-right">{fmt(player.expenses.otherExpenses)}</span></>}
        </div>
      </div>

      {/* 能力值 */}
      <div className="card">
        <p className="text-sm text-gray-400 mb-2">能力值</p>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div>
            <div className="text-lg font-bold text-blue-400">{player.stats.financialIQ}</div>
            <div className="text-gray-500">財商 FQ</div>
          </div>
          <div>
            <div className={`text-lg font-bold ${player.stats.health > 30 ? 'text-green-400' : 'text-red-400'}`}>{player.stats.health}</div>
            <div className="text-gray-500">健康 HP</div>
          </div>
          <div>
            <div className="text-lg font-bold text-purple-400">{player.stats.careerSkill}</div>
            <div className="text-gray-500">專長 SK</div>
          </div>
          <div>
            <div className="text-lg font-bold text-yellow-400">{player.stats.network}</div>
            <div className="text-gray-500">人脈 NT</div>
          </div>
        </div>
      </div>

      {/* 生活狀態 */}
      <div className="card">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`px-2 py-1 rounded-full ${player.isMarried ? 'bg-pink-900 text-pink-200' : 'bg-gray-800 text-gray-500'}`}>
            {player.isMarried ? '💑 已婚' : '單身'}
          </span>
          <span className="px-2 py-1 rounded-full bg-blue-900 text-blue-200">
            👶 {player.numberOfChildren} 子女
          </span>
          <span className="px-2 py-1 rounded-full bg-amber-900 text-amber-200">
            ✨ 體驗值 {player.lifeExperience}
          </span>
          {player.isInFastTrack && (
            <span className="px-2 py-1 rounded-full bg-emerald-900 text-emerald-200">🚀 外圈</span>
          )}
          {player.isBedridden && (
            <span className="px-2 py-1 rounded-full bg-red-900 text-red-200">🛏 臥床</span>
          )}
          {player.insurance.hasMedicalInsurance && (
            <span className="px-2 py-1 rounded-full bg-teal-900 text-teal-200">🏥 醫療險</span>
          )}
          {player.insurance.hasLifeInsurance && (
            <span className="px-2 py-1 rounded-full bg-teal-900 text-teal-200">🛡 壽險</span>
          )}
        </div>
      </div>
    </div>
  );
}
