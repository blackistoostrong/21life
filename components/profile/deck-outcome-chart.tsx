'use client';

import { Pie, PieChart } from 'recharts';

/** Counts define the sectors; the existing decisive-game win rate stays separate. */
export default function DeckOutcomeChart({ wins, draws, losses, winRate, label }: {
  wins: number; draws: number; losses: number; winRate: number; label: string;
}) {
  const data = [
    { value: wins, fill: '#34d399' },
    { value: draws, fill: '#22d3ee' },
    { value: losses, fill: '#64748b' },
  ];
  const hasGames = wins + draws + losses > 0;
  return (
    <div role="img" aria-label={label} className="relative h-28 w-28 rounded-full bg-secondary">
      <div aria-hidden="true">
        <PieChart width={112} height={112} accessibilityLayer={false}>
          <Pie data={hasGames ? data : [{ value: 1, fill: '#1e293b' }]} dataKey="value"
            cx="50%" cy="50%" innerRadius={40} outerRadius={56} stroke="none" isAnimationActive={false} />
        </PieChart>
      </div>
      <div className="absolute inset-4 grid place-items-center rounded-full bg-card text-center shadow-inner">
        <strong className="text-2xl text-emerald-300">{winRate}%</strong>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">win rate</span>
      </div>
    </div>
  );
}
